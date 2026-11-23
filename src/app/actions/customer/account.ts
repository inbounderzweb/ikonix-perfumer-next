"use server";

import { revalidatePath } from "next/cache";
import { normalizeMobile } from "@/lib/phone";
import { db } from "@/server/db";
import { User } from "@/server/models";
import { getCustomer, revokeCustomerSessions, destroyCustomerSession } from "@/server/auth/customer-session";
import { clientMeta } from "@/server/auth/request";
import { rateLimit } from "@/server/auth/rate-limit";
import { requestOtp, verifyOtp } from "@/server/auth/otp/service";
import { applyMobileChange, updateProfile } from "@/server/customer/profile";
import { fieldErrors, objectId, profileInput } from "@/server/customer/schemas";
import { deleteAddress, saveAddress, setDefaultAddress, type AddressDTO } from "@/server/customer/addresses";
import { addToWishlist, removeFromWishlist } from "@/server/customer/wishlist";
import { reorderLines, type ReorderResult } from "@/server/customer/orders";
import { auditCustomer } from "@/server/customer/audit";

type Res = { ok: true; message?: string } | { ok: false; error: string; fields?: Record<string, string> };
const SIGN_IN = { ok: false as const, error: "Please sign in to continue." };

export async function updateProfileAction(raw: unknown): Promise<Res> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  const p = profileInput.safeParse(raw); // .strict(): email / mobile / role fields from the client are rejected
  if (!p.success) return { ok: false, error: "Please check the highlighted fields.", fields: fieldErrors(p.error) };
  if (p.data.alternativePhone && p.data.alternativePhone === c.mobile) return { ok: false, error: "The alternative number must differ from your main number.", fields: { alternativePhone: "Must differ from your main number" } };
  await updateProfile(c.id, p.data);
  await auditCustomer(c.id, "customer.profile.update", "User", c.id, { fields: Object.keys(p.data) });
  revalidatePath("/account", "layout");
  return { ok: true, message: "Profile updated." };
}

/** Change/add mobile, step 1: OTP goes to the NEW number. It is not used for anything until step 2 succeeds. */
export async function requestMobileChange(mobileRaw: string): Promise<{ ok: true; message: string; mock: boolean; resendAfterSec: number } | { ok: false; error: string }> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  const mobile = normalizeMobile(mobileRaw);
  if (!mobile) return { ok: false, error: "Enter a valid 10-digit mobile number." };
  if (mobile === c.mobile) return { ok: false, error: "That is already your number." };
  await db();
  if (await User.exists({ mobile, _id: { $ne: c.id }, deletedAt: null })) return { ok: false, error: "That number is already used by another account." };
  const { ip, userAgent } = await clientMeta();
  const r = await requestOtp({ destination: mobile, purpose: "CHANGE_MOBILE", userId: c.id, ip, userAgent });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: r.mock ? "Development mode: no SMS is sent." : "We sent a code to the new number.", mock: r.mock, resendAfterSec: r.resendAfterSec };
}

export async function confirmMobileChange(mobileRaw: string, code: string): Promise<Res> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  const mobile = normalizeMobile(mobileRaw);
  if (!mobile || !/^\d{6}$/.test(code.replace(/\s/g, ""))) return { ok: false, error: "Enter the 6-digit code." };
  const { ip } = await clientMeta();
  if (!(await rateLimit(`mobile-change:${c.id}`, 20, 3600))) return { ok: false, error: "Too many attempts. Try again later." };
  const v = await verifyOtp({ destination: mobile, purpose: "CHANGE_MOBILE", code: code.replace(/\s/g, ""), ip });
  if (!v.ok) return { ok: false, error: v.error };
  if (v.userId && v.userId !== c.id) return { ok: false, error: "This code was requested by a different account." };
  const r = await applyMobileChange(c.id, mobile);
  if (!r.ok) return r;
  await auditCustomer(c.id, "customer.mobile.change", "User", c.id, { to: `${mobile.slice(0, 3)}******${mobile.slice(-2)}` });
  revalidatePath("/account", "layout");
  return { ok: true, message: "Mobile number verified and updated." };
}

// ── Addresses ──
export async function saveAddressAction(raw: unknown): Promise<{ ok: true; address: AddressDTO } | { ok: false; error: string; fields?: Record<string, string> }> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  const r = await saveAddress(c.id, raw); // userId from the session; any userId in `raw` is stripped by the schema
  if (r.ok) { await auditCustomer(c.id, "customer.address.save", "Address", r.address.id); revalidatePath("/account", "layout"); }
  return r;
}
export async function deleteAddressAction(id: string): Promise<Res> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  if (!objectId.safeParse(id).success) return { ok: false, error: "Address not found." };
  const r = await deleteAddress(c.id, id);
  if (r.ok) { await auditCustomer(c.id, "customer.address.delete", "Address", id); revalidatePath("/account", "layout"); return { ok: true, message: "Address removed." }; }
  return { ok: false, error: r.error ?? "Address not found." };
}
export async function setDefaultAddressAction(id: string): Promise<Res> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  if (!objectId.safeParse(id).success) return { ok: false, error: "Address not found." };
  const r = await setDefaultAddress(c.id, id);
  if (r.ok) { revalidatePath("/account", "layout"); return { ok: true, message: "Default address updated." }; }
  return { ok: false, error: r.error ?? "Address not found." };
}

// ── Wishlist ──
export async function toggleWishlist(productId: string, on: boolean): Promise<Res> {
  const c = await getCustomer(); if (!c) return { ok: false, error: "Sign in to save items to your wishlist." };
  if (!objectId.safeParse(productId).success) return { ok: false, error: "Product not found." };
  if (!(await rateLimit(`wish:${c.id}`, 120, 600))) return { ok: false, error: "Too many changes. Slow down a little." };
  const r: { ok: boolean; error?: string } = on ? await addToWishlist(c.id, productId) : await removeFromWishlist(c.id, productId);
  if (!r.ok) return { ok: false, error: r.error ?? "Could not update wishlist." };
  revalidatePath("/account/wishlist");
  return { ok: true };
}

// ── Orders ──
export async function reorderAction(orderNumber: string): Promise<ReorderResult> {
  const c = await getCustomer(); if (!c) return { ok: false, error: "Please sign in to continue." };
  return reorderLines(c.id, orderNumber);
}

// ── Account / security ──
export async function requestAccountDeletion(): Promise<Res> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  await db();
  await User.updateOne({ _id: c.id, deletionRequestedAt: null }, { deletionRequestedAt: new Date() });
  await auditCustomer(c.id, "customer.deletion.request", "User", c.id);
  revalidatePath("/account", "layout");
  return { ok: true, message: "Deletion requested. Our team will process it; order and payment records are retained as the law requires." };
}
export async function cancelAccountDeletion(): Promise<Res> {
  const c = await getCustomer(); if (!c) return SIGN_IN;
  await db();
  await User.updateOne({ _id: c.id }, { $unset: { deletionRequestedAt: 1 } });
  await auditCustomer(c.id, "customer.deletion.cancel", "User", c.id);
  revalidatePath("/account", "layout");
  return { ok: true, message: "Deletion request cancelled." };
}
export async function logoutEverywhere(): Promise<void> {
  const c = await getCustomer(); if (!c) return;
  await revokeCustomerSessions(c.id);
  await destroyCustomerSession();
  await auditCustomer(c.id, "customer.logout.all", "User", c.id);
}
