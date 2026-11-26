import "server-only";
import { db } from "@/server/db";
import { Order, TrackingSyncFile } from "@/server/models";
import { INDIA_POST, IN_FLIGHT_ORDER, normalizeTrackingNumber } from "../../../lib/shipment-tracking";
import { getConfig, getState } from "../india-post/config";
import type { Shipment } from "./shipments";

type Filter = { order: string; number: string; status: string; failed: boolean; shipped?: { $gte?: Date; $lt?: Date }; page: number; perPage: number };
const safe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, "");

export async function dashboard(f: Filter) {
  await db();
  const base = { "shipments.carrier": INDIA_POST };
  const match: Record<string, unknown> = { ...base };
  // Values are reduced to [A-Z0-9-] before being used in a pattern, and an unusable search matches nothing.
  if (f.order) match.orderNumber = { $regex: safe(f.order) || "__none__" };
  if (f.number) match["shipments.trackingNumber"] = { $regex: safe(normalizeTrackingNumber(f.number)) || "__none__" };
  if (f.status) match["shipments.status"] = f.status;
  if (f.shipped) match["shipments.shippedAt"] = f.shipped;
  if (f.failed) match["shipments.trackingError"] = { $type: "string" };

  const now = new Date();
  const active = { $and: [{ $eq: ["$shipments.trackingEnabled", true] }, { $in: ["$status", [...IN_FLIGHT_ORDER]] }] };
  const count = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });
  const [totals, listed, failedFiles, config, state] = await Promise.all([
    Order.aggregate([
      { $match: base }, { $unwind: "$shipments" }, { $match: base },
      { $group: {
        _id: null, active: count(active), inTransit: count({ $eq: ["$shipments.status", "IN_TRANSIT"] }), outForDelivery: count({ $eq: ["$shipments.status", "OUT_FOR_DELIVERY"] }),
        delivered: count({ $eq: ["$shipments.status", "DELIVERED"] }), returned: count({ $eq: ["$shipments.status", "RETURNED"] }),
        failed: count({ $eq: [{ $type: "$shipments.trackingError" }, "string"] }),
        pending: count({ $and: [active, { $ne: ["$shipments.trackingFailed", true] }, { $lte: [{ $ifNull: ["$shipments.nextTrackingCheckAt", new Date(8.64e15)] }, now] }] }),
      } },
    ]),
    Order.aggregate([
      { $match: match }, { $project: { orderNumber: 1, shipments: 1 } }, { $unwind: "$shipments" }, { $match: match },
      { $sort: { "shipments.shippedAt": -1, _id: -1 } },
      { $facet: { rows: [{ $skip: (f.page - 1) * f.perPage }, { $limit: f.perPage }], total: [{ $count: "n" }] } },
    ]),
    TrackingSyncFile.countDocuments({ status: "FAILED" }),
    getConfig(),
    getState(),
  ]);
  const t = (totals[0] ?? {}) as Partial<Record<"active" | "inTransit" | "outForDelivery" | "delivered" | "returned" | "failed" | "pending", number>>;
  const l = listed[0] as { rows: { orderNumber: string; shipments: Shipment }[]; total: { n: number }[] };
  return {
    counts: { active: t.active ?? 0, inTransit: t.inTransit ?? 0, outForDelivery: t.outForDelivery ?? 0, delivered: t.delivered ?? 0, returned: t.returned ?? 0, failed: t.failed ?? 0, pending: t.pending ?? 0 },
    rows: l.rows.map((r) => ({ orderNumber: r.orderNumber, shipment: r.shipments })), total: l.total[0]?.n ?? 0, failedFiles, config, state,
  };
}
