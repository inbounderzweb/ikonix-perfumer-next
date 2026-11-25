import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, Pagination, Table, button, formatDate, formatINR, inputCls } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Order } from "@/server/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/server/models/commerce";
import { DEFAULT_PAGE_SIZE, pageParam, qs, sizeParam, sortParam } from "@/server/admin/util";
import { GROUPS, PRESETS, parseSalesFilters, salesFilterOptions, salesMatch, salesSummary, type Bucket } from "@/server/admin/sales-report";

export const metadata: Metadata = { title: "Sales report" };
const SORTS = { placed: "placedAt", order: "orderNumber", customer: "contact.name", status: "status", payment: "paymentStatus", total: "grandTotal" } as const;
const pretty = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/_/g, " ") : "unknown");
const tone = (s: string) => (["DELIVERED", "CONFIRMED"].includes(s) ? "ok" : ["CANCELLED", "REFUNDED"].includes(s) ? "danger" : "warn") as "ok" | "danger" | "warn";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <Card><div className="p-4"><p className="text-xs text-a-muted">{label}</p><p className="text-2xl font-semibold">{value}</p>{hint && <p className="mt-0.5 text-xs text-a-muted">{hint}</p>}</div></Card>;
}

function Breakdown({ title, rows, label }: { title: string; rows: Bucket[]; label?: (id: string | null) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="p-4 text-sm text-a-muted">No data.</p> : (
        <ul className="divide-y divide-a-border text-sm">
          {rows.map((r) => (
            <li key={String(r._id)} className="px-4 py-2">
              <div className="flex justify-between gap-3"><span className="truncate">{label ? label(r._id) : pretty(r._id)}</span><span className="whitespace-nowrap font-medium">{formatINR(r.revenue)} <span className="font-normal text-a-muted">· {r.orders}</span></span></div>
              <div className="mt-1 h-1.5 rounded bg-a-raised"><div className="h-1.5 rounded bg-a-accent" style={{ width: `${Math.max(2, (r.revenue / max) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function SalesReportPage({ searchParams }: PageProps<"/admin/reports/sales">) {
  await requireAdminPage("orders.read");
  const sp = await searchParams;
  const f = parseSalesFilters(sp);
  const page = pageParam(sp.page);
  const size = sizeParam(sp.size);
  const sort = sortParam(sp, SORTS, "placed");
  await db();
  const match = await salesMatch(f);
  const [sum, opts] = await Promise.all([salesSummary(match, f), salesFilterOptions()]);
  type O = { orderNumber: string; status: string; paymentStatus: string; grandTotal: number; placedAt: Date; contact: { name: string; phone: string }; items: { quantity: number; freeQuantity: number }[]; couponCode?: string; shippingAddress?: { state?: string } };
  const rows = (await Order.find(match, "orderNumber status paymentStatus grandTotal placedAt contact items couponCode shippingAddress.state").sort(sort.mongo).skip((page - 1) * size).limit(size).lean()) as unknown as O[];

  const t = sum.totals;
  const isDefaultSort = sort.key === "placed" && sort.dir === "desc";
  const base = { range: f.range === "custom" ? "" : f.range, from: f.range === "custom" ? f.from : "", to: f.range === "custom" ? f.to : "", status: f.status, payment: f.payment, method: f.method, source: f.source, customer: f.customer, state: f.state, coupon: f.coupon, min: f.min, max: f.max, product: f.product, q: f.q, group: f.group === "day" ? "" : f.group, sort: isDefaultSort ? "" : sort.key, dir: isDefaultSort ? "" : sort.dir, size: size === DEFAULT_PAGE_SIZE ? "" : size };
  const url = (o: Record<string, string | number | undefined>) => `/admin/reports/sales?${qs({ ...base, ...o })}`;
  const exportUrl = `/api/admin/reports/sales?${qs({ ...base, range: f.range, from: f.from, to: f.to })}`;
  const defaults = f.range === "30d" && !(f.status || f.payment || f.method || f.source || f.customer || f.state || f.coupon || f.min || f.max || f.product || f.q);
  const trendMax = Math.max(1, ...sum.trend.map((b) => b.revenue));
  const periodLabel = f.range === "all" ? "All time" : PRESETS.find(([k]) => k === f.range)?.[1] ?? `${f.from || "start"} to ${f.to || "today"}`;
  const sel = `${inputCls} !w-auto`;

  return (
    <>
      <PageHeader title="Sales report" subtitle={`${periodLabel} · ${t.orders.toLocaleString("en-IN")} orders · ${f.status === "all" ? "every status" : f.status ? pretty(f.status) : "excludes pending, cancelled & refunded"}`}
        actions={<div className="flex gap-2"><a href={exportUrl} className={button("secondary")}>Export CSV</a><Link href="/admin/reports" className={button("secondary")}>All reports</Link></div>} />

      <nav className="mb-3 flex flex-wrap gap-2" aria-label="Quick date range">
        {PRESETS.map(([k, label]) => <Link key={k} href={url({ range: k, from: "", to: "", page: undefined })} className={button(f.range === k ? "primary" : "secondary", "!py-1")}>{label}</Link>)}
      </nav>
      <form className="mb-5 flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={f.q} placeholder="Order no., name, phone, email" aria-label="Search orders" className={`${inputCls} max-w-[16rem]`} />
        <input name="product" defaultValue={f.product} placeholder="Product name or SKU" aria-label="Product" className={`${inputCls} max-w-[13rem]`} />
        <label className="flex items-center gap-1 text-xs text-a-muted">From<input type="date" name="from" defaultValue={f.from} className={sel} /></label>
        <label className="flex items-center gap-1 text-xs text-a-muted">To<input type="date" name="to" defaultValue={f.to} className={sel} /></label>
        <select name="status" defaultValue={f.status} aria-label="Order status" className={sel}><option value="">Sales (excl. pending/cancelled/refunded)</option><option value="all">Every status</option>{ORDER_STATUS.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select>
        <select name="payment" defaultValue={f.payment} aria-label="Payment status" className={sel}><option value="">Any payment status</option>{PAYMENT_STATUS.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select>
        <select name="method" defaultValue={f.method} aria-label="Payment method" className={sel}><option value="">Any payment method</option>{opts.methods.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        <select name="state" defaultValue={f.state} aria-label="State" className={sel}><option value="">All states</option>{opts.states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select name="customer" defaultValue={f.customer} aria-label="Customer type" className={sel}><option value="">Guests & registered</option><option value="registered">Registered only</option><option value="guest">Guest checkout only</option></select>
        <select name="source" defaultValue={f.source} aria-label="Source" className={sel}><option value="">New & imported orders</option><option value="new">New site only</option><option value="legacy">Imported (old site)</option></select>
        <select name="coupon" defaultValue={["", "any", "none"].includes(f.coupon) ? f.coupon : ""} aria-label="Coupon" className={sel}><option value="">Any coupon use</option><option value="any">Used a coupon</option><option value="none">No coupon</option></select>
        <input name="min" defaultValue={f.min} inputMode="decimal" placeholder="Min ₹" aria-label="Minimum order value" className={`${inputCls} max-w-[6rem]`} />
        <input name="max" defaultValue={f.max} inputMode="decimal" placeholder="Max ₹" aria-label="Maximum order value" className={`${inputCls} max-w-[6rem]`} />
        <select name="group" defaultValue={f.group} aria-label="Group trend by" className={sel}>{GROUPS.map((g) => <option key={g} value={g}>By {g}</option>)}</select>
        {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={size} />}
        <button className={button("primary")}>Apply filters</button>
        {!defaults && <Link href="/admin/reports/sales" className="px-2 py-2 text-sm text-a-muted underline">Reset</Link>}
      </form>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total sales" value={formatINR(t.gross)} hint="Order totals incl. shipping & tax" />
        <Stat label="Orders" value={t.orders.toLocaleString("en-IN")} hint={`${t.units.toLocaleString("en-IN")} units sold`} />
        <Stat label="Average order value" value={formatINR(t.orders ? Math.round(t.gross / t.orders) : 0)} />
        <Stat label="Unique customers" value={sum.customers.toLocaleString("en-IN")} />
        <Stat label="Product subtotal" value={formatINR(t.subtotal)} />
        <Stat label="Discounts given" value={formatINR(t.discount)} hint={t.subtotal ? `${((t.discount / t.subtotal) * 100).toFixed(1)}% of subtotal` : undefined} />
        <Stat label="Shipping + packing" value={formatINR(t.shipping + t.packing)} />
        <Stat label="Tax" value={formatINR(t.tax)} />
      </div>

      <Card title={`Sales by ${f.group}`} className="mb-4">
        {sum.trend.length === 0 ? <p className="p-4 text-sm text-a-muted">No orders match these filters.</p> : (
          <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-a-surface text-xs uppercase tracking-wide text-a-muted"><tr><th className="px-4 py-2">{f.group === "week" ? "Week starting" : f.group === "month" ? "Month" : "Date"}</th><th className="px-2">Orders</th><th className="px-2">Units</th><th className="px-2 text-right">Sales</th><th className="w-1/3 px-4" /></tr></thead>
            <tbody className="divide-y divide-a-border">{[...sum.trend].reverse().map((b) => (
              <tr key={String(b._id)}><td className="px-4 py-1.5">{b._id}</td><td className="px-2">{b.orders}</td><td className="px-2">{b.units}</td><td className="px-2 text-right font-medium">{formatINR(b.revenue)}</td><td className="px-4"><div className="h-2 rounded bg-a-raised"><div className="h-2 rounded bg-a-accent" style={{ width: `${Math.max(2, (b.revenue / trendMax) * 100)}%` }} /></div></td></tr>
            ))}</tbody></table></div>
        )}
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Top products">
          {sum.topProducts.length === 0 ? <p className="p-4 text-sm text-a-muted">No data.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-a-muted"><tr><th className="px-4 py-2">Product</th><th className="px-2">Units</th><th className="px-4 text-right">Sales</th></tr></thead>
              <tbody className="divide-y divide-a-border">{sum.topProducts.map((p) => <tr key={p._id}><td className="px-4 py-1.5">{p.name}<span className="block text-xs text-a-muted">{p.sku}</span></td><td className="px-2">{p.units}</td><td className="px-4 text-right font-medium">{formatINR(p.revenue)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Breakdown title="By state (top 15)" rows={sum.byState} label={(s) => s || "Unknown"} />
        <Breakdown title="By order status" rows={sum.byStatus} />
        <Breakdown title="By payment status" rows={sum.byPayment} />
        {sum.byCoupon.length > 0 && <Breakdown title="By coupon (top 10)" rows={sum.byCoupon} label={(s) => s ?? "—"} />}
      </div>

      <h2 className="mb-2 text-sm font-semibold">Orders ({t.orders.toLocaleString("en-IN")})</h2>
      <Table head={[{ label: "Order", sort: "order" }, { label: "Customer", sort: "customer" }, "State", "Units", "Coupon", { label: "Status", sort: "status" }, { label: "Payment", sort: "payment" }, { label: "Total", sort: "total" }, { label: "Placed", sort: "placed" }]}
        sort={{ key: sort.key, dir: sort.dir }} sortHref={(key, dir) => url({ sort: key, dir, page: undefined })} empty={rows.length ? undefined : "No orders match these filters."}>
        {rows.map((o) => (
          <tr key={o.orderNumber} className="hover:bg-a-raised/60">
            <td><Link href={`/admin/orders/${o.orderNumber}`} className="font-medium text-a-accent underline">{o.orderNumber}</Link></td>
            <td>{o.contact.name}<span className="block text-xs text-a-muted">{o.contact.phone}</span></td>
            <td className="text-a-muted">{o.shippingAddress?.state ?? "—"}</td>
            <td>{o.items.reduce((n, i) => n + i.quantity + i.freeQuantity, 0)}</td>
            <td className="text-a-muted">{o.couponCode ?? "—"}</td>
            <td><Badge tone={tone(o.status)}>{pretty(o.status)}</Badge></td>
            <td className="text-a-muted">{pretty(o.paymentStatus)}</td>
            <td className="font-medium">{formatINR(o.grandTotal)}</td>
            <td className="whitespace-nowrap text-a-muted">{formatDate(o.placedAt)}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(t.orders / size))} total={t.orders} size={size} href={(p) => url({ page: p })} sizeHref={(n) => url({ size: n === DEFAULT_PAGE_SIZE ? "" : n, page: undefined })} />
    </>
  );
}
