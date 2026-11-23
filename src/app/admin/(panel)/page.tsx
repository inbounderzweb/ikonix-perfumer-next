import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Notice, PageHeader, Table, formatDate, formatINR } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Inventory, Order, Product, User } from "@/server/models";
import { one } from "@/server/admin/util";

export const metadata: Metadata = { title: "Dashboard" };

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdminPage("dashboard.view");
  const sp = await searchParams;
  await db();
  const can = (p: Parameters<typeof admin.permissions.has>[0]) => admin.permissions.has(p);
  const since = daysAgo(30);
  const [active, drafts, customers, paid, pendingOrders, lowStock, recent] = await Promise.all([
    Product.countDocuments({ status: "ACTIVE", deletedAt: null }),
    Product.countDocuments({ status: "DRAFT", deletedAt: null }),
    can("customers.read") ? User.countDocuments({ "roleKeys.0": { $exists: false }, status: { $ne: "DELETED" } }) : Promise.resolve(null),
    can("orders.read") ? Order.aggregate([{ $match: { paymentStatus: "CAPTURED", placedAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: "$grandTotal" }, n: { $sum: 1 } } }]) : Promise.resolve(null),
    can("orders.read") ? Order.countDocuments({ status: { $in: ["CONFIRMED", "PROCESSING", "PACKED"] } }) : Promise.resolve(null),
    can("products.read") ? Inventory.countDocuments({ tracked: true, $expr: { $lte: [{ $subtract: ["$onHand", "$reserved"] }, "$lowStockThreshold"] } }) : Promise.resolve(null),
    can("orders.read") ? Order.find({}, "orderNumber status paymentStatus grandTotal placedAt contact.name").sort({ placedAt: -1 }).limit(8).lean() : Promise.resolve([]),
  ]);
  const revenue = (paid as { total: number; n: number }[] | null)?.[0];
  const tiles: { label: string; value: string; href?: string; note?: string }[] = [
    { label: "Published products", value: active.toLocaleString("en-IN"), href: "/admin/products?status=ACTIVE", note: `${drafts} drafts` },
    ...(paid ? [{ label: "Revenue, last 30 days", value: formatINR(revenue?.total ?? 0), note: `${revenue?.n ?? 0} paid orders`, href: "/admin/orders" }] : []),
    ...(pendingOrders !== null ? [{ label: "Orders to fulfil", value: String(pendingOrders), href: "/admin/orders?status=CONFIRMED" }] : []),
    ...(customers !== null ? [{ label: "Customers", value: String(customers), href: "/admin/customers" }] : []),
    ...(lowStock !== null ? [{ label: "Low stock sizes", value: String(lowStock), note: "tracked items only", href: "/admin/products" }] : []),
  ];
  type O = { _id: unknown; orderNumber: string; status: string; paymentStatus: string; grandTotal: number; placedAt: Date; contact: { name: string } };
  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Welcome back, ${admin.name}.`} />
      {one(sp.denied) && <div className="mb-4"><Notice tone="warn">Your role doesn’t have access to that page.</Notice></div>}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href ?? "#"} className="rounded-xl border border-a-border bg-a-surface p-4 transition hover:border-a-accent/60">
            <p className="text-xs text-a-muted">{t.label}</p><p className="mt-1 text-2xl font-semibold">{t.value}</p>{t.note && <p className="mt-1 text-xs text-a-muted">{t.note}</p>}
          </Link>
        ))}
      </div>
      {can("orders.read") && (
        <Card title="Recent orders" actions={<Link href="/admin/orders" className="text-xs text-a-accent underline">View all</Link>}>
          {(recent as unknown as O[]).length === 0 ? <p className="py-6 text-center text-sm text-a-muted">No orders yet. They appear here once customers check out.</p> : (
            <Table head={["Order", "Customer", "Status", "Payment", "Total", "Placed"]}>
              {(recent as unknown as O[]).map((o) => (
                <tr key={o.orderNumber}><td><Link className="font-medium text-a-accent underline" href={`/admin/orders/${o.orderNumber}`}>{o.orderNumber}</Link></td><td>{o.contact.name}</td><td><Badge>{o.status.toLowerCase().replace(/_/g, " ")}</Badge></td><td><Badge tone={o.paymentStatus === "CAPTURED" ? "ok" : "warn"}>{o.paymentStatus.toLowerCase()}</Badge></td><td>{formatINR(o.grandTotal)}</td><td className="text-a-muted">{formatDate(o.placedAt)}</td></tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
