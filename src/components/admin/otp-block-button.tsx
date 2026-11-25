"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { blockOtpNumber, unblockOtpNumber, type OtpActivityResult } from "@/app/actions/admin/otp-activity";
import { button } from "./ui";

export function OtpBlockButton({ id, mobile, blocked }: { id: string; mobile: string; blocked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<OtpActivityResult | null>(null);
  const run = (fn: () => Promise<OtpActivityResult>) => start(async () => { const r = await fn(); setRes(r); if (r.ok) router.refresh(); });
  return (
    <div className="space-y-1">
      {blocked
        ? <button className={button("secondary", "!py-1")} disabled={pending} onClick={() => run(() => unblockOtpNumber(id))}>Unblock</button>
        : <button className={button("danger", "!py-1")} disabled={pending} onClick={() => {
            const why = prompt(`Block ${mobile} from using OTP? They will not be able to request or use any code.\n\nReason (optional):`, "");
            if (why !== null) run(() => blockOtpNumber(id, why));
          }}>Block</button>}
      {res && !res.ok && <p role="alert" className="text-xs text-a-danger">{res.error}</p>}
    </div>
  );
}
