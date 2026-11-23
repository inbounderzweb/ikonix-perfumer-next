"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { User } from "@/server/models";
import { rateLimit } from "@/server/auth/rate-limit";
import { clientMeta } from "@/server/auth/request";
import { createAdminSession, destroyAdminSession } from "@/server/auth/session";
import { checkAdminPassword as checkPassword, ensureOwnerRow } from "@/server/auth/admin-credentials";
import { audit } from "@/server/admin/audit";

export type LoginState = { error?: string } | undefined;

const schema = z.object({ email: z.email().max(200).transform((s) => s.trim().toLowerCase()), password: z.string().min(1).max(200) });
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
const GENERIC = "Incorrect email or password.";

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
      userId = await ensureOwnerRow(email);
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
  await audit({ id: userId }, "auth.login", "User", userId);
  redirect("/admin");
}

export async function logoutAction() {
  await destroyAdminSession();
  redirect("/admin/login");
}
