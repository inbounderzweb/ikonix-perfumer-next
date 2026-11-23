import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, googleConfigured } from "@/server/auth/google";
import { userForGoogle } from "@/server/auth/identity";
import { createCustomerSession } from "@/server/auth/customer-session";
import { safeEqual } from "@/server/auth/crypto";
import { safeNext } from "@/lib/phone";
import { rateLimit } from "@/server/auth/rate-limit";
import { clientMeta } from "@/server/auth/request";

export const runtime = "nodejs";
const OAUTH_COOKIE = "__Host-ikx_oauth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (code: string) => { const r = NextResponse.redirect(`${url.origin}/login?error=${code}`); r.cookies.delete(OAUTH_COOKIE); return r; };
  if (!googleConfigured()) return fail("google_unavailable");
  if (!(await rateLimit(`google-cb:${(await clientMeta()).ip}`, 30, 600))) return fail("rate_limited");

  const raw = (await cookies()).get(OAUTH_COOKIE)?.value;
  let saved: { s: string; n: string; v: string; next: string } | null = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !saved || !state || !code || code.length > 2048 || !safeEqual(state, saved.s)) return fail("google_failed");

  try {
    const claims = await exchangeCode(code, saved.v, saved.n);
    const user = await userForGoogle(claims);
    if ("error" in user) return fail("account_unavailable");
    await createCustomerSession(user.id, "GOOGLE");
    const res = NextResponse.redirect(`${url.origin}${safeNext(saved.next)}`);
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch (e) {
    console.error("google callback", e instanceof Error ? e.message : e);
    return fail("google_failed");
  }
}
