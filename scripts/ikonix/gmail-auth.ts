/**
 * One-time helper: get a Gmail refresh token (scope gmail.send) for GMAIL_REFRESH_TOKEN.
 * Google Cloud Console → APIs & Services → Credentials → OAuth client (Web). Add this redirect URI:
 *   http://localhost:53682/callback
 * Enable the Gmail API, add the sending mailbox as a Test user (or publish the app), put GOOGLE_CLIENT_ID/SECRET in .env, then:
 *   npm run gmail:auth
 * Sign in as the mailbox that will send mail. The token is printed to YOUR terminal only: paste it into .env / Vercel yourself.
 */
import http from "node:http";

const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) { console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first."); process.exit(1); }
const redirect = "http://localhost:53682/callback";
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: "code", scope: "https://www.googleapis.com/auth/gmail.send", access_type: "offline", prompt: "consent" });
console.log("\nOpen this URL in your browser and approve:\n\n" + url + "\n");
http.createServer(async (req, res) => {
  const code = new URL(req.url ?? "", redirect).searchParams.get("code");
  if (!code) { res.end("Waiting…"); return; }
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }) });
  const j = (await r.json()) as { refresh_token?: string; error?: string };
  res.end(j.refresh_token ? "Done. Return to the terminal." : "Failed. See the terminal.");
  if (j.refresh_token) console.log("GMAIL_REFRESH_TOKEN=" + j.refresh_token + "\n\nAlso set GMAIL_SENDER=<the mailbox you just signed in with>");
  else console.error("No refresh token returned:", j.error ?? "revoke the app at myaccount.google.com/permissions and retry");
  process.exit(j.refresh_token ? 0 : 1);
}).listen(53682);
