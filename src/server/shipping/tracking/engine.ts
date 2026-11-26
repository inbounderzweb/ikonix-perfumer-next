import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Order, TrackingSyncFile, TrackingSyncLog } from "@/server/models";
import { sha256 } from "@/server/auth/crypto";
import { INDIA_POST } from "../../../lib/shipment-tracking";
import { connectionFingerprint, getConfig, getState, patchState, type TrackingConfig } from "../india-post/config";
import { IndiaPostTrackingService as courier } from "../india-post/service";
import { EVENT_CODE_LE } from "../india-post/bulk-xml";
import { addDays, dayStart, daysBetween, istDay, DAY_MS } from "../india-post/dates";
import { asTrackingError, type TrackingError } from "../india-post/errors";
import type { NormalizedEvent } from "../india-post/events";
import { acquireLock, type Lock } from "./lock";
import { applyEvents, queuedShipments, retireShipments, saveEvents, sendOrderNotifications, type OrderChange, type ShipmentRef } from "./shipments";

export const LOCK_NAME = "tracking:india-post";
const LOCK_TTL = 5 * 60_000;
/** CEPT keeps outbound files for 30 days. */
export const ARCHIVE_DAYS = 30;
const MINUTE = 60_000;

export type RunOptions = {
  trigger: "SCHEDULED" | "MANUAL" | "RETRY" | "RECONCILE";
  actorUserId?: string;
  /** Retry just this shipment. */
  shipmentId?: string;
  /** Bulk mode only: download these days again (inclusive, "YYYY-MM-DD"). */
  reconcile?: { from: string; to: string };
  /** Stop starting new requests after this long; the rest is picked up by the next run. */
  budgetMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};
export type RunResult =
  | { ran: false; reason: "DISABLED" | "UNVERIFIED" | "NOT_DUE" | "BACKOFF" | "LOCKED" | "IDLE"; message: string }
  | { ran: true; status: "SUCCESS" | "PARTIAL" | "FAILED"; message: string; processed: number; updated: number; newEvents: number; failed: number };

type Ctx = {
  cfg: TrackingConfig; opts: RunOptions; now: () => Date; deadline: number; lock: Lock;
  processed: number; updated: number; newEvents: number; failed: number; succeeded: number;
  details: string[]; changes: OrderChange[]; fatal: TrackingError | null; error: string | null;
};
const note = (x: Ctx, m: string) => { if (x.details.length < 30) x.details.push(m.slice(0, 300)); };
/** 1×, 2×, 4× … the base delay, at most 24 hours. */
export const backoffMs = (attempt: number, baseMinutes: number) => Math.min(24 * 60, baseMinutes * 2 ** Math.max(0, attempt - 1)) * MINUTE;

/** Out of time, or another instance took the lock over (we stalled past its expiry): stop. */
async function mayContinue(x: Ctx) {
  if (Date.now() > x.deadline) { note(x, "Time limit reached; the rest runs next time."); return false; }
  if (!(await x.lock.renew())) { x.error = "Lost the worker lock."; return false; }
  return true;
}

async function ingest(x: Ctx, ref: ShipmentRef, events: NormalizedEvent[], source: "BULK_XML" | "ARTICLE_API") {
  x.newEvents += await saveEvents(ref, events, source);
  const r = await applyEvents(ref, x.cfg, x.now());
  if (r.changed) x.updated++;
  if (r.order) x.changes.push(r.order);
}

// ── Bulk XML ───────────────────────────────────────────────────────────────
type Checkpoint = { _id: string; eventDate: string; status: string; contentHash?: string; processedAt?: Date; final?: boolean; attempts?: number; nextAttemptAt?: Date };

async function runBulk(x: Ctx, queue: ShipmentRef[]) {
  const { cfg, opts } = x;
  const today = istDay(x.now());
  const oldest = addDays(today, -(ARCHIVE_DAYS - 1));
  const startFor = (r: ShipmentRef) => {
    const d = addDays(istDay(r.shipment.shippedAt ?? r.shipment.trackingEnrolledAt ?? x.now()), -cfg.backfillDays);
    return d < oldest ? oldest : d;
  };
  const from = opts.reconcile ? (opts.reconcile.from < oldest ? oldest : opts.reconcile.from) : queue.reduce((a, r) => (startFor(r) < a ? startFor(r) : a), today);
  const days = daysBetween(from, opts.reconcile && opts.reconcile.to < today ? opts.reconcile.to : today);
  const id = (day: string) => `${cfg.customerId}:${EVENT_CODE_LE}:${day}`;
  const checkpoints = new Map(((await TrackingSyncFile.find({ _id: { $in: days.map(id) } }).lean()) as unknown as Checkpoint[]).map((c) => [c.eventDate, c]));
  // A shipment added after a day was last read still needs that day read once more.
  const pending = queue.filter((r) => r.shipment.trackingBackfillPending);
  const neededSince = (day: string) => pending.reduce((a, r) => (startFor(r) <= day ? Math.max(a, r.shipment.trackingEnrolledAt?.getTime() ?? 0) : a), 0);

  let parked = 0; // days not requested because earlier attempts failed
  for (const day of days) {
    const cp = checkpoints.get(day);
    const stale = neededSince(day) > (cp?.processedAt?.getTime() ?? 0);
    if (!opts.reconcile) {
      if (cp?.status === "FAILED" && opts.trigger !== "RETRY") { parked++; continue; } // retry limit reached: waits for staff
      if (cp?.status === "RETRY" && cp.nextAttemptAt && cp.nextAttemptAt > x.now() && opts.trigger === "SCHEDULED") { parked++; continue; }
      if (cp?.final && !stale) continue;
    }
    if (!(await mayContinue(x))) break;
    const startedAt = x.now();
    const closed = startedAt.getTime() >= dayStart(day).getTime() + DAY_MS + cfg.settleHours * 3_600_000;
    try {
      const xml = await courier.downloadBulkFile(cfg, day);
      const hash = xml ? sha256(xml) : undefined;
      let records = 0;
      if (xml && (hash !== cp?.contentHash || stale || opts.reconcile)) {
        const file = courier.parseLatestEventXml(xml);
        records = file.records;
        x.processed += file.records;
        x.failed += file.invalid.length;
        for (const m of file.invalid.slice(0, 5)) note(x, `${day}: ${m}`);
        const byNumber = new Map<string, NormalizedEvent[]>();
        for (const e of file.events) byNumber.set(e.trackingNumber, [...(byNumber.get(e.trackingNumber) ?? []), e]);
        const numbers = [...byNumber.keys()];
        for (let i = 0; i < numbers.length; i += cfg.batchSize) {
          if (!(await x.lock.renew())) throw new Error("lock lost");
          const matches = await queuedShipments({ "shipments.trackingNumber": { $in: numbers.slice(i, i + cfg.batchSize) } });
          for (const ref of matches) await ingest(x, ref, byNumber.get(ref.shipment.trackingNumber!)!, "BULK_XML");
        }
      }
      // Written only after every record is applied, so a crash means the file is simply processed again.
      const saved = { customerId: cfg.customerId, eventCode: EVENT_CODE_LE, eventDate: day, status: xml ? "OK" : "NO_FILE", processedAt: startedAt, final: closed, attempts: 0, ...(hash ? { contentHash: hash } : {}), ...(records ? { records } : {}) };
      await TrackingSyncFile.updateOne({ _id: id(day) }, { $set: saved, $unset: { nextAttemptAt: 1, lastError: 1 } } as never, { upsert: true });
      checkpoints.set(day, { ...cp, ...saved, _id: id(day) });
      x.succeeded++;
    } catch (e) {
      const err = asTrackingError(e);
      if (!(e as { kind?: string }).kind) console.error("[tracking] bulk file failed", day, e instanceof Error ? e.message : e);
      x.error = err.message;
      note(x, `${day}: ${err.message}`);
      if (err.kind === "AUTH" || err.kind === "CONFIG" || err.kind === "RATE") { x.fatal = err; break; } // not this file's fault
      const attempts = (cp?.attempts ?? 0) + 1;
      await TrackingSyncFile.updateOne(
        { _id: id(day) },
        { $set: { customerId: cfg.customerId, eventCode: EVENT_CODE_LE, eventDate: day, status: attempts >= cfg.maxRetries ? "FAILED" : "RETRY", attempts, lastError: err.message, final: false, nextAttemptAt: new Date(x.now().getTime() + backoffMs(attempts, cfg.retryBaseMinutes)) } } as never,
        { upsert: true },
      );
      x.failed++;
      if (err.kind === "TRANSIENT") { x.fatal = err; break; } // don't hammer a service that is down
    }
  }

  if (parked) {
    const m = `${parked} day(s) not read because of earlier failures.`;
    note(x, m);
    x.error ??= m;
  }

  // Bookkeeping on the shipments: when they were last covered, and whose history is now complete.
  if (x.succeeded && !opts.reconcile) {
    const now = x.now();
    const next = new Date(now.getTime() + cfg.syncIntervalMinutes * MINUTE);
    const ids = queue.map((r) => r.shipment._id);
    await Order.updateMany({ "shipments._id": { $in: ids } }, { $set: { "shipments.$[s].lastTrackingCheckAt": now, "shipments.$[s].nextTrackingCheckAt": next }, $unset: { "shipments.$[s].trackingError": 1 } } as never, { arrayFilters: [{ "s._id": { $in: ids }, "s.trackingEnabled": true }] });
    const complete = pending.filter((r) => daysBetween(startFor(r), today).every((d) => (checkpoints.get(d)?.processedAt?.getTime() ?? 0) >= (r.shipment.trackingEnrolledAt?.getTime() ?? 0))).map((r) => r.shipment._id);
    if (complete.length) await Order.updateMany({ "shipments._id": { $in: complete } }, { $set: { "shipments.$[s].trackingBackfillPending": false } } as never, { arrayFilters: [{ "s._id": { $in: complete } }] });
  }
}

// ── Individual article API ─────────────────────────────────────────────────
function nextCheck(cfg: TrackingConfig, status: string, now: Date) {
  const minutes = status === "OUT_FOR_DELIVERY" ? cfg.outForDeliveryIntervalMinutes
    : status === "ON_HOLD" || status === "DELIVERY_ATTEMPT_FAILED" ? cfg.attentionIntervalMinutes
    : status === "PENDING_TRACKING" ? cfg.syncIntervalMinutes : cfg.inTransitIntervalMinutes;
  return new Date(now.getTime() + minutes * MINUTE);
}
const setShipment = (ref: ShipmentRef, set: Record<string, unknown>, unset: string[] = []) => Order.updateOne(
  { _id: ref.orderId, shipments: { $elemMatch: { _id: ref.shipment._id, trackingNumber: ref.shipment.trackingNumber, trackingEnabled: true } } } as never,
  { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`shipments.$.${k}`, v])), ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [`shipments.$.${k}`, 1])) } : {}) } as never,
);

async function runArticles(x: Ctx, queue: ShipmentRef[]) {
  const { cfg } = x;
  const sleep = x.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = Math.ceil(60_000 / cfg.requestsPerMinute); // one article per request: no bulk call is assumed
  let transientInARow = 0;
  for (const [i, ref] of queue.entries()) {
    if (!(await mayContinue(x))) break;
    if (i) await sleep(gap);
    x.processed++;
    try {
      const r = await courier.fetchArticleEvents(cfg, ref.shipment.trackingNumber!);
      x.failed += r.invalid.length;
      await ingest(x, ref, r.events, "ARTICLE_API");
      const now = x.now();
      await setShipment(ref, { lastTrackingCheckAt: now, nextTrackingCheckAt: nextCheck(cfg, ref.shipment.status, now), retryCount: 0, trackingFailed: false, trackingBackfillPending: false }, ["trackingError"]);
      x.succeeded++;
      transientInARow = 0;
    } catch (e) {
      const err = asTrackingError(e);
      if (!(e as { kind?: string }).kind) console.error("[tracking] article failed", ref.orderNumber, e instanceof Error ? e.message : e);
      x.error = err.message;
      note(x, `${ref.shipment.trackingNumber}: ${err.message}`);
      if (err.kind === "AUTH" || err.kind === "CONFIG" || err.kind === "RATE") { x.fatal = err; break; } // shipments stay due; nothing counted against them
      x.failed++;
      const retryCount = (ref.shipment.retryCount ?? 0) + 1;
      const giveUp = retryCount >= cfg.maxRetries;
      const now = x.now();
      await setShipment(ref, { lastTrackingCheckAt: now, retryCount, trackingError: err.message, trackingFailed: giveUp, ...(giveUp ? {} : { nextTrackingCheckAt: new Date(now.getTime() + backoffMs(retryCount, cfg.retryBaseMinutes)) }) }, giveUp ? ["nextTrackingCheckAt"] : []);
      if (err.kind === "TRANSIENT" && ++transientInARow >= 3) { x.fatal = err; break; }
    }
  }
}

// ── One cycle ──────────────────────────────────────────────────────────────
/**
 * The single entry point for the scheduler, the cron endpoint and the admin buttons. Safe to call from any number of
 * instances at once: only the lock holder does anything.
 */
export async function runTrackingCycle(opts: RunOptions): Promise<RunResult> {
  await db();
  const now = opts.now ?? (() => new Date());
  const cfg = await getConfig();
  if (!cfg.enabled) return { ran: false, reason: "DISABLED", message: "India Post tracking is switched off." };
  if (cfg.verifiedFingerprint !== connectionFingerprint(cfg)) return { ran: false, reason: "UNVERIFIED", message: "Run a successful connection test first." };
  const scheduled = opts.trigger === "SCHEDULED";
  if (opts.reconcile && cfg.mode !== "BULK_XML") return { ran: false, reason: "IDLE", message: "Date reconciliation applies to Bulk XML mode only." };

  const lock = await acquireLock(LOCK_NAME, LOCK_TTL);
  if (!lock) return { ran: false, reason: "LOCKED", message: "A synchronization is already running." };
  try {
    const state = await getState(); // read under the lock: another instance may just have finished
    if (scheduled && state.backoffUntil && state.backoffUntil > now()) return { ran: false, reason: "BACKOFF", message: "Waiting before retrying after a failure." };
    // Cheap exit for the every-minute scheduler: between bulk runs only a newly shipped parcel makes work.
    if (scheduled && cfg.mode === "BULK_XML" && state.nextRunAt && state.nextRunAt > now()) {
      const fresh = await Order.exists({ shipments: { $elemMatch: { trackingEnabled: true, trackingBackfillPending: true, lastTrackingCheckAt: null, nextTrackingCheckAt: { $lte: now() } } } } as never);
      if (!fresh) return { ran: false, reason: "NOT_DUE", message: "The next synchronization is not due yet." };
    }
    await retireShipments(cfg, now());

    if (opts.shipmentId) {
      await Order.updateOne({ "shipments._id": new Types.ObjectId(opts.shipmentId), status: { $in: ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"] } } as never,
        { $set: { "shipments.$.trackingEnabled": true, "shipments.$.trackingFailed": false, "shipments.$.retryCount": 0, "shipments.$.nextTrackingCheckAt": now(), "shipments.$.trackingEnrolledAt": now(), "shipments.$.trackingBackfillPending": true }, $unset: { "shipments.$.trackingError": 1 } } as never);
    }
    const filter: Record<string, unknown> = opts.shipmentId ? { "shipments._id": new Types.ObjectId(opts.shipmentId) } : {};
    let queue: ShipmentRef[];
    if (cfg.mode === "ARTICLE_API") {
      if (opts.trigger === "RETRY" && !opts.shipmentId) await Order.updateMany({ "shipments.trackingFailed": true }, { $set: { "shipments.$[s].trackingFailed": false, "shipments.$[s].retryCount": 0, "shipments.$[s].nextTrackingCheckAt": now() } } as never, { arrayFilters: [{ "s.trackingFailed": true, "s.trackingEnabled": true }] });
      queue = await queuedShipments({ ...filter, "shipments.trackingFailed": { $ne: true }, ...(scheduled ? { "shipments.nextTrackingCheckAt": { $lte: now() } } : {}) }, cfg.batchSize);
      // Manual runs take the longest-waiting shipments first (the queue is sorted by next check time).
      if (!queue.length) return { ran: false, reason: "IDLE", message: "No shipments are due for a check." };
    } else {
      queue = await queuedShipments(filter, 20_000);
      if (!queue.length && !opts.reconcile) return { ran: false, reason: "IDLE", message: "There are no active India Post shipments." };
    }

    // A run that died leaves its log open; we hold the lock, so nothing else can be running.
    await TrackingSyncLog.updateMany({ carrier: INDIA_POST, syncStatus: "RUNNING" }, { $set: { syncStatus: "ABORTED", syncCompletedAt: now(), errorMessage: "The worker stopped before finishing." } });
    const log = await TrackingSyncLog.create({ carrier: INDIA_POST, integrationMode: cfg.mode, trigger: opts.trigger, actorUserId: opts.actorUserId ?? null, syncStartedAt: now() });
    const x: Ctx = { cfg, opts, now, deadline: Date.now() + (opts.budgetMs ?? 4 * MINUTE), lock, processed: 0, updated: 0, newEvents: 0, failed: 0, succeeded: 0, details: [], changes: [], fatal: null, error: null };
    try {
      if (cfg.mode === "BULK_XML") await runBulk(x, queue); else await runArticles(x, queue);
    } catch (e) {
      console.error("[tracking] run failed", e instanceof Error ? e.stack : e);
      x.error = "The synchronization stopped unexpectedly. See the server log.";
      x.fatal = asTrackingError(e);
    }

    const status = x.error || x.failed ? (x.succeeded ? "PARTIAL" : "FAILED") : "SUCCESS";
    const message = x.error ?? (x.failed ? `${x.failed} record(s) could not be read.` : `${x.processed} record(s) read, ${x.updated} shipment(s) updated.`);
    const finished = now();
    await TrackingSyncLog.updateOne({ _id: log._id }, { $set: { syncCompletedAt: finished, syncStatus: status, recordsProcessed: x.processed, recordsUpdated: x.updated, newEvents: x.newEvents, failedRecords: x.failed, errorMessage: x.error ?? undefined, details: x.details } });
    const failures = x.fatal ? (state.consecutiveFailures ?? 0) + 1 : 0;
    const wait = x.fatal ? Math.max((x.fatal.retryAfterSec ?? 0) * 1000, backoffMs(Math.min(failures, cfg.maxRetries), cfg.retryBaseMinutes)) : 0;
    await patchState({
      lastRunAt: finished, ...(status !== "FAILED" ? { lastSuccessAt: finished } : {}),
      lastResult: { status, message, processed: x.processed, updated: x.updated, failed: x.failed, at: finished },
      nextRunAt: new Date(finished.getTime() + cfg.syncIntervalMinutes * MINUTE),
      // A run that got no answer at all (nothing left to request) proves nothing: keep the current backoff.
      ...(x.fatal || x.succeeded ? { consecutiveFailures: failures, backoffUntil: x.fatal ? new Date(finished.getTime() + wait) : null } : {}),
      health: { status: status === "SUCCESS" ? "HEALTHY" : status === "PARTIAL" ? "DEGRADED" : "DOWN", message, checkedAt: finished, accessRejected: x.fatal?.kind === "AUTH" },
    });
    await sendOrderNotifications(x.changes, finished);
    return { ran: true, status, message, processed: x.processed, updated: x.updated, newEvents: x.newEvents, failed: x.failed };
  } finally {
    await lock.release();
  }
}
