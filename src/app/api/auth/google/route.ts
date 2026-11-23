import { NextResponse } from "next/server";
import { buildAuthRequest, googleConfigured } from "@/server/auth/google";
import { safeNext } from "@/lib/phone";
import { rateLimit } from "@/server/auth/rate-limit";
import { clientMeta } from "@/server/auth/request";

export const runtime = "nodejs";
const OAUTH_COOKIE = "__Host-ikx_oauth";

export async function GET(req: Request) {
  const base = new URL(req.url).origin;
  if (!googleConfigured()) return NextResponse.redirect(`${base}/login?error=google_unavailable`);
  if (!(await rateLimit(`google-start:${(await clientMeta()).ip}`, 30, 600))) return NextResponse.redirect(`${base}/login?error=rate_limited`);
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const a = buildAuthRequest();
  const res = NextResponse.redirect(a.url);
  // Short-lived, HttpOnly, SameSite=Lax (must survive the redirect back from Google). Holds the PKCE verifier, not any user secret.
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ s: a.state, n: a.nonce, v: a.verifier, next }), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
