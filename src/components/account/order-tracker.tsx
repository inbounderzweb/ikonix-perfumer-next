"use client";
import { useEffect, useState } from "react";
import { Card } from "./ui";
import { fmtDate } from "@/lib/format";
import type { TimelineEvent, TimelineStep } from "@/server/customer/orders";

type Data = { timeline: TimelineStep[]; events: TimelineEvent[]; shipment: { carrier: string; trackingNumber: string | null; trackingUrl: string | null; estimatedDelivery: string | null } | null; status: string; statusLabel: string; cancelReason: string | null };
const DONE = new Set(["DELIVERED", "CANCELLED", "REFUNDED", "RETURNED"]);
const POLL_MS = 20_000;

/** No websocket infrastructure: refreshes every 20s while the tab is visible and the order isn't finished. Nothing here is estimated. */
export function OrderTracker({ orderNumber, initial }: { orderNumber: string; initial: Data }) {
  const [d, setD] = useState(initial);
  const [updated, setUpdated] = useState<Date | null>(null);
  const live = !DONE.has(d.status);
  useEffect(() => {
    if (!live) return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/account/orders/${orderNumber}/tracking`, { cache: "no-store" });
        if (r.ok && !stop) { setD(await r.json()); setUpdated(new Date()); }
      } catch { /* offline: keep showing the last known state */ }
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [live, orderNumber]);

  return (
    <Card title="Tracking" action={live ? <span className="font-fancy text-xs text-[#6b5446]">{updated ? `Updated ${updated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : "Auto-refreshing"}</span> : undefined}>
      <ol className="relative space-y-0">
        {d.timeline.map((s, i) => {
          const bad = ["CANCELLED", "DELIVERY_FAILED", "RETURNED", "RETURN_REQUESTED", "REFUNDED"].includes(s.key);
          return (
            <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0" aria-current={s.state === "current" ? "step" : undefined}>
              {i < d.timeline.length - 1 && <span className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5 ${s.state === "done" ? "bg-[#8C7367]" : "bg-[#e0d3ca]"}`} />}
              <span className={`z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[11px] ${bad ? "border-red-600 bg-red-600 text-white" : s.state === "upcoming" ? "border-[#d9c9bf] bg-white" : "border-[#8C7367] bg-[#8C7367] text-white"}`}>{s.state === "upcoming" ? "" : bad ? "!" : "✓"}</span>
              <div className={s.state === "upcoming" ? "opacity-50" : ""}>
                <p className={`font-fancy text-sm ${s.state === "current" ? "font-semibold" : ""} text-[#3f342c]`}>{s.label}</p>
                {s.at && <p className="font-fancy text-xs text-[#6b5446]">{fmtDate(s.at, true)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {d.cancelReason && <p className="mt-3 font-fancy text-sm text-red-700">Reason: {d.cancelReason}</p>}
      {d.shipment && (
        <div className="mt-4 rounded-xl bg-white p-3 font-fancy text-sm text-[#3f342c]">
          <p><b>Courier:</b> {d.shipment.carrier}</p>
          {d.shipment.trackingNumber && <p><b>Tracking number:</b> {d.shipment.trackingNumber}</p>}
          {d.shipment.estimatedDelivery && <p><b>Estimated delivery:</b> {fmtDate(d.shipment.estimatedDelivery)}</p>}
          {d.shipment.trackingUrl && <a href={d.shipment.trackingUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-block underline">Track on courier website ↗</a>}
        </div>
      )}
      {d.events.some((e) => e.description) && (
        <div className="mt-4 border-t border-[#e7dbd3] pt-3">
          <p className="mb-2 font-fancy text-sm font-semibold text-[#53443D]">Updates from Ikonix</p>
          <ul className="space-y-2">{d.events.filter((e) => e.description).map((e, i) => <li key={i} className="font-fancy text-sm text-[#3f342c]">{e.description}<span className="block text-xs text-[#6b5446]">{e.label} · {fmtDate(e.at, true)} · {e.by}</span></li>)}</ul>
        </div>
      )}
      <details className="mt-3 font-fancy text-sm text-[#53443D]">
        <summary className="cursor-pointer">Full status history</summary>
        <ul className="mt-2 space-y-1">{d.events.map((e, i) => <li key={i}>{e.label} <span className="text-xs text-[#6b5446]">— {fmtDate(e.at, true)} ({e.by})</span></li>)}</ul>
      </details>
    </Card>
  );
}
