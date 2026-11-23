import type { Metadata } from "next";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { getProfile } from "@/server/customer/profile";
import { ProfileForm } from "@/components/account/profile-form";

export const metadata: Metadata = { title: "My Profile", robots: { index: false } };

export default async function ProfilePage() {
  const me = await requireCustomerPage("/account/profile");
  const p = await getProfile(me.id);
  if (!p) return null;
  return (
    <div className="space-y-5">
      <div><h1 className="font-heading text-[28px] text-[#8C7367]">My profile</h1>
        <div className="mt-2 h-2 max-w-sm overflow-hidden rounded-full bg-[#ecdfd6]"><div className="h-full bg-[#8C7367]" style={{ width: `${p.completion.percent}%` }} /></div>
        <p className="mt-1 font-fancy text-xs text-[#6b5446]">{p.completion.percent}% complete{p.completion.missing.length ? ` · missing: ${p.completion.missing.join(", ")}` : ""}</p></div>
      <ProfileForm p={p} />
    </div>
  );
}
