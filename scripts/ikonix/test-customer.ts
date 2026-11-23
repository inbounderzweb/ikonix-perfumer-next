// Integration test of the customer section (OTP, identity, profile, addresses, wishlist, orders, ownership/IDOR, invoice).
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/ikonix/test-customer.ts
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { connect, disconnect } from "./_env";
import { Address, AuditLog, Order, OtpVerification, Payment, Product, RateLimitBucket, User, Wishlist } from "../../src/server/models";
import { requestOtp, verifyOtp } from "../../src/server/auth/otp/service";
import { userForVerifiedMobile } from "../../src/server/auth/identity";
import { applyMobileChange, completion, updateProfile } from "../../src/server/customer/profile";
import { profileInput } from "../../src/server/customer/schemas";
import { deleteAddress, listAddresses, saveAddress, setDefaultAddress } from "../../src/server/customer/addresses";
import { addToWishlist, listWishlist, removeFromWishlist, wishlistIds } from "../../src/server/customer/wishlist";
import { buildTimeline, dashboardStats, getOrder, listOrders, reorderLines } from "../../src/server/customer/orders";
import { buildInvoice } from "../../src/server/customer/invoice";
import { normalizeMobile, safeNext } from "../../src/lib/phone";

process.env.OTP_PROVIDER = "mock"; process.env.MOCK_OTP_CODE = "123456"; process.env.OTP_MAX_ATTEMPTS = "3"; process.env.OTP_RESEND_SECONDS = "30"; process.env.OTP_MAX_SENDS_PER_HOUR = "5";
const A = "+919000000011", B = "+919000000012", C = "+919000000013", TAG = "ZZTEST-CUST";
const ip = "203.0.113.77";
let count = 0;
const ok = (m: string) => { count++; console.log("  ✓", m); };
const addr = (o: object = {}) => ({ type: "HOME", fullName: "Test Person", phone: "9000000011", line1: "12 Test Street", city: "Mumbai", state: "Maharashtra", postalCode: "400001", country: "IN", ...o });

async function main() {
  await connect();
  await cleanup();

  console.log("Phone & redirect helpers");
  assert.equal(normalizeMobile("98765 43210"), "+919876543210"); assert.equal(normalizeMobile("+91-98765-43210"), "+919876543210"); assert.equal(normalizeMobile("1234567890"), null); assert.equal(normalizeMobile("abc"), null);
  ok("mobile numbers normalise to E.164; invalid ones rejected");
  assert.equal(safeNext("//evil.com"), "/account"); assert.equal(safeNext("https://evil.com"), "/account"); assert.equal(safeNext("/\\evil.com"), "/account"); assert.equal(safeNext("/account/orders"), "/account/orders");
  ok("open-redirect guard accepts only same-site paths");

  console.log("OTP");
  const r1 = await requestOtp({ destination: A, purpose: "LOGIN", ip }); assert(r1.ok && r1.mock);
  const again = await requestOtp({ destination: A, purpose: "LOGIN", ip }); assert(!again.ok && (again.retryAfterSec ?? 0) > 0); ok("resend inside the cooldown is refused");
  let v = await verifyOtp({ destination: A, purpose: "LOGIN", code: "000000", ip }); assert(!v.ok);
  v = await verifyOtp({ destination: A, purpose: "CHANGE_MOBILE", code: "123456", ip }); assert(!v.ok); ok("wrong code rejected; a LOGIN code cannot be used for CHANGE_MOBILE");
  v = await verifyOtp({ destination: A, purpose: "LOGIN", code: "123456", ip }); assert(v.ok); ok("correct code accepted");
  v = await verifyOtp({ destination: A, purpose: "LOGIN", code: "123456", ip }); assert(!v.ok); ok("code is single-use (replay rejected)");
  await OtpVerification.updateMany({ destination: A }, { resendAvailableAt: new Date(0) });
  assert((await requestOtp({ destination: A, purpose: "LOGIN", ip })).ok);
  for (let i = 0; i < 3; i++) v = await verifyOtp({ destination: A, purpose: "LOGIN", code: "111111", ip });
  assert(!v.ok && /new code/i.test(v.error)); v = await verifyOtp({ destination: A, purpose: "LOGIN", code: "123456", ip }); assert(!v.ok); ok("max attempts locks the code; even the right code then fails");
  await OtpVerification.updateMany({ destination: A }, { resendAvailableAt: new Date(0) });
  assert((await requestOtp({ destination: A, purpose: "LOGIN", ip })).ok);
  await OtpVerification.updateMany({ destination: A, active: true }, { expiresAt: new Date(Date.now() - 1000) });
  v = await verifyOtp({ destination: A, purpose: "LOGIN", code: "123456", ip }); assert(!v.ok); ok("expired code rejected");
  const stored = JSON.stringify(await OtpVerification.find({ destination: A }).lean()); assert(!stored.includes("123456")); ok("the code is never stored in plain text");
  let blocked = false;
  for (let i = 0; i < 8 && !blocked; i++) { await OtpVerification.updateMany({ destination: C }, { resendAvailableAt: new Date(0) }); const r = await requestOtp({ destination: C, purpose: "LOGIN", ip }); if (!r.ok) blocked = true; }
  assert(blocked); ok("per-number hourly send limit kicks in");
  const [x, y] = await Promise.all([verifyOtp({ destination: B, purpose: "LOGIN", code: "123456", ip }), (async () => { await requestOtp({ destination: B, purpose: "LOGIN", ip }); return null; })()]);
  void x; void y;
  await OtpVerification.updateMany({ destination: B }, { active: false }); await OtpVerification.deleteMany({ destination: B }); await RateLimitBucket.deleteMany({ _id: { $regex: `^otp-dest:${B.replace("+", "\\+")}` } });
  await requestOtp({ destination: B, purpose: "LOGIN", ip });
  const race = await Promise.all([verifyOtp({ destination: B, purpose: "LOGIN", code: "123456" }), verifyOtp({ destination: B, purpose: "LOGIN", code: "123456" })]);
  assert.equal(race.filter((r) => r.ok).length, 1); ok("two simultaneous correct submissions: exactly one succeeds");

  console.log("Identity");
  const ua = await userForVerifiedMobile(A); assert("id" in ua && ua.created);
  const ua2 = await userForVerifiedMobile(A); assert("id" in ua2 && !ua2.created && ua2.id === ua.id); assert.equal(await User.countDocuments({ mobile: A }), 1); ok("same number twice → one account (no duplicates)");
  const ub = await userForVerifiedMobile(B); assert("id" in ub);
  const u = (await User.findById(ua.id).lean()) as unknown as { roleKeys: string[] }; assert.deepEqual(u.roleKeys ?? [], []); ok("new customers get no staff roles");
  await User.updateOne({ _id: ub.id }, { status: "SUSPENDED" }); assert("error" in (await userForVerifiedMobile(B))); await User.updateOne({ _id: ub.id }, { status: "ACTIVE" }); ok("suspended accounts cannot sign in");
  const idA = (ua as { id: string }).id, idB = (ub as { id: string }).id;

  console.log("Profile");
  assert(!profileInput.safeParse({ name: "Aarav Test", email: "hacker@x.com" }).success); ok("profile schema rejects an email field (email is read-only)");
  assert(!profileInput.safeParse({ name: "A" }).success); assert(!profileInput.safeParse({ name: "Aarav", dateOfBirth: "2020-01-01" }).success); assert(!profileInput.safeParse({ name: "Aarav", alternativePhone: "123" }).success); ok("short name, under-13 DOB and bad alt phone rejected");
  const pv = profileInput.parse({ name: "Aarav Test", alternativePhone: "98765 43210", dateOfBirth: "1990-05-17", gender: "MALE" });
  await updateProfile(idA, pv); const after = (await User.findById(idA).lean()) as unknown as { name: string; alternativePhone: string; gender: string; mobile: string; roleKeys: string[] };
  assert.equal(after.name, "Aarav Test"); assert.equal(after.alternativePhone, "+919876543210"); assert.equal(after.mobile, A); ok("profile saved; main mobile untouched");
  assert.equal(completion({ name: "x", mobile: A, mobileVerified: true, email: "", avatarUrl: "", dateOfBirth: "", gender: "" }, 0).percent, 29); ok("completion percentage computed from real fields");
  const dup = await applyMobileChange(idA, B); assert(!dup.ok); ok("changing to a number another account owns is refused");
  assert((await applyMobileChange(idA, "+919000000014")).ok); assert.equal(((await User.findById(idA).lean()) as unknown as { mobile: string }).mobile, "+919000000014"); ok("verified mobile change applied");
  await applyMobileChange(idA, A);

  console.log("Addresses & ownership");
  assert(!(await saveAddress(idA, addr({ postalCode: "12345" }))).ok); assert(!(await saveAddress(idA, addr({ state: "Atlantis" }))).ok); assert(!(await saveAddress(idA, addr({ country: "US" }))).ok); assert(!(await saveAddress(idA, addr({ phone: "123" }))).ok); ok("bad PIN / state / country / phone rejected");
  const a1 = await saveAddress(idA, addr()); assert(a1.ok && a1.address.isDefault); ok("first address becomes the default automatically");
  const a2 = await saveAddress(idA, addr({ type: "WORK", line1: "Office Tower 5", makeDefault: true })); assert(a2.ok && a2.address.isDefault);
  assert.equal((await listAddresses(idA)).filter((a) => a.isDefault).length, 1); ok("exactly one default at a time");
  const idA1 = (a1 as { address: { id: string } }).address.id, idA2 = (a2 as { address: { id: string } }).address.id;
  assert(!(await saveAddress(idB, { ...addr(), id: idA1, line1: "Hijacked 1" })).ok); assert(!(await deleteAddress(idB, idA1)).ok); assert(!(await setDefaultAddress(idB, idA1)).ok);
  assert.equal(((await Address.findById(idA1).lean()) as unknown as { line1: string; deletedAt?: Date }).line1, "12 Test Street"); assert.equal((await listAddresses(idB)).length, 0); ok("IDOR: user B cannot edit, delete or default user A's address, nor see it");
  assert((await saveAddress(idA, { ...addr({ line1: "Updated Street 9" }), id: idA1 })).ok); ok("owner can edit");
  assert((await deleteAddress(idA, idA2)).ok); assert.equal((await listAddresses(idA)).find((a) => a.isDefault)?.id, idA1); ok("deleting the default promotes another address");
  assert((await saveAddress(idA, { ...addr(), userId: String(idB) })).ok && (await listAddresses(idB)).length === 0); ok("a client-supplied userId is ignored (addresses always belong to the session user)");

  console.log("Wishlist");
  const prod = (await Product.findOne({ status: "ACTIVE", deletedAt: null }, "_id").lean()) as unknown as { _id: Types.ObjectId }; assert(prod);
  const pid = String(prod._id);
  assert((await addToWishlist(idA, pid)).ok); assert((await addToWishlist(idA, pid)).ok); assert.deepEqual(await wishlistIds(idA), [pid]); ok("adding twice keeps a single entry");
  await Promise.all([addToWishlist(idB, pid), addToWishlist(idB, pid), addToWishlist(idB, pid)]); assert.equal((await wishlistIds(idB)).length, 1); ok("concurrent adds do not duplicate");
  const wl = await listWishlist(idA); assert.equal(wl.length, 1); assert(wl[0].regularPrice !== null && wl[0].name); ok("wishlist shows live name, price and availability");
  assert(!(await addToWishlist(idA, String(new Types.ObjectId()))).ok); ok("unknown product refused");
  await removeFromWishlist(idB, pid); assert.deepEqual(await wishlistIds(idA), [pid]); assert.deepEqual(await wishlistIds(idB), []); ok("removal affects only the owner's list");

  console.log("Orders, tracking & ownership");
  const p2 = (await Product.findOne({ status: "ACTIVE", deletedAt: null }, "name variants").lean()) as unknown as { _id: Types.ObjectId; name: string; variants: { _id: Types.ObjectId; sku: string; label: string }[] };
  const v0 = p2.variants[0];
  let n = 0;
  async function mk(userId: string | null, status: string, pay: string, extra: object = {}) {
    const num = `IKX-991231-${String(95000 + ++n)}`;
    const item = { productId: p2._id, variantId: v0._id, sku: v0.sku, productName: p2.name, variantLabel: v0.label, unitRegularPrice: 100000, unitSalePrice: 80000, quantity: 2, freeQuantity: 0, lineDiscount: 0, lineTotal: 160000, taxAmount: 0 };
    const o = await Order.create({ orderNumber: num, userId: userId ? new Types.ObjectId(userId) : null, status, paymentStatus: pay, items: [item], subtotal: 160000, shippingTotal: 5000, grandTotal: 165000, pricingSnapshot: {}, contact: { name: TAG, phone: "+919000000011" }, shippingAddress: { fullName: TAG, line1: "x", city: "y", state: "z", postalCode: "400001" }, billingAddress: { fullName: TAG }, shippingMethodName: "Standard", idempotencyKey: `${TAG}-${num}`, ...extra } as never);
    if (pay === "CAPTURED") await Payment.create({ orderId: o._id, providerOrderId: `order_${TAG.replace(/\W/g, "")}${n}`, providerPaymentId: `pay_${TAG.replace(/\W/g, "")}${n}`, method: "upi", amount: 165000, status: "CAPTURED" });
    return num;
  }
  const t0 = Date.now();
  const hist = [{ from: null, to: "PENDING", actorType: "CUSTOMER", at: new Date(t0 - 6e5) }, { from: "PENDING", to: "CONFIRMED", actorType: "SYSTEM", at: new Date(t0 - 5e5) }, { from: "CONFIRMED", to: "PROCESSING", actorType: "ADMIN", note: "INTERNAL-SECRET-NOTE", description: "We are preparing your order", at: new Date(t0 - 4e5) }];
  const o1 = await mk(idA, "PROCESSING", "CAPTURED", { statusHistory: hist, shipments: [{ carrier: "BlueDart", trackingNumber: "BD123", trackingUrl: "https://example.com/t/BD123", status: "PENDING" }] });
  await mk(idA, "DELIVERED", "CAPTURED"); const o3 = await mk(idA, "CANCELLED", "CANCELLED"); const oUnpaid = await mk(idA, "PENDING", "CREATED"); const oB = await mk(idB, "CONFIRMED", "CAPTURED"); const oGuest = await mk(null, "CONFIRMED", "CAPTURED");
  const list = await listOrders(idA, {}); assert.equal(list.total, 3); assert(!list.orders.some((o) => o.orderNumber === oUnpaid)); ok("order list contains only my paid/finished orders (abandoned checkouts hidden)");
  assert(!list.orders.some((o) => [oB, oGuest].includes(o.orderNumber))); ok("never lists another customer's or a guest's orders");
  assert.equal((await listOrders(idA, { status: "delivered" })).total, 1); assert.equal((await listOrders(idA, { status: "cancelled" })).total, 1); assert.equal((await listOrders(idA, { status: "active" })).total, 1); ok("status filters work");
  assert.equal((await listOrders(idA, { q: o1 })).total, 1); assert.equal((await listOrders(idA, { q: oB })).total, 0); assert.equal((await listOrders(idA, { q: ".*" })).total, 0); ok("search by order id; regex characters are neutralised; cannot find others' orders");
  assert.equal((await listOrders(idA, { from: "2999-01-01" })).total, 0); assert.equal((await listOrders(idA, { from: "2000-01-01", to: "2999-01-01" })).total, 3); ok("date range filter works");
  assert.equal(await getOrder(idA, oB), null); assert.equal(await getOrder(idA, oGuest), null); assert.equal(await getOrder(idA, oUnpaid), null); assert.equal(await getOrder(idB, o1), null); assert.equal(await getOrder(idA, "not-an-order"), null); ok("IDOR: order detail for someone else's / guest / unpaid / malformed id → not found");
  const d = (await getOrder(idA, o1))!; assert.equal(d.items.length, 1); assert.equal(d.payment.transactionId?.startsWith("pay_"), true); assert.equal(d.shipment?.carrier, "BlueDart"); assert.equal(d.shipment?.estimatedDelivery, null); ok("detail shows items, payment txn id, courier and NO invented ETA");
  assert(!JSON.stringify(d).includes("INTERNAL-SECRET-NOTE")); assert(d.events.some((e) => e.description === "We are preparing your order")); ok("customer sees admin's customer-facing message, never the internal note");
  const states = Object.fromEntries(d.timeline.map((s) => [s.key, s.state])); assert.equal(states.CONFIRMED, "done"); assert.equal(states.PROCESSING, "current"); assert.equal(states.SHIPPED, "upcoming"); ok("timeline: confirmed done, processing current, shipped upcoming");
  const tl = buildTimeline("DELIVERY_FAILED", new Date(), [{ to: "SHIPPED", at: new Date() }, { to: "DELIVERY_FAILED", at: new Date() }]); assert(tl.some((s) => s.key === "DELIVERY_FAILED" && s.state === "current")); ok("delivery-failed shown as a terminal step");
  const st = await dashboardStats(idA); assert.equal(st.total, 3); assert.equal(st.active, 1); assert.equal(st.delivered, 1); assert.equal(st.cancelled, 1); assert(st.recent.length === 3 && st.activities.length > 0); ok("dashboard counts match my orders only");
  const inv = await buildInvoice(idA, o1); assert(inv && inv.length > 1000 && Buffer.from(inv.slice(0, 5)).toString() === "%PDF-"); ok("invoice PDF generated for my paid order");
  assert.equal(await buildInvoice(idB, o1), null); assert.equal(await buildInvoice(idA, o3), null); ok("invoice: not for another customer's order, not for an unpaid/cancelled one");
  const ro = await reorderLines(idA, o1); assert(ro.ok); assert.equal(await reorderLines(idB, o1).then((r) => r.ok), false); ok("reorder works for the owner only");

  console.log("Audit");
  await AuditLog.create({ actorUserId: idA, actorType: "CUSTOMER", action: "test.audit", entityType: "User", entityId: idA }); assert(await AuditLog.countDocuments({ actorUserId: idA, actorType: "CUSTOMER" })); ok("customer audit entries can be recorded");
}

async function cleanup() {
  const users = (await User.find({ mobile: { $in: [A, B, C, "+919000000014"] } }, "_id").lean()).map((u) => u._id);
  const orders = (await Order.find({ "contact.name": TAG }, "_id").lean()).map((o) => o._id);
  await Payment.deleteMany({ orderId: { $in: orders } }); await Order.deleteMany({ _id: { $in: orders } });
  await Address.deleteMany({ userId: { $in: users } }); await Wishlist.deleteMany({ userId: { $in: users } });
  await AuditLog.deleteMany({ actorUserId: { $in: users } });
  await OtpVerification.deleteMany({ destination: { $in: [A, B, C] } });
  await RateLimitBucket.deleteMany({ _id: { $regex: "^(otp-dest:\\+9190000000|otp-ip:203\\.0\\.113\\.77|otp-verify-ip:203\\.0\\.113\\.77)" } });
  await User.deleteMany({ _id: { $in: users } });
}
main().then(() => console.log(`\nALL ${count} CHECKS PASSED`)).catch((e) => { console.error("\nFAILED:", e.stack ?? e.message); process.exitCode = 1; }).finally(async () => { await cleanup().catch((e) => console.error("cleanup", e.message)); await disconnect(); });
