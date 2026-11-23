"use client";

import { useActionState, useEffect, useState } from "react";
import { sendLoginOtp, verifyLoginOtp, type OtpState } from "@/app/actions/customer/auth";

const input = "w-full rounded-lg border border-[#d9c9bf] bg-white px-4 py-3 font-fancy text-[#3f342c] outline-none focus:border-[#8C7367]";
const btn = "w-full rounded-full bg-[#b49d91] px-6 py-3 font-fancy text-[#3f342c] transition hover:bg-[#a38c80] disabled:opacity-60";

export function LoginForm({ next, google, initialError, mock, resendSeconds }: { next: string; google: boolean; initialError?: string; mock: boolean; resendSeconds: number }) {
  const [sendState, send, sending] = useActionState<OtpState, FormData>(sendLoginOtp, undefined);
  const [verifyState, verify, verifying] = useActionState<OtpState, FormData>(verifyLoginOtp, undefined);
  const [editedFor, setEditedFor] = useState<OtpState>(undefined);
  const state = verifyState ?? sendState;
  const editing = sendState !== undefined && editedFor === sendState; // a fresh send result ends "change number" mode
  const onCode = state?.step === "code" && !editing;
  const mobile = state?.mobile ?? "";
  const error = state?.error ?? initialError;

  return (
    <div className="mt-8 rounded-2xl border border-[#e7dbd3] bg-[#fbf7f4] p-6 shadow-sm">
      {mock && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">Development mode: OTP SMS is simulated. No message is sent{process.env.NODE_ENV !== "production" ? " — use the mock code configured for this environment." : "."}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {google && (
        <>
          <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} className="flex w-full items-center justify-center gap-3 rounded-full border border-[#d9c9bf] bg-white px-6 py-3 font-fancy text-[#3f342c] hover:bg-[#f4ece6]">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </a>
          <div className="my-5 flex items-center gap-3 text-xs text-[#8C7367]"><span className="h-px flex-1 bg-[#e7dbd3]" />or<span className="h-px flex-1 bg-[#e7dbd3]" /></div>
        </>
      )}
      {!onCode ? (
        <form action={send} className="space-y-4">
          <label className="block font-fancy text-sm text-[#53443D]" htmlFor="mobile">Mobile number</label>
          <div className="flex gap-2">
            <span className="grid place-items-center rounded-lg border border-[#d9c9bf] bg-white px-3 font-fancy text-[#53443D]">+91</span>
            <input id="mobile" name="mobile" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile number" defaultValue={mobile.replace(/^\+91/, "")} maxLength={14} required className={input} />
          </div>
          <button className={btn} disabled={sending}>{sending ? "Sending…" : "Send code"}</button>
        </form>
      ) : (
        <div className="space-y-4">
          <form action={verify} className="space-y-4">
            <input type="hidden" name="mobile" value={mobile} />
            <input type="hidden" name="next" value={next} />
            <p className="font-fancy text-sm text-[#53443D]">Enter the code sent to <strong>{mobile.replace(/^\+91/, "+91 ")}</strong>. {state?.info}</p>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="6-digit code" aria-label="Verification code" required autoFocus className={`${input} text-center tracking-[0.5em]`} />
            <button className={btn} disabled={verifying}>{verifying ? "Verifying…" : "Verify & sign in"}</button>
          </form>
          <form action={send} className="flex items-center justify-between text-sm">
            <input type="hidden" name="mobile" value={mobile} /><input type="hidden" name="resend" value="1" />
            <button type="button" onClick={() => setEditedFor(sendState)} className="text-[#8C7367] underline">Change number</button>
            <Resend key={String(sendState?.resendAfterSec) + String(sending)} seconds={sendState?.resendAfterSec ?? resendSeconds} sending={sending} />
          </form>
        </div>
      )}
      <p className="mt-5 text-center text-xs text-[#8C7367]">By continuing you agree to our terms and privacy policy.</p>
    </div>
  );
}

/** Counts down on its own; remounted (via key) whenever a new code is sent, so no state is set from an effect body. */
function Resend({ seconds, sending }: { seconds: number; sending: boolean }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  return <button disabled={left > 0 || sending} className="text-[#8C7367] underline disabled:no-underline disabled:opacity-60">{left > 0 ? `Resend in ${left}s` : "Resend code"}</button>;
}
