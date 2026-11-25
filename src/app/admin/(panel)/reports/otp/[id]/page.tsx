import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, Table, button, formatDate } from "@/components/admin/ui";
import { OtpBlockButton } from "@/components/admin/otp-block-button";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { OtpActivity, OtpVerification, User } from "@/server/models";
import { objectIdRe } from "@/server/admin/util";

export const metadata: Metadata = { title: "OTP history" };

const currentMs = () => Date.now();
const STATUS_TONE = { VERIFY_SUCCESS: "ok", VERIFY_FAILURE: "warn", LOCKED: "danger", RATE_LIMITED: "danger" } as const;

export default async function OtpHistoryPage({ params }: PageProps<"/admin/reports/otp/[id]">) {
  const admin = await requireAdminPage("customers.read");
  const { id } = await params;
  if (!objectIdRe.test(id)) notFound();
  await db();
  type A = { _id: unknown; mobile: string; requestCount: number; verifiedCount: number; failedCount: number; blockedAttempts: number; lastRequestAt?: Date; createdAt: Date; blocked: boolean; blockedAt?: Date; blockedReason?: string };
  const a = (await OtpActivity.findById(id).lean()) as unknown as A | null;
  if (!a) notFound();
  type O = { _id: unknown; purpose: string; createdAt: Date; expiresAt: Date; attempts: number; maxAttempts: number; sendCount: number; consumedAt?: Date; lockedAt?: Date; deliveryStatus: string; provider?: string; ipAddress?: string; userAgent?: string; events: { type: string; ipAddress?: string; at: Date }[] };
  const [user, otps] = await Promise.all([
    User.findOne({ mobile: a.mobile, deletedAt: null }, "name email status createdAt lastLoginAt").lean() as unknown as Promise<{ _id: unknown; name?: string; email?: string; status: string; lastLoginAt?: Date } | null>,
    OtpVerification.find({ destination: a.mobile }).sort({ createdAt: -1 }).limit(200).lean() as unknown as Promise<O[]>,
  ]);
  const nowMs = currentMs();
  const outcome = (o: O): { label: string; tone: "ok" | "warn" | "danger" | "neutral" } =>
    o.consumedAt ? { label: "used", tone: "ok" } : o.lockedAt ? { label: "locked (too many wrong codes)", tone: "danger" } : o.deliveryStatus === "FAILED" ? { label: "send failed", tone: "danger" } : o.expiresAt.getTime() < nowMs ? { label: "expired unused", tone: "neutral" } : o.attempts >= 1 ? { label: "wrong code entered", tone: "warn" } : { label: "pending / replaced", tone: "neutral" };
  const stat = (label: string, v: number | string) => <Card><div className="p-4"><p className="text-xs text-a-muted">{label}</p><p className="text-2xl font-semibold">{v}</p></div></Card>;
  return (
    <>
      <PageHeader title={a.mobile} subtitle={user ? `${user.name ?? "Customer"}${user.email ? ` · ${user.email}` : ""}` : "No customer account (never completed sign-in)"}
        actions={<div className="flex gap-2"><Link href="/admin/reports/otp" className={button("secondary")}>Back to report</Link>{user && <Link href={`/admin/customers/${String(user._id)}`} className={button("secondary")}>Customer</Link>}</div>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {stat("OTPs requested", a.requestCount)}{stat("Verified (logged in)", a.verifiedCount)}{stat("Wrong codes", a.failedCount)}{stat("Tries while blocked", a.blockedAttempts)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-a-muted">
        <span>First seen {formatDate(a.createdAt)}</span>{a.lastRequestAt && <span>· Last request {formatDate(a.lastRequestAt)}</span>}
        {a.blocked ? <Badge tone="danger">blocked{a.blockedReason ? `: ${a.blockedReason}` : ""}</Badge> : <Badge tone="ok">not blocked</Badge>}
        {admin.permissions.has("customers.write") && <OtpBlockButton id={String(a._id)} mobile={a.mobile} blocked={a.blocked} />}
      </div>
      <h2 className="mb-2 text-sm font-semibold">Each OTP used (latest 200, kept 30 days)</h2>
      <Table head={["Requested", "Purpose", "Outcome", "Wrong tries", "Resends", "Delivery", "IP / device", "Timeline"]} empty={otps.length ? undefined : "No OTP records in the last 30 days. The totals above are all-time."}>
        {otps.map((o) => { const out = outcome(o); return (
          <tr key={String(o._id)}>
            <td className="whitespace-nowrap">{formatDate(o.createdAt)}</td>
            <td>{o.purpose.toLowerCase().replace("_", " ")}</td>
            <td><Badge tone={out.tone}>{out.label}</Badge>{o.consumedAt && <span className="block text-xs text-a-muted">{formatDate(o.consumedAt)}</span>}</td>
            <td>{o.attempts}/{o.maxAttempts}</td>
            <td>{Math.max(0, o.sendCount - 1)}</td>
            <td className="text-a-muted">{o.deliveryStatus.toLowerCase()}{o.provider && <span className="block text-xs">{o.provider}</span>}</td>
            <td className="max-w-[14rem] text-xs text-a-muted">{o.ipAddress}<span className="block truncate" title={o.userAgent}>{o.userAgent}</span></td>
            <td className="text-xs">{o.events.map((e, i) => <span key={i} className="mr-1 inline-block"><Badge tone={STATUS_TONE[e.type as keyof typeof STATUS_TONE] ?? "neutral"}>{e.type.toLowerCase().replace(/_/g, " ")}</Badge></span>)}</td>
          </tr>); })}
      </Table>
    </>
  );
}
