"use server";

import { isIP } from "node:net";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { Order, TrackingSyncFile } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";
import { rateLimit } from "@/server/auth/rate-limit";
import { configProblems, configSchema, connectionFingerprint, getConfig, patchState, urlProblem, writeConfig } from "@/server/shipping/india-post/config";
import { IndiaPostTrackingService } from "@/server/shipping/india-post/service";
import { runTrackingCycle, type RunOptions } from "@/server/shipping/tracking/engine";
import { enrolExistingShipments } from "@/server/shipping/tracking/shipments";
import { INDIA_POST } from "@/lib/shipment-tracking";

export type TrackingResult = { ok: true; message: string } | { ok: false; error: string; fields?: Record<string, string> };

const PAGES = ["/admin/tracking", "/admin/settings/shipping/india-post", "/admin/orders"];
const refresh = () => PAGES.forEach((p) => revalidatePath(p, "layout"));
function failure(e: unknown): TrackingResult {
  if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
  console.error("tracking action", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function saveTrackingConfig(raw: unknown): Promise<TrackingResult> {
  try {
    const admin = await requireAdmin("tracking.configure");
    const current = await getConfig();
    // Verification is owned by the server: whatever the browser sends for it is ignored.
    const p = configSchema.safeParse({ ...(raw as object), verifiedFingerprint: current.verifiedFingerprint, verifiedAt: current.verifiedAt });
    if (!p.success) {
      const fields: Record<string, string> = {};
      for (const i of p.error.issues) fields[i.path.join(".")] ??= i.message;
      return { ok: false, error: "Please fix the highlighted fields.", fields };
    }
    const c = p.data;
    const fields: Record<string, string> = {};
    for (const k of ["bulkUrl", "articleUrl"] as const) { const problem = urlProblem(c[k], c.authType); if (problem) fields[k] = problem; }
    if (c.expectedOutboundIp && !isIP(c.expectedOutboundIp)) fields.expectedOutboundIp = "Enter an IP address";
    if (c.customerId && !/^\d{1,20}$/.test(c.customerId)) fields.customerId = "Digits only";
    if (Object.keys(fields).length) return { ok: false, error: "Please fix the highlighted fields.", fields };

    const wanted = c.enabled;
    const blocked = !wanted ? null : configProblems(c)[0] ?? (c.verifiedFingerprint !== connectionFingerprint(c) ? "Run a successful connection test for these settings, then switch tracking on." : null);
    if (blocked) c.enabled = false;
    await writeConfig(c, admin.id);
    await patchState({ backoffUntil: null, consecutiveFailures: 0, nextRunAt: new Date() });
    await audit(admin, "tracking.config", "Setting", "tracking.indiapost", { before: current, after: c });
    refresh();
    return blocked ? { ok: false, error: `Settings saved, but tracking stays off. ${blocked}` } : { ok: true, message: "Settings saved." };
  } catch (e) { return failure(e); }
}

export async function testTrackingConnection(sample: string): Promise<TrackingResult> {
  try {
    const admin = await requireAdmin("tracking.configure");
    if (!(await rateLimit(`tracking:test:${admin.id}`, 10, 300))) return { ok: false, error: "Too many tests. Wait a few minutes." };
    const r = await IndiaPostTrackingService.healthCheck(z.string().max(30).catch("").parse(sample));
    await audit(admin, "tracking.test", "Setting", "tracking.indiapost", { after: r });
    refresh();
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (e) { return failure(e); }
}

export async function detectOutboundIp(): Promise<TrackingResult> {
  try {
    const admin = await requireAdmin("tracking.configure");
    if (!(await rateLimit(`tracking:ip:${admin.id}`, 10, 300))) return { ok: false, error: "Too many lookups. Wait a few minutes." };
    try {
      const ip = await IndiaPostTrackingService.outboundIp();
      refresh();
      return { ok: true, message: `This server is currently sending from ${ip}.` };
    } catch { return { ok: false, error: "The outbound IP could not be looked up." }; }
  } catch (e) { return failure(e); }
}

async function manualRun(action: string, entity: string, opts: Omit<RunOptions, "actorUserId" | "budgetMs">): Promise<TrackingResult> {
  const admin = await requireAdmin("orders.write");
  if (!(await rateLimit(`tracking:run:${admin.id}`, 20, 300))) return { ok: false, error: "Too many manual runs. Wait a few minutes." };
  const r = await runTrackingCycle({ ...opts, actorUserId: admin.id, budgetMs: 45_000 });
  await audit(admin, action, "Shipment", entity, { after: r });
  refresh();
  if (!r.ran) return { ok: false, error: r.message };
  return r.status === "FAILED" ? { ok: false, error: r.message } : { ok: true, message: r.status === "PARTIAL" ? `Finished with problems: ${r.message}` : r.message };
}

export async function syncTrackingNow(): Promise<TrackingResult> {
  try { return await manualRun("tracking.sync", "all", { trigger: "MANUAL" }); } catch (e) { return failure(e); }
}

/** Retries everything that hit its retry limit. */
export async function retryFailedTracking(): Promise<TrackingResult> {
  try {
    await requireAdmin("orders.write");
    return await manualRun("tracking.retry", "failed", { trigger: "RETRY" });
  } catch (e) { return failure(e); }
}

export async function retryShipmentTracking(orderNumber: string, shipmentId: string): Promise<TrackingResult> {
  try {
    await requireAdmin("orders.write");
    if (!/^IKX-\d{6}-\d{5}$/.test(orderNumber) || !/^[a-f0-9]{24}$/.test(shipmentId)) return { ok: false, error: "Invalid request." };
    await db();
    const found = await Order.exists({ orderNumber, status: { $in: ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"] }, legacy: { $exists: false }, shipments: { $elemMatch: { _id: shipmentId, carrier: INDIA_POST, trackingNumber: { $type: "string" } } } } as never);
    if (!found) return { ok: false, error: "Only India Post shipments that are still on their way can be checked." };
    return await manualRun("tracking.shipment", orderNumber, { trigger: "RETRY", shipmentId });
  } catch (e) { return failure(e); }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export async function reconcileTracking(from: string, to: string): Promise<TrackingResult> {
  try {
    await requireAdmin("orders.write");
    const p = z.object({ from: day, to: day }).refine((v) => v.from <= v.to).safeParse({ from, to });
    if (!p.success) return { ok: false, error: "Choose a valid date range." };
    return await manualRun("tracking.reconcile", `${from}..${to}`, { trigger: "RECONCILE", reconcile: p.data });
  } catch (e) { return failure(e); }
}

/** Clears failed bulk days so the next run reads them again. */
export async function resetFailedFiles(): Promise<TrackingResult> {
  try {
    const admin = await requireAdmin("orders.write");
    await db();
    const r = await TrackingSyncFile.updateMany({ status: { $in: ["FAILED", "RETRY"] } }, { $set: { status: "RETRY", attempts: 0 }, $unset: { nextAttemptAt: 1 } });
    await patchState({ backoffUntil: null, consecutiveFailures: 0, nextRunAt: new Date() });
    await audit(admin, "tracking.files.reset", "Shipment", "files", { after: { count: r.modifiedCount } });
    refresh();
    return { ok: true, message: `${r.modifiedCount} day(s) will be read again.` };
  } catch (e) { return failure(e); }
}

export async function addExistingShipments(): Promise<TrackingResult> {
  try {
    const admin = await requireAdmin("orders.write");
    const r = await enrolExistingShipments(await getConfig());
    await audit(admin, "tracking.enrol", "Shipment", "existing", { after: r });
    refresh();
    return { ok: true, message: `${r.enrolled} shipment(s) added to tracking.${r.skipped.length ? ` Skipped (no valid consignment number): ${r.skipped.slice(0, 20).join(", ")}.` : ""}` };
  } catch (e) { return failure(e); }
}
