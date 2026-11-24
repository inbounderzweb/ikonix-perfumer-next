import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/server/db";
import { OtpVerification, TestLogin } from "@/server/models";
import { hmacSha256Hex, safeEqual } from "../crypto";
import { rateLimit } from "../rate-limit";
import { getSmsProvider } from "./sms-provider";

export type OtpPurpose = "LOGIN" | "CHANGE_MOBILE";

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
export const otpConfig = () => ({
  ttlSec: num(process.env.OTP_TTL_SECONDS, 300),
  maxAttempts: num(process.env.OTP_MAX_ATTEMPTS, 5),
  resendSec: num(process.env.OTP_RESEND_SECONDS, 30),
  maxSendsPerHour: num(process.env.OTP_MAX_SENDS_PER_HOUR, 5),
});

let warned = false;
function pepper(): string {
  const p = process.env.OTP_PEPPER;
  if (p && p.length >= 16) return p;
  if (process.env.NODE_ENV === "production") throw new Error("OTP_PEPPER must be set (16+ random characters) in production");
  if (!warned) { warned = true; console.warn("[otp] OTP_PEPPER not set; using an insecure development pepper"); }
  return "dev-only-otp-pepper";
}
const hashCode = (destination: string, purpose: OtpPurpose, code: string) => hmacSha256Hex(pepper(), `${destination}|${purpose}|${code}`);

function generateCode(isMock: boolean): string {
  // Mock mode uses a fixed code so flows can be tested without an SMS gateway. Never reachable in production (see provider).
  if (isMock) return /^\d{6}$/.test(process.env.MOCK_OTP_CODE ?? "") ? process.env.MOCK_OTP_CODE! : "123456";
  return String(randomInt(100000, 1000000));
}

export type RequestResult =
  | { ok: true; resendAfterSec: number; expiresInSec: number; mock: boolean; test?: boolean }
  | { ok: false; error: string; retryAfterSec?: number };

/** Creates and sends an OTP. All abuse limits live here, not in controllers. */
export async function requestOtp(input: { destination: string; purpose: OtpPurpose; userId?: string | null; ip: string; userAgent?: string }): Promise<RequestResult> {
  const cfg = otpConfig();
  const { destination, purpose } = input;
  await db();

  if (!(await rateLimit(`otp-ip:${input.ip}`, 20, 3600))) return { ok: false, error: "Too many requests from your network. Try again later.", retryAfterSec: 3600 };
  if (!(await rateLimit(`otp-dest:${destination}`, cfg.maxSendsPerHour, 3600))) return { ok: false, error: "Too many codes requested for this number. Try again in an hour.", retryAfterSec: 3600 };

  const live = (await OtpVerification.findOne({ destination, purpose, active: true }).lean()) as unknown as { resendAvailableAt: Date; sendCount: number } | null;
  if (live && live.resendAvailableAt.getTime() > Date.now()) {
    return { ok: false, error: "Please wait before requesting another code.", retryAfterSec: Math.ceil((live.resendAvailableAt.getTime() - Date.now()) / 1000) };
  }

  // Admin-registered test numbers: a fixed code, nothing is sent, works in any environment.
  const test = (await TestLogin.findOne({ mobile: destination, active: true }).lean()) as unknown as { code: string } | null;
  let provider;
  try { provider = test ? ({ name: "test-login", isMock: true, send: async () => ({ messageId: "test" }) } as const) : getSmsProvider(); } catch (e) {
    // Misconfiguration (e.g. mock provider in production): fail with a readable message instead of a 500 page.
    console.error("[otp] SMS provider unavailable:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Mobile sign-in is temporarily unavailable. Please try again later or continue as a guest." };
  }
  const code = test ? test.code : generateCode(provider.isMock);
  await OtpVerification.updateMany({ destination, purpose, active: true }, { active: false }); // a resend replaces the old code
  let doc;
  try {
    doc = await OtpVerification.create({
      destination, purpose, userId: input.userId ?? null, codeHash: hashCode(destination, purpose, code), active: true,
      expiresAt: new Date(Date.now() + cfg.ttlSec * 1000), maxAttempts: cfg.maxAttempts, sendCount: (live?.sendCount ?? 0) + 1,
      resendAvailableAt: new Date(Date.now() + cfg.resendSec * 1000), provider: provider.name, ipAddress: input.ip, userAgent: input.userAgent,
      events: [{ type: live ? "RESENT" : "REQUESTED", ipAddress: input.ip }],
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "A code is already being sent. Try again in a moment.", retryAfterSec: 5 };
    throw e;
  }
  try {
    const r = await provider.send(destination, `Your Ikonix verification code is ${code}. It expires in ${Math.round(cfg.ttlSec / 60)} minutes. Do not share it with anyone.`);
    await OtpVerification.updateOne({ _id: doc._id }, { providerMessageId: r.messageId, deliveryStatus: provider.isMock ? "QUEUED" : "SENT" });
  } catch (e) {
    await OtpVerification.updateOne({ _id: doc._id }, { active: false, deliveryStatus: "FAILED" });
    console.error("otp send failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "We couldn't send the code right now. Please try again shortly." };
  }
  return { ok: true, resendAfterSec: cfg.resendSec, expiresInSec: cfg.ttlSec, mock: provider.isMock, test: !!test };
}

export type VerifyResult = { ok: true; userId: string | null } | { ok: false; error: string };
const BAD = "That code is incorrect or has expired.";

/** Verifies a code. Attempts are counted atomically; a correct code can be consumed exactly once. */
export async function verifyOtp(input: { destination: string; purpose: OtpPurpose; code: string; ip?: string }): Promise<VerifyResult> {
  await db();
  const { destination, purpose } = input;
  if (!/^\d{6}$/.test(input.code)) return { ok: false, error: BAD };
  if (input.ip && !(await rateLimit(`otp-verify-ip:${input.ip}`, 60, 900))) return { ok: false, error: "Too many attempts. Try again later." };

  // Claim one attempt atomically (concurrent guesses cannot exceed maxAttempts).
  const claimed = (await OtpVerification.findOneAndUpdate(
    { destination, purpose, active: true, expiresAt: { $gt: new Date() }, $expr: { $lt: ["$attempts", "$maxAttempts"] } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  ).lean()) as unknown as { _id: unknown; codeHash: string; attempts: number; maxAttempts: number; userId?: { toString(): string } | null } | null;
  if (!claimed) {
    // Expired, never requested, or already locked: retire any stale row so it cannot be retried.
    await OtpVerification.updateMany({ destination, purpose, active: true, expiresAt: { $lte: new Date() } }, { active: false });
    return { ok: false, error: BAD };
  }

  if (!safeEqual(hashCode(destination, purpose, input.code), claimed.codeHash)) {
    const locked = claimed.attempts >= claimed.maxAttempts;
    await OtpVerification.updateOne({ _id: claimed._id }, { ...(locked ? { active: false, lockedAt: new Date() } : {}), $push: { events: { type: locked ? "LOCKED" : "VERIFY_FAILURE", ipAddress: input.ip } } });
    return { ok: false, error: locked ? "Too many wrong attempts. Request a new code." : BAD };
  }
  // One-time use: only the request that flips `active` wins, even if two correct submissions race.
  const used = await OtpVerification.updateOne({ _id: claimed._id, active: true }, { active: false, consumedAt: new Date(), $push: { events: { type: "VERIFY_SUCCESS", ipAddress: input.ip } } });
  if (used.modifiedCount !== 1) return { ok: false, error: BAD };
  return { ok: true, userId: claimed.userId ? claimed.userId.toString() : null };
}
