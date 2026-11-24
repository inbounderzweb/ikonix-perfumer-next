import "server-only";
import { db } from "@/server/db";
import { Order, User } from "@/server/models";

export type LoginUser = { id: string; created: boolean } | { error: string };
const SUSPENDED = "This account is not available. Please contact support.";

/**
 * Attaches imported guest orders from the previous website to the customer who just proved ownership of the phone number.
 * Runs only after a verified OTP, matches the exact normalised mobile, touches only unowned legacy guest orders
 * (userId null), and is idempotent: once linked, an order no longer matches. Never blocks or fails a login.
 */
async function linkLegacyGuestOrders(userId: unknown, mobile: string) {
  try {
    await Order.updateMany({ userId: null, "legacy.source": { $exists: true }, "legacy.guest": true, "contact.phone": mobile }, { $set: { userId } });
  } catch (e) {
    console.error("[legacy-link] could not link guest orders:", (e as Error).message);
  }
}

/** After a verified OTP: finds the customer who owns this mobile, or creates one. */
export async function userForVerifiedMobile(mobile: string): Promise<LoginUser> {
  await db();
  const found = (await User.findOne({ mobile, deletedAt: null }, "status").lean()) as unknown as { _id: { toString(): string }; status: string } | null;
  if (found) {
    if (found.status !== "ACTIVE") return { error: SUSPENDED };
    await User.updateOne({ _id: found._id }, { lastLoginAt: new Date(), mobileVerifiedAt: new Date() });
    await linkLegacyGuestOrders(found._id, mobile);
    return { id: found._id.toString(), created: false };
  }
  try {
    const u = await User.create({ mobile, mobileVerifiedAt: new Date(), lastLoginAt: new Date() });
    await linkLegacyGuestOrders(u._id, mobile);
    return { id: String(u._id), created: true };
  } catch (e) {
    if ((e as { code?: number }).code === 11000) { // created concurrently by a parallel verification
      const again = (await User.findOne({ mobile }, "_id").lean()) as unknown as { _id: { toString(): string } } | null;
      if (again) { await linkLegacyGuestOrders(again._id, mobile); return { id: again._id.toString(), created: false }; }
    }
    throw e;
  }
}

export type GoogleClaims = { sub: string; email: string; email_verified: boolean; name?: string; picture?: string };

/**
 * Google sign-in. Order matters for safety:
 *  1. Known Google subject → that account.
 *  2. Same email already registered → link Google to it (allowed ONLY because Google asserts email_verified).
 *  3. Otherwise create a new customer.
 * Google never grants admin access: staff roles come from the admin panel only, and the admin cookie is separate.
 */
export async function userForGoogle(c: GoogleClaims): Promise<LoginUser> {
  await db();
  if (!c.email_verified || !c.email) return { error: "Your Google email is not verified." };
  const email = c.email.trim().toLowerCase();
  const picture = c.picture && /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(c.picture) ? c.picture : undefined;
  const now = new Date();

  const bySub = (await User.findOne({ "google.sub": c.sub, deletedAt: null }, "status").lean()) as unknown as { _id: { toString(): string }; status: string } | null;
  if (bySub) {
    if (bySub.status !== "ACTIVE") return { error: SUSPENDED };
    await User.updateOne({ _id: bySub._id }, { lastLoginAt: now, "google.lastUsedAt": now });
    return { id: bySub._id.toString(), created: false };
  }

  const byEmail = (await User.findOne({ email, deletedAt: null }, "status name avatarUrl google").lean()) as unknown as { _id: { toString(): string }; status: string; name?: string; avatarUrl?: string; google?: { sub?: string } | null } | null;
  if (byEmail) {
    if (byEmail.status !== "ACTIVE") return { error: SUSPENDED };
    if (byEmail.google?.sub && byEmail.google.sub !== c.sub) return { error: "This email is linked to a different Google account." };
    await User.updateOne({ _id: byEmail._id }, {
      google: { sub: c.sub, email, emailVerified: true, linkedAt: now, lastUsedAt: now },
      emailVerifiedAt: now, lastLoginAt: now,
      ...(!byEmail.name && c.name ? { name: c.name.slice(0, 80) } : {}), ...(!byEmail.avatarUrl && picture ? { avatarUrl: picture } : {}),
    });
    return { id: byEmail._id.toString(), created: false };
  }
  try {
    const u = await User.create({ email, emailVerifiedAt: now, name: c.name?.slice(0, 80), avatarUrl: picture, google: { sub: c.sub, email, emailVerified: true, linkedAt: now, lastUsedAt: now }, lastLoginAt: now });
    return { id: String(u._id), created: true };
  } catch (e) {
    if ((e as { code?: number }).code === 11000) { // parallel first login: retry through the lookup path
      const again = (await User.findOne({ $or: [{ "google.sub": c.sub }, { email }] }, "_id").lean()) as unknown as { _id: { toString(): string } } | null;
      if (again) return { id: again._id.toString(), created: false };
    }
    throw e;
  }
}
