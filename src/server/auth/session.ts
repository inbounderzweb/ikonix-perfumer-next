import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Session, User, SESSION_MAX_MS } from "@/server/models";
import { randomToken, sha256 } from "./crypto";
import { permissionsFor, type Permission } from "./permissions";
import { clientMeta } from "./request";

// "__Host-" prefix: Secure, Path=/, no Domain → the cookie cannot be set by sibling subdomains.
// Browsers treat http://localhost as secure for Secure cookies, so the prefix works in development too.
export const ADMIN_COOKIE = "__Host-ikx_admin";
const IDLE_MS = 2 * 3600 * 1000; // sliding idle timeout
const TOUCH_EVERY_MS = 60 * 1000; // write lastSeenAt at most once a minute

export type AdminUser = { id: string; name: string; email: string; roleKeys: string[]; permissions: Set<Permission>; sessionId: string };

/** Creates a session row + cookie. The cookie holds an opaque random token; only its SHA-256 is stored. */
export async function createAdminSession(userId: Types.ObjectId | string): Promise<void> {
  await db();
  const token = randomToken(32);
  const now = Date.now();
  const meta = await clientMeta();
  await Session.create({
    userId, kind: "ADMIN", authMethod: "PASSWORD", tokenHash: sha256(token),
    expiresAt: new Date(now + SESSION_MAX_MS.ADMIN), idleExpiresAt: new Date(now + IDLE_MS),
    ipAddress: meta.ip, userAgent: meta.userAgent,
  });
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_MS.ADMIN / 1000,
  });
}

/** Current staff member or null. Re-validated against the DB on every call (cached per request). */
export const getAdmin = cache(async (): Promise<AdminUser | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  await db();
  const now = new Date();
  const s = (await Session.findOne({ tokenHash: sha256(token), kind: "ADMIN", revokedAt: null, expiresAt: { $gt: now }, idleExpiresAt: { $gt: now } }).lean()) as
    { _id: Types.ObjectId; userId: Types.ObjectId; lastSeenAt?: Date; expiresAt: Date } | null;
  if (!s) return null;
  const u = (await User.findOne({ _id: s.userId, status: "ACTIVE", deletedAt: null, "roleKeys.0": { $exists: true } }, "name email roleKeys").lean()) as
    { _id: Types.ObjectId; name?: string; email?: string; roleKeys: string[] } | null;
  if (!u) return null; // suspended, deleted or demoted staff are locked out immediately
  if (!s.lastSeenAt || now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    const idle = new Date(Math.min(now.getTime() + IDLE_MS, s.expiresAt.getTime()));
    await Session.updateOne({ _id: s._id }, { lastSeenAt: now, idleExpiresAt: idle });
  }
  return { id: String(u._id), name: u.name ?? u.email ?? "Staff", email: u.email ?? "", roleKeys: u.roleKeys, permissions: permissionsFor(u.roleKeys), sessionId: String(s._id) };
});

export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) {
    await db();
    await Session.updateOne({ tokenHash: sha256(token), revokedAt: null }, { revokedAt: new Date(), revokeReason: "LOGOUT" });
  }
  jar.delete(ADMIN_COOKIE);
}

export async function revokeUserSessions(userId: string, reason: "ADMIN_REVOKED" | "ACCOUNT_SUSPENDED" | "SECURITY_CHANGE", exceptSessionId?: string) {
  await db();
  await Session.updateMany(
    { userId, revokedAt: null, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) },
    { revokedAt: new Date(), revokeReason: reason },
  );
}
