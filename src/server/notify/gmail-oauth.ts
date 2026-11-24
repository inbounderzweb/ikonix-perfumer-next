import "server-only";
import { timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

/**
 * One-time Gmail OAuth helper (scope gmail.send). Uses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.
 * Setup-only: disabled in production unless EMAIL_OAUTH_SETUP=enabled. The refresh token is never put in an HTTP response.
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CALLBACK_PATH = "/api/email/oauth/callback";
export const STATE_COOKIE = process.env.NODE_ENV === "production" ? "__Host-ikx_email_oauth" : "ikx_email_oauth"; // __Host- needs HTTPS
export const SECURE_COOKIE = process.env.NODE_ENV === "production";
const TOKEN_FILE = path.join(process.cwd(), ".secrets", "gmail-refresh-token.json");

export const setupEnabled = () => process.env.NODE_ENV !== "production" || process.env.EMAIL_OAUTH_SETUP === "enabled";

export const fail = (status: number, error: string, hint?: string) =>
  Response.json({ error, ...(hint ? { hint } : {}) }, { status, headers: { "Cache-Control": "no-store" } });

/** Returns the OAuth client, or a Response describing the misconfiguration (including a redirect URI that would not match Google). */
export function oauthClient(requestUrl: string, isCallback: boolean) {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET, redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!id || !secret || !redirect) return { error: fail(500, "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must all be set.") };
  let r: URL;
  try { r = new URL(redirect); } catch { return { error: fail(500, "GOOGLE_REDIRECT_URI is not a valid URL.") }; }
  if (r.pathname !== CALLBACK_PATH || r.search || r.hash) return { error: fail(500, `GOOGLE_REDIRECT_URI must end with exactly ${CALLBACK_PATH}.`) };
  // The state cookie is bound to the host the developer visited, so the visited origin must equal the registered redirect origin.
  if (new URL(requestUrl).origin !== r.origin) return { error: fail(400, "Origin mismatch.", `Open this flow at ${r.origin}/api/email/oauth (the origin in GOOGLE_REDIRECT_URI), and register that exact URI in Google Cloud Console.`) };
  return { client: new google.auth.OAuth2(id, secret, redirect) };
}

export function stateMatches(cookieValue: string | undefined, param: string | null) {
  if (!cookieValue || !param) return false;
  const a = Buffer.from(cookieValue), b = Buffer.from(param);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Saves the token to a 0600 file outside any served path (git-ignored) and, in dev only, prints it to the server terminal. */
export async function storeRefreshToken(token: string) {
  await mkdir(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  await writeFile(TOKEN_FILE, JSON.stringify({ refresh_token: token, scope: GMAIL_SCOPE, created_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  if (process.env.NODE_ENV !== "production") {
    console.log(`\n[gmail-oauth] Copy into .env (shown once; also saved to .secrets/gmail-refresh-token.json):\nGMAIL_REFRESH_TOKEN=${token}\n`);
  }
}

export const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
