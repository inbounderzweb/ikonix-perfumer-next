import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, button, formatDate, formatINR, inputCls } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Order } from "@/server/models";
import { ORDER_STATUS } from "@/server/models/commerce";
import { escapeRe } from "@/server/admin/products";
import { one, pageParam } from "@/server/admin/util";
import { expirePendingOrders } from "@/server/commerce/orders";

export const metadata: Metadata = { title: "Orders" };
const SIZE = 25;
const tone = (s: string) => (["DELIVERED", "CONFIRMED"].includes(s) ? "ok" : ["CANCELLED", "REFUNDED"].includes(s) ? "danger" : "warn") as "ok" | "danger" | "warn";

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAdminPage("orders.read");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 60);
  const status = one(sp.status);
  const page = pageParam(sp.page);
  await db();
  await expirePendingOrders();
  const filter: Record<string, unknown> = {};
  if ((ORDER_STATUS as readonly string[]).includes(status)) filter.status = status;
  if (q) { const re = new RegExp(escapeRe(q), "i"); filter.$or = [{ orderNumber: re }, { "contact.phone": re }, { "contact.name": re }, { "contact.email": re }]; }
  type O = { orderNumber: string; status: string; paymentStatus: string; grandTotal: number; placedAt: Date; contact: { name: string; phone: string }; items: unknown[] };
  const [total, rows] = await Promise.all([Order.countDocuments(filter), Order.find(filter, "orderNumber status paymentStatus grandTotal placedAt contact items").sort({ placedAt: -1 }).skip((page - 1) * SIZE).limit(SIZE).lean() as unknown as Promise<O[]>]);
  return (
    <>
      <PageHeader title="Orders" subtitle={`${total.toLocaleString("en-IN")} orders`} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Order no., name, phone or email" aria-label="Search orders" className={`${inputCls} max-w-sm`} />
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputCls} !w-auto`}><option value="">All statuses</option>{ORDER_STATUS.map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}</select>
        <button className={button("secondary")}>Filter</button>
      </form>
      <Table head={["Order", "Customer", "Items", "Status", "Payment", "Total", "Placed"]} empty={rows.length ? undefined : "No orders found."}>
        {rows.map((o) => (
          <tr key={o.orderNumber} className="hover:bg-a-raised/60">
            <td><Link href={`/admin/orders/${o.orderNumber}`} className="font-medium text-a-accent underline">{o.orderNumber}</Link></td>
            <td>{o.contact.name}<br /><span className="text-xs text-a-muted">{o.contact.phone}</span></td><td>{o.items.length}</td>
            <td><Badge tone={tone(o.status)}>{o.status.toLowerCase().replace(/_/g, " ")}</Badge></td>
            <td><Badge tone={o.paymentStatus === "CAPTURED" ? "ok" : o.paymentStatus.includes("REFUND") ? "danger" : "warn"}>{o.paymentStatus.toLowerCase().replace(/_/g, " ")}</Badge></td>
            <td>{formatINR(o.grandTotal)}</td><td className="whitespace-nowrap text-a-muted">{formatDate(o.placedAt)}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / SIZE))} href={(p) => `/admin/orders?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), page: String(p) })}`} />
    </>
  );
}
