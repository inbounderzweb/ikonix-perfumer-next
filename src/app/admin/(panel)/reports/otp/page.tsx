import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, Pagination, Table, button, formatDate, inputCls } from "@/components/admin/ui";
import { OtpBlockButton } from "@/components/admin/otp-block-button";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { OtpActivity, User } from "@/server/models";
import { escapeRe } from "@/server/admin/products";
import { DEFAULT_PAGE_SIZE, one, pageParam, qs, sizeParam, sortParam } from "@/server/admin/util";

export const metadata: Metadata = { title: "OTP usage report" };
const SORTS = { mobile: "mobile", requests: "requestCount", today: "todayCount", failed: "failedCount", last: "lastRequestAt" } as const;
/** A number asking for this many codes in one day (or this many all-time) is flagged for review. */
const HEAVY_PER_DAY = 5;
const HEAVY_TOTAL = 15;

export default async function OtpActivityPage({ searchParams }: PageProps<"/admin/reports/otp">) {
  const admin = await requireAdminPage("customers.read");
  const canWrite = admin.permissions.has("customers.write");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 20);
  const view = one(sp.view); // "" | "blocked" | "heavy"
  const page = pageParam(sp.page);
  const size = sizeParam(sp.size);
  const sort = sortParam(sp, SORTS, "last");
  await db();

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const heavy = { $or: [{ dayKey: today, todayCount: { $gte: HEAVY_PER_DAY } }, { requestCount: { $gte: HEAVY_TOTAL } }] };
  const filter: Record<string, unknown> = {};
  if (view === "blocked") filter.blocked = true;
  if (view === "heavy") Object.assign(filter, heavy);
  if (q) filter.mobile = new RegExp(escapeRe(q.replace(/[\s-]/g, "")), "i");

  type R = { _id: unknown; mobile: string; requestCount: number; verifiedCount: number; failedCount: number; blockedAttempts: number; dayKey?: string; todayCount: number; lastRequestAt?: Date; lastIp?: string; blocked: boolean; blockedAt?: Date; blockedReason?: string };
  const [total, rows, numbers, blockedCount, heavyCount, sentToday] = await Promise.all([
    OtpActivity.countDocuments(filter),
    OtpActivity.find(filter).sort(sort.mongo).skip((page - 1) * size).limit(size).lean() as unknown as Promise<R[]>,
    OtpActivity.estimatedDocumentCount(),
    OtpActivity.countDocuments({ blocked: true }),
    OtpActivity.countDocuments(heavy),
    OtpActivity.aggregate([{ $match: { dayKey: today } }, { $group: { _id: null, n: { $sum: "$todayCount" } } }]),
  ]);
  const users = (await User.find({ mobile: { $in: rows.map((r) => r.mobile) } }, "mobile name").lean()) as unknown as { mobile: string; name?: string }[];
  const names = new Map(users.map((u) => [u.mobile, u.name]));
  const sentTodayN = (sentToday[0]?.n as number | undefined) ?? 0;

  const isDefaultSort = sort.key === "last" && sort.dir === "desc";
  const base = { q, view, sort: isDefaultSort ? "" : sort.key, dir: isDefaultSort ? "" : sort.dir, size: size === DEFAULT_PAGE_SIZE ? "" : size };
  const url = (o: Record<string, string | number | undefined>) => `/admin/reports/otp?${qs({ ...base, ...o })}`;
  const tabs = [["", "All", numbers], ["heavy", "Heavy use", heavyCount], ["blocked", "Blocked", blockedCount]] as const;

  return (
    <>
      <PageHeader title="OTP usage report" subtitle="Every mobile number that has tried to sign in with an OTP, and how many codes it has used. Open a number to see each OTP it used." actions={<Link href="/admin/reports" className={button("secondary")}>All reports</Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card><div className="p-4"><p className="text-xs text-a-muted">Numbers that tried to log in</p><p className="text-2xl font-semibold">{numbers.toLocaleString("en-IN")}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-a-muted">OTPs requested today</p><p className="text-2xl font-semibold">{sentTodayN.toLocaleString("en-IN")}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-a-muted">Heavy use (≥{HEAVY_PER_DAY} today or ≥{HEAVY_TOTAL} total)</p><p className="text-2xl font-semibold">{heavyCount.toLocaleString("en-IN")}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-a-muted">Blocked numbers</p><p className="text-2xl font-semibold">{blockedCount.toLocaleString("en-IN")}</p></div></Card>
      </div>
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter">
        {tabs.map(([key, label, n]) => <Link key={key} href={url({ view: key, page: undefined })} className={button(view === key ? "primary" : "secondary", "!py-1")}>{label} ({n})</Link>)}
      </nav>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search mobile number" aria-label="Search mobile number" className={`${inputCls} max-w-xs`} />
        {view && <input type="hidden" name="view" value={view} />}
        {base.sort && <><input type="hidden" name="sort" value={base.sort} /><input type="hidden" name="dir" value={base.dir} /></>}
        {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={size} />}
        <button className={button("secondary")}>Search</button>
        {q && <Link href={url({ q: "", page: undefined })} className="px-2 py-2 text-sm text-a-muted underline">Clear</Link>}
      </form>
      <Table
        head={[{ label: "Mobile", sort: "mobile" }, { label: "OTPs requested", sort: "requests" }, { label: "Today", sort: "today" }, "Verified", { label: "Wrong codes", sort: "failed" }, { label: "Last request", sort: "last" }, "Status", ""]}
        sort={{ key: sort.key, dir: sort.dir }} sortHref={(key, dir) => url({ sort: key, dir, page: undefined })}
        empty={rows.length ? undefined : q || view ? "No numbers match." : "No one has requested an OTP yet."}>
        {rows.map((r) => {
          const today_ = r.dayKey === today ? r.todayCount : 0;
          const isHeavy = today_ >= HEAVY_PER_DAY || r.requestCount >= HEAVY_TOTAL;
          return (
            <tr key={String(r._id)}>
              <td className="font-medium"><Link href={`/admin/reports/otp/${String(r._id)}`} className="text-a-accent underline">{r.mobile}</Link>{names.get(r.mobile) && <span className="block text-xs font-normal text-a-muted">{names.get(r.mobile)}</span>}</td>
              <td>{r.requestCount}</td>
              <td>{today_}</td>
              <td>{r.verifiedCount}</td>
              <td>{r.failedCount}{r.blockedAttempts > 0 && <span className="block text-xs text-a-muted">{r.blockedAttempts} while blocked</span>}</td>
              <td className="text-a-muted">{r.lastRequestAt ? formatDate(r.lastRequestAt) : "—"}{r.lastIp && <span className="block text-xs">{r.lastIp}</span>}</td>
              <td>
                {r.blocked ? <Badge tone="danger">blocked</Badge> : isHeavy ? <Badge tone="warn">heavy use</Badge> : <Badge tone="ok">ok</Badge>}
                {r.blocked && r.blockedReason && <span className="mt-1 block max-w-[14rem] text-xs text-a-muted">{r.blockedReason}{r.blockedAt && ` · ${formatDate(r.blockedAt)}`}</span>}
              </td>
              <td className="space-y-1"><Link href={`/admin/reports/otp/${String(r._id)}`} className={button("secondary", "!py-1")}>History</Link>{canWrite && <OtpBlockButton id={String(r._id)} mobile={r.mobile} blocked={r.blocked} />}</td>
            </tr>
          );
        })}
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / size))} total={total} size={size} href={(p) => url({ page: p })} sizeHref={(n) => url({ size: n === DEFAULT_PAGE_SIZE ? "" : n, page: undefined })} />
    </>
  );
}
