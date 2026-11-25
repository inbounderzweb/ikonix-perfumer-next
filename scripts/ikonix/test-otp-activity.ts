// Integration test of OTP activity tracking + admin blocking.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/ikonix/test-otp-activity.ts
import assert from "node:assert/strict";
import { connect, disconnect } from "./_env";
import { OtpActivity, OtpVerification, RateLimitBucket } from "../../src/server/models";

process.env.OTP_PROVIDER = "mock"; process.env.MOCK_OTP_CODE = "123456"; process.env.OTP_RESEND_SECONDS = "30"; process.env.OTP_MAX_SENDS_PER_HOUR = "50";
const M = "+919000000041", ip = "203.0.113.91";
let n = 0; const ok = (m: string) => { n++; console.log("  ✓", m); };
type Act = { requestCount: number; todayCount: number; verifiedCount: number; failedCount: number; blockedAttempts: number; blocked: boolean };
const get = async () => (await OtpActivity.findOne({ mobile: M }).lean()) as unknown as Act;
const cleanup = async () => { await OtpActivity.deleteMany({ mobile: M }); await OtpVerification.deleteMany({ destination: M }); await RateLimitBucket.deleteMany({ _id: new RegExp(`${M.replace("+", "\\+")}|${ip.replace(/\./g, "\\.")}`) }); };

async function main() {
  await connect(); await cleanup();
  const { requestOtp, verifyOtp, BLOCKED_MESSAGE } = await import("../../src/server/auth/otp/service");
  assert.equal((await requestOtp({ destination: M, purpose: "LOGIN", ip })).ok, true);
  let a = await get();
  assert.equal(a.requestCount, 1); assert.equal(a.todayCount, 1); assert.equal(a.blocked, false); ok("a request creates the activity row");

  assert.equal((await verifyOtp({ destination: M, purpose: "LOGIN", code: "000000", ip })).ok, false);
  assert.equal((await verifyOtp({ destination: M, purpose: "LOGIN", code: "123456", ip })).ok, true);
  a = await get(); assert.equal(a.failedCount, 1); assert.equal(a.verifiedCount, 1); ok("wrong and correct codes are counted");

  await OtpActivity.updateOne({ mobile: M }, { dayKey: "2000-01-01", todayCount: 9 });
  await OtpVerification.deleteMany({ destination: M });
  await requestOtp({ destination: M, purpose: "LOGIN", ip });
  a = await get(); assert.equal(a.todayCount, 1); assert.equal(a.requestCount, 2); ok("daily counter rolls over on a new day");

  await OtpActivity.updateOne({ mobile: M }, { blocked: true });
  const r = await requestOtp({ destination: M, purpose: "LOGIN", ip });
  assert.equal(r.ok, false); assert.equal(!r.ok && r.error, BLOCKED_MESSAGE); ok("a blocked number cannot request a code");
  const v = await verifyOtp({ destination: M, purpose: "LOGIN", code: "123456", ip });
  assert.equal(v.ok, false); assert.equal(!v.ok && v.error, BLOCKED_MESSAGE);
  assert.equal(await OtpVerification.countDocuments({ destination: M, active: true }), 0); ok("a blocked number cannot use an already-sent code");
  a = await get(); assert.equal(a.blockedAttempts, 2); assert.equal(a.requestCount, 2); ok("blocked attempts are counted, not as requests");

  await OtpActivity.updateOne({ mobile: M }, { blocked: false });
  await RateLimitBucket.deleteMany({ _id: new RegExp(M.replace("+", "\\+")) });
  assert.equal((await requestOtp({ destination: M, purpose: "LOGIN", ip })).ok, true); ok("unblocking restores OTP");
  await cleanup(); console.log(`\n${n} checks passed`);
}
main().catch(async (e) => { console.error(e); process.exitCode = 1; await cleanup().catch(() => {}); }).finally(() => disconnect());
