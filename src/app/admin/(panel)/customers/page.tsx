import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, button, formatDate, inputCls } from "@/components/admin/ui";
import { CustomerActions } from "@/components/admin/people";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Order, TestLogin, User } from "@/server/models";
import { escapeRe } from "@/server/admin/products";
import { DEFAULT_PAGE_SIZE, dateRange, one, pageParam, qs, sizeParam, sortParam } from "@/server/admin/util";

export const metadata: Metadata = { title: "Customers" };
const SORTS = { name: "name", contact: "mobile", joined: "createdAt", login: "lastLoginAt", status: "status" } as const;

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const admin = await requireAdminPage("customers.read");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80);
  const page = pageParam(sp.page);
  const size = sizeParam(sp.size);
  const sort = sortParam(sp, SORTS, "joined");
  const status = one(sp.status); const source = one(sp.source); const from = one(sp.from); const to = one(sp.to);
  const testOnly = one(sp.test) === "1";
  await db();
  const filter: Record<string, unknown> = { "roleKeys.0": { $exists: false }, status: { $ne: "DELETED" } };
  if (testOnly) filter.mobile = { $in: ((await TestLogin.find({}, "mobile").lean()) as unknown as { mobile: string }[]).map((t) => t.mobile) };
  if (status === "ACTIVE" || status === "SUSPENDED") filter.status = status;
  if (source === "legacy") filter["legacy.source"] = { $exists: true }; else if (source === "new") filter["legacy.source"] = { $exists: false };
  const joinedRange = dateRange(from, to); if (joinedRange) filter.createdAt = joinedRange;
  if (q) { const re = new RegExp(escapeRe(q), "i"); filter.$or = [{ name: re }, { email: re }, { mobile: re }]; }
  type U = { _id: unknown; name?: string; email?: string; mobile?: string; status: string; createdAt: Date; lastLoginAt?: Date };
  const [total, rows] = await Promise.all([User.countDocuments(filter), User.find(filter, "name email mobile status createdAt lastLoginAt").sort(sort.mongo).skip((page - 1) * size).limit(size).lean() as unknown as Promise<U[]>]);
  const counts = await Order.aggregate([{ $match: { userId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]);
  const orders = new Map(counts.map((c) => [String(c._id), c.n as number]));
  const testPhones = new Set(((await TestLogin.find({}, "mobile").lean()) as unknown as { mobile: string }[]).map((t) => t.mobile));
  const isDefaultSort = sort.key === "joined" && sort.dir === "desc";
  const base = { q, test: testOnly && "1", status, source, from, to, sort: isDefaultSort ? "" : sort.key, dir: isDefaultSort ? "" : sort.dir, size: size === DEFAULT_PAGE_SIZE ? "" : size };
  const url = (o: Record<string, string | number | undefined>) => `/admin/customers?${qs({ ...base, ...o })}`;
  const filtered = !!(q || testOnly || status || source || from || to);
  return (
    <>
      <PageHeader title="Customers" subtitle={`${total.toLocaleString("en-IN")} ${filtered ? "matching " : ""}customers`} actions={<div className="flex gap-2"><Link href="/admin/reports/otp" className={button("secondary")}>OTP usage</Link>{admin.permissions.has("customers.write") && <Link href="/admin/customers/test-logins" className={button("secondary")}>Test users</Link>}</div>} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, email or mobile" aria-label="Search customers" className={`${inputCls} max-w-xs`} />
        <select name="test" defaultValue={testOnly ? "1" : ""} aria-label="Customer type" className={`${inputCls} !w-auto`}><option value="">All customers</option><option value="1">Test users only</option></select>
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputCls} !w-auto`}><option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select>
        <select name="source" defaultValue={source} aria-label="Source" className={`${inputCls} !w-auto`}><option value="">All sources</option><option value="new">New site</option><option value="legacy">Imported (old site)</option></select>
        <label className="flex items-center gap-1 text-xs text-a-muted">Joined from<input type="date" name="from" defaultValue={from} className={`${inputCls} !w-auto`} /></label>
        <label className="flex items-center gap-1 text-xs text-a-muted">to<input type="date" name="to" defaultValue={to} className={`${inputCls} !w-auto`} /></label>
        {base.sort && <><input type="hidden" name="sort" value={base.sort} /><input type="hidden" name="dir" value={base.dir} /></>}
        {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={size} />}
        <button className={button("secondary")}>Filter</button>
        {filtered && <Link href="/admin/customers" className="px-2 py-2 text-sm text-a-muted underline">Clear</Link>}
      </form>
      <Table head={[{ label: "Customer", sort: "name" }, { label: "Contact", sort: "contact" }, "Orders", { label: "Joined", sort: "joined" }, { label: "Status", sort: "status" }, ""]} sort={{ key: sort.key, dir: sort.dir }} sortHref={(key, dir) => url({ sort: key, dir, page: undefined })} empty={rows.length ? undefined : "No customers yet."}>
        {rows.map((u) => (
          <tr key={String(u._id)}><td className="font-medium"><Link href={`/admin/customers/${String(u._id)}`} className="text-a-accent underline">{u.name ?? u.mobile ?? "—"}</Link> {u.mobile && testPhones.has(u.mobile) && <Badge tone="warn">test</Badge>}</td><td className="text-a-muted">{u.email}{u.email && u.mobile && <br />}{u.mobile}</td><td>{orders.get(String(u._id)) ?? 0}</td><td className="text-a-muted">{formatDate(u.createdAt)}</td><td><Badge tone={u.status === "ACTIVE" ? "ok" : "danger"}>{u.status.toLowerCase()}</Badge></td><td><CustomerActions id={String(u._id)} status={u.status} canWrite={admin.permissions.has("customers.write")} /></td></tr>
        ))}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / size))} total={total} size={size} href={(p) => url({ page: p })} sizeHref={(n) => url({ size: n === DEFAULT_PAGE_SIZE ? "" : n, page: undefined })} />
    </>
  );
}
