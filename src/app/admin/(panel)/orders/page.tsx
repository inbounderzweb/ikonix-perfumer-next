import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, button, formatDate, formatINR, inputCls } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Order, TestLogin } from "@/server/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/server/models/commerce";
import { escapeRe } from "@/server/admin/products";
import { DEFAULT_PAGE_SIZE, dateRange, one, pageParam, qs, sizeParam, sortParam } from "@/server/admin/util";
import { expirePendingOrders } from "@/server/commerce/orders";

export const metadata: Metadata = { title: "Orders" };
const SORTS = { placed: "placedAt", order: "orderNumber", customer: "contact.name", status: "status", payment: "paymentStatus", total: "grandTotal" } as const;
const tone = (s: string) => (["DELIVERED", "CONFIRMED"].includes(s) ? "ok" : ["CANCELLED", "REFUNDED"].includes(s) ? "danger" : "warn") as "ok" | "danger" | "warn";

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAdminPage("orders.read");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 60);
  const status = one(sp.status);
  const payment = one(sp.payment);
  const source = one(sp.source); // "legacy" | "new"
  const from = one(sp.from); const to = one(sp.to);
  const page = pageParam(sp.page);
  const size = sizeParam(sp.size);
  const sort = sortParam(sp, SORTS, "placed");
  await db();
  await expirePendingOrders();
  const filter: Record<string, unknown> = {};
  if ((ORDER_STATUS as readonly string[]).includes(status)) filter.status = status;
  if ((PAYMENT_STATUS as readonly string[]).includes(payment)) filter.paymentStatus = payment;
  if (source === "legacy") filter["legacy.source"] = { $exists: true };
  else if (source === "new") filter["legacy.source"] = { $exists: false };
  const placed = dateRange(from, to); if (placed) filter.placedAt = placed;
  if (q) { const re = new RegExp(escapeRe(q), "i"); filter.$or = [{ orderNumber: re }, { "contact.phone": re }, { "contact.name": re }, { "contact.email": re }]; }
  type O = { orderNumber: string; status: string; paymentStatus: string; grandTotal: number; placedAt: Date; contact: { name: string; phone: string }; items: unknown[]; legacy?: { source?: string } };
  const [total, rows] = await Promise.all([Order.countDocuments(filter), Order.find(filter, "orderNumber status paymentStatus grandTotal placedAt contact items legacy.source").sort(sort.mongo).skip((page - 1) * size).limit(size).lean() as unknown as Promise<O[]>]);
  const testPhones = new Set(((await TestLogin.find({}, "mobile").lean()) as unknown as { mobile: string }[]).map((t) => t.mobile));
  const base = { q, status, payment, source, from, to, sort: sort.key === "placed" && sort.dir === "desc" ? "" : sort.key, dir: sort.key === "placed" && sort.dir === "desc" ? "" : sort.dir, size: size === DEFAULT_PAGE_SIZE ? "" : size };
  const url = (o: Record<string, string | number | undefined>) => `/admin/orders?${qs({ ...base, ...o })}`;
  const filtered = !!(q || status || payment || source || from || to);
  return (
    <>
      <PageHeader title="Orders" subtitle={`${total.toLocaleString("en-IN")} ${filtered ? "matching " : ""}orders`} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Order no., name, phone or email" aria-label="Search orders" className={`${inputCls} max-w-xs`} />
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputCls} !w-auto`}><option value="">All statuses</option>{ORDER_STATUS.map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}</select>
        <select name="payment" defaultValue={payment} aria-label="Payment" className={`${inputCls} !w-auto`}><option value="">All payments</option>{PAYMENT_STATUS.map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}</select>
        <select name="source" defaultValue={source} aria-label="Source" className={`${inputCls} !w-auto`}><option value="">All orders</option><option value="new">New site</option><option value="legacy">Imported (old site)</option></select>
        <label className="flex items-center gap-1 text-xs text-a-muted">From<input type="date" name="from" defaultValue={from} className={`${inputCls} !w-auto`} /></label>
        <label className="flex items-center gap-1 text-xs text-a-muted">To<input type="date" name="to" defaultValue={to} className={`${inputCls} !w-auto`} /></label>
        {base.sort && <><input type="hidden" name="sort" value={base.sort} /><input type="hidden" name="dir" value={base.dir} /></>}
        {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={size} />}
        <button className={button("secondary")}>Filter</button>
        {filtered && <Link href="/admin/orders" className="px-2 py-2 text-sm text-a-muted underline">Clear</Link>}
      </form>
      <Table head={[{ label: "Order", sort: "order" }, { label: "Customer", sort: "customer" }, "Items", { label: "Status", sort: "status" }, { label: "Payment", sort: "payment" }, { label: "Total", sort: "total" }, { label: "Placed", sort: "placed" }]} sort={{ key: sort.key, dir: sort.dir }} sortHref={(key, dir) => url({ sort: key, dir, page: undefined })} empty={rows.length ? undefined : "No orders found."}>
        {rows.map((o) => (
          <tr key={o.orderNumber} className="hover:bg-a-raised/60">
            <td><Link href={`/admin/orders/${o.orderNumber}`} className="font-medium text-a-accent underline">{o.orderNumber}</Link>{o.legacy?.source && <> <Badge tone="neutral">imported</Badge></>}</td>
            <td>{o.contact.name} {testPhones.has(o.contact.phone) && <Badge tone="warn">test</Badge>}<br /><span className="text-xs text-a-muted">{o.contact.phone}</span></td><td>{o.items.length}</td>
            <td><Badge tone={tone(o.status)}>{o.status.toLowerCase().replace(/_/g, " ")}</Badge></td>
            <td><Badge tone={o.paymentStatus === "CAPTURED" ? "ok" : o.paymentStatus.includes("REFUND") ? "danger" : "warn"}>{o.paymentStatus.toLowerCase().replace(/_/g, " ")}</Badge></td>
            <td>{formatINR(o.grandTotal)}</td><td className="whitespace-nowrap text-a-muted">{formatDate(o.placedAt)}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / size))} total={total} size={size} href={(p) => url({ page: p })} sizeHref={(n) => url({ size: n === DEFAULT_PAGE_SIZE ? "" : n, page: undefined })} />
    </>
  );
}
