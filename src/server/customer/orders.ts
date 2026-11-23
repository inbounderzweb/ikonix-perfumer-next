import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Inventory, Order, Payment, Product } from "@/server/models";
import { safeEqual, sha256 } from "@/server/auth/crypto";

/** Orders a customer should see: unpaid checkout attempts (PENDING, never captured) are hidden. */
const visible = { $or: [{ status: { $ne: "PENDING" } }, { paymentStatus: "CAPTURED" }] };

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting payment", CONFIRMED: "Confirmed", PROCESSING: "Processing", PACKED: "Packed", SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", DELIVERY_FAILED: "Delivery failed", CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested", RETURNED: "Returned", REFUNDED: "Refunded",
};
const ACTIVE = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"];
const FILTERS: Record<string, string[]> = { active: ACTIVE, delivered: ["DELIVERED"], cancelled: ["CANCELLED", "REFUNDED"], returned: ["RETURN_REQUESTED", "RETURNED"] };

type Item = { productId: Types.ObjectId; variantId: Types.ObjectId; productName: string; variantLabel: string; imageUrl?: string; unitSalePrice: number; unitRegularPrice: number; quantity: number; freeQuantity: number; lineDiscount: number; lineTotal: number };
type Row = { _id: Types.ObjectId; orderNumber: string; status: string; paymentStatus: string; placedAt: Date; grandTotal: number; items: Item[] };

export type OrderSummary = { orderNumber: string; status: string; statusLabel: string; paymentStatus: string; placedAt: string; total: number; itemCount: number; thumbs: { name: string; image: string | null }[] };
const summary = (o: Row): OrderSummary => ({
  orderNumber: o.orderNumber, status: o.status, statusLabel: STATUS_LABEL[o.status] ?? o.status, paymentStatus: o.paymentStatus, placedAt: o.placedAt.toISOString(), total: o.grandTotal,
  itemCount: o.items.reduce((a, i) => a + i.quantity + i.freeQuantity, 0), thumbs: o.items.slice(0, 3).map((i) => ({ name: i.productName, image: i.imageUrl ?? null })),
});

export type OrderQuery = { q?: string; status?: string; from?: string; to?: string; page?: number };
export const PAGE_SIZE = 10;

/** Every query includes userId from the verified session, so another customer's order can never be listed. */
export async function listOrders(userId: string, f: OrderQuery) {
  await db();
  const q: Record<string, unknown> = { userId: new Types.ObjectId(userId), ...visible };
  if (f.status && FILTERS[f.status]) q.status = { $in: FILTERS[f.status] };
  const term = (f.q ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
  if (f.q?.trim() && !term) q.orderNumber = "__none__"; // a query with no usable characters matches nothing (not everything)
  else if (term) q.orderNumber = { $regex: `^${term}` }; // sanitised to [A-Z0-9-], so it cannot inject regex syntax
  const range: Record<string, Date> = {};
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) range.$gte = new Date(`${f.from}T00:00:00+05:30`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) range.$lte = new Date(`${f.to}T23:59:59.999+05:30`);
  if (Object.keys(range).length) q.placedAt = range;
  const page = Math.max(1, Math.min(500, f.page ?? 1));
  const [rows, total] = await Promise.all([
    Order.find(q, "orderNumber status paymentStatus placedAt grandTotal items").sort({ placedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean() as unknown as Promise<Row[]>,
    Order.countDocuments(q as never),
  ]);
  return { orders: rows.map(summary), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export type TimelineStep = { key: string; label: string; state: "done" | "current" | "upcoming"; at: string | null };
export type TimelineEvent = { status: string; label: string; at: string; description: string | null; by: string };
const MAIN = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"] as const;

/** Builds the stepper from the real status history. A step is "done" only if the history records it (no guessed progress). */
export function buildTimeline(status: string, placedAt: Date, history: { to: string; at: Date }[]) {
  const reached = new Map<string, Date>();
  for (const h of history) if (!reached.has(h.to)) reached.set(h.to, h.at);
  const terminal = ["CANCELLED", "DELIVERY_FAILED", "RETURN_REQUESTED", "RETURNED", "REFUNDED"].includes(status);
  const steps: TimelineStep[] = [{ key: "PLACED", label: "Order placed", state: "done", at: placedAt.toISOString() }];
  const curIdx = (MAIN as readonly string[]).indexOf(status);
  for (const [i, k] of MAIN.entries()) {
    const at = reached.get(k);
    // Skipped steps (e.g. staff jumped PACKED→SHIPPED) show as passed without a fake time.
    const passed = curIdx >= 0 ? i <= curIdx : !!at;
    steps.push({ key: k, label: STATUS_LABEL[k], state: passed ? (i === curIdx && k !== "DELIVERED" ? "current" : "done") : "upcoming", at: at?.toISOString() ?? null });
  }
  const end = terminal ? (["DELIVERY_FAILED", "CANCELLED", "RETURN_REQUESTED", "RETURNED", "REFUNDED"] as const).filter((k) => reached.has(k) || k === status) : [];
  for (const k of end) steps.push({ key: k, label: STATUS_LABEL[k], state: k === status ? "current" : "done", at: reached.get(k)?.toISOString() ?? null });
  return steps;
}

export type OrderDetail = ReturnType<typeof toDetail> extends infer R ? R : never;
function toDetail(o: Row & { subtotal: number; discountTotal: number; shippingTotal: number; packingTotal: number; taxTotal: number; couponCode?: string; shippingMethodName: string; contact: { name: string; phone: string; email?: string }; shippingAddress: Record<string, string | undefined>; statusHistory: { from?: string; to: string; description?: string; actorType: string; at: Date }[]; shipments: { carrier: string; trackingNumber?: string; trackingUrl?: string; status: string; estimatedDeliveryDate?: Date; shippedAt?: Date; deliveredAt?: Date }[]; cancelReason?: string }, pay: { providerPaymentId?: string; method?: string; methodDetail?: string; status: string } | null) {
  const sh = o.shipments[0];
  return {
    ...summary(o),
    items: o.items.map((i) => ({ productId: String(i.productId), variantId: String(i.variantId), name: i.productName, variant: i.variantLabel, image: i.imageUrl ?? null, unit: i.unitSalePrice, regular: i.unitRegularPrice, qty: i.quantity, free: i.freeQuantity, discount: i.lineDiscount, total: i.lineTotal })),
    subtotal: o.subtotal, discount: o.discountTotal, shipping: o.shippingTotal, packing: o.packingTotal, tax: o.taxTotal, coupon: o.couponCode ?? null,
    shippingMethod: o.shippingMethodName, address: { name: o.shippingAddress.fullName ?? "", phone: o.shippingAddress.phone ?? "", lines: [o.shippingAddress.line1, o.shippingAddress.line2, o.shippingAddress.landmark].filter(Boolean) as string[], city: o.shippingAddress.city ?? "", state: o.shippingAddress.state ?? "", postalCode: o.shippingAddress.postalCode ?? "" },
    payment: { status: o.paymentStatus, method: pay?.method ?? null, methodDetail: pay?.methodDetail ?? null, transactionId: pay?.providerPaymentId ?? null },
    shipment: sh ? { carrier: sh.carrier, trackingNumber: sh.trackingNumber ?? null, trackingUrl: sh.trackingUrl ?? null, estimatedDelivery: sh.estimatedDeliveryDate?.toISOString() ?? null } : null,
    cancelReason: o.cancelReason ?? null,
    timeline: buildTimeline(o.status, o.placedAt, o.statusHistory),
    // Customer-visible history only: staff-internal notes are never selected into this view.
    events: [...o.statusHistory].reverse().map((h): TimelineEvent => ({ status: h.to, label: STATUS_LABEL[h.to] ?? h.to, at: h.at.toISOString(), description: h.description ?? null, by: h.actorType === "ADMIN" ? "Ikonix team" : h.actorType === "CUSTOMER" ? "You" : "System" })),
  };
}

async function fetchDetail(filter: Record<string, unknown>) {
  await db();
  const o = (await Order.findOne(filter as never, "-statusHistory.note -ipAddress -userAgent -pricingSnapshot -idempotencyKey").lean()) as unknown as Parameters<typeof toDetail>[0] | null;
  if (!o) return null;
  const pay = (await Payment.findOne({ orderId: o._id }, "providerPaymentId method methodDetail status").lean()) as unknown as Parameters<typeof toDetail>[1];
  return toDetail(o, pay);
}

export async function getOrder(userId: string, orderNumber: string) {
  if (!/^IKX-\d{6}-\d{5}$/.test(orderNumber)) return null;
  // Ownership is part of the query: someone else's order number returns null, indistinguishable from "doesn't exist".
  return fetchDetail({ orderNumber, userId: new Types.ObjectId(userId), ...visible });
}

/** Guest access: the order is returned only if the private checkout token matches (same "not found" for wrong token or number). */
export async function getOrderByToken(orderNumber: string, token: string) {
  if (!/^IKX-\d{6}-\d{5}$/.test(orderNumber) || !token || token.length > 80) return null;
  await db();
  const o = (await Order.findOne({ orderNumber }, "+accessTokenHash").lean()) as unknown as { accessTokenHash?: string } | null;
  if (!o?.accessTokenHash || !safeEqual(sha256(token), o.accessTokenHash)) return null;
  return fetchDetail({ orderNumber });
}

export async function dashboardStats(userId: string) {
  await db();
  const uid = new Types.ObjectId(userId);
  const grouped = (await Order.aggregate([{ $match: { userId: uid, ...visible } }, { $group: { _id: "$status", n: { $sum: 1 } } }])) as { _id: string; n: number }[];
  const by = Object.fromEntries(grouped.map((g) => [g._id, g.n]));
  const sum = (ks: string[]) => ks.reduce((a, k) => a + (by[k] ?? 0), 0);
  const recent = (await Order.find({ userId: uid, ...visible } as never, "orderNumber status paymentStatus placedAt grandTotal items").sort({ placedAt: -1 }).limit(4).lean()) as unknown as Row[];
  const events = (await Order.aggregate([
    { $match: { userId: uid, ...visible } }, { $unwind: "$statusHistory" }, { $match: { "statusHistory.to": { $ne: "PENDING" } } },
    { $sort: { "statusHistory.at": -1 } }, { $limit: 6 }, { $project: { orderNumber: 1, to: "$statusHistory.to", at: "$statusHistory.at", description: "$statusHistory.description" } },
  ])) as { orderNumber: string; to: string; at: Date; description?: string }[];
  return {
    total: Object.values(by).reduce((a, b) => a + b, 0), active: sum(ACTIVE), delivered: sum(["DELIVERED"]), cancelled: sum(["CANCELLED", "REFUNDED"]),
    recent: recent.map(summary), activities: events.map((e) => ({ orderNumber: e.orderNumber, label: STATUS_LABEL[e.to] ?? e.to, at: e.at.toISOString(), description: e.description ?? null })),
  };
}

export type ReorderResult = { ok: true; lines: { variantId: string; qty: number }[]; skipped: { name: string; reason: string }[] } | { ok: false; error: string };

/** Re-adds what is still purchasable, at today's prices (the cart is always re-priced server-side at checkout). */
export async function reorderLines(userId: string, orderNumber: string): Promise<ReorderResult> {
  if (!/^IKX-\d{6}-\d{5}$/.test(orderNumber)) return { ok: false, error: "Order not found." };
  await db();
  const o = (await Order.findOne({ orderNumber, userId: new Types.ObjectId(userId), ...visible } as never, "items").lean()) as unknown as { items: Item[] } | null;
  if (!o) return { ok: false, error: "Order not found." };
  const vids = o.items.map((i) => i.variantId);
  const ps = (await Product.find({ "variants._id": { $in: vids }, status: "ACTIVE", deletedAt: null }, "variants._id variants.isActive").lean()) as unknown as { variants: { _id: Types.ObjectId; isActive: boolean }[] }[];
  const live = new Set(ps.flatMap((p) => p.variants.filter((v) => v.isActive).map((v) => String(v._id))));
  const inv = (await Inventory.find({ variantId: { $in: vids } }).lean()) as unknown as { variantId: Types.ObjectId; tracked: boolean; onHand: number; reserved: number; manualAvailability: string }[];
  const free = new Map(inv.map((r) => [String(r.variantId), r.tracked ? Math.max(0, r.onHand - r.reserved) : r.manualAvailability === "IN_STOCK" ? 99 : 0]));
  const lines: { variantId: string; qty: number }[] = []; const skipped: { name: string; reason: string }[] = [];
  for (const i of o.items) {
    const id = String(i.variantId); const avail = free.get(id) ?? 0;
    if (!live.has(id)) skipped.push({ name: `${i.productName} (${i.variantLabel})`, reason: "no longer available" });
    else if (avail <= 0) skipped.push({ name: `${i.productName} (${i.variantLabel})`, reason: "out of stock" });
    else { lines.push({ variantId: id, qty: Math.min(i.quantity, avail) }); if (avail < i.quantity) skipped.push({ name: `${i.productName} (${i.variantLabel})`, reason: `only ${avail} left` }); }
  }
  return { ok: true, lines, skipped };
}
