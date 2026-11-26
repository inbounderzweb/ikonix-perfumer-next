"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { z } from "zod";
import { db } from "@/server/db";
import { Order, Payment, Refund } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";
import { cancelOrder } from "@/server/commerce/orders";
import { allowedNext } from "@/server/commerce/order-flow";
import { queueOrderNotification, retryNotification, type OrderEvent } from "@/server/notify/order-notify";
import { RazorpayError, refundRazorpayPayment } from "@/server/commerce/razorpay";
import { INDIA_POST, checkConsignment, isIndiaPostCarrier } from "@/lib/shipment-tracking";
import { getConfig } from "@/server/shipping/india-post/config";
import { enrolmentFields, syncEnrolment } from "@/server/shipping/tracking/shipments";

export type OrderResult = { ok: true; message?: string } | { ok: false; error: string };


const numberRe = /^IKX-\d{6}-\d{5}$/;
const statusInput = z.object({
  orderNumber: z.string().regex(numberRe),
  to: z.enum(["PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "CANCELLED"]),
  carrier: z.string().trim().max(60).optional(),
  trackingNumber: z.string().trim().max(80).optional(),
  trackingUrl: z.string().trim().max(300).refine((u) => u === "" || /^https?:\/\//i.test(u), "Tracking link must start with http(s)://").optional(),
  note: z.string().trim().max(300).optional(), // internal, never shown to the customer
  description: z.string().trim().max(500).optional(), // shown to the customer in the tracking timeline
  estimatedDeliveryDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(), // only when staff or the courier actually provide one
});

const isIndiaPost = (carrier: string | undefined) => carrier === INDIA_POST || isIndiaPostCarrier(carrier);

/** Validates an India Post consignment number and flags likely typing mistakes without blocking a genuine one. */
async function consignment(raw: string, orderId: Types.ObjectId): Promise<{ ok: true; value: string; warnings: string[] } | { ok: false; error: string }> {
  const c = checkConsignment(raw);
  if (!c.ok) return c;
  const other = (await Order.findOne({ _id: { $ne: orderId }, "shipments.trackingNumber": c.value } as never, "orderNumber").lean()) as unknown as { orderNumber: string } | null;
  return { ok: true, value: c.value, warnings: [c.warning, other ? `${c.value} is also on order ${other.orderNumber}.` : undefined].filter((w): w is string => !!w) };
}

function failure(e: unknown): OrderResult {
  if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
  console.error("order action", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function updateOrderStatus(raw: unknown): Promise<OrderResult> {
  try {
    const admin = await requireAdmin("orders.write");
    const p = statusInput.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid request." };
    const v = p.data;
    await db();
    const o = (await Order.findOne({ orderNumber: v.orderNumber }, "status paymentStatus shipments").lean()) as unknown as { _id: Types.ObjectId; status: string; paymentStatus: string; shipments?: { shippedAt?: Date }[] } | null;
    if (!o) return { ok: false, error: "Order not found." };
    if (!allowedNext(o.status).includes(v.to)) return { ok: false, error: `An order that is ${o.status.toLowerCase().replace(/_/g, " ")} can't move to ${v.to.toLowerCase().replace(/_/g, " ")}.` };
    if (v.to !== "CANCELLED" && o.paymentStatus !== "CAPTURED") return { ok: false, error: "The order hasn't been paid yet." };

    if (v.to === "CANCELLED") {
      const done = await cancelOrder(o._id, v.note || "Cancelled by staff", { type: "ADMIN", userId: admin.id });
      if (!done) return { ok: false, error: "The order was already cancelled." };
      await audit(admin, "order.cancel", "Order", v.orderNumber, { before: { status: o.status } });
      queueOrderNotification(o._id, "CANCELLED", o.status);
      revalidatePath("/admin/orders");
      return { ok: true, message: o.paymentStatus === "CAPTURED" ? "Order cancelled and stock returned. Remember to refund the customer." : "Order cancelled." };
    }
    if (v.to === "SHIPPED" && !v.carrier) return { ok: false, error: "Enter the courier name to mark as shipped." };

    const now = new Date();
    let shipment: Record<string, unknown> | null = null;
    let warnings: string[] = [];
    let dropLink = false;
    if (v.to === "SHIPPED") {
      let { carrier, trackingNumber, trackingUrl } = v;
      let tracking = {};
      if (isIndiaPost(carrier)) {
        const c = await consignment(trackingNumber ?? "", o._id);
        if (!c.ok) return { ok: false, error: c.error };
        [carrier, trackingNumber, warnings] = [INDIA_POST, c.value, c.warnings];
        tracking = enrolmentFields(await getConfig(), now); // joins the central tracking queue
        [trackingUrl, dropLink] = [undefined, true]; // India Post has no per-parcel web link
      }
      shipment = { carrier, trackingNumber: trackingNumber || undefined, trackingUrl: trackingUrl || undefined, status: "SHIPPED", shippedAt: now, estimatedDeliveryDate: v.estimatedDeliveryDate ? new Date(`${v.estimatedDeliveryDate}T00:00:00Z`) : undefined, ...tracking };
    }
    // Courier details posted before dispatch already made a shipment: complete that one instead of adding a second.
    const reuse = !!shipment && !!o.shipments?.length && !o.shipments[0].shippedAt;
    const r = await Order.updateOne(
      { _id: o._id, status: o.status as never }, // guard against two staff acting at once
      {
        $set: { status: v.to, ...(v.to === "DELIVERED" ? { deliveredAt: now } : {}), ...(reuse ? Object.fromEntries(Object.entries(shipment!).filter(([, x]) => x !== undefined).map(([k, x]) => [`shipments.0.${k}`, x])) : {}) },
        ...(reuse && dropLink ? { $unset: { "shipments.0.trackingUrl": 1 } } : {}),
        $push: {
          statusHistory: { from: o.status, to: v.to, note: v.note || undefined, description: v.description || undefined, actorType: "ADMIN", actorUserId: admin.id },
          ...(shipment && !reuse ? { shipments: shipment } : {}),
        },
      } as never,
    );
    if (!r.modifiedCount) return { ok: false, error: "The order changed while you were editing. Reload and try again." };
    const shipStatus = ({ OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY", DELIVERED: "DELIVERED" } as Record<string, string>)[v.to];
    if (shipStatus && v.to !== "SHIPPED") {
      await Order.updateOne({ _id: o._id, "shipments.0": { $exists: true } }, { $set: { "shipments.$[].status": shipStatus, ...(v.to === "DELIVERED" ? { "shipments.$[].deliveredAt": now, "shipments.$[].trackingEnabled": false } : {}) } } as never);
    }
    await audit(admin, "order.status", "Order", v.orderNumber, { before: { status: o.status }, after: { status: v.to } });
    queueOrderNotification(o._id, v.to as OrderEvent, o.status);
    revalidatePath("/admin/orders");
    return { ok: true, ...(warnings.length ? { message: `Updated. ${warnings.join(" ")}` } : {}) };
  } catch (e) { return failure(e); }
}

const updateInput = z.object({
  orderNumber: z.string().regex(numberRe),
  carrier: z.string().trim().max(60).optional(),
  trackingNumber: z.string().trim().max(80).optional(),
  trackingUrl: z.string().trim().max(300).refine((u) => u === "" || /^https?:\/\//i.test(u), "Tracking link must start with http(s)://").optional(),
  estimatedDeliveryDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  description: z.string().trim().max(500).optional(),
});

/** Adds a customer-visible delivery update and/or courier details without changing the order status. */
export async function postOrderUpdate(raw: unknown): Promise<OrderResult> {
  try {
    const admin = await requireAdmin("orders.write");
    const p = updateInput.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid request." };
    const v = p.data;
    if (!v.description && !v.carrier && !v.trackingNumber && !v.trackingUrl && !v.estimatedDeliveryDate) return { ok: false, error: "Nothing to update." };
    await db();
    const o = (await Order.findOne({ orderNumber: v.orderNumber }, "status shipments").lean()) as unknown as { _id: Types.ObjectId; status: string; shipments: { _id: Types.ObjectId; carrier: string; trackingNumber?: string }[] } | null;
    if (!o) return { ok: false, error: "Order not found." };
    if (["PENDING", "CANCELLED", "REFUNDED"].includes(o.status)) return { ok: false, error: "This order can't receive delivery updates." };
    const hasShipmentInfo = v.carrier || v.trackingNumber || v.trackingUrl || v.estimatedDeliveryDate;
    let warnings: string[] = [];
    if (hasShipmentInfo) {
      let dropLink = false;
      const before = o.shipments[0] ? { carrier: o.shipments[0].carrier, trackingNumber: o.shipments[0].trackingNumber } : undefined;
      if ((v.carrier || v.trackingNumber) && isIndiaPost(v.carrier || before?.carrier)) {
        const number = v.trackingNumber || before?.trackingNumber;
        v.carrier = INDIA_POST;
        [v.trackingUrl, dropLink] = [undefined, true];
        if (number) {
          const c = await consignment(number, o._id);
          if (!c.ok) return { ok: false, error: c.error };
          [v.trackingNumber, warnings] = [c.value, c.warnings];
        }
      }
      if (o.shipments.length) {
        const set: Record<string, unknown> = {};
        if (v.carrier) set["shipments.0.carrier"] = v.carrier;
        if (v.trackingNumber) set["shipments.0.trackingNumber"] = v.trackingNumber;
        if (v.trackingUrl) set["shipments.0.trackingUrl"] = v.trackingUrl;
        if (v.estimatedDeliveryDate) set["shipments.0.estimatedDeliveryDate"] = new Date(`${v.estimatedDeliveryDate}T00:00:00Z`);
        await Order.updateOne({ _id: o._id }, { $set: set, ...(dropLink ? { $unset: { "shipments.0.trackingUrl": 1 } } : {}) } as never);
      } else if (v.carrier) {
        await Order.updateOne({ _id: o._id }, { $push: { shipments: { carrier: v.carrier, trackingNumber: v.trackingNumber || undefined, trackingUrl: v.trackingUrl || undefined, status: "PENDING", estimatedDeliveryDate: v.estimatedDeliveryDate ? new Date(`${v.estimatedDeliveryDate}T00:00:00Z`) : undefined } } } as never);
      } else return { ok: false, error: "Enter the courier name first." };
      if (v.carrier || v.trackingNumber) await syncEnrolment(o._id, before, await getConfig());
    }
    if (v.description) await Order.updateOne({ _id: o._id }, { $push: { statusHistory: { from: o.status, to: o.status, description: v.description, actorType: "ADMIN", actorUserId: admin.id } } } as never);
    await audit(admin, "order.update", "Order", v.orderNumber, { after: { description: v.description, carrier: v.carrier, trackingNumber: v.trackingNumber } });
    revalidatePath("/admin/orders");
    return { ok: true, message: ["Update saved. The customer will see it on their order.", ...warnings].join(" ") };
  } catch (e) { return failure(e); }
}

const refundInput = z.object({
  orderNumber: z.string().regex(numberRe),
  amount: z.coerce.number().positive().max(1_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimals"),
  reason: z.string().trim().min(3, "Give a reason").max(200),
});

export async function refundOrder(raw: unknown): Promise<OrderResult> {
  try {
    const admin = await requireAdmin("orders.refund");
    const p = refundInput.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid request." };
    const amount = Math.round(p.data.amount * 100);
    await db();
    const o = (await Order.findOne({ orderNumber: p.data.orderNumber }, "status paymentStatus grandTotal").lean()) as unknown as { _id: Types.ObjectId; status: string; paymentStatus: string; grandTotal: number } | null;
    if (!o) return { ok: false, error: "Order not found." };
    const pay = (await Payment.findOne({ orderId: o._id, status: { $in: ["CAPTURED", "PARTIALLY_REFUNDED"] } }).lean()) as unknown as { _id: Types.ObjectId; providerPaymentId?: string; amount: number } | null;
    if (!pay?.providerPaymentId) return { ok: false, error: "There is no captured payment to refund." };

    // Reserve the refund amount first (a REQUESTED row counts), so two clicks can't over-refund.
    const prior = await Refund.aggregate([{ $match: { orderId: o._id, status: { $ne: "FAILED" } } }, { $group: { _id: null, t: { $sum: "$amount" } } }]);
    const refunded = (prior[0]?.t as number | undefined) ?? 0;
    if (refunded + amount > pay.amount) return { ok: false, error: `Only ${((pay.amount - refunded) / 100).toFixed(2)} is left to refund.` };
    const row = await Refund.create({ orderId: o._id, paymentId: pay._id, amount, status: "REQUESTED", reason: p.data.reason, initiatedById: admin.id });
    try {
      const rf = await refundRazorpayPayment(pay.providerPaymentId, amount, { orderNumber: p.data.orderNumber, reason: p.data.reason.slice(0, 100) });
      const full = refunded + amount >= pay.amount;
      await Refund.updateOne({ _id: row._id }, { providerRefundId: rf.id, status: rf.status === "processed" ? "PROCESSED" : "PENDING", ...(rf.status === "processed" ? { processedAt: new Date() } : {}) });
      await Payment.updateOne({ _id: pay._id }, { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" });
      await Order.updateOne({ _id: o._id }, { paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED", ...(full && o.status !== "CANCELLED" ? { status: "REFUNDED" } : {}), $push: { statusHistory: { from: o.status, to: full && o.status !== "CANCELLED" ? "REFUNDED" : o.status, note: `Refund of ₹${(amount / 100).toFixed(2)}: ${p.data.reason}`, actorType: "ADMIN", actorUserId: admin.id } } });
      await audit(admin, "order.refund", "Order", p.data.orderNumber, { after: { amount, razorpayRefund: rf.id } });
      if (full) queueOrderNotification(o._id, "REFUNDED", o.status);
      revalidatePath("/admin/orders");
      return { ok: true, message: `Refund of ₹${(amount / 100).toFixed(2)} initiated.` };
    } catch (e) {
      await Refund.updateOne({ _id: row._id }, { status: "FAILED" });
      return { ok: false, error: e instanceof RazorpayError ? `Razorpay: ${e.message}` : "The refund could not be processed." };
    }
  } catch (e) { return failure(e); }
}

/** Retry a failed customer email/SMS from the order's notification history. */
export async function retryOrderNotification(notificationId: string): Promise<OrderResult> {
  try {
    const admin = await requireAdmin("orders.write");
    if (!/^[a-f0-9]{24}$/i.test(notificationId)) return { ok: false, error: "Invalid request." };
    const r = await retryNotification(notificationId);
    await audit(admin, "order.notification.retry", "Notification", notificationId, { after: { ok: r.ok } });
    revalidatePath("/admin/orders");
    return r.ok ? { ok: true, message: "Sent." } : { ok: false, error: r.error ?? "Retry failed." };
  } catch (e) { return failure(e); }
}
