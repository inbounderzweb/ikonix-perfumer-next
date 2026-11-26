import { NextResponse } from "next/server";
import { handle } from "@/server/auth/http";
import { safeEqual } from "@/server/auth/crypto";
import { runTrackingCycle } from "@/server/shipping/tracking/engine";
import { patchState } from "@/server/shipping/india-post/config";

export const runtime = "nodejs";
export const maxDuration = 60;

// The one scheduled entry point for hosts without a long-running worker. Call it every few minutes with
// `Authorization: Bearer $CRON_SECRET`; it does nothing unless a synchronization is due.
async function run(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET ?? "";
    if (secret.length < 16) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
    if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await patchState({ workerSeenAt: new Date() });
    const r = await runTrackingCycle({ trigger: "SCHEDULED", budgetMs: 45_000 });
    return NextResponse.json(r.ran ? { ran: true, status: r.status, processed: r.processed, updated: r.updated } : { ran: false, reason: r.reason }, { headers: { "Cache-Control": "no-store" } });
  });
}
export const GET = run;
export const POST = run;
