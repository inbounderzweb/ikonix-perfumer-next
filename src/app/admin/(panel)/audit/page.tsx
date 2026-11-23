import type { Metadata } from "next";
import { PageHeader, Pagination, Table, formatDate, inputCls, button } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { AuditLog, User } from "@/server/models";
import { one, pageParam } from "@/server/admin/util";

export const metadata: Metadata = { title: "Audit log" };
const SIZE = 50;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdminPage("audit.read");
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const action = one(sp.action).replace(/[^a-z._]/gi, "").slice(0, 40);
  await db();
  const filter = action ? { action: new RegExp(`^${action.replace(/\./g, "\\.")}`) } : {};
  type L = { _id: unknown; action: string; entityType: string; entityId?: string; actorUserId?: unknown; ipAddress?: string; createdAt: Date };
  const [total, rows] = await Promise.all([AuditLog.countDocuments(filter), AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * SIZE).limit(SIZE).lean() as unknown as Promise<L[]>]);
  const actors = (await User.find({ _id: { $in: rows.map((r) => r.actorUserId).filter(Boolean) } }, "name email").lean()) as unknown as { _id: unknown; name?: string; email?: string }[];
  const who = new Map(actors.map((a) => [String(a._id), a.email ?? a.name ?? "staff"]));
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every admin change, newest first. Entries cannot be edited." />
      <form className="mb-4 flex gap-2"><input name="action" defaultValue={action} placeholder="Filter by action, e.g. product, media, order" aria-label="Filter by action" className={`${inputCls} max-w-sm`} /><button className={button("secondary")}>Filter</button></form>
      <Table head={["When", "Who", "Action", "Entity", "IP"]} empty={rows.length ? undefined : "Nothing logged yet."}>
        {rows.map((r) => (
          <tr key={String(r._id)}><td className="whitespace-nowrap text-a-muted">{formatDate(r.createdAt)}</td><td>{who.get(String(r.actorUserId)) ?? "system"}</td><td className="font-mono text-xs">{r.action}</td><td className="text-a-muted">{r.entityType} <span className="font-mono text-xs">{r.entityId?.slice(-8)}</span></td><td className="text-a-muted">{r.ipAddress}</td></tr>
        ))}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / SIZE))} href={(p) => `/admin/audit?${new URLSearchParams({ ...(action && { action }), page: String(p) })}`} />
    </>
  );
}
