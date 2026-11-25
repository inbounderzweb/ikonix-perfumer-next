"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { OtpActivity, OtpVerification } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";
import { objectIdRe } from "@/server/admin/util";

export type OtpActivityResult = { ok: true; message?: string } | { ok: false; error: string };
const reason = z.string().trim().max(200).optional();

function fail(e: unknown): OtpActivityResult {
  if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
  console.error("otp-activity action", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Try again." };
}

/** Blocks a number from ever receiving or using an OTP until an admin unblocks it. */
export async function blockOtpNumber(id: string, rawReason?: string): Promise<OtpActivityResult> {
  try {
    const admin = await requireAdmin("customers.write");
    if (!objectIdRe.test(id)) return { ok: false, error: "Invalid request." };
    const p = reason.safeParse(rawReason);
    if (!p.success) return { ok: false, error: "The reason is too long (200 characters max)." };
    await db();
    const row = (await OtpActivity.findByIdAndUpdate(id, { blocked: true, blockedAt: new Date(), blockedReason: p.data || "Blocked by admin", blockedBy: admin.id }).lean()) as unknown as { mobile: string } | null;
    if (!row) return { ok: false, error: "Number not found." };
    await OtpVerification.updateMany({ destination: row.mobile, active: true }, { active: false }); // any code already sent stops working
    await audit(admin, "otp.block", "OtpActivity", id, { after: { mobile: row.mobile, reason: p.data || null } });
    revalidatePath("/admin/reports/otp");
    return { ok: true, message: `${row.mobile} can no longer use OTP.` };
  } catch (e) { return fail(e); }
}

export async function unblockOtpNumber(id: string): Promise<OtpActivityResult> {
  try {
    const admin = await requireAdmin("customers.write");
    if (!objectIdRe.test(id)) return { ok: false, error: "Invalid request." };
    await db();
    const row = (await OtpActivity.findByIdAndUpdate(id, { blocked: false, $unset: { blockedAt: 1, blockedReason: 1, blockedBy: 1 } }).lean()) as unknown as { mobile: string } | null;
    if (!row) return { ok: false, error: "Number not found." };
    await audit(admin, "otp.unblock", "OtpActivity", id, { after: { mobile: row.mobile } });
    revalidatePath("/admin/reports/otp");
    return { ok: true, message: `${row.mobile} can use OTP again.` };
  } catch (e) { return fail(e); }
}
