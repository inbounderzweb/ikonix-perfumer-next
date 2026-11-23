import "server-only";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomToken } from "./crypto";
import type { GoogleClaims } from "./identity";

// Authorization Code flow with PKCE + state + nonce. The client secret and tokens never reach the browser.
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
export const googleRedirectUri = () => `${siteUrl()}/api/auth/google/callback`;

export function buildAuthRequest() {
  const state = randomToken(24), nonce = randomToken(24), verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: googleRedirectUri(), response_type: "code", scope: "openid email profile",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, nonce, verifier };
}

export async function exchangeCode(code: string, verifier: string, nonce: string): Promise<GoogleClaims> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirectUri(), grant_type: "authorization_code", code_verifier: verifier }),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!res.ok || !json.id_token) throw new Error(`google token exchange failed (${res.status})`);
  const { payload } = await jwtVerify(json.id_token, JWKS, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: process.env.GOOGLE_CLIENT_ID! });
  if (payload.nonce !== nonce) throw new Error("google nonce mismatch");
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new Error("google token missing claims");
  return { sub: payload.sub, email: payload.email, email_verified: payload.email_verified === true, name: typeof payload.name === "string" ? payload.name : undefined, picture: typeof payload.picture === "string" ? payload.picture : undefined };
}
