import "server-only";
import { db } from "@/server/db";
import { OtpActivity } from "@/server/models";

export type OtpEvent = "request" | "verified" | "failed" | "blocked";

/** IST calendar day, so "today" matches what admins see. */
const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** True when an admin has blocked this number from using OTP. Fails open only if the lookup itself errors (logged). */
export async function isOtpBlocked(mobile: string): Promise<boolean> {
  try {
    await db();
    return !!(await OtpActivity.exists({ mobile, blocked: true }));
  } catch (e) {
    console.error("[otp] block lookup failed", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Best-effort counters for the admin page. Never throws: a stats failure must not break sign-in. */
export async function trackOtp(mobile: string, event: OtpEvent, ip?: string): Promise<void> {
  try {
    await db();
    const now = new Date();
    const inc: Record<string, number> = {};
    const set: Record<string, unknown> = {};
    if (event === "request") { inc.requestCount = 1; inc.todayCount = 1; set.lastRequestAt = now; if (ip) set.lastIp = ip; }
    if (event === "verified") { inc.verifiedCount = 1; set.lastVerifiedAt = now; }
    if (event === "failed") inc.failedCount = 1;
    if (event === "blocked") { inc.blockedAttempts = 1; if (ip) set.lastIp = ip; }
    const today = dayKey();
    // Roll the daily counter over when the day changed (a no-op for a number seen today or never seen).
    await OtpActivity.updateOne({ mobile, dayKey: { $ne: today } }, { $set: { dayKey: today, todayCount: 0 } });
    const update = { $inc: inc, $set: { ...set, dayKey: today } };
    try { await OtpActivity.updateOne({ mobile }, update, { upsert: true }); } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // two first-time requests raced to create the row
      await OtpActivity.updateOne({ mobile }, update);
    }
  } catch (e) {
    console.error("[otp] activity tracking failed", e instanceof Error ? e.message : e);
  }
}
