import { Badge, Card, formatDate } from "./ui";
import { RetryShipmentButton } from "./tracking-actions";
import { db } from "@/server/db";
import { ShipmentEvent } from "@/server/models";
import { INDIA_POST, INDIA_POST_SITE, TERMINAL_TRACKING, carrierLabel, shipmentStatusLabel } from "@/lib/shipment-tracking";
import type { Shipment } from "@/server/shipping/tracking/shipments";

export const statusTone = (s: string) => (s === "DELIVERED" ? "ok" : ["ON_HOLD", "DELIVERY_ATTEMPT_FAILED"].includes(s) ? "warn" : ["RETURNED", "RETURNED_TO_ORIGIN", "CANCELLED"].includes(s) ? "danger" : "neutral");

/** One shipment on the admin order page, with its courier history when tracked by India Post. */
export async function ShipmentCard({ orderNumber, shipment: s, canWrite }: { orderNumber: string; shipment: Shipment & { trackingUrl?: string }; canWrite: boolean }) {
  const indiaPost = s.carrier === INDIA_POST;
  await db();
  const events = indiaPost && s.trackingNumber ? ((await ShipmentEvent.find({ shipmentId: s._id, trackingNumber: s.trackingNumber } as never).sort({ eventAt: -1 }).limit(50).lean()) as unknown as { _id: string; eventCode: string; eventDescription?: string; eventOffice?: string; eventAt: Date }[]) : [];
  return (
    <Card title="Shipment" actions={indiaPost ? <Badge tone={statusTone(s.status)}>{shipmentStatusLabel(s.status)}</Badge> : undefined}>
      <p className="text-sm">{carrierLabel(s.carrier)} <span className="font-mono">{s.trackingNumber}</span>{s.trackingUrl && <> · <a className="text-a-accent underline" href={s.trackingUrl} target="_blank" rel="noopener noreferrer">Track</a></>}{indiaPost && <> · <a className="text-a-accent underline" href={INDIA_POST_SITE} target="_blank" rel="noopener noreferrer">India Post</a></>}</p>
      {indiaPost && (
        <div className="mt-3 space-y-3 text-sm">
          <dl className="space-y-1 text-xs text-a-muted">
            <div>Automatic tracking: {s.trackingEnabled ? (s.trackingFailed ? "paused after repeated failures" : "on") : "off"}</div>
            <div>Last checked: {s.lastTrackingCheckAt ? formatDate(s.lastTrackingCheckAt) : "never"}</div>
            {s.trackingEnabled && s.nextTrackingCheckAt && <div>Next check due: {formatDate(s.nextTrackingCheckAt)}</div>}
          </dl>
          {s.trackingError && <p className="text-xs text-a-danger">{s.trackingError}</p>}
          {events.length > 0 && <ol className="max-h-64 space-y-2 overflow-y-auto border-t border-a-border pt-3 text-xs">{events.map((e) => <li key={e._id}><b className="font-medium">{e.eventDescription || e.eventCode}</b> <span className="font-mono text-a-muted">{e.eventCode}</span><span className="block text-a-muted">{formatDate(e.eventAt)}{e.eventOffice ? ` · ${e.eventOffice}` : ""}</span></li>)}</ol>}
          {canWrite && s.trackingNumber && !TERMINAL_TRACKING.includes(s.status) && <RetryShipmentButton orderNumber={orderNumber} shipmentId={String(s._id)} />}
        </div>
      )}
    </Card>
  );
}
