import "server-only";
import bcrypt from "bcryptjs";
import { User } from "@/server/models";
import { randomToken, safeEqual } from "./crypto";
import { permissionsFor, type Permission } from "./permissions";

// Compared when the account doesn't exist so response time doesn't reveal which emails are valid.
const DUMMY_HASH = bcrypt.hashSync(randomToken(), 12);

/**
 * The owner account lives in .env (ADMIN_EMAIL + ADMIN_PASSWORD_HASH or ADMIN_PASSWORD) and is the only way in
 * for that email: changing .env changes the login, and a database password can never override it.
 * Other staff (created later with other roles) sign in with their stored bcrypt hash.
 */
export async function checkAdminPassword(email: string, password: string, stored?: string): Promise<{ ok: boolean; viaEnv: boolean }> {
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (envEmail && email === envEmail) {
    const hash = process.env.ADMIN_PASSWORD_HASH;
    const plain = process.env.ADMIN_PASSWORD;
    if (hash) return { ok: await bcrypt.compare(password, hash), viaEnv: true };
    if (plain) { await bcrypt.compare(password, DUMMY_HASH); return { ok: safeEqual(password, plain), viaEnv: true }; }
    return { ok: false, viaEnv: true }; // email reserved for the owner but no password configured: nobody gets in
  }
  return { ok: await bcrypt.compare(password, stored ?? DUMMY_HASH), viaEnv: false };
}

/** Owner: keep a User row (sessions and audit entries reference it) and always grant SUPER_ADMIN. */
export async function ensureOwnerRow(email: string): Promise<string | null> {
  const row = (await User.findOneAndUpdate(
    { email },
    { $set: { status: "ACTIVE", emailVerifiedAt: new Date(), lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null, deletedAt: null }, $addToSet: { roleKeys: "SUPER_ADMIN" }, $setOnInsert: { name: "Owner" } },
    { upsert: true, returnDocument: "after" },
  ).lean()) as unknown as { _id: { toString(): string } } | null;
  return row ? row._id.toString() : null;
}

export type StaffIdentity = { id: string; name: string; email: string; roleKeys: string[]; permissions: Set<Permission> };

/**
 * Non-interactive sign-in for trusted server tooling (bulk import CLI). Same password rules, lockout and
 * role checks as the admin login form; no session cookie is created. Returns null on any failure.
 */
export async function authenticateStaff(rawEmail: string, password: string): Promise<StaffIdentity | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !password) return null;
  const user = (await User.findOne({ email, deletedAt: null }, "+passwordHash name status roleKeys lockedUntil").lean()) as
    { _id: unknown; name?: string; passwordHash?: string; status: string; roleKeys: string[]; lockedUntil?: Date } | null;
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) return null;
  const { ok, viaEnv } = await checkAdminPassword(email, password, user?.passwordHash);
  if (!ok) return null;
  if (viaEnv) {
    const id = await ensureOwnerRow(email);
    return id ? { id, name: "Owner", email, roleKeys: ["SUPER_ADMIN"], permissions: permissionsFor(["SUPER_ADMIN"]) } : null;
  }
  if (!user || user.status !== "ACTIVE" || user.roleKeys.length === 0) return null;
  return { id: String(user._id), name: user.name ?? email, email, roleKeys: user.roleKeys, permissions: permissionsFor(user.roleKeys) };
}
