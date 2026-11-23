import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Session } from "@/server/models";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { getProfile } from "@/server/customer/profile";
import { Card } from "@/components/account/ui";
import { SettingsActions } from "@/components/account/settings-actions";
import { fmtDate } from "@/lib/format";
import { maskMobile } from "@/lib/phone";

export const metadata: Metadata = { title: "Account Settings", robots: { index: false } };

export default async function SettingsPage() {
  const me = await requireCustomerPage("/account/settings");
  const p = await getProfile(me.id);
  await db();
  const now = new Date();
  const sessions = (await Session.find({ userId: new Types.ObjectId(me.id), kind: "CUSTOMER", revokedAt: null, expiresAt: { $gt: now }, idleExpiresAt: { $gt: now } }, "deviceLabel authMethod lastSeenAt createdAt").sort({ lastSeenAt: -1 }).limit(10).lean()) as unknown as { _id: Types.ObjectId; deviceLabel?: string; authMethod: string; lastSeenAt?: Date; createdAt: Date }[];
  return (
    <div className="space-y-5">
      <h1 className="font-heading text-[28px] text-[#8C7367]">Account settings</h1>
      <Card title="Account"><dl className="space-y-1.5 font-fancy text-sm text-[#3f342c]">
        <div className="flex justify-between gap-4"><dt>Name</dt><dd>{p?.name || "—"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Email</dt><dd className="break-all">{p?.email || "—"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Mobile</dt><dd>{p?.mobile ? `${maskMobile(p.mobile)}${p.mobileVerified ? " ✓" : ""}` : "—"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Member since</dt><dd>{p ? fmtDate(p.createdAt) : ""}</dd></div>
      </dl><p className="mt-3 font-fancy text-sm"><Link href="/account/profile" className="underline">Edit profile or change mobile</Link> · <Link href="/account/addresses" className="underline">Manage addresses</Link></p></Card>
      <Card title="Sign-in methods"><ul className="font-fancy text-sm text-[#3f342c]"><li>Mobile OTP: {p?.authProviders.includes("mobile") ? "enabled" : "not set up"}</li><li>Google: {p?.authProviders.includes("google") ? `linked (${p.googleEmail})` : "not linked. Sign in with Google using the same email to link it."}</li></ul></Card>
      <Card title="Active sessions">
        <ul className="space-y-2 font-fancy text-sm text-[#3f342c]">{sessions.map((s) => <li key={String(s._id)} className="flex justify-between gap-3"><span>{s.deviceLabel ?? "Browser"} · {s.authMethod === "GOOGLE" ? "Google" : "OTP"}{String(s._id) === me.sessionId && <b className="ml-2 text-green-700">This device</b>}</span><span className="text-xs text-[#6b5446]">Active {fmtDate(s.lastSeenAt ?? s.createdAt, true)}</span></li>)}</ul>
        <div className="mt-4"><SettingsActions deletionRequested={!!p?.deletionRequestedAt} /></div>
        {p?.deletionRequestedAt && <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 font-fancy text-sm text-orange-900">Deletion requested on {fmtDate(p.deletionRequestedAt)}. Order and payment records are retained as required.</p>}
      </Card>
    </div>
  );
}
