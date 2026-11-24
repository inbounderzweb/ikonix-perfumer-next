import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";

/**
 * Gmail API sender (OAuth 2.0, refresh-token based). No Gmail password / App Password anywhere.
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (scope gmail.send), GMAIL_SENDER (the authorised mailbox).
 * Optional: EMAIL_FROM_NAME, EMAIL_REPLY_TO. Get the refresh token once with `npm run gmail:auth`.
 */
export const emailConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_SENDER);

export class EmailError extends Error { constructor(message: string, readonly temporary: boolean) { super(message); } }

/** One address, no control characters, no header-injection tricks, sane length. */
export const validEmail = (s: unknown): s is string => typeof s === "string" && s.length <= 254 && /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[A-Za-z]{2,}$/.test(s);

let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store", signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GMAIL_REFRESH_TOKEN!, grant_type: "refresh_token" }),
    });
  } catch { throw new EmailError("Could not reach Google to renew the access token", true); }
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) throw new EmailError(`Google rejected the token refresh (${j.error ?? res.status}). Re-run npm run gmail:auth if the refresh token was revoked.`, res.status >= 500 || res.status === 429);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3000) * 1000 };
  return cached.token;
}

const raw = (m: ConstructorParameters<typeof MailComposer>[0]) => new Promise<Buffer>((resolve, reject) => new MailComposer(m).compile().build((e, b) => (e ? reject(e) : resolve(b))));

export type MailInput = { to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: Uint8Array; contentType: string }[] };

async function once(m: MailInput): Promise<string | undefined> {
  const sender = process.env.GMAIL_SENDER!;
  const msg = await raw({
    from: process.env.EMAIL_FROM_NAME ? { name: process.env.EMAIL_FROM_NAME.replace(/[\r\n"<>]/g, "").trim(), address: sender } : sender,
    replyTo: process.env.EMAIL_REPLY_TO && validEmail(process.env.EMAIL_REPLY_TO) ? process.env.EMAIL_REPLY_TO : undefined,
    to: m.to, subject: m.subject.replace(/[\r\n]+/g, " "), html: m.html, text: m.text,
    attachments: m.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
  });
  let res: Response;
  try {
    res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: msg.toString("base64url") }),
    });
  } catch (e) { if (e instanceof EmailError) throw e; throw new EmailError("Gmail API did not respond in time", true); }
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (res.status === 401) cached = null;
  if (!res.ok) throw new EmailError(`Gmail API ${res.status}: ${j.error?.message ?? "request failed"}`.slice(0, 300), res.status === 401 || res.status === 429 || res.status >= 500);
  return j.id;
}

/** Retries temporary failures (network, 429, 5xx, expired token) up to 3 times. "Sent" here means Gmail ACCEPTED it, not that it was delivered. */
export async function sendEmail(m: MailInput): Promise<{ messageId?: string; attempts: number }> {
  if (!emailConfigured()) throw new EmailError("Gmail OAuth is not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER)", false);
  if (!validEmail(m.to)) throw new EmailError("Invalid recipient address", false);
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return { messageId: await once(m), attempts: attempt }; }
    catch (e) { last = e; if (!(e instanceof EmailError) || !e.temporary || attempt === 3) break; await new Promise((r) => setTimeout(r, attempt * 1000)); }
  }
  throw last;
}
