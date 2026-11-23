import "server-only";
import { db } from "@/server/db";
import { AuditLog } from "@/server/models";
import { clientMeta } from "@/server/auth/request";
import type { AdminUser } from "@/server/auth/session";

const REDACT = /pass|secret|token|hash|otp/i;
const scrub = (v: unknown, depth = 0): unknown => {
  if (depth > 4 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? "[redacted]" : scrub(x, depth + 1)]));
  }
  return v;
};

/** Append-only record of an admin action. Never throws (an audit failure must not undo the action). */
export type AuditActor = Pick<AdminUser, "id">;
export type AuditMeta = { ip: string | null; userAgent: string | null };

/** `meta` is for callers outside a request (CLI tooling); inside a request it is read from the headers. */
export async function audit(actor: AuditActor, action: string, entityType: string, entityId: string, change?: { before?: unknown; after?: unknown }, meta?: AuditMeta) {
  try {
    await db();
    const m = meta ?? (await clientMeta());
    await AuditLog.create({
      actorUserId: actor.id, actorType: "ADMIN", action, entityType, entityId,
      before: scrub(change?.before), after: scrub(change?.after), ipAddress: m.ip, userAgent: m.userAgent,
    });
  } catch (e) {
    console.error("audit write failed", action, e instanceof Error ? e.message : e);
  }
}
