import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCustomer } from "@/server/auth/customer-session";
import { googleConfigured } from "@/server/auth/google";
import { otpConfig } from "@/server/auth/otp/service";
import { safeNext } from "@/lib/phone";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  google_unavailable: "Google sign-in isn't available right now. Use your mobile number instead.",
  google_failed: "We couldn't sign you in with Google. Please try again.",
  google_unverified: "Your Google email is not verified, so we can't use it to sign you in.",
  suspended: "This account is not active. Please contact support.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null, "/account");
  if (await getCustomer()) redirect(next);
  const err = typeof sp.error === "string" ? ERRORS[sp.error] ?? "Sign-in failed. Please try again." : undefined;
  return (
    <section className="mx-auto w-[92%] max-w-md py-12 lg:py-20">
      <h1 className="text-center font-heading text-[32px] text-[#8C7367]">Sign in</h1>
      <p className="mt-2 text-center font-fancy text-[#53443D]">Track orders, save addresses and keep a wishlist.</p>
      <LoginForm next={next} google={googleConfigured()} initialError={err} mock={process.env.OTP_PROVIDER !== "msg91" && process.env.OTP_PROVIDER !== "twilio"} resendSeconds={otpConfig().resendSec} />
    </section>
  );
}
