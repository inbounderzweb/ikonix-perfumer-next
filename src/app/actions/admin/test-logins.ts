"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { AccountLinkRequest, Address, Cart, CustomerNote, Inventory, InventoryMovement, Notification, Order, OtpVerification, Payment, ProductReview, PromotionCustomer, PromotionRedemption, RecentlyViewed, Refund, RefreshToken, ReturnRequest, Session, TestLogin, User, Wishlist } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";
import { normalizeMobile } from "@/lib/phone";

export type TestLoginResult = { ok: true; message?: string } | { ok: false; error: string };
const input = z.object({ name: z.string().trim().min(2).max(80), mobile: z.string().max(20), code: z.string().regex(/^\d{4,6}$/, "The code must be 4 to 6 digits.") });

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

/** Changes the fixed OTP. Any pending code is discarded so the new one works immediately. */
export async function resetTestLoginCode(id: string, code: string): Promise<TestLoginResult> {
  try {
    const admin = await requireAdmin("customers.write");
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Invalid request." };
    if (!/^\d{4,6}$/.test(code)) return { ok: false, error: "The code must be 4 to 6 digits." };
    await db();
    const t = (await TestLogin.findByIdAndUpdate(id, { code }).lean()) as unknown as { mobile: string } | null;
    if (!t) return { ok: false, error: "Test login not found." };
    await OtpVerification.deleteMany({ destination: t.mobile, active: true });
    await audit(admin, "testlogin.reset-otp", "TestLogin", id);
    revalidatePath("/admin/customers/test-logins");
    return { ok: true, message: `OTP changed to ${code}. Request a new code on the login page.` };
  } catch (e) { return fail(e); }
}

/** Permanently removes a test user and everything they created: orders, payments, addresses, cart, sessions, OTP logs. */
export async function deleteTestLogin(id: string): Promise<TestLoginResult> {
  try {
    const admin = await requireAdmin("customers.write");
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Invalid request." };
    await db();
    const t = (await TestLogin.findById(id).lean()) as unknown as { mobile: string; userId?: unknown } | null;
    if (!t) return { ok: false, error: "Test login not found." };
    const user = (await User.findOne({ mobile: t.mobile, "roleKeys.0": { $exists: false } }, "_id").lean()) as unknown as { _id: unknown } | null;
    const uid = user?._id ?? null;

    // Orders placed by the account, plus guest orders placed with the test number.
    const orderQuery = { $or: [...(uid ? [{ userId: uid }] : []), { userId: null, "contact.phone": t.mobile }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderIds: any[] = ((await Order.find(orderQuery, "_id").lean()) as unknown as { _id: unknown }[]).map((o) => o._id);

    // Put stock back: undo whatever these orders reserved or sold, then drop the movement rows.
    if (orderIds.length) {
      const net = await InventoryMovement.aggregate([
        { $match: { orderId: { $in: orderIds } } },
        { $group: { _id: "$variantId", onHand: { $sum: "$onHandDelta" }, reserved: { $sum: "$reservedDelta" } } },
      ]);
      for (const n of net) {
        if (n.onHand || n.reserved) await Inventory.updateOne({ variantId: n._id }, { $inc: { onHand: -n.onHand, reserved: -n.reserved } });
      }
      await InventoryMovement.deleteMany({ orderId: { $in: orderIds } });
      await Promise.all([
        Payment.deleteMany({ orderId: { $in: orderIds } }), Refund.deleteMany({ orderId: { $in: orderIds } }), ReturnRequest.deleteMany({ orderId: { $in: orderIds } }),
        PromotionRedemption.deleteMany({ orderId: { $in: orderIds } }), ProductReview.deleteMany({ orderId: { $in: orderIds } }),
      ]);
      await Order.deleteMany({ _id: { $in: orderIds } });
    }
    if (uid) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionIds: any[] = ((await Session.find({ userId: uid }, "_id").lean()) as unknown as { _id: unknown }[]).map((x) => x._id);
      await Promise.all([
        RefreshToken.deleteMany({ sessionId: { $in: sessionIds } }), Session.deleteMany({ userId: uid }),
        Address.deleteMany({ userId: uid }), CustomerNote.deleteMany({ customerId: uid }), Cart.deleteMany({ userId: uid }), Wishlist.deleteMany({ userId: uid }),
        RecentlyViewed.deleteMany({ userId: uid }), ProductReview.deleteMany({ userId: uid }), Notification.deleteMany({ userId: uid }),
        PromotionCustomer.deleteMany({ userId: uid }), PromotionRedemption.deleteMany({ userId: uid }), AccountLinkRequest.deleteMany({ userId: uid }),
      ]);
      await User.deleteOne({ _id: uid });
    }
    await OtpVerification.deleteMany({ destination: t.mobile });
    await TestLogin.deleteOne({ _id: id });
    await audit(admin, "testlogin.delete", "TestLogin", id, { before: { mobile: t.mobile }, after: { ordersDeleted: orderIds.length, userDeleted: !!uid } });
    revalidatePath("/admin/customers/test-logins"); revalidatePath("/admin/customers"); revalidatePath("/admin/orders");
    return { ok: true, message: `Deleted the test user and all related data (${orderIds.length} order${orderIds.length === 1 ? "" : "s"}).` };
  } catch (e) { return fail(e); }
}
