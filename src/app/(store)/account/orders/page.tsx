import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { listOrders } from "@/server/customer/orders";
import { Empty, OrderCard, btnGhost, btnPrimary, field } from "@/components/account/ui";

export const metadata: Metadata = { title: "My Orders", robots: { index: false } };
const s = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function OrdersPage({ searchParams }: PageProps<"/account/orders">) {
  const me = await requireCustomerPage("/account/orders");
  const sp = await searchParams;
  const f = { q: s(sp.q), status: s(sp.status), from: s(sp.from), to: s(sp.to), page: Number(s(sp.page)) || 1 };
  const r = await listOrders(me.id, f);
  const filtered = !!(f.q || f.status || f.from || f.to);
  const href = (page: number) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ q: f.q, status: f.status, from: f.from, to: f.to })) if (v) u.set(k, v); u.set("page", String(page)); return `/account/orders?${u}`; };
  return (
    <div className="space-y-5">
      <h1 className="font-heading text-[28px] text-[#8C7367]">My orders</h1>
      <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]" role="search">
        <input name="q" defaultValue={f.q} placeholder="Search order ID (IKX-…)" aria-label="Order ID" maxLength={20} className={field} />
        <select name="status" defaultValue={f.status ?? ""} aria-label="Status" className={field}>
          <option value="">All statuses</option><option value="active">In progress</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled / refunded</option><option value="returned">Returns</option>
        </select>
        <input type="date" name="from" defaultValue={f.from} aria-label="From date" className={field} />
        <input type="date" name="to" defaultValue={f.to} aria-label="To date" className={field} />
        <div className="flex gap-2"><button className={btnPrimary}>Filter</button>{filtered && <Link href="/account/orders" className={btnGhost}>Clear</Link>}</div>
      </form>
      {r.orders.length ? (
        <div className="space-y-2">{r.orders.map((o) => <OrderCard key={o.orderNumber} o={o} />)}</div>
      ) : filtered ? <Empty title="No matching orders" text="Try a different order ID, status or date range." href="/account/orders" cta="Clear filters" />
        : <Empty title="No orders yet" text="Your orders will show up here once you place one." href="/shop" cta="Start shopping" />}
      {r.pages > 1 && (
        <nav className="flex items-center justify-center gap-3 font-fancy text-sm" aria-label="Pagination">
          {r.page > 1 && <Link className={btnGhost} href={href(r.page - 1)}>Previous</Link>}
          <span>Page {r.page} of {r.pages}</span>
          {r.page < r.pages && <Link className={btnGhost} href={href(r.page + 1)}>Next</Link>}
        </nav>
      )}
    </div>
  );
}
