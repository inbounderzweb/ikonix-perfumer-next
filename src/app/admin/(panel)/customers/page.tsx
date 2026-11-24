import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, button, formatDate, inputCls } from "@/components/admin/ui";
import { CustomerActions } from "@/components/admin/people";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Order, TestLogin, User } from "@/server/models";
import { escapeRe } from "@/server/admin/products";
import { one, pageParam } from "@/server/admin/util";

export const metadata: Metadata = { title: "Customers" };
const SIZE = 25;

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const admin = await requireAdminPage("customers.read");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80);
  const page = pageParam(sp.page);
  const testOnly = one(sp.test) === "1";
  await db();
  const filter: Record<string, unknown> = { "roleKeys.0": { $exists: false }, status: { $ne: "DELETED" } };
  if (testOnly) filter.mobile = { $in: ((await TestLogin.find({}, "mobile").lean()) as unknown as { mobile: string }[]).map((t) => t.mobile) };
  if (q) { const re = new RegExp(escapeRe(q), "i"); filter.$or = [{ name: re }, { email: re }, { mobile: re }]; }
  type U = { _id: unknown; name?: string; email?: string; mobile?: string; status: string; createdAt: Date; lastLoginAt?: Date };
  const [total, rows] = await Promise.all([User.countDocuments(filter), User.find(filter, "name email mobile status createdAt lastLoginAt").sort({ createdAt: -1 }).skip((page - 1) * SIZE).limit(SIZE).lean() as unknown as Promise<U[]>]);
  const counts = await Order.aggregate([{ $match: { userId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]);
  const orders = new Map(counts.map((c) => [String(c._id), c.n as number]));
  const testPhones = new Set(((await TestLogin.find({}, "mobile").lean()) as unknown as { mobile: string }[]).map((t) => t.mobile));
  return (
    <>
      <PageHeader title="Customers" subtitle={`${total.toLocaleString("en-IN")} customers`} actions={admin.permissions.has("customers.write") && <Link href="/admin/customers/test-logins" className={button("secondary")}>Test users</Link>} />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search"><input name="q" defaultValue={q} placeholder="Search name, email or mobile" aria-label="Search customers" className={`${inputCls} max-w-sm`} /><select name="test" defaultValue={testOnly ? "1" : ""} aria-label="Customer type" className={`${inputCls} !w-auto`}><option value="">All customers</option><option value="1">Test users only</option></select><button className={button("secondary")}>Search</button></form>
      <Table head={["Customer", "Contact", "Orders", "Joined", "Status", ""]} empty={rows.length ? undefined : "No customers yet."}>
        {rows.map((u) => (
          <tr key={String(u._id)}><td className="font-medium"><Link href={`/admin/customers/${String(u._id)}`} className="text-a-accent underline">{u.name ?? u.mobile ?? "—"}</Link> {u.mobile && testPhones.has(u.mobile) && <Badge tone="warn">test</Badge>}</td><td className="text-a-muted">{u.email}{u.email && u.mobile && <br />}{u.mobile}</td><td>{orders.get(String(u._id)) ?? 0}</td><td className="text-a-muted">{formatDate(u.createdAt)}</td><td><Badge tone={u.status === "ACTIVE" ? "ok" : "danger"}>{u.status.toLowerCase()}</Badge></td><td><CustomerActions id={String(u._id)} status={u.status} canWrite={admin.permissions.has("customers.write")} /></td></tr>
        ))}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / SIZE))} href={(p) => `/admin/customers?${new URLSearchParams({ ...(q && { q }), ...(testOnly && { test: "1" }), page: String(p) })}`} />
    </>
  );
}
