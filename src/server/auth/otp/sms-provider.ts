import "server-only";

/**
 * SMS gateway contract. The OTP service only ever talks to this interface, so adding MSG91, Twilio, etc. means
 * writing ONE class and registering it in `getSmsProvider()`: no change to the auth flow, actions or UI.
 *
 * To integrate a real provider (e.g. MSG91):
 *   1. Create src/server/auth/otp/msg91.ts exporting `class Msg91Provider implements SmsProvider` (isMock = false).
 *      `send()` calls the gateway with a DLT-approved template and returns the provider message id. Throw on failure.
 *   2. Add `case "msg91": return new Msg91Provider();` below and set OTP_PROVIDER=msg91 plus the provider's secrets in .env.
 *   3. Optional: expose a delivery-report webhook that updates OtpVerification.deliveryStatus (WebhookEvent provider "SMS").
 */
export interface SmsProvider {
  readonly name: string;
  /** Mock providers never send anything and use a predictable code. They are refused in production. */
  readonly isMock: boolean;
  send(to: string, message: string): Promise<{ messageId?: string }>;
}

class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly isMock = true;
  async send(to: string) {
    // Intentionally does not log the code. The development UI banner and MOCK_OTP_CODE tell the developer what to type.
    console.info(`[otp:mock] no SMS sent to ${to.slice(0, 3)}…${to.slice(-2)} (development provider)`);
    return { messageId: "mock" };
  }
}

/** Comma-separated normalized numbers (e.g. +919746997154) allowed to use the mock OTP in production. */
export const testMobiles = () => (process.env.OTP_TEST_MOBILES ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function getSmsProvider(): SmsProvider {
  const name = (process.env.OTP_PROVIDER || "mock").toLowerCase();
  switch (name) {
    case "mock":
      // In production the mock is only usable for an explicit allowlist of test numbers (OTP_TEST_MOBILES); see requestOtp.
      if (process.env.NODE_ENV === "production" && testMobiles().length === 0) throw new Error("OTP_PROVIDER=mock is not allowed in production without OTP_TEST_MOBILES. Integrate an SMS provider (see sms-provider.ts).");
      return new MockSmsProvider();
    default:
      throw new Error(`Unknown OTP_PROVIDER "${name}". Implement it in src/server/auth/otp and register it in getSmsProvider().`);
  }
}
