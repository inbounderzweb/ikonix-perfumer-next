import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, Table, formatDate, formatINR } from "@/components/admin/ui";
import { CustomerActions } from "@/components/admin/people";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Address, Order, TestLogin, User } from "@/server/models";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const admin = await requireAdminPage("customers.read");
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/.test(id)) notFound();
  await db();
  type U = { _id: string; name?: string; email?: string; mobile?: string; status: string; createdAt: Date; lastLoginAt?: Date; roleKeys?: string[]; google?: { email?: string } | null };
  const u = (await User.findOne({ _id: id, "roleKeys.0": { $exists: false }, status: { $ne: "DELETED" } }).lean()) as unknown as U | null;
  if (!u) notFound();
  type O = { orderNumber: string; status: string; paymentStatus: string; grandTotal: number; placedAt: Date };
  type A = { fullName: string; phone: string; line1: string; line2?: string; city: string; state: string; postalCode: string };
  const [orders, addresses, test] = await Promise.all([
    Order.find({ userId: u._id }, "orderNumber status paymentStatus grandTotal placedAt").sort({ placedAt: -1 }).limit(50).lean() as unknown as Promise<O[]>,
    Address.find({ userId: u._id, deletedAt: null }).lean() as unknown as Promise<A[]>,
    u.mobile ? TestLogin.exists({ mobile: u.mobile }) : null,
  ]);
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-a-muted">{k}</dt><dd className="text-right">{v || "—"}</dd></div>;
  return (
    <>
      <PageHeader
        title={u.name ?? u.mobile ?? "Customer"}
        subtitle={test ? "Test user" : "Customer"}
        actions={<><Link href="/admin/customers" className="text-sm underline">← All customers</Link>{test && admin.permissions.has("customers.write") && <Link href="/admin/customers/test-logins" className="ml-3 text-sm underline">Manage test login (OTP, delete)</Link>}</>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="divide-y divide-a-border">
            {row("Name", u.name)}{row("Mobile", u.mobile)}{row("Email", u.email ?? u.google?.email)}
            {row("Status", <Badge tone={u.status === "ACTIVE" ? "ok" : "danger"}>{u.status.toLowerCase()}</Badge>)}
            {row("Type", test ? <Badge tone="warn">test</Badge> : "Real customer")}
            {row("Joined", formatDate(u.createdAt))}{row("Last sign-in", u.lastLoginAt && formatDate(u.lastLoginAt))}
          </dl>
          <div className="mt-3"><CustomerActions id={String(u._id)} status={u.status} canWrite={admin.permissions.has("customers.write")} /></div>
        </Card>
        <Card title={`Addresses (${addresses.length})`}>
          {addresses.length === 0 ? <p className="text-sm text-a-muted">No saved addresses.</p> : (
            <ul className="space-y-3 text-sm">{addresses.map((a, i) => <li key={i}><b>{a.fullName}</b> · {a.phone}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.postalCode}</li>)}</ul>
          )}
        </Card>
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Orders ({orders.length})</h2>
      <Table head={["Order", "Status", "Payment", "Total", "Placed"]} empty={orders.length ? undefined : "No orders yet."}>
        {orders.map((o) => (
          <tr key={o.orderNumber}>
            <td><Link href={`/admin/orders/${o.orderNumber}`} className="font-medium text-a-accent underline">{o.orderNumber}</Link></td>
            <td>{o.status.toLowerCase().replace(/_/g, " ")}</td><td>{o.paymentStatus.toLowerCase().replace(/_/g, " ")}</td>
            <td>{formatINR(o.grandTotal)}</td><td className="whitespace-nowrap text-a-muted">{formatDate(o.placedAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
