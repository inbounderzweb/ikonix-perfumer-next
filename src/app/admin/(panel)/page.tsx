import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Notice, PageHeader, Table, formatDate, formatINR } from "@/components/admin/ui";
import { BarList, TrendChart } from "@/components/admin/charts";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Inventory, Order, Product, User } from "@/server/models";
import { one } from "@/server/admin/util";

export const metadata: Metadata = { title: "Dashboard" };

const DAY = 24 * 3600 * 1000;
const clock = () => Date.now();
const IST = 5.5 * 3600 * 1000;
/** YYYY-MM-DD of a moment in India time. */
const istDay = (t: number) => new Date(t + IST).toISOString().slice(0, 10);
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const RANGES = [7, 30, 90] as const;
/** Excludes orders that no longer count as sales. */
const COUNTED = { paymentStatus: "CAPTURED", status: { $nin: ["CANCELLED", "REFUNDED"] } };

export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdminPage("dashboard.view");
  const sp = await searchParams;
  await db();
  const can = (p: Parameters<typeof admin.permissions.has>[0]) => admin.permissions.has(p);
  const r = Number(one(sp.range)); const range = (RANGES as readonly number[]).includes(r) ? r : 30;

  // One daily series (India-time days) covering 2x the longest range, so every period and its previous period come from it.
  const now = clock(); const HISTORY = 180;
  const days = Array.from({ length: HISTORY }, (_, i) => istDay(now - (HISTORY - 1 - i) * DAY));
  const since = new Date(`${days[0]}T00:00:00+05:30`);
  const [active, drafts, customers, pendingOrders, lowStock, recent, salesRows, userRows, allTime, statusRows, topRows] = await Promise.all([
    Product.countDocuments({ status: "ACTIVE", deletedAt: null }),
    Product.countDocuments({ status: "DRAFT", deletedAt: null }),
    can("customers.read") ? User.countDocuments({ "roleKeys.0": { $exists: false }, status: { $ne: "DELETED" } }) : Promise.resolve(null),
    can("orders.read") ? Order.countDocuments({ status: { $in: ["CONFIRMED", "PROCESSING", "PACKED"] } }) : Promise.resolve(null),
    can("products.read") ? Inventory.countDocuments({ tracked: true, $expr: { $lte: [{ $subtract: ["$onHand", "$reserved"] }, "$lowStockThreshold"] } }) : Promise.resolve(null),
    can("orders.read") ? Order.find({}, "orderNumber status paymentStatus grandTotal placedAt contact.name").sort({ placedAt: -1 }).limit(10).lean() : Promise.resolve([]),
    can("orders.read") ? Order.aggregate([{ $match: { ...COUNTED, placedAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$placedAt", timezone: "Asia/Kolkata" } }, total: { $sum: "$grandTotal" }, n: { $sum: 1 } } }]) : Promise.resolve(null),
    can("customers.read") ? User.aggregate([{ $match: { "roleKeys.0": { $exists: false }, status: { $ne: "DELETED" }, createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, n: { $sum: 1 } } }]) : Promise.resolve(null),
    can("orders.read") ? Order.aggregate([{ $match: COUNTED }, { $group: { _id: null, total: { $sum: "$grandTotal" }, n: { $sum: 1 } } }]) : Promise.resolve(null),
    can("orders.read") ? Order.aggregate([{ $match: { placedAt: { $gte: new Date(now - range * DAY) }, $or: [{ status: { $ne: "PENDING" } }, { paymentStatus: "CAPTURED" }] } }, { $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { n: -1 } }]) : Promise.resolve(null),
    can("orders.read") ? Order.aggregate([{ $match: { ...COUNTED, placedAt: { $gte: new Date(now - range * DAY) } } }, { $unwind: "$items" }, { $group: { _id: "$items.productName", units: { $sum: { $add: ["$items.quantity", "$items.freeQuantity"] } }, revenue: { $sum: "$items.lineTotal" } } }, { $sort: { revenue: -1 } }, { $limit: 6 }]) : Promise.resolve(null),
  ]);

  const salesBy = new Map((salesRows as { _id: string; total: number; n: number }[] | null ?? []).map((x) => [x._id, x]));
  const usersBy = new Map((userRows as { _id: string; n: number }[] | null ?? []).map((x) => [x._id, x.n]));
  const sum = (from: number, to: number, f: (d: string) => number) => days.slice(from, to).reduce((a, d) => a + f(d), 0);
  const rev = (d: string) => salesBy.get(d)?.total ?? 0; const cnt = (d: string) => salesBy.get(d)?.n ?? 0; const usr = (d: string) => usersBy.get(d) ?? 0;
  const N = days.length; const cur = days.slice(N - range); const prevStart = N - 2 * range;
  const revCur = sum(N - range, N, rev), revPrev = sum(prevStart, N - range, rev);
  const ordCur = sum(N - range, N, cnt), usrCur = sum(N - range, N, usr), usrPrev = sum(prevStart, N - range, usr);
  const delta = (a: number, b: number) => (b === 0 ? (a === 0 ? null : "new") : `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) / b) * 100))}%`);
  const total = (allTime as { total: number; n: number }[] | null)?.[0];
  const period = (label: string, from: number, to = N) => ({ label, amount: sum(from, to, rev), orders: sum(from, to, cnt) });
  const recentSales = [period("Today", N - 1), period("Yesterday", N - 2, N - 1), period("Last 7 days", N - 7), period("Last 30 days", N - 30)];

  const tiles: { label: string; value: string; href?: string; note?: string }[] = [
    ...(salesRows ? [
      { label: "Total sales (all time)", value: formatINR(total?.total ?? 0), note: `${(total?.n ?? 0).toLocaleString("en-IN")} paid orders`, href: "/admin/orders?payment=CAPTURED" },
      { label: `Sales, last ${range} days`, value: formatINR(revCur), note: `${delta(revCur, revPrev) ?? "no change"} vs previous ${range} days`, href: "/admin/orders?payment=CAPTURED" },
      { label: `Orders, last ${range} days`, value: String(ordCur), note: `Average order ${formatINR(ordCur ? Math.round(revCur / ordCur) : 0)}`, href: "/admin/orders" },
    ] : []),
    ...(customers !== null ? [{ label: `New customers, last ${range} days`, value: String(usrCur), note: `${delta(usrCur, usrPrev) ?? "no change"} · ${customers.toLocaleString("en-IN")} in total`, href: "/admin/customers" }] : []),
    ...(pendingOrders !== null ? [{ label: "Orders to fulfil", value: String(pendingOrders), href: "/admin/orders?status=CONFIRMED" }] : []),
    { label: "Published products", value: active.toLocaleString("en-IN"), href: "/admin/products?status=ACTIVE", note: `${drafts} drafts` },
    ...(lowStock !== null ? [{ label: "Low stock sizes", value: String(lowStock), note: "tracked items only", href: "/admin/products" }] : []),
  ];
  type O = { _id: unknown; orderNumber: string; status: string; paymentStatus: string; grandTotal: number; placedAt: Date; contact: { name: string } };
  const statusLabel = (s: string) => s.toLowerCase().replace(/_/g, " ");
  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Welcome back, ${admin.name}.`} actions={
        <nav aria-label="Period" className="flex gap-1 rounded-lg border border-a-border bg-a-surface p-1 text-sm">
          {RANGES.map((n) => <Link key={n} href={n === 30 ? "/admin" : `/admin?range=${n}`} aria-current={n === range ? "true" : undefined} className={`rounded-md px-3 py-1 ${n === range ? "bg-a-accent text-white" : "text-a-muted hover:bg-a-raised hover:text-a-fg"}`}>{n} days</Link>)}
        </nav>} />
      {one(sp.denied) && <div className="mb-4"><Notice tone="warn">Your role doesn’t have access to that page.</Notice></div>}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href ?? "#"} className="rounded-xl border border-a-border bg-a-surface p-4 transition hover:border-a-accent/60">
            <p className="text-xs text-a-muted">{t.label}</p><p className="mt-1 text-2xl font-semibold">{t.value}</p>{t.note && <p className="mt-1 text-xs text-a-muted">{t.note}</p>}
          </Link>
        ))}
      </div>
      {salesRows && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {recentSales.map((p) => (
            <div key={p.label} className="rounded-xl border border-a-border bg-a-surface p-4">
              <p className="text-xs text-a-muted">{p.label}</p><p className="mt-1 text-xl font-semibold">{formatINR(p.amount)}</p><p className="mt-1 text-xs text-a-muted">{p.orders} {p.orders === 1 ? "order" : "orders"}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        {salesRows && <Card title={`Sales per day · last ${range} days`}><TrendChart label="Sales per day" data={cur.map((d) => ({ label: shortDay(d), value: Math.round(rev(d) / 100) }))} format={(n) => `₹${n.toLocaleString("en-IN")}`} /></Card>}
        {userRows && <Card title={`New customers per day · last ${range} days`}><TrendChart kind="bar" label="New customers per day" data={cur.map((d) => ({ label: shortDay(d), value: usr(d) }))} /></Card>}
      </div>
      {statusRows && topRows && (
        <div className="mb-6 grid gap-4 xl:grid-cols-2">
          <Card title={`Top products · last ${range} days`}><BarList format={(n) => formatINR(n)} rows={(topRows as { _id: string; units: number; revenue: number }[]).map((t) => ({ label: t._id, value: t.revenue, note: `${t.units} sold` }))} /></Card>
          <Card title={`Orders by status · last ${range} days`}><BarList rows={(statusRows as { _id: string; n: number }[]).map((s) => ({ label: statusLabel(s._id), value: s.n }))} /></Card>
        </div>
      )}
      {can("orders.read") && (
        <Card title="Recent orders" actions={<Link href="/admin/orders" className="text-xs text-a-accent underline">View all</Link>}>
          {(recent as unknown as O[]).length === 0 ? <p className="py-6 text-center text-sm text-a-muted">No orders yet. They appear here once customers check out.</p> : (
            <Table head={["Order", "Customer", "Status", "Payment", "Total", "Placed"]}>
              {(recent as unknown as O[]).map((o) => (
                <tr key={o.orderNumber}><td><Link className="font-medium text-a-accent underline" href={`/admin/orders/${o.orderNumber}`}>{o.orderNumber}</Link></td><td>{o.contact.name}</td><td><Badge>{statusLabel(o.status)}</Badge></td><td><Badge tone={o.paymentStatus === "CAPTURED" ? "ok" : "warn"}>{o.paymentStatus.toLowerCase()}</Badge></td><td>{formatINR(o.grandTotal)}</td><td className="text-a-muted">{formatDate(o.placedAt)}</td></tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
