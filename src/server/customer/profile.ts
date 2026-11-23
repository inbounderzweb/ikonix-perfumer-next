import "server-only";
import { db } from "@/server/db";
import { Address, User } from "@/server/models";

export type ProfileDTO = {
  id: string; name: string; email: string; googleEmail: string; mobile: string; mobileVerified: boolean; alternativePhone: string;
  avatarUrl: string; dateOfBirth: string; gender: string; authProviders: ("mobile" | "google")[]; createdAt: string; deletionRequestedAt: string | null;
  completion: { percent: number; missing: string[] };
};

/** Profile completeness: what a customer can still add to make delivery and support smoother. */
export function completion(p: { name?: string; mobile?: string; mobileVerified?: boolean; email?: string; avatarUrl?: string; dateOfBirth?: string; gender?: string }, addressCount: number) {
  const items: [string, boolean][] = [
    ["Full name", !!p.name], ["Verified mobile number", !!p.mobile && !!p.mobileVerified], ["Email address", !!p.email],
    ["Profile photo", !!p.avatarUrl], ["Date of birth", !!p.dateOfBirth], ["Gender", !!p.gender], ["A saved address", addressCount > 0],
  ];
  return { percent: Math.round((items.filter(([, ok]) => ok).length / items.length) * 100), missing: items.filter(([, ok]) => !ok).map(([n]) => n) };
}

export async function getProfile(userId: string): Promise<ProfileDTO | null> {
  await db();
  const u = (await User.findOne({ _id: userId, deletedAt: null }, "name email mobile mobileVerifiedAt alternativePhone avatarUrl dateOfBirth gender google createdAt deletionRequestedAt").lean()) as unknown as
    { _id: unknown; name?: string; email?: string; mobile?: string; mobileVerifiedAt?: Date; alternativePhone?: string; avatarUrl?: string; dateOfBirth?: Date; gender?: string | null; google?: { sub?: string; email?: string } | null; createdAt: Date; deletionRequestedAt?: Date } | null;
  if (!u) return null;
  const addresses = await Address.countDocuments({ userId, deletedAt: null });
  const base = { name: u.name ?? "", mobile: u.mobile ?? "", mobileVerified: !!u.mobileVerifiedAt, email: u.email ?? "", avatarUrl: u.avatarUrl ?? "", dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : "", gender: u.gender ?? "" };
  return {
    id: String(u._id), ...base, googleEmail: u.google?.sub ? u.google.email ?? u.email ?? "" : "", alternativePhone: u.alternativePhone ?? "",
    authProviders: [...(u.mobile ? ["mobile" as const] : []), ...(u.google?.sub ? ["google" as const] : [])], createdAt: u.createdAt.toISOString(),
    deletionRequestedAt: u.deletionRequestedAt?.toISOString() ?? null, completion: completion(base, addresses),
  };
}

export async function updateProfile(userId: string, v: { name: string; alternativePhone?: string; dateOfBirth?: string; gender?: string }) {
  await db();
  const set: Record<string, unknown> = { name: v.name, gender: v.gender || null };
  const unset: Record<string, 1> = {};
  if (v.alternativePhone) set.alternativePhone = v.alternativePhone; else unset.alternativePhone = 1;
  if (v.dateOfBirth) set.dateOfBirth = new Date(`${v.dateOfBirth}T00:00:00Z`); else unset.dateOfBirth = 1;
  // Whitelisted fields only: email, roles, status and mobile are never writable here.
  await User.updateOne({ _id: userId, deletedAt: null }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
}

/** Applies a mobile change that has ALREADY been proved by a CHANGE_MOBILE OTP on the new number. */
export async function applyMobileChange(userId: string, newMobile: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await db();
  try {
    const r = await User.updateOne({ _id: userId, deletedAt: null }, { mobile: newMobile, mobileVerifiedAt: new Date() });
    return r.matchedCount ? { ok: true } : { ok: false, error: "Account not found." };
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "That number is already used by another account." };
    throw e;
  }
}
