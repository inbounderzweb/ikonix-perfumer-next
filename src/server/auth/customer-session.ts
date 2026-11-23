import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Session, User, SESSION_MAX_MS } from "@/server/models";
import { randomToken, sha256 } from "./crypto";
import { clientMeta } from "./request";

// Opaque, server-revocable token in an HttpOnly cookie (no tokens in localStorage). Only its SHA-256 is stored.
// 90-day absolute lifetime (the legacy site's persistent login) with a 30-day sliding idle window.
export const CUSTOMER_COOKIE = "__Host-ikx_session";
const IDLE_MS = 30 * 24 * 3600 * 1000;
const TOUCH_EVERY_MS = 10 * 60 * 1000;

export type Customer = {
  id: string; name: string; email: string; mobile: string; avatarUrl: string; sessionId: string;
  authMethod: "OTP" | "GOOGLE" | "PASSWORD"; googleLinked: boolean;
};

export async function createCustomerSession(userId: Types.ObjectId | string, method: "OTP" | "GOOGLE"): Promise<void> {
  await db();
  const token = randomToken(32);
  const now = Date.now();
  const meta = await clientMeta();
  await Session.create({
    userId, kind: "CUSTOMER", authMethod: method, tokenHash: sha256(token),
    expiresAt: new Date(now + SESSION_MAX_MS.CUSTOMER), idleExpiresAt: new Date(now + IDLE_MS),
    ipAddress: meta.ip, userAgent: meta.userAgent,
    deviceLabel: /Mobile|Android|iPhone/i.test(meta.userAgent) ? "Mobile browser" : "Computer browser",
  });
  (await cookies()).set(CUSTOMER_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_MS.CUSTOMER / 1000 });
}

/** The signed-in customer, or null. Identity always comes from this verified session, never from client input. */
export const getCustomer = cache(async (): Promise<Customer | null> => {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  await db();
  const now = new Date();
  const s = (await Session.findOne({ tokenHash: sha256(token), kind: "CUSTOMER", revokedAt: null, expiresAt: { $gt: now }, idleExpiresAt: { $gt: now } }).lean()) as unknown as
    { _id: Types.ObjectId; userId: Types.ObjectId; lastSeenAt?: Date; expiresAt: Date; authMethod: Customer["authMethod"] } | null;
  if (!s) return null;
  const u = (await User.findOne({ _id: s.userId, status: "ACTIVE", deletedAt: null }, "name email mobile avatarUrl google").lean()) as unknown as
    { _id: Types.ObjectId; name?: string; email?: string; mobile?: string; avatarUrl?: string; google?: { sub?: string } | null } | null;
  if (!u) return null; // suspended or deleted accounts lose access immediately
  if (!s.lastSeenAt || now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await Session.updateOne({ _id: s._id }, { lastSeenAt: now, idleExpiresAt: new Date(Math.min(now.getTime() + IDLE_MS, s.expiresAt.getTime())) });
  }
  return { id: String(u._id), name: u.name ?? "", email: u.email ?? "", mobile: u.mobile ?? "", avatarUrl: u.avatarUrl ?? "", sessionId: String(s._id), authMethod: s.authMethod, googleLinked: !!u.google?.sub };
});

export async function destroyCustomerSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_COOKIE)?.value;
  if (token) { await db(); await Session.updateOne({ tokenHash: sha256(token), revokedAt: null }, { revokedAt: new Date(), revokeReason: "LOGOUT" }); }
  jar.delete(CUSTOMER_COOKIE);
}

export async function revokeCustomerSessions(userId: string, exceptSessionId?: string) {
  await db();
  await Session.updateMany({ userId, kind: "CUSTOMER", revokedAt: null, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) }, { revokedAt: new Date(), revokeReason: exceptSessionId ? "LOGOUT_OTHER_DEVICES" : "LOGOUT" });
}

export async function requireCustomerPage(next = "/account"): Promise<Customer> {
  const c = await getCustomer();
  if (!c) redirect(`/login?next=${encodeURIComponent(next)}`);
  return c;
}

/** For Server Actions and Route Handlers: throws a 401 Response. */
export async function requireCustomer(): Promise<Customer> {
  const c = await getCustomer();
  if (!c) throw new Response("Unauthorized", { status: 401 });
  return c;
}
