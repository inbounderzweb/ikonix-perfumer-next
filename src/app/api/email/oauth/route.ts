import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { GMAIL_SCOPE, SECURE_COOKIE, STATE_COOKIE, fail, oauthClient, setupEnabled } from "@/server/notify/gmail-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!setupEnabled()) return new Response("Not found", { status: 404 });
  const { client, error } = oauthClient(req.url, false);
  if (error) return error;
  try {
    const state = randomBytes(32).toString("base64url");
    const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: [GMAIL_SCOPE], state, include_granted_scopes: false });
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: SECURE_COOKIE, sameSite: "lax", path: "/api/email/oauth", maxAge: 600 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return fail(500, "Could not build the Google authorization URL.");
  }
}
