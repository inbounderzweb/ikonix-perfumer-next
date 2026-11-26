import "server-only";
import { urlProblem, type TrackingConfig } from "./config";
import { TrackingError } from "./errors";

const MAX_BYTES = 20 * 1024 * 1024;

function authHeaders(c: TrackingConfig): Record<string, string> {
  const secret = process.env.INDIA_POST_AUTH_SECRET ?? "";
  if (c.authType === "NONE") return {};
  if (!secret) throw new TrackingError("CONFIG", "INDIA_POST_AUTH_SECRET is not set.");
  if (c.authType === "BEARER") return { Authorization: `Bearer ${secret}` };
  if (c.authType === "BASIC") return { Authorization: `Basic ${Buffer.from(`${process.env.INDIA_POST_AUTH_USERNAME ?? ""}:${secret}`).toString("base64")}` };
  return { [c.authHeaderName]: secret };
}

async function readCapped(res: Response): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of (res.body ?? []) as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new TrackingError("DATA", "The response is larger than 20 MB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
}

/** The only place that talks to India Post. Server-side, time-limited, never follows redirects. */
export async function callIndiaPost(c: TrackingConfig, url: URL, init: { method: "GET" | "POST"; body?: string; contentType?: string }, badRequest: "CONFIG" | "DATA"): Promise<{ status: 200 | 204; body: string }> {
  const problem = urlProblem(url.toString(), c.authType);
  if (problem) throw new TrackingError("CONFIG", problem);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method, body: init.body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(c.timeoutSeconds * 1000),
      headers: { ...authHeaders(c), ...(init.contentType ? { "Content-Type": init.contentType } : {}) },
    });
    if (res.status === 200) return { status: 200, body: await readCapped(res) };
    await res.body?.cancel();
  } catch (e) {
    if (e instanceof TrackingError) throw e;
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    const code = (e as { cause?: { code?: string } }).cause?.code;
    throw new TrackingError("TRANSIENT", timedOut ? `India Post did not answer within ${c.timeoutSeconds}s.` : `Could not reach India Post${code && /^[A-Z_]+$/.test(code) ? ` (${code})` : ""}.`);
  }
  const s = res.status;
  if (s === 204) return { status: 204, body: "" };
  if (s === 401 || s === 403) throw new TrackingError("AUTH", `India Post refused access (HTTP ${s}). Check that this server's outbound IP is whitelisted and the credentials are right.`);
  if (s === 429) { const wait = Number(res.headers.get("retry-after")); throw new TrackingError("RATE", "India Post rate limit reached (HTTP 429).", Number.isFinite(wait) && wait > 0 ? Math.min(wait, 86_400) : undefined); }
  if (s === 404) throw new TrackingError("CONFIG", "HTTP 404: India Post does not recognise this Customer ID, or the URL is wrong.");
  if (s === 405) throw new TrackingError("CONFIG", "HTTP 405: India Post rejected the request method.");
  if (s >= 300 && s < 400) throw new TrackingError("CONFIG", `India Post answered with a redirect (HTTP ${s}). Enter the final URL; redirects are not followed.`);
  if (s >= 500) throw new TrackingError("TRANSIENT", `India Post server error (HTTP ${s}).`);
  throw new TrackingError(badRequest, `India Post rejected the request (HTTP ${s}).`);
}
