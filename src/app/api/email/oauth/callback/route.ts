import { NextResponse, type NextRequest } from "next/server";
import { SECURE_COOKIE, STATE_COOKIE, oauthClient, page, setupEnabled, stateMatches, storeRefreshToken } from "@/server/notify/gmail-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!setupEnabled()) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  // Always clear the one-time state, whatever happens next.
  const done = (r: Response) => { const res = new NextResponse(r.body, r); res.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: SECURE_COOKIE, sameSite: "lax", path: "/api/email/oauth", maxAge: 0 }); return res; };

  if (!stateMatches(expected, q.get("state"))) return done(page("Invalid or expired request", "The OAuth state did not match (possible CSRF, or the 10-minute window passed). Start again at /api/email/oauth.", 400));
  const oauthError = q.get("error");
  if (oauthError) {
    return done(oauthError === "access_denied"
      ? page("Consent denied", "You declined access. Start again at /api/email/oauth and approve the Gmail send permission.", 403)
      : page("Google returned an error", `Error code: ${oauthError.replace(/[^\w-]/g, "").slice(0, 60)}.`, 400));
  }
  const code = q.get("code");
  if (!code) return done(page("Missing authorization code", "Google did not send a code. Start again at /api/email/oauth.", 400));

  const { client, error } = oauthClient(req.url, true);
  if (error) return done(error);
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return done(page("No refresh token returned", "Google only issues one on first consent. Remove this app at myaccount.google.com/permissions, then start again at /api/email/oauth.", 422));
    }
    await storeRefreshToken(tokens.refresh_token);
    return done(page("Gmail authorised", process.env.NODE_ENV !== "production"
      ? "The refresh token was printed once in your <b>dev server terminal</b> and saved to <code>.secrets/gmail-refresh-token.json</code>. Add it to <code>.env</code> as <code>GMAIL_REFRESH_TOKEN</code>, then restart."
      : "The refresh token was saved on the server. It is not displayed here."));
  } catch (e) {
    const err = (e as { response?: { data?: { error?: string } }; message?: string });
    const code2 = err.response?.data?.error;
    if (process.env.NODE_ENV !== "production") console.error("[gmail-oauth] token exchange failed:", code2 ?? err.message);
    return done(code2 === "invalid_grant"
      ? page("Invalid authorization code", "The code is invalid, expired or already used (or the redirect URI differs from the one registered). Start again at /api/email/oauth.", 400)
      : page("Google API error", "Token exchange failed. Check GOOGLE_CLIENT_ID/SECRET and the registered redirect URI, then retry.", 502));
  }
}
