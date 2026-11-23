"use server";

import { redirect } from "next/navigation";
import { normalizeMobile, safeNext } from "@/lib/phone";
import { clientMeta } from "@/server/auth/request";
import { requestOtp, verifyOtp } from "@/server/auth/otp/service";
import { userForVerifiedMobile } from "@/server/auth/identity";
import { createCustomerSession, destroyCustomerSession, getCustomer, revokeCustomerSessions } from "@/server/auth/customer-session";
import { rateLimit } from "@/server/auth/rate-limit";
import { auditCustomer } from "@/server/customer/audit";

export type OtpState = { step: "mobile" | "code"; mobile?: string; error?: string; info?: string; resendAfterSec?: number; mock?: boolean } | undefined;

/** Step 1: send a code. The response is identical for new and existing numbers (no account enumeration). */
export async function sendLoginOtp(_p: OtpState, form: FormData): Promise<OtpState> {
  const mobile = normalizeMobile(String(form.get("mobile") ?? ""));
  if (!mobile) return { step: "mobile", error: "Enter a valid 10-digit Indian mobile number." };
  const { ip, userAgent } = await clientMeta();
  const r = await requestOtp({ destination: mobile, purpose: "LOGIN", ip, userAgent });
  if (!r.ok) return { step: form.get("resend") ? "code" : "mobile", mobile, error: r.error, resendAfterSec: r.retryAfterSec };
  return { step: "code", mobile, resendAfterSec: r.resendAfterSec, mock: r.mock, info: r.mock ? "Development mode: no SMS is sent. Use the mock code." : "We sent a 6-digit code by SMS." };
}

/** Step 2: verify, then create (or find) the account and start a session. */
export async function verifyLoginOtp(_p: OtpState, form: FormData): Promise<OtpState> {
  const mobile = normalizeMobile(String(form.get("mobile") ?? ""));
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!mobile) return { step: "mobile", error: "Enter your mobile number again." };
  if (!/^\d{6}$/.test(code)) return { step: "code", mobile, error: "Enter the 6-digit code." };
  const { ip } = await clientMeta();
  if (!(await rateLimit(`otp-verify-ip:${ip}`, 40, 900))) return { step: "code", mobile, error: "Too many attempts. Try again in a few minutes." };
  const v = await verifyOtp({ destination: mobile, purpose: "LOGIN", code, ip });
  if (!v.ok) return { step: "code", mobile, error: v.error };
  const u = await userForVerifiedMobile(mobile);
  if ("error" in u) return { step: "mobile", error: u.error };
  await createCustomerSession(u.id, "OTP");
  await auditCustomer(u.id, u.created ? "customer.signup.otp" : "customer.login.otp", "User", u.id);
  redirect(safeNext(String(form.get("next") ?? ""), "/account"));
}

export async function logoutAction(): Promise<void> {
  const c = await getCustomer();
  await destroyCustomerSession();
  if (c) await auditCustomer(c.id, "customer.logout", "Session", c.sessionId);
  redirect("/");
}

export async function logoutOtherDevices(): Promise<{ ok: boolean }> {
  const c = await getCustomer();
  if (!c) return { ok: false };
  await revokeCustomerSessions(c.id, c.sessionId);
  await auditCustomer(c.id, "customer.logout.others", "User", c.id);
  return { ok: true };
}
