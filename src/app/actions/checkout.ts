"use server";

import { Types } from "mongoose";
import { z } from "zod";
import { db } from "@/server/db";
import { Inventory, Order, Payment } from "@/server/models";
import { INDIAN_STATES } from "@/lib/india";
import { activeShippingMethods, cartLines, priceCart } from "@/server/commerce/pricing";
import { RESERVATION_MS, cancelOrder, expirePendingOrders, markOrderPaid, nextOrderNumber, reserveStock } from "@/server/commerce/orders";
import { RazorpayError, captureRazorpayPayment, createRazorpayOrder, fetchRazorpayPayment, razorpayMode, razorpayPublicKey, verifyPaymentSignature } from "@/server/commerce/razorpay";
import { randomToken, sha256, safeEqual } from "@/server/auth/crypto";
import { rateLimit } from "@/server/auth/rate-limit";
import { clientMeta } from "@/server/auth/request";
import { getCustomer } from "@/server/auth/customer-session";

export type Quote = { ok: true; subtotal: number; shipping: number; discount: number; tax: number; total: number; methods: Awaited<ReturnType<typeof activeShippingMethods>> } | { ok: false; error: string };

/** Totals shown on the checkout page. Authoritative totals are recomputed again when the order is created. */
export async function getCheckoutQuote(lines: unknown, shippingMethodId?: string): Promise<Quote> {
  const methods = await activeShippingMethods();
  const chosen = shippingMethodId && methods.some((m) => m.id === shippingMethodId) ? shippingMethodId : methods[0]?.id;
  const p = await priceCart(lines, chosen);
  if (!p.ok) return p;
  return { ok: true, subtotal: p.subtotal, shipping: p.shippingTotal, discount: p.discountTotal, tax: p.taxTotal, total: p.grandTotal, methods };
}

const phone = z.string().trim().transform((s) => s.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=[6-9]\d{9}$)/, "")).refine((s) => /^[6-9]\d{9}$/.test(s), "Enter a valid 10-digit mobile number").transform((s) => `+91${s}`);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const checkoutInput = z.object({
  lines: cartLines,
  shippingMethodId: z.string().regex(/^[a-f0-9]{24}$/, "Choose a delivery method"),
  idempotencyKey: z.string().uuid(),
  contact: z.object({ name: text(2, 80), phone, email: z.union([z.email().max(200), z.literal("")]).transform((s) => s.toLowerCase()) }),
  address: z.object({
    line1: text(3, 150), line2: z.string().trim().max(150).default(""), landmark: z.string().trim().max(100).default(""),
    city: text(2, 80), state: z.enum(INDIAN_STATES), postalCode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code"),
  }),
  customerNote: z.string().trim().max(300).default(""),
});

export type CheckoutResult =
  | { ok: true; orderNumber: string; accessToken: string; razorpay: { keyId: string; orderId: string; amount: number; currency: "INR"; testMode: boolean }; prefill: { name: string; email: string; contact: string } }
  | { ok: false; error: string; fields?: Record<string, string> };

export async function createCheckout(raw: unknown): Promise<CheckoutResult> {
  const p = checkoutInput.safeParse(raw);
  if (!p.success) {
    const fields: Record<string, string> = {};
    for (const i of p.error.issues) fields[i.path.join(".")] ??= i.message;
    return { ok: false, error: "Please check the highlighted details.", fields };
  }
  const input = p.data;
  const me = await getCustomer(); // identity comes from the session cookie only; the client never supplies a user id
  const { ip, userAgent } = await clientMeta();
  if (!(await rateLimit(`checkout:${ip}`, 15, 600))) return { ok: false, error: "Too many attempts. Please wait a few minutes and try again." };
  await db();
  void expirePendingOrders(); // housekeeping; never blocks the customer

  // Retry of the same attempt (double click, flaky network): hand back the existing Razorpay order.
  const existing = (await Order.findOne({ idempotencyKey: input.idempotencyKey }, "orderNumber status paymentStatus grandTotal contact").lean()) as unknown as { _id: Types.ObjectId; orderNumber: string; status: string; paymentStatus: string; grandTotal: number; contact: { name: string; phone: string; email?: string } } | null;
  if (existing) {
    const pay = (await Payment.findOne({ orderId: existing._id }).lean()) as unknown as { providerOrderId: string } | null;
    if (existing.status !== "PENDING" || !pay) return { ok: false, error: "This order was already processed. Start a new checkout." };
    // The access token is only ever returned at creation; a retry mints a fresh one (the old link stays valid until replaced).
    const token = randomToken(24);
    await Order.updateOne({ _id: existing._id }, { accessTokenHash: sha256(token) });
    return { ok: true, orderNumber: existing.orderNumber, accessToken: token, razorpay: { keyId: razorpayPublicKey(), orderId: pay.providerOrderId, amount: existing.grandTotal, currency: "INR", testMode: razorpayMode() === "test" }, prefill: { name: existing.contact.name, email: existing.contact.email ?? "", contact: existing.contact.phone } };
  }

  const priced = await priceCart(input.lines, input.shippingMethodId);
  if (!priced.ok) return priced;
  if (!priced.method) return { ok: false, error: "Choose a delivery method." };
  if (priced.grandTotal < 100) return { ok: false, error: "The order total is too low to pay online." };

  const stock = await reserveStock(priced.items);
  if (!stock.ok) return stock;

  const token = randomToken(24);
  const orderNumber = await nextOrderNumber();
  const addr = { fullName: input.contact.name, phone: input.contact.phone, line1: input.address.line1, line2: input.address.line2 || undefined, landmark: input.address.landmark || undefined, city: input.address.city, state: input.address.state, postalCode: input.address.postalCode, country: "IN" };
  let order;
  try {
    order = await Order.create({
      orderNumber, userId: me ? new Types.ObjectId(me.id) : null, status: "PENDING", paymentStatus: "CREATED", currency: "INR",
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      items: priced.items.map(({ tracked, ...i }) => i),
      subtotal: priced.subtotal, discountTotal: 0, shippingTotal: priced.shippingTotal, packingTotal: 0, taxTotal: 0, grandTotal: priced.grandTotal,
      pricingSnapshot: { version: 1, note: "Offers, packing and tax not applied (rules pending)", stockState: stock.reserved.length ? "RESERVED" : "NONE", reserved: stock.reserved },
      contact: { name: input.contact.name, phone: input.contact.phone, email: input.contact.email || undefined },
      shippingAddress: addr, billingAddress: addr, shippingMethodId: priced.method.id, shippingMethodName: priced.method.name,
      customerNote: input.customerNote || undefined, idempotencyKey: input.idempotencyKey, accessTokenHash: sha256(token),
      reservationExpiresAt: new Date(Date.now() + RESERVATION_MS), statusHistory: [{ from: null, to: "PENDING", note: "Order created", actorType: "CUSTOMER" }],
      ipAddress: ip, userAgent,
    });
  } catch (e) {
    for (const r of stock.reserved) await Inventory.updateOne({ variantId: r.variantId, reserved: { $gte: r.qty } }, { $inc: { reserved: -r.qty } });
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "This checkout is already in progress. Refresh and try again." };
    console.error("order create failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not create your order. Please try again." };
  }

  try {
    const rz = await createRazorpayOrder(priced.grandTotal, orderNumber, { orderId: String(order._id), orderNumber });
    await Payment.create({ orderId: order._id, providerOrderId: rz.id, amount: priced.grandTotal, currency: "INR", status: "CREATED" });
    return { ok: true, orderNumber, accessToken: token, razorpay: { keyId: razorpayPublicKey(), orderId: rz.id, amount: priced.grandTotal, currency: "INR", testMode: razorpayMode() === "test" }, prefill: { name: input.contact.name, email: input.contact.email, contact: input.contact.phone } };
  } catch (e) {
    await cancelOrder(order._id, "Payment gateway unavailable", { type: "SYSTEM" });
    console.error("razorpay order failed", e instanceof RazorpayError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : e);
    return { ok: false, error: "The payment gateway is unavailable right now. You have not been charged. Please try again shortly." };
  }
}

const verifyInput = z.object({
  orderNumber: z.string().regex(/^IKX-\d{6}-\d{5}$/),
  accessToken: z.string().min(20).max(80),
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i),
});

/**
 * Called by the browser after Razorpay Checkout succeeds. The browser is NOT trusted: we verify the HMAC signature,
 * then ask Razorpay's API for the payment itself (status + amount) before marking anything paid.
 */
export async function verifyPayment(raw: unknown): Promise<{ ok: true; orderNumber: string; needsAttention?: boolean } | { ok: false; error: string }> {
  const p = verifyInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Invalid payment response." };
  const v = p.data;
  const { ip } = await clientMeta();
  if (!(await rateLimit(`verify:${ip}`, 30, 600))) return { ok: false, error: "Too many attempts. Try again shortly." };
  await db();

  const order = (await Order.findOne({ orderNumber: v.orderNumber }, "+accessTokenHash grandTotal").lean()) as unknown as { _id: Types.ObjectId; accessTokenHash?: string; grandTotal: number } | null;
  const pay = order ? ((await Payment.findOne({ orderId: order._id }).lean()) as unknown as { providerOrderId: string; amount: number } | null) : null;
  if (!order || !pay || !order.accessTokenHash || !safeEqual(sha256(v.accessToken), order.accessTokenHash)) return { ok: false, error: "We couldn't find that order." };
  if (pay.providerOrderId !== v.razorpay_order_id) return { ok: false, error: "Payment does not match this order." };
  if (!verifyPaymentSignature(v.razorpay_order_id, v.razorpay_payment_id, v.razorpay_signature)) {
    console.warn("razorpay signature mismatch", v.orderNumber);
    return { ok: false, error: "We couldn't verify this payment. If money was deducted it will be reviewed automatically." };
  }
  try {
    let rp = await fetchRazorpayPayment(v.razorpay_payment_id);
    if (rp.order_id !== pay.providerOrderId || rp.amount !== pay.amount || rp.currency !== "INR") return { ok: false, error: "Payment details do not match this order." };
    if (rp.status === "authorized") rp = await captureRazorpayPayment(rp.id, pay.amount);
    if (rp.status !== "captured") return { ok: false, error: "The payment was not completed." };
    const r = await markOrderPaid(order._id, { providerPaymentId: rp.id, method: rp.method, methodDetail: rp.vpa ?? rp.bank ?? rp.wallet ?? rp.card?.network });
    return { ok: true, orderNumber: v.orderNumber, needsAttention: r === "needs_refund" };
  } catch (e) {
    // The signature was valid, so money probably moved. The webhook (or a retry) will finish confirming.
    console.error("verifyPayment", e instanceof Error ? e.message : e);
    return { ok: false, error: "Your payment was received but we couldn't confirm it yet. Please don't pay again; check your order in a minute." };
  }
}
