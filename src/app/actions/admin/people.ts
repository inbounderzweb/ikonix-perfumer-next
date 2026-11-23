"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { User } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { ROLE_KEYS } from "@/server/auth/permissions";
import { revokeUserSessions } from "@/server/auth/session";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/admin/audit";

export type PeopleResult = { ok: true; message?: string; password?: string } | { ok: false; error: string };
const id = z.string().regex(/^[a-f0-9]{24}$/);
const roleEnum = z.enum(ROLE_KEYS as [string, ...string[]]);
const ownerEmail = () => process.env.ADMIN_EMAIL?.trim().toLowerCase();
const newPassword = () => randomBytes(15).toString("base64url"); // 120 bits, shown once

function denied(e: unknown): PeopleResult {
  if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
  console.error("people action", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Try again." };
}

// ── Customers ──────────────────────────────────────────────────────────────
export async function setCustomerStatus(userId: string, status: "ACTIVE" | "SUSPENDED", reason?: string): Promise<PeopleResult> {
  try {
    const admin = await requireAdmin("customers.write");
    if (!id.safeParse(userId).success || !["ACTIVE", "SUSPENDED"].includes(status)) return { ok: false, error: "Invalid request." };
    await db();
    const u = await User.findOneAndUpdate(
      { _id: userId, "roleKeys.0": { $exists: false }, status: { $ne: "DELETED" } }, // staff are managed on the Staff page
      status === "SUSPENDED" ? { status, suspendedAt: new Date(), suspendedReason: (reason ?? "").slice(0, 200) } : { status, $unset: { suspendedAt: 1, suspendedReason: 1 } },
    );
    if (!u) return { ok: false, error: "Customer not found." };
    if (status === "SUSPENDED") await revokeUserSessions(userId, "ACCOUNT_SUSPENDED");
    await audit(admin, `customer.${status === "SUSPENDED" ? "suspend" : "reactivate"}`, "User", userId, { after: { status, reason } });
    revalidatePath("/admin/customers");
    return { ok: true };
  } catch (e) { return denied(e); }
}

// ── Staff ──────────────────────────────────────────────────────────────────
const createInput = z.object({ name: z.string().trim().min(2).max(80), email: z.email().max(200).transform((s) => s.trim().toLowerCase()), role: roleEnum });

export async function createStaff(raw: unknown): Promise<PeopleResult> {
  try {
    const admin = await requireAdmin("staff.manage");
    const p = createInput.safeParse(raw);
    if (!p.success) return { ok: false, error: "Enter a name, a valid email and a role." };
    if (p.data.email === ownerEmail()) return { ok: false, error: "That email belongs to the owner account (set in .env)." };
    await db();
    if (await User.exists({ email: p.data.email })) return { ok: false, error: "A user with that email already exists." };
    const password = newPassword();
    const u = await User.create({ name: p.data.name, email: p.data.email, emailVerifiedAt: new Date(), roleKeys: [p.data.role], passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date(), mustChangePassword: true });
    await audit(admin, "staff.create", "User", String(u._id), { after: { email: p.data.email, role: p.data.role } });
    revalidatePath("/admin/staff");
    return { ok: true, password, message: `Account created for ${p.data.email}. Share this one-time password securely; they should change it on first sign-in.` };
  } catch (e) { return denied(e); }
}

async function guardTarget(actorId: string, targetId: string, op: "roles" | "status" | "password"): Promise<{ email?: string; roleKeys: string[] } | string> {
  const t = (await User.findOne({ _id: targetId, "roleKeys.0": { $exists: true } }, "email roleKeys status").lean()) as { email?: string; roleKeys: string[]; status: string } | null;
  if (!t) return "Staff member not found.";
  if (t.email && t.email === ownerEmail()) return "The owner account is managed in .env and can’t be changed here.";
  if (op !== "password" && actorId === targetId) return "You can’t change your own access. Ask another super admin.";
  return t;
}
const otherSuperAdmins = (excludeId: string) => User.countDocuments({ _id: { $ne: excludeId }, roleKeys: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null });

export async function setStaffRoles(userId: string, roles: string[]): Promise<PeopleResult> {
  try {
    const admin = await requireAdmin("staff.manage");
    const r = z.array(roleEnum).min(1).max(5).safeParse(roles);
    if (!id.safeParse(userId).success || !r.success) return { ok: false, error: "Choose at least one valid role." };
    await db();
    const t = await guardTarget(admin.id, userId, "roles");
    if (typeof t === "string") return { ok: false, error: t };
    if (t.roleKeys.includes("SUPER_ADMIN") && !r.data.includes("SUPER_ADMIN") && (await otherSuperAdmins(userId)) === 0) return { ok: false, error: "At least one active super admin must remain." };
    await User.updateOne({ _id: userId }, { roleKeys: [...new Set(r.data)] });
    await revokeUserSessions(userId, "SECURITY_CHANGE"); // new permissions apply from the next sign-in
    await audit(admin, "staff.roles", "User", userId, { before: { roles: t.roleKeys }, after: { roles: r.data } });
    revalidatePath("/admin/staff");
    return { ok: true };
  } catch (e) { return denied(e); }
}

export async function setStaffStatus(userId: string, status: "ACTIVE" | "SUSPENDED"): Promise<PeopleResult> {
  try {
    const admin = await requireAdmin("staff.manage");
    if (!id.safeParse(userId).success || !["ACTIVE", "SUSPENDED"].includes(status)) return { ok: false, error: "Invalid request." };
    await db();
    const t = await guardTarget(admin.id, userId, "status");
    if (typeof t === "string") return { ok: false, error: t };
    if (status === "SUSPENDED" && t.roleKeys.includes("SUPER_ADMIN") && (await otherSuperAdmins(userId)) === 0) return { ok: false, error: "At least one active super admin must remain." };
    await User.updateOne({ _id: userId }, { status });
    if (status === "SUSPENDED") await revokeUserSessions(userId, "ACCOUNT_SUSPENDED");
    await audit(admin, `staff.${status === "SUSPENDED" ? "suspend" : "reactivate"}`, "User", userId);
    revalidatePath("/admin/staff");
    return { ok: true };
  } catch (e) { return denied(e); }
}

export async function resetStaffPassword(userId: string): Promise<PeopleResult> {
  try {
    const admin = await requireAdmin("staff.manage");
    if (!id.safeParse(userId).success) return { ok: false, error: "Invalid request." };
    await db();
    const t = await guardTarget(admin.id, userId, "password");
    if (typeof t === "string") return { ok: false, error: t };
    const password = newPassword();
    await User.updateOne({ _id: userId }, { passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date(), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null });
    await revokeUserSessions(userId, "SECURITY_CHANGE");
    await audit(admin, "staff.password_reset", "User", userId);
    return { ok: true, password, message: "New one-time password generated. Existing sessions were signed out." };
  } catch (e) { return denied(e); }
}

// ── Own password ───────────────────────────────────────────────────────────
const pwInput = z.object({ current: z.string().min(1).max(200), next: z.string().min(12, "Use at least 12 characters").max(200) });
export async function changeOwnPassword(raw: unknown): Promise<PeopleResult> {
  try {
    const admin = await requireAdmin("dashboard.view");
    if (admin.email && admin.email === ownerEmail()) return { ok: false, error: "The owner password is set in .env (ADMIN_PASSWORD or ADMIN_PASSWORD_HASH)." };
    const p = pwInput.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input." };
    if (!(await rateLimit(`pwchange:${admin.id}`, 5, 900))) return { ok: false, error: "Too many attempts. Try again later." };
    await db();
    const u = (await User.findById(admin.id, "+passwordHash").lean()) as { passwordHash?: string } | null;
    if (!u?.passwordHash || !(await bcrypt.compare(p.data.current, u.passwordHash))) return { ok: false, error: "Current password is incorrect." };
    await User.updateOne({ _id: admin.id }, { passwordHash: await bcrypt.hash(p.data.next, 12), passwordChangedAt: new Date(), mustChangePassword: false });
    await revokeUserSessions(admin.id, "SECURITY_CHANGE", admin.sessionId); // sign out other devices, keep this one
    await audit(admin, "auth.password_change", "User", admin.id);
    return { ok: true, message: "Password changed. Other devices were signed out." };
  } catch (e) { return denied(e); }
}
