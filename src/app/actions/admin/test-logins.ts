"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { TestLogin, User } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";
import { normalizeMobile } from "@/lib/phone";

export type TestLoginResult = { ok: true; message?: string } | { ok: false; error: string };
const input = z.object({ name: z.string().trim().min(2).max(80), mobile: z.string().max(20), code: z.string().regex(/^\d{6}$/, "The code must be 6 digits.") });

function fail(e: unknown): TestLoginResult {
  if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
  console.error("test-login action", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function createTestLogin(raw: unknown): Promise<TestLoginResult> {
  try {
    const admin = await requireAdmin("customers.write");
    const p = input.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Enter a name, mobile number and 6-digit code." };
    const mobile = normalizeMobile(p.data.mobile);
    if (!mobile) return { ok: false, error: "Enter a valid 10-digit Indian mobile number." };
    await db();
    if (await TestLogin.exists({ mobile })) return { ok: false, error: "That number is already a test login." };
    // A fixed code on a real customer's number would be a back door into their account.
    if (await User.exists({ mobile, deletedAt: null })) return { ok: false, error: "That number already belongs to a customer account. Use a number that has never signed in." };
    const user = await User.create({ name: p.data.name, mobile, mobileVerifiedAt: new Date() });
    const t = await TestLogin.create({ mobile, name: p.data.name, code: p.data.code, userId: user._id, createdBy: admin.id });
    await audit(admin, "testlogin.create", "TestLogin", String(t._id), { after: { mobile, name: p.data.name } });
    revalidatePath("/admin/customers/test-logins");
    return { ok: true, message: `Test login created. Sign in at /login with ${mobile} and the code you set.` };
  } catch (e) { return fail(e); }
}

export async function setTestLoginActive(id: string, active: boolean): Promise<TestLoginResult> {
  try {
    const admin = await requireAdmin("customers.write");
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Invalid request." };
    await db();
    const t = await TestLogin.findByIdAndUpdate(id, { active });
    if (!t) return { ok: false, error: "Test login not found." };
    await audit(admin, `testlogin.${active ? "enable" : "disable"}`, "TestLogin", id);
    revalidatePath("/admin/customers/test-logins");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteTestLogin(id: string): Promise<TestLoginResult> {
  try {
    const admin = await requireAdmin("customers.write");
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Invalid request." };
    await db();
    const t = (await TestLogin.findByIdAndDelete(id).lean()) as unknown as { mobile: string } | null;
    if (!t) return { ok: false, error: "Test login not found." };
    await audit(admin, "testlogin.delete", "TestLogin", id, { before: { mobile: t.mobile } });
    revalidatePath("/admin/customers/test-logins");
    return { ok: true, message: "Removed. The customer account it created is kept (suspend it on the Customers page if needed)." };
  } catch (e) { return fail(e); }
}
