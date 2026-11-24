import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, button, formatDate, inputCls } from "@/components/admin/ui";
import { OfferRowActions } from "@/components/admin/offer-form";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Promotion } from "@/server/models";
import { escapeRe } from "@/server/admin/products";
import { DEFAULT_PAGE_SIZE, one, pageParam, qs, sizeParam, sortParam } from "@/server/admin/util";

export const metadata: Metadata = { title: "Offers" };
const SORTS = { name: "name", window: "startsAt", used: "usageCount", created: "createdAt" } as const;

type R = { _id: unknown; name: string; status: string; startsAt?: Date; endsAt?: Date; usageCount: number; usageLimitTotal?: number; variantRules: { buy: number; free: number }[] };
function state(r: R) {
  const now = Date.now();
  if (r.status !== "ACTIVE") return ["disabled", "neutral"] as const;
  if (r.endsAt && r.endsAt.getTime() < now) return ["expired", "danger"] as const;
  if (r.startsAt && r.startsAt.getTime() > now) return ["scheduled", "warn"] as const;
  return ["live", "ok"] as const;
}

export default async function OffersPage({ searchParams }: PageProps<"/admin/offers">) {
  await requireAdminPage("promotions.write");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80); const status = one(sp.status);
  const page = pageParam(sp.page); const size = sizeParam(sp.size); const sort = sortParam(sp, SORTS, "created");
  await db();
  const now = new Date();
  const filter: Record<string, unknown> = { type: "BUY_X_GET_Y", deletedAt: null };
  const and: Record<string, unknown>[] = [];
  if (status === "disabled") filter.status = { $ne: "ACTIVE" };
  else if (status === "expired") { filter.status = "ACTIVE"; filter.endsAt = { $lt: now }; }
  else if (status === "scheduled") { filter.status = "ACTIVE"; filter.startsAt = { $gt: now }; }
  else if (status === "live") { filter.status = "ACTIVE"; and.push({ $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }, { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }); }
  if (q) and.push({ name: new RegExp(escapeRe(q), "i") });
  if (and.length) filter.$and = and;
  const [total, rows] = await Promise.all([Promotion.countDocuments(filter), Promotion.find(filter).sort(sort.mongo).skip((page - 1) * size).limit(size).lean() as unknown as Promise<R[]>]);
  const isDefaultSort = sort.key === "created" && sort.dir === "desc";
  const base = { q, status, sort: isDefaultSort ? "" : sort.key, dir: isDefaultSort ? "" : sort.dir, size: size === DEFAULT_PAGE_SIZE ? "" : size };
  const url = (o: Record<string, string | number | undefined>) => `/admin/offers?${qs({ ...base, ...o })}`;
  const filtered = !!(q || status);
  return (
    <>
      <PageHeader title="Offers" subtitle={`${total.toLocaleString("en-IN")} ${filtered ? "matching " : ""}Buy X Get Y offers, configured per product variant.`} actions={<Link href="/admin/offers/new" className={button("primary")}>New offer</Link>} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search offer name" aria-label="Search offers" className={`${inputCls} max-w-xs`} />
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputCls} !w-auto`}><option value="">All statuses</option><option value="live">Live</option><option value="scheduled">Scheduled</option><option value="expired">Expired</option><option value="disabled">Disabled</option></select>
        {base.sort && <><input type="hidden" name="sort" value={base.sort} /><input type="hidden" name="dir" value={base.dir} /></>}
        {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={size} />}
        <button className={button("secondary")}>Filter</button>
        {filtered && <Link href="/admin/offers" className="px-2 py-2 text-sm text-a-muted underline">Clear</Link>}
      </form>
      <Table head={[{ label: "Offer", sort: "name" }, "Variants", { label: "Window", sort: "window" }, { label: "Used", sort: "used" }, "Status", ""]} sort={{ key: sort.key, dir: sort.dir }} sortHref={(key, dir) => url({ sort: key, dir, page: undefined })} empty={rows.length ? undefined : filtered ? "No offers match." : "No offers yet."}>
        {rows.map((r) => { const [label, tone] = state(r); return (
          <tr key={String(r._id)}>
            <td><Link href={`/admin/offers/${String(r._id)}`} className="font-medium text-a-accent underline">{r.name}</Link></td>
            <td className="text-a-muted">{r.variantRules.length} · {[...new Set(r.variantRules.map((v) => `B${v.buy}G${v.free}`))].slice(0, 4).join(", ")}</td>
            <td className="whitespace-nowrap text-a-muted">{r.startsAt ? formatDate(r.startsAt) : "Now"} → {r.endsAt ? formatDate(r.endsAt) : "No end"}</td>
            <td>{r.usageCount}{r.usageLimitTotal ? ` / ${r.usageLimitTotal}` : ""}</td>
            <td><Badge tone={tone}>{label}</Badge></td>
            <td><OfferRowActions id={String(r._id)} active={r.status === "ACTIVE"} /></td>
          </tr>
        ); })}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / size))} total={total} size={size} href={(p) => url({ page: p })} sizeHref={(n) => url({ size: n === DEFAULT_PAGE_SIZE ? "" : n, page: undefined })} />
    </>
  );
}
