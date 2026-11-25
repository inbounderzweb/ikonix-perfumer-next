import "server-only";
import type { PipelineStage } from "mongoose";
import { db } from "@/server/db";
import { Order, Payment } from "@/server/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/server/models/commerce";
import { escapeRe } from "@/server/admin/products";
import { dateRange, one } from "@/server/admin/util";

type SP = Record<string, string | string[] | undefined>;
/** Orders that are not (or no longer) revenue. The default view leaves these out; pick "Every status" to include them. */
export const NON_SALE_STATUSES = ["PENDING", "CANCELLED", "REFUNDED"] as const;
export const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"], ["year", "This year"], ["all", "All time"]] as const;
export const GROUPS = ["day", "week", "month"] as const;
export type Group = (typeof GROUPS)[number];

const ist = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d); // YYYY-MM-DD in India time
const DAY = 86_400_000;

/** Turns a quick-range name into from/to dates (India time, `to` inclusive). */
export function presetRange(p: string): { from: string; to: string } | null {
  const now = new Date(); const today = ist(now); const [y, m] = today.split("-");
  switch (p) {
    case "today": return { from: today, to: today };
    case "yesterday": { const d = ist(new Date(now.getTime() - DAY)); return { from: d, to: d }; }
    case "7d": return { from: ist(new Date(now.getTime() - 6 * DAY)), to: today };
    case "30d": return { from: ist(new Date(now.getTime() - 29 * DAY)), to: today };
    case "month": return { from: `${y}-${m}-01`, to: today };
    case "lastmonth": { const first = new Date(`${y}-${m}-01T00:00:00+05:30`); const last = new Date(first.getTime() - DAY); return { from: `${ist(last).slice(0, 8)}01`, to: ist(last) }; }
    case "year": return { from: `${y}-01-01`, to: today };
    default: return null;
  }
}

export type SalesFilters = {
  range: string; from: string; to: string; status: string; payment: string; method: string; source: string; customer: string;
  state: string; coupon: string; min: string; max: string; product: string; q: string; group: Group;
};

export function parseSalesFilters(sp: SP): SalesFilters {
  const range = one(sp.range);
  const p = presetRange(range);
  const rupee = (v: string) => (/^\d{1,9}(\.\d{1,2})?$/.test(v) ? v : "");
  const group = one(sp.group);
  return {
    range: p || range === "all" ? range : one(sp.from) || one(sp.to) ? "custom" : "30d",
    from: p?.from ?? (range === "all" ? "" : one(sp.from)), to: p?.to ?? (range === "all" ? "" : one(sp.to)),
    status: one(sp.status), payment: one(sp.payment), method: one(sp.method).slice(0, 30), source: one(sp.source), customer: one(sp.customer),
    state: one(sp.state).slice(0, 60), coupon: one(sp.coupon).trim().slice(0, 40), min: rupee(one(sp.min)), max: rupee(one(sp.max)),
    product: one(sp.product).trim().slice(0, 60), q: one(sp.q).trim().slice(0, 60), group: (GROUPS as readonly string[]).includes(group) ? (group as Group) : "day",
  };
}

/** Builds the Mongo match for an order list. Every value is validated or escaped; nothing from the URL is used as an operator. */
export async function salesMatch(f: SalesFilters): Promise<Record<string, unknown>> {
  await db();
  const m: Record<string, unknown> = {};
  const placed = dateRange(f.from, f.to); if (placed) m.placedAt = placed;
  if (f.status === "all") { /* every status */ } else if ((ORDER_STATUS as readonly string[]).includes(f.status)) m.status = f.status;
  else m.status = { $nin: [...NON_SALE_STATUSES] };
  if ((PAYMENT_STATUS as readonly string[]).includes(f.payment)) m.paymentStatus = f.payment;
  if (f.method) m._id = { $in: await Payment.distinct("orderId", { method: f.method }) };
  if (f.source === "legacy") m["legacy.source"] = { $exists: true }; else if (f.source === "new") m["legacy.source"] = { $exists: false };
  if (f.customer === "guest") m.userId = null; else if (f.customer === "registered") m.userId = { $ne: null };
  if (f.state) m["shippingAddress.state"] = new RegExp(`^${escapeRe(f.state)}$`, "i");
  if (f.coupon === "any") m.couponCode = { $nin: [null, ""] }; else if (f.coupon === "none") m.couponCode = { $in: [null, ""] };
  else if (f.coupon) m.couponCode = new RegExp(`^${escapeRe(f.coupon)}$`, "i");
  if (f.min || f.max) m.grandTotal = { ...(f.min ? { $gte: Math.round(Number(f.min) * 100) } : {}), ...(f.max ? { $lte: Math.round(Number(f.max) * 100) } : {}) };
  if (f.product) { const re = new RegExp(escapeRe(f.product), "i"); m.items = { $elemMatch: { $or: [{ productName: re }, { sku: re }] } }; }
  if (f.q) { const re = new RegExp(escapeRe(f.q), "i"); m.$or = [{ orderNumber: re }, { "contact.phone": re }, { "contact.name": re }, { "contact.email": re }]; }
  return m;
}

export type Bucket = { _id: string | null; orders: number; revenue: number };
export type SalesSummary = {
  totals: { orders: number; gross: number; subtotal: number; discount: number; shipping: number; packing: number; tax: number; units: number };
  customers: number;
  trend: (Bucket & { units: number })[];
  byStatus: Bucket[]; byPayment: Bucket[]; byState: Bucket[]; byCoupon: Bucket[];
  topProducts: { _id: string; name: string; sku: string; units: number; orders: number; revenue: number }[];
};

export async function salesSummary(match: Record<string, unknown>, f: SalesFilters): Promise<SalesSummary> {
  await db();
  const bucket = (field: string | object, extra: PipelineStage.FacetPipelineStage[] = []): PipelineStage.FacetPipelineStage[] => [{ $group: { _id: field, orders: { $sum: 1 }, revenue: { $sum: "$grandTotal" } } }, { $sort: { revenue: -1 } }, ...extra];
  const productRe = f.product ? new RegExp(escapeRe(f.product), "i") : null;
  const [r] = await Order.aggregate([
    { $match: match },
    { $facet: {
      totals: [{ $group: { _id: null, orders: { $sum: 1 }, gross: { $sum: "$grandTotal" }, subtotal: { $sum: "$subtotal" }, discount: { $sum: "$discountTotal" }, shipping: { $sum: "$shippingTotal" }, packing: { $sum: "$packingTotal" }, tax: { $sum: "$taxTotal" }, units: { $sum: { $add: [{ $sum: "$items.quantity" }, { $sum: "$items.freeQuantity" }] } } } }],
      customers: [{ $group: { _id: { $ifNull: ["$userId", "$contact.phone"] } } }, { $count: "n" }],
      trend: [
        { $group: { _id: { $dateToString: { format: f.group === "month" ? "%Y-%m" : "%Y-%m-%d", date: { $dateTrunc: { date: "$placedAt", unit: f.group, timezone: "Asia/Kolkata", startOfWeek: "monday" } }, timezone: "Asia/Kolkata" } }, orders: { $sum: 1 }, revenue: { $sum: "$grandTotal" }, units: { $sum: { $add: [{ $sum: "$items.quantity" }, { $sum: "$items.freeQuantity" }] } } } },
        { $sort: { _id: 1 } }, { $limit: 400 },
      ],
      byStatus: bucket("$status"), byPayment: bucket("$paymentStatus"),
      byState: bucket("$shippingAddress.state", [{ $limit: 15 }]),
      byCoupon: [{ $match: { couponCode: { $nin: [null, ""] } } }, ...bucket({ $toUpper: "$couponCode" }, [{ $limit: 10 }])],
      topProducts: [
        { $unwind: "$items" },
        ...(productRe ? [{ $match: { $or: [{ "items.productName": productRe }, { "items.sku": productRe }] } }] : []),
        { $group: { _id: { $ifNull: [{ $toString: "$items.productId" }, "$items.sku"] }, name: { $first: "$items.productName" }, sku: { $first: "$items.sku" }, units: { $sum: { $add: ["$items.quantity", "$items.freeQuantity"] } }, orders: { $sum: 1 }, revenue: { $sum: "$items.lineTotal" } } },
        { $sort: { revenue: -1 } }, { $limit: 15 },
      ],
    } },
  ]);
  const zero = { orders: 0, gross: 0, subtotal: 0, discount: 0, shipping: 0, packing: 0, tax: 0, units: 0 };
  return { totals: r.totals[0] ?? zero, customers: r.customers[0]?.n ?? 0, trend: r.trend, byStatus: r.byStatus, byPayment: r.byPayment, byState: r.byState, byCoupon: r.byCoupon, topProducts: r.topProducts };
}

/** Values for the filter drop-downs. */
export async function salesFilterOptions() {
  await db();
  const [states, methods] = await Promise.all([Order.distinct("shippingAddress.state"), Payment.distinct("method")]);
  const clean = (a: unknown[]) => (a.filter((x) => typeof x === "string" && x) as string[]).sort((a, b) => a.localeCompare(b));
  return { states: clean(states), methods: clean(methods) };
}
