import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Notice, PageHeader, Table, button, formatDate, inputCls } from "@/components/admin/ui";
import { RetryShipmentButton, TrackingToolbar } from "@/components/admin/tracking-actions";
import { statusTone } from "@/components/admin/shipment-card";
import { requireAdminPage } from "@/server/auth/guard";
import { dateRange, one, pageParam, qs } from "@/server/admin/util";
import { dashboard } from "@/server/shipping/tracking/dashboard";
import { TERMINAL_TRACKING, TRACKING_STATUS, shipmentStatusLabel } from "@/lib/shipment-tracking";
import { addDays, istDay } from "@/server/shipping/india-post/dates";

export const metadata: Metadata = { title: "Shipment tracking" };
const PER_PAGE = 25;

export default async function TrackingPage({ searchParams }: PageProps<"/admin/tracking">) {
  const admin = await requireAdminPage("orders.read");
  const sp = await searchParams;
  const f = { order: one(sp.order).trim().slice(0, 30), number: one(sp.number).trim().slice(0, 30), status: one(sp.status), from: one(sp.from), to: one(sp.to), failed: one(sp.failed) === "1" };
  const page = pageParam(sp.page);
  const d = await dashboard({ ...f, shipped: dateRange(f.from, f.to), page, perPage: PER_PAGE });
  const pages = Math.max(1, Math.ceil(d.total / PER_PAGE));
  const href = (p: number) => `/admin/tracking?${qs({ ...f, failed: f.failed ? "1" : "", page: p })}`;
  const canWrite = admin.permissions.has("orders.write");
  const today = istDay(new Date());
  const tiles: [string, number, string?][] = [
    ["Active shipments", d.counts.active], ["In transit", d.counts.inTransit], ["Out for delivery", d.counts.outForDelivery], ["Delivered", d.counts.delivered],
    ["Returned", d.counts.returned], ["Failed tracking", d.counts.failed + d.failedFiles, "/admin/tracking?failed=1"], ["Pending checks", d.counts.pending],
  ];
  const health = d.state.health?.status ?? "UNKNOWN";
  return (
    <>
      <PageHeader title="Shipment tracking" subtitle="India Post parcels, followed automatically." actions={admin.permissions.has("tracking.configure") ? <Link href="/admin/settings/shipping/india-post" className={button("secondary")}>Settings</Link> : undefined} />
      <div className="space-y-5">
        {!d.config.enabled && <Notice tone="warn">Automatic tracking is switched off. Shipments are queued and will be checked once it is enabled.</Notice>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {tiles.map(([label, n, link]) => {
            const body = <><p className="text-xs text-a-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{n}</p></>;
            return link ? <Link key={label} href={link} className="rounded-xl border border-a-border bg-a-surface p-3 hover:bg-a-raised">{body}</Link> : <div key={label} className="rounded-xl border border-a-border bg-a-surface p-3">{body}</div>;
          })}
        </div>
        <Card title="Synchronization" actions={<Badge tone={health === "HEALTHY" ? "ok" : health === "DOWN" ? "danger" : "warn"}>API {health.toLowerCase()}</Badge>}>
          <dl className="mb-3 grid gap-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-a-muted">Last successful sync: </dt><dd className="inline">{d.state.lastSuccessAt ? formatDate(d.state.lastSuccessAt) : "never"}</dd></div>
            <div><dt className="inline text-a-muted">Last result: </dt><dd className="inline">{d.state.lastResult ? `${d.state.lastResult.status.toLowerCase()} · ${d.state.lastResult.message}` : "—"}</dd></div>
            <div><dt className="inline text-a-muted">Next sync: </dt><dd className="inline">{!d.config.enabled ? "—" : d.state.backoffUntil && d.state.backoffUntil > new Date() ? `retrying after ${formatDate(d.state.backoffUntil)}` : d.config.mode === "BULK_XML" && d.state.nextRunAt ? formatDate(d.state.nextRunAt) : "when shipments are due"}</dd></div>
            <div><dt className="inline text-a-muted">Background worker last seen: </dt><dd className="inline">{d.state.workerSeenAt ? formatDate(d.state.workerSeenAt) : "never (check the worker or cron job)"}</dd></div>
          </dl>
          {canWrite && <TrackingToolbar bulk={d.config.mode === "BULK_XML"} from={addDays(today, -7)} to={today} />}
        </Card>
        <form method="get" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <input name="order" aria-label="Order number" placeholder="Order number" className={inputCls} defaultValue={f.order} />
          <input name="number" aria-label="Consignment number" placeholder="Consignment number" className={inputCls} defaultValue={f.number} />
          <select name="status" aria-label="Shipment status" className={inputCls} defaultValue={f.status}><option value="">All statuses</option>{TRACKING_STATUS.map((s) => <option key={s} value={s}>{shipmentStatusLabel(s)}</option>)}</select>
          <input type="date" name="from" aria-label="Shipped from" className={inputCls} defaultValue={f.from} />
          <input type="date" name="to" aria-label="Shipped to" className={inputCls} defaultValue={f.to} />
          <div className="flex gap-2"><button className={button("secondary")}>Filter</button><Link href="/admin/tracking" className={button("ghost")}>Clear</Link></div>
          {f.failed && <input type="hidden" name="failed" value="1" />}
        </form>
        <Table head={["Order", "Consignment", "Status", "Shipped", "Latest event", "Last checked", ""]} empty={d.rows.length ? undefined : "No India Post shipments match."}>
          {d.rows.map(({ orderNumber, shipment: s }) => (
            <tr key={String(s._id)}>
              <td><Link className="font-medium text-a-accent underline" href={`/admin/orders/${orderNumber}`}>{orderNumber}</Link></td>
              <td className="font-mono text-xs">{s.trackingNumber ?? "—"}</td>
              <td><Badge tone={statusTone(s.status)}>{shipmentStatusLabel(s.status)}</Badge>{s.trackingError && <span className="mt-1 block max-w-[240px] text-xs text-a-danger">{s.trackingError}</span>}</td>
              <td className="whitespace-nowrap text-a-muted">{s.shippedAt ? formatDate(s.shippedAt) : "—"}</td>
              <td className="text-xs">{s.lastEventDescription ?? "—"}{s.lastEventAt && <span className="block text-a-muted">{formatDate(s.lastEventAt)}</span>}</td>
              <td className="whitespace-nowrap text-a-muted">{s.lastTrackingCheckAt ? formatDate(s.lastTrackingCheckAt) : "never"}</td>
              <td>{canWrite && s.trackingNumber && !TERMINAL_TRACKING.includes(s.status) && <RetryShipmentButton orderNumber={orderNumber} shipmentId={String(s._id)} />}</td>
            </tr>
          ))}
        </Table>
        <nav className="flex items-center justify-between text-sm text-a-muted" aria-label="Pages"><span>{d.total} shipment(s) · page {page} of {pages}</span><span className="flex gap-2">{page > 1 && <Link className={button("secondary")} href={href(page - 1)}>Previous</Link>}{page < pages && <Link className={button("secondary")} href={href(page + 1)}>Next</Link>}</span></nav>
      </div>
    </>
  );
}
