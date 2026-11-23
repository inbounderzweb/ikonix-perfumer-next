"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelAccountDeletion, logoutEverywhere, requestAccountDeletion } from "@/app/actions/customer/account";
import { logoutAction, logoutOtherDevices } from "@/app/actions/customer/auth";
import { useToast } from "./toast";
import { btnGhost } from "./ui";

export function SettingsActions({ deletionRequested }: { deletionRequested: boolean }) {
  const toast = useToast(); const router = useRouter(); const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <form action={logoutAction}><button className={btnGhost}>Sign out</button></form>
      <button className={btnGhost} disabled={pending} onClick={() => start(async () => { await logoutOtherDevices(); toast("ok", "Signed out of all other devices."); router.refresh(); })}>Sign out other devices</button>
      <button className={btnGhost} disabled={pending} onClick={() => start(async () => { await logoutEverywhere(); router.replace("/login"); router.refresh(); })}>Sign out everywhere</button>
      {deletionRequested ? (
        <button className={btnGhost} disabled={pending} onClick={() => start(async () => { const r = await cancelAccountDeletion(); toast(r.ok ? "ok" : "err", r.ok ? r.message ?? "Done" : r.error); router.refresh(); })}>Cancel deletion request</button>
      ) : (
        <button className={`${btnGhost} text-red-700`} disabled={pending} onClick={() => { if (confirm("Request deletion of your account? Your saved profile data will be removed by our team. Order and payment records are kept as required by law.")) start(async () => { const r = await requestAccountDeletion(); toast(r.ok ? "ok" : "err", r.ok ? r.message ?? "Requested" : r.error); router.refresh(); }); }}>Request account deletion</button>
      )}
    </div>
  );
}
