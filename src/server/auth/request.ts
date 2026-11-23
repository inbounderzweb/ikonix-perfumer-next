import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP. Only trust x-forwarded-for behind your own proxy (set TRUSTED_PROXY=1). */
export async function clientMeta() {
  const h = await headers();
  const fwd = process.env.TRUSTED_PROXY === "1" ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return { ip: fwd || h.get("x-real-ip") || "unknown", userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}

/**
 * CSRF guard for cookie-authenticated Route Handlers (Server Actions already compare Origin to Host).
 * Rejects cross-site mutating requests; same-origin fetches always send Sec-Fetch-Site or Origin.
 */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new Response("Cross-site request blocked", { status: 403 });
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host");
    let ok = false;
    try { ok = new URL(origin).host === host; } catch { /* malformed */ }
    if (!ok) throw new Response("Cross-site request blocked", { status: 403 });
  } else if (!site) {
    throw new Response("Origin required", { status: 403 });
  }
}
