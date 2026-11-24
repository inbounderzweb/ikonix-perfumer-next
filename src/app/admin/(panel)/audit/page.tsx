import type { Metadata } from "next";
import { PageHeader, Pagination, Table, formatDate, inputCls, button } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { AuditLog, User } from "@/server/models";
import Link from "next/link";
import { DEFAULT_PAGE_SIZE, dateRange, one, pageParam, qs, sizeParam, sortParam } from "@/server/admin/util";

export const metadata: Metadata = { title: "Audit log" };
const SORTS = { when: "createdAt", action: "action", entity: "entityType" } as const;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdminPage("audit.read");
  const sp = await searchParams;
  const page = pageParam(sp.page); const size = sizeParam(sp.size); const sort = sortParam(sp, SORTS, "when");
  const entity = one(sp.entity).replace(/[^a-z_]/gi, "").slice(0, 40); const from = one(sp.from); const to = one(sp.to);
  const action = one(sp.action).replace(/[^a-z._]/gi, "").slice(0, 40);
  await db();
  const filter: Record<string, unknown> = action ? { action: new RegExp(`^${action.replace(/\./g, "\\.")}`) } : {};
  if (entity) filter.entityType = new RegExp(`^${entity}`, "i");
  const range = dateRange(from, to); if (range) filter.createdAt = range;
  type L = { _id: unknown; action: string; entityType: string; entityId?: string; actorUserId?: unknown; ipAddress?: string; createdAt: Date };
  const [total, rows] = await Promise.all([AuditLog.countDocuments(filter), AuditLog.find(filter).sort(sort.mongo).skip((page - 1) * size).limit(size).lean() as unknown as Promise<L[]>]);
  const actors = (await User.find({ _id: { $in: rows.map((r) => r.actorUserId).filter(Boolean) } }, "name email").lean()) as unknown as { _id: unknown; name?: string; email?: string }[];
  const who = new Map(actors.map((a) => [String(a._id), a.email ?? a.name ?? "staff"]));
  const isDefaultSort = sort.key === "when" && sort.dir === "desc";
  const base = { action, entity, from, to, sort: isDefaultSort ? "" : sort.key, dir: isDefaultSort ? "" : sort.dir, size: size === DEFAULT_PAGE_SIZE ? "" : size };
  const url = (o: Record<string, string | number | undefined>) => `/admin/audit?${qs({ ...base, ...o })}`;
  const filtered = !!(action || entity || from || to);
  return (
    <>
      <PageHeader title="Audit log" subtitle={`${total.toLocaleString("en-IN")} ${filtered ? "matching " : ""}entries. Every admin change; entries cannot be edited.`} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input name="action" defaultValue={action} placeholder="Action, e.g. product, media, order" aria-label="Filter by action" className={`${inputCls} max-w-xs`} />
        <input name="entity" defaultValue={entity} placeholder="Entity type" aria-label="Filter by entity type" className={`${inputCls} max-w-[10rem]`} />
        <label className="flex items-center gap-1 text-xs text-a-muted">From<input type="date" name="from" defaultValue={from} className={`${inputCls} !w-auto`} /></label>
        <label className="flex items-center gap-1 text-xs text-a-muted">To<input type="date" name="to" defaultValue={to} className={`${inputCls} !w-auto`} /></label>
        {base.sort && <><input type="hidden" name="sort" value={base.sort} /><input type="hidden" name="dir" value={base.dir} /></>}
        {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={size} />}
        <button className={button("secondary")}>Filter</button>
        {filtered && <Link href="/admin/audit" className="px-2 py-2 text-sm text-a-muted underline">Clear</Link>}
      </form>
      <Table head={[{ label: "When", sort: "when" }, "Who", { label: "Action", sort: "action" }, { label: "Entity", sort: "entity" }, "IP"]} sort={{ key: sort.key, dir: sort.dir }} sortHref={(key, dir) => url({ sort: key, dir, page: undefined })} empty={rows.length ? undefined : "Nothing logged yet."}>
        {rows.map((r) => (
          <tr key={String(r._id)}><td className="whitespace-nowrap text-a-muted">{formatDate(r.createdAt)}</td><td>{who.get(String(r.actorUserId)) ?? "system"}</td><td className="font-mono text-xs">{r.action}</td><td className="text-a-muted">{r.entityType} <span className="font-mono text-xs">{r.entityId?.slice(-8)}</span></td><td className="text-a-muted">{r.ipAddress}</td></tr>
        ))}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / size))} total={total} size={size} href={(p) => url({ page: p })} sizeHref={(n) => url({ size: n === DEFAULT_PAGE_SIZE ? "" : n, page: undefined })} />
    </>
  );
}
