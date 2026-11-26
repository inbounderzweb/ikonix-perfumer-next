import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Order, ShipmentEvent } from "@/server/models";
import { sha256 } from "@/server/auth/crypto";
import { notifyOrder, type OrderEvent } from "@/server/notify/order-notify";
import { IN_FLIGHT_ORDER, INDIA_POST, TERMINAL_TRACKING, checkConsignment, isIndiaPostCarrier, shipmentStatusLabel, type TrackingStatus } from "../../../lib/shipment-tracking";
import type { NormalizedEvent } from "../india-post/events";
import type { TrackingConfig } from "../india-post/config";

export type Shipment = {
  _id: Types.ObjectId; carrier: string; trackingNumber?: string; status: string; shippedAt?: Date; createdAt?: Date; deliveredAt?: Date;
  trackingEnabled?: boolean; trackingEnrolledAt?: Date; trackingBackfillPending?: boolean; lastTrackingCheckAt?: Date; nextTrackingCheckAt?: Date;
  lastEventAt?: Date; lastEventCode?: string; lastEventDescription?: string; lastEventOffice?: string; statusEventKey?: string;
  trackingError?: string; retryCount?: number; trackingFailed?: boolean;
};
export type ShipmentRef = { orderId: Types.ObjectId; orderNumber: string; shipment: Shipment };

const MINUTE = 60_000;

/** Fields that put a shipment into the central tracking queue (also used to restart tracking after a number change). */
export function enrolmentFields(cfg: Pick<TrackingConfig, "initialDelayMinutes">, now = new Date()) {
  return {
    status: "PENDING_TRACKING" as const, trackingEnabled: true, trackingEnrolledAt: now, trackingBackfillPending: true,
    nextTrackingCheckAt: new Date(now.getTime() + cfg.initialDelayMinutes * MINUTE), retryCount: 0, trackingFailed: false,
  };
}
const CLEARED = { lastTrackingCheckAt: 1, lastEventAt: 1, lastEventCode: 1, lastEventDescription: 1, lastEventOffice: 1, statusEventKey: 1, trackingError: 1, deliveredAt: 1 } as const;

/**
 * After staff add or change courier details: start (or restart) tracking for the first shipment of an order that is on
 * its way, or stop it if the courier is no longer India Post. `before` is the shipment as it was.
 */
export async function syncEnrolment(orderId: Types.ObjectId, before: { carrier?: string; trackingNumber?: string } | undefined, cfg: TrackingConfig) {
  const o = (await Order.findById(orderId, "status shipments legacy").lean()) as unknown as { status: string; shipments: Shipment[]; legacy?: unknown } | null;
  const s = o?.shipments[0];
  if (!o || !s || o.legacy) return;
  const wasSame = before?.carrier === s.carrier && before?.trackingNumber === s.trackingNumber;
  if (s.carrier !== INDIA_POST) {
    if (s.trackingEnabled) await Order.updateOne({ _id: orderId, "shipments._id": s._id }, { $set: { "shipments.$.trackingEnabled": false, "shipments.$.status": "SHIPPED" }, $unset: { "shipments.$.nextTrackingCheckAt": 1 } });
    return;
  }
  if (wasSame || !s.trackingNumber || !(IN_FLIGHT_ORDER as readonly string[]).includes(o.status)) return;
  await Order.updateOne({ _id: orderId, "shipments._id": s._id }, {
    $set: Object.fromEntries(Object.entries({ ...enrolmentFields(cfg), shippedAt: s.shippedAt ?? new Date() }).map(([k, v]) => [`shipments.$.${k}`, v])),
    $unset: Object.fromEntries(Object.keys(CLEARED).map((k) => [`shipments.$.${k}`, 1])),
  } as never);
}

/** One-off for orders shipped by hand before tracking existed. Skips imported history and invalid numbers. */
export async function enrolExistingShipments(cfg: TrackingConfig): Promise<{ enrolled: number; skipped: string[] }> {
  await db();
  const rows = (await Order.find({ status: { $in: [...IN_FLIGHT_ORDER] }, legacy: { $exists: false }, "shipments.0": { $exists: true } } as never, "orderNumber shipments").lean()) as unknown as { _id: Types.ObjectId; orderNumber: string; shipments: Shipment[] }[];
  let enrolled = 0;
  const skipped: string[] = [];
  for (const o of rows) for (const s of o.shipments) {
    if (!(s.carrier === INDIA_POST || isIndiaPostCarrier(s.carrier)) || s.trackingEnrolledAt) continue;
    const n = checkConsignment(s.trackingNumber ?? "");
    if (!n.ok) { skipped.push(o.orderNumber); continue; }
    const set = { ...enrolmentFields(cfg), carrier: INDIA_POST, trackingNumber: n.value, shippedAt: s.shippedAt ?? s.createdAt ?? new Date() };
    const r = await Order.updateOne({ _id: o._id, shipments: { $elemMatch: { _id: s._id, trackingEnrolledAt: { $exists: false } } } } as never, { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`shipments.$.${k}`, v])) } as never);
    enrolled += r.modifiedCount;
  }
  return { enrolled, skipped };
}

/** All shipments in the tracking queue (their order is still on its way), optionally narrowed. */
export async function queuedShipments(filter: Record<string, unknown> = {}, limit = 5000): Promise<ShipmentRef[]> {
  const match = { "shipments.carrier": INDIA_POST, "shipments.trackingEnabled": true, ...filter };
  const rows = (await Order.aggregate([
    { $match: { status: { $in: [...IN_FLIGHT_ORDER] }, shipments: { $elemMatch: Object.fromEntries(Object.entries(match).map(([k, v]) => [k.replace("shipments.", ""), v])) } } },
    { $project: { orderNumber: 1, shipments: 1 } }, { $unwind: "$shipments" }, { $match: match },
    { $sort: { "shipments.nextTrackingCheckAt": 1, _id: 1 } }, { $limit: limit },
  ])) as unknown as { _id: Types.ObjectId; orderNumber: string; shipments: Shipment }[];
  return rows.map((r) => ({ orderId: r._id, orderNumber: r.orderNumber, shipment: r.shipments }));
}

/** Stops tracking where staff already closed the order, or where nothing final has arrived for too long. */
export async function retireShipments(cfg: TrackingConfig, now = new Date()) {
  const closed: [string[], Record<string, unknown>][] = [
    [["DELIVERED"], { status: "DELIVERED" }], [["CANCELLED", "REFUNDED"], { status: "CANCELLED" }], [["RETURNED", "RETURN_REQUESTED"], {}],
  ];
  for (const [statuses, extra] of closed) {
    const set = Object.fromEntries(Object.entries({ ...extra, trackingEnabled: false }).map(([k, v]) => [`shipments.$[s].${k}`, v]));
    await Order.updateMany({ "shipments.trackingEnabled": true, status: { $in: statuses } } as never, { $set: set, $unset: { "shipments.$[s].nextTrackingCheckAt": 1 } } as never, { arrayFilters: [{ "s.trackingEnabled": true }] });
  }
  const cutoff = new Date(now.getTime() - cfg.maxTrackingDays * 86_400_000);
  await Order.updateMany(
    { shipments: { $elemMatch: { trackingEnabled: true, shippedAt: { $lt: cutoff }, trackingEnrolledAt: { $lt: cutoff } } } } as never,
    { $set: { "shipments.$[s].trackingEnabled": false, "shipments.$[s].trackingFailed": true, "shipments.$[s].trackingError": `No final status after ${cfg.maxTrackingDays} days. Check with India Post.` } } as never,
    { arrayFilters: [{ "s.trackingEnabled": true, "s.shippedAt": { $lt: cutoff }, "s.trackingEnrolledAt": { $lt: cutoff } }] },
  );
}

export const eventKey = (shipmentId: unknown, e: NormalizedEvent) =>
  sha256([String(shipmentId), e.trackingNumber, e.eventCode, e.eventDate, e.eventTime ?? "", (e.officeId || e.eventOffice).toUpperCase()].join("|"));

/** Stores events once each. Returns how many were new. */
export async function saveEvents(ref: ShipmentRef, events: NormalizedEvent[], source: "BULK_XML" | "ARTICLE_API"): Promise<number> {
  if (!events.length) return 0;
  const ops = events.map((e) => ({
    updateOne: {
      filter: { _id: eventKey(ref.shipment._id, e) }, upsert: true,
      update: { $setOnInsert: {
        orderId: ref.orderId, shipmentId: ref.shipment._id, carrier: INDIA_POST, trackingNumber: e.trackingNumber, eventCode: e.eventCode, eventDescription: e.eventDescription,
        trackingStatus: e.trackingStatus, eventAt: e.eventAt, eventDate: e.eventDate, eventTime: e.eventTime ?? undefined, eventOffice: e.eventOffice || undefined,
        nonDeliveryReason: e.nonDeliveryReason || undefined, rawEventData: e.raw, source,
      } },
    },
  }));
  return (await ShipmentEvent.bulkWrite(ops as never, { ordered: false })).upsertedCount;
}

type Stored = { _id: string; eventCode: string; eventDescription?: string; trackingStatus: TrackingStatus | null; eventAt: Date; eventOffice?: string };
const RANK: Record<string, number> = { BOOKED: 1, IN_TRANSIT: 2, ON_HOLD: 3, OUT_FOR_DELIVERY: 4, DELIVERY_ATTEMPT_FAILED: 5, DELIVERED: 6, RETURNED: 7, CANCELLED: 8 };

/**
 * Status from the whole history, so the result is the same whatever order events arrive in. The first final event
 * (delivered, returned, cancelled) wins: a returned parcel "delivered" back to us stays returned.
 */
export function deriveStatus<T extends Pick<Stored, "trackingStatus" | "eventAt">>(events: T[]): { status: TrackingStatus; by: T } | null {
  const sorted = events.filter((e) => e.trackingStatus).sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime() || RANK[a.trackingStatus!] - RANK[b.trackingStatus!]);
  const by = sorted.find((e) => TERMINAL_TRACKING.includes(e.trackingStatus!)) ?? sorted.at(-1);
  return by ? { status: by.trackingStatus!, by } : null;
}

const ORDER_TARGET: Partial<Record<TrackingStatus, { to: OrderEvent; text: string }>> = {
  OUT_FOR_DELIVERY: { to: "OUT_FOR_DELIVERY", text: "Your parcel is out for delivery." },
  DELIVERY_ATTEMPT_FAILED: { to: "DELIVERY_FAILED", text: "India Post could not deliver your parcel." },
  DELIVERED: { to: "DELIVERED", text: "Your parcel has been delivered." },
  RETURNED: { to: "RETURNED", text: "India Post is returning this parcel to us." },
};
export type OrderChange = { orderId: Types.ObjectId; to: OrderEvent; from: string; eventAt: Date };

async function updateOrder(ref: ShipmentRef, status: TrackingStatus, by: Stored, now: Date): Promise<OrderChange | null> {
  const target = ORDER_TARGET[status];
  if (!target) return null;
  const o = (await Order.findById(ref.orderId, "status shipments statusHistory").lean()) as unknown as { status: string; shipments: Shipment[]; statusHistory: { from?: string; to: string; actorType: string; at: Date }[] } | null;
  // Only orders that are still on their way move; delivered, cancelled, refunded and returned orders are never rewritten.
  if (!o || o.status === target.to || !(IN_FLIGHT_ORDER as readonly string[]).includes(o.status)) return null;
  // A late-arriving older event does not undo a status that staff set afterwards.
  const staff = o.statusHistory.filter((h) => h.actorType === "ADMIN" && h.from !== h.to && h.to !== "SHIPPED").at(-1);
  if (staff && !TERMINAL_TRACKING.includes(status) && by.eventAt < staff.at) return null;
  // With several India Post parcels, the order is delivered only when all of them are.
  if (status === "DELIVERED" && o.shipments.some((s) => s.carrier === INDIA_POST && String(s._id) !== String(ref.shipment._id) && s.status !== "DELIVERED")) return null;
  const at = by.eventAt <= now ? by.eventAt : now;
  const r = await Order.updateOne(
    { _id: ref.orderId, status: o.status as never }, // lost the race with staff → leave their change alone
    {
      $set: { status: target.to, ...(target.to === "DELIVERED" ? { deliveredAt: at } : {}) },
      $push: { statusHistory: { from: o.status, to: target.to, description: target.text, note: `India Post ${by.eventCode} for ${ref.shipment.trackingNumber}${target.to === "RETURNED" ? ": check the returned parcel, stock and refund" : ""}`, actorType: "SYSTEM", at } },
    } as never,
  );
  return r.modifiedCount ? { orderId: ref.orderId, to: target.to, from: o.status, eventAt: by.eventAt } : null;
}

/** Recomputes one shipment from its stored events and, when something meaningful is new, moves the order along. */
export async function applyEvents(ref: ShipmentRef, cfg: TrackingConfig, now = new Date()): Promise<{ changed: boolean; order: OrderChange | null }> {
  const s = ref.shipment;
  const events = (await ShipmentEvent.find({ shipmentId: s._id, trackingNumber: s.trackingNumber } as never, "eventCode eventDescription trackingStatus eventAt eventOffice").sort({ eventAt: 1 }).lean()) as unknown as Stored[];
  const latest = events.at(-1);
  if (!latest) return { changed: false, order: null };
  const derived = deriveStatus(events);
  const newKey = derived && derived.by._id !== s.statusEventKey ? derived.by._id : null;
  const changed = !!newKey || !s.lastEventAt || latest.eventAt > s.lastEventAt;
  if (!changed) return { changed: false, order: null };
  // The order goes first: if the process dies in between, the next run sees the same "new" event and finishes the job.
  const order = newKey && cfg.autoUpdateOrders ? await updateOrder(ref, derived!.status, derived!.by, now) : null;
  const done = !!derived && TERMINAL_TRACKING.includes(derived.status);
  const set: Record<string, unknown> = {
    lastEventAt: latest.eventAt, lastEventCode: latest.eventCode, lastEventDescription: latest.eventDescription || shipmentStatusLabel(derived?.status ?? s.status), lastEventOffice: latest.eventOffice ?? "",
    ...(newKey ? { status: derived!.status, statusEventKey: newKey } : {}),
    ...(derived?.status === "DELIVERED" ? { deliveredAt: derived.by.eventAt } : {}),
    ...(done ? { trackingEnabled: false, trackingFailed: false, trackingBackfillPending: false } : {}),
  };
  // Matching on the number too: if staff replaced it meanwhile, these events no longer apply.
  const r = await Order.updateOne(
    { _id: ref.orderId, shipments: { $elemMatch: { _id: s._id, trackingNumber: s.trackingNumber } } } as never,
    { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`shipments.$.${k}`, v])), ...(done ? { $unset: { "shipments.$.nextTrackingCheckAt": 1, "shipments.$.trackingError": 1 } } : {}) } as never,
  );
  ref.shipment = { ...s, ...(set as Partial<Shipment>) };
  return { changed: r.modifiedCount > 0, order };
}

/** Customer messages for automatic changes. "Out for delivery today" is not sent for old news. */
export async function sendOrderNotifications(changes: OrderChange[], now = new Date()) {
  for (const c of changes) {
    if (c.to === "OUT_FOR_DELIVERY" && now.getTime() - c.eventAt.getTime() > 86_400_000) continue;
    await notifyOrder(c.orderId, c.to, c.from).catch((e) => console.error("[tracking] notification failed", e instanceof Error ? e.message : e));
  }
}
