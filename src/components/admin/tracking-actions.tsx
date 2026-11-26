"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addExistingShipments, reconcileTracking, resetFailedFiles, retryFailedTracking, retryShipmentTracking, syncTrackingNow, type TrackingResult } from "@/app/actions/admin/tracking";
import { Notice, button, inputCls } from "./ui";

export function useTrackingAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<TrackingResult | null>(null);
  const run = (fn: () => Promise<TrackingResult>) => start(async () => { setRes(await fn()); router.refresh(); });
  const notice = res && <Notice tone={res.ok ? "ok" : "danger"}>{res.ok ? res.message : res.error}</Notice>;
  return { pending, run, res, notice };
}

export function TrackingToolbar({ bulk, from, to }: { bulk: boolean; from: string; to: string }) {
  const { pending, run, notice } = useTrackingAction();
  const [range, setRange] = useState({ from, to });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button("primary")} disabled={pending} onClick={() => run(syncTrackingNow)}>{pending ? "Working…" : "Sync now"}</button>
        <button type="button" className={button("secondary")} disabled={pending} onClick={() => run(retryFailedTracking)}>Retry failed</button>
        {bulk && <button type="button" className={button("secondary")} disabled={pending} onClick={() => run(resetFailedFiles)}>Reset failed days</button>}
        <button type="button" className={button("ghost")} disabled={pending} onClick={() => { if (confirm("Add India Post orders that were shipped before automatic tracking?")) run(addExistingShipments); }}>Add existing shipments</button>
      </div>
      {bulk && (
        <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); run(() => reconcileTracking(range.from, range.to)); }}>
          <label className="space-y-1"><span className="block text-xs text-a-muted">Re-read days from</span><input type="date" required className={inputCls} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="space-y-1"><span className="block text-xs text-a-muted">to (last 30 days only)</span><input type="date" required className={inputCls} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button className={button("secondary")} disabled={pending}>Reconcile</button>
        </form>
      )}
      {notice}
    </div>
  );
}

export function RetryShipmentButton({ orderNumber, shipmentId }: { orderNumber: string; shipmentId: string }) {
  const { pending, run, notice } = useTrackingAction();
  return (
    <div className="space-y-2">
      <button type="button" className={button("secondary", "!px-2.5 !py-1.5 text-xs")} disabled={pending} onClick={() => run(() => retryShipmentTracking(orderNumber, shipmentId))}>{pending ? "Checking…" : "Check now"}</button>
      {notice}
    </div>
  );
}
