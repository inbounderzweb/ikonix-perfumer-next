"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { User } from "@/server/models";
import { rateLimit } from "@/server/auth/rate-limit";
import { randomToken, safeEqual } from "@/server/auth/crypto";
import { clientMeta } from "@/server/auth/request";
import { createAdminSession, destroyAdminSession } from "@/server/auth/session";
import { audit } from "@/server/admin/audit";

export type LoginState = { error?: string } | undefined;

const schema = z.object({ email: z.email().max(200).transform((s) => s.trim().toLowerCase()), password: z.string().min(1).max(200) });
// Compared when the account doesn't exist so response time doesn't reveal which emails are valid.
const DUMMY_HASH = bcrypt.hashSync(randomToken(), 12);
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
const GENERIC = "Incorrect email or password.";

/**
 * The owner account lives in .env (ADMIN_EMAIL + ADMIN_PASSWORD_HASH or ADMIN_PASSWORD) and is the only way in
 * for that email: changing .env changes the login, and a database password can never override it.
 * Other staff (created later with other roles) sign in with their stored bcrypt hash.
 */
async function checkPassword(email: string, password: string, stored?: string): Promise<{ ok: boolean; viaEnv: boolean }> {
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

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: GENERIC };
  const { email, password } = parsed.data;
  const { ip } = await clientMeta();

  if (!(await rateLimit(`login-ip:${ip}`, 20, 900)) || !(await rateLimit(`login-email:${email}`, 8, 900))) {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }

  await db();
  const user = (await User.findOne({ email, deletedAt: null }, "+passwordHash status roleKeys failedLoginCount lockedUntil").lean()) as
    { _id: string; passwordHash?: string; status: string; roleKeys: string[]; failedLoginCount?: number; lockedUntil?: Date } | null;
  const locked = !!user?.lockedUntil && user.lockedUntil.getTime() > Date.now();
  const { ok, viaEnv } = await checkPassword(email, password, user?.passwordHash);

  let userId: string | null = null;
  if (ok && !locked) {
    if (viaEnv) {
      // Owner: keep a User row (sessions and audit entries reference it) and always grant SUPER_ADMIN.
      const row = (await User.findOneAndUpdate(
        { email },
        { $set: { status: "ACTIVE", emailVerifiedAt: new Date(), lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null, deletedAt: null }, $addToSet: { roleKeys: "SUPER_ADMIN" }, $setOnInsert: { name: "Owner" } },
        { upsert: true, returnDocument: "after" },
      ).lean()) as unknown as { _id: { toString(): string } } | null;
      userId = row ? row._id.toString() : null;
    } else if (user && user.status === "ACTIVE" && user.roleKeys.length > 0) {
      await User.updateOne({ _id: user._id }, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() });
      userId = String(user._id);
    }
  }

  if (!userId) {
    if (user && !ok && !viaEnv) {
      const fails = (user.failedLoginCount ?? 0) + 1;
      await User.updateOne({ _id: user._id }, fails >= MAX_FAILS ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { $inc: { failedLoginCount: 1 } });
    }
    return { error: locked ? "This account is temporarily locked. Try again later." : GENERIC };
  }

  await createAdminSession(userId);
  await audit({ id: userId, name: email, email, roleKeys: [], permissions: new Set(), sessionId: "" }, "auth.login", "User", userId);
  redirect("/admin");
}

export async function logoutAction() {
  await destroyAdminSession();
  redirect("/admin/login");
}
