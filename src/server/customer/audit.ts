import "server-only";
import { db } from "@/server/db";
import { AuditLog } from "@/server/models";
import { clientMeta } from "@/server/auth/request";

/** Append-only record of a customer security/account event. Never throws; never stores OTPs or tokens. */
export async function auditCustomer(userId: string, action: string, entityType: string, entityId: string, detail?: Record<string, unknown>) {
  try {
    await db();
    const m = await clientMeta();
    await AuditLog.create({ actorUserId: userId, actorType: "CUSTOMER", action, entityType, entityId, after: detail, ipAddress: m.ip, userAgent: m.userAgent });
  } catch (e) {
    console.error("customer audit failed", action, e instanceof Error ? e.message : e);
  }
}
