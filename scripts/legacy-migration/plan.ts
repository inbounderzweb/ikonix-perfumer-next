// Pure planner: legacy MySQL rows (+ read-only snapshots of what MongoDB already holds) in, Mongo-ready documents and an
// audit trail out. No I/O and no database writes happen here, so the dry run and the real run share exactly one code path.
import { normalizeMobile } from "../../src/lib/phone";
import { INDIAN_STATES } from "../../src/lib/india";
import type { Row, Tables } from "./sql-parse";

export const SOURCE = "ikonix-mysql-2026-11";

// ── Explicit, auditable exclusions ───────────────────────────────────────────────────────────────────────────────
/** Legacy user ids confirmed as dummy/test by the owner. */
export const EXCLUDED_USER_IDS = new Set([22, 24]);
/** Internal team numbers (10 digit, no country code). TestLogin and staff mobiles from Mongo are added at run time. */
/** Customers whose orders are held in a separate pending-review category until the owner confirms them (not imported). */
export const REVIEW_USER_IDS = new Set([55]);
export const EXCLUDED_PHONES = new Set(["8139886630"]);
const TEAM_RE = /inbounderz/i;
/** Orders at or below this subtotal (paise) are payment-gateway test transactions (the dump contains many ₹1 orders). */
export const TEST_AMOUNT_MAX_PAISE = 100;
const TEST_NAME_RE = /^\s*(test|testing|dummy)\b/i;

// ── Types ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ProductLite = {
  _id: string; slug: string; name: string; legacyId?: string;
  variants: { _id: string; legacyId?: string; sizeValue?: number; sizeUnit?: string; label: string; sku: string }[];
  images: { url: string; sourceUrl?: string; sortOrder?: number }[];
};
export type Ctx = {
  existingUsers: { _id: string; mobile?: string; email?: string; isStaff: boolean }[];
  existingAddresses: { userId: string; line1: string; postalCode: string }[];
  testMobiles: string[];
  products: ProductLite[];
  existingLegacyOrderIds: number[];
  existingLegacyPaymentIds: number[];
  migratedAt: Date;
  /** Actual Razorpay records keyed by payment id (from an export or the API). null = none supplied, so nothing can be verified. */
  razorpay: Map<string, { amountPaise: number; status: string }> | null;
  /** Import the orders held for review (default: keep them out). */
  releaseReview: boolean;
};
type Issue = { table: string; id: number | string; reason: string };

export type CustomerPlan = { legacyUid: number; mobile: string; name?: string; email?: string; matchedExistingId?: string; doc: Record<string, unknown> };
export type AddressPlan = { legacyAid: number; legacyUid: number; doc: Record<string, unknown>; isDefault: boolean };
export type OrderPlan = { legacyOid: number; customerKey: { legacyUid?: number; existingId?: string } | null; guestMatch: boolean; doc: Record<string, unknown>; grandTotal: number };
export type PaymentPlan = { legacyPayId: number; legacyOid: number; doc: Record<string, unknown> };

const paise = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const istDate = (s: string | number | null): Date | null => {
  const t = clean(s);
  if (!t || t.startsWith("0000") || t.startsWith("1970")) return null;
  const d = new Date(`${t.replace(" ", "T")}${t.length <= 10 ? "T00:00:00" : ""}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const legacyOrderNumber = (oid: number) => `IKX-L-${String(oid).padStart(6, "0")}`;

// ── State / country normalisation ────────────────────────────────────────────────────────────────────────────────
const STATE_ALIAS: Record<string, string> = {
  tamilnadu: "Tamil Nadu", andhrapradesh: "Andhra Pradesh", pondy: "Puducherry", pondicherry: "Puducherry", mp: "Madhya Pradesh",
  orissa: "Odisha", uttaranchal: "Uttarakhand", "new delhi": "Delhi", "nct of delhi": "Delhi", bangalore: "Karnataka", bengaluru: "Karnataka",
  "jammu & kashmir": "Jammu and Kashmir", "andaman & nicobar islands": "Andaman and Nicobar Islands",
};
const STATE_BY_KEY = new Map<string, string>([...INDIAN_STATES.map((s) => [s.toLowerCase().replace(/\s+/g, ""), s] as const), ...Object.entries(STATE_ALIAS).map(([k, v]) => [k.replace(/\s+/g, ""), v] as const)]);
export const normalizeState = (s: unknown) => STATE_BY_KEY.get(clean(s).toLowerCase().replace(/\s+/g, "")) ?? null;
export const normalizeCountry = (c: unknown) => (/^ind(ia|ian)?\b/i.test(clean(c)) ? "IN" : null);
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const slugKey = (s: unknown) => clean(s).toLowerCase();
const sizeOf = (name: string) => { const m = /(\d+(?:\.\d+)?)\s*ml\b/i.exec(name); return m ? Number(m[1]) : null; };

/** Order `addr`/`baddr` is flat text: door, house, street…, city, pincode, district, state, country, company, gst. Parsed from the right. */
export function parseAddressText(text: string | null) {
  const raw = String(text ?? "");
  if (/^[,\s]*$/.test(raw)) return { parsed: false as const, blank: true as const };
  const parts = raw.split(",").map((p) => p.trim());
  // The 6-digit PIN is the anchor: city sits before it; district, state, country, company, gst follow it.
  let k = -1; for (let i = parts.length - 1; i >= 2; i--) if (/^\d{6}$/.test(parts[i])) { k = i; break; }
  if (k >= 2) {
    const at = (i: number) => parts[i] || undefined; const country = at(k + 3);
    return { line1: parts.slice(0, k - 1).filter(Boolean).join(", ") || undefined, city: at(k - 1), postalCode: parts[k], district: at(k + 1), state: normalizeState(parts[k + 2]) ?? at(k + 2), country: (country && normalizeCountry(country)) || country, company: at(k + 4), gstin: at(k + 5), parsed: true as const };
  }
  return { line1: raw.replace(/(,\s*)+$/, "") || undefined, parsed: false as const };
}

export const maskPhone = (p?: string) => (p ? `${p.slice(0, 3)}${"•".repeat(Math.max(0, p.length - 5))}${p.slice(-2)}` : "—");
export const maskEmail = (e?: string) => (e ? `${e.slice(0, 1)}•••@${e.split("@")[1] ?? "?"}` : "—");

// ── The plan ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function buildPlan(t: Tables, ctx: Ctx) {
  const skipped: Issue[] = []; const warnings: Issue[] = []; const errors: Issue[] = [];
  const rep = {
    customers: { found: t.users.length, withMobile: 0, newCustomers: 0, matchedExisting: 0, skipped: 0, skippedEmailOnly: 0, skippedExcluded: 0, skippedInvalidMobile: 0, skippedDuplicateMobile: 0, emailDropped: 0, noOrdersNoAddress: 0 },
    addresses: { found: t.address.length, valid: 0, invalid: 0, duplicate: 0, skippedOwnerNotImported: 0, gstinDropped: 0, stateNormalised: 0 },
    orders: { pendingReview: 0, found: t.orders.length, eligibleByRule: 0, importCandidates: 0, excluded: 0, byReason: {} as Record<string, number>, byStatus: {} as Record<string, number>, alreadyImported: 0, delivered: 0, confirmed: 0, paidProcessing: 0, cancelled: 0 },
    payments: { found: t.paylog.length, heldWithReviewOrders: 0, paid: 0, verified: 0, unverified: 0, notFoundAtRazorpay: 0, amountMismatch: 0, statusMismatch: 0, matched: 0, paymentOfExcludedOrder: 0, duplicate: 0, notPaidRows: 0 },
    products: { itemRows: 0, linked: 0, snapshotOnly: 0, legacyIdAgrees: 0, legacyIdDisagrees: 0, imageExact: 0, imageFallback: 0, imageNone: 0, unmatchedReasons: {} as Record<string, number> },
    guests: { guestOrders: 0, matchedToCustomer: 0, remainingGuests: 0 },
    discounts: { freeRows: 0, ordersWithFree: 0, validated: 0, discrepancies: 0, modeBDiffPaise: 0 },
    totals: { reconstructed: 0, grandTotalSumPaise: 0, withoutPaymentAmount: 0, ordersWithZeroOrNegative: 0 },
  };
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

  // Existing Mongo state ----------------------------------------------------------------------------------------
  const existingByMobile = new Map(ctx.existingUsers.filter((u) => u.mobile).map((u) => [u.mobile!, u]));
  const takenEmails = new Set(ctx.existingUsers.filter((u) => u.email).map((u) => u.email!.toLowerCase()));
  const blockedMobiles = new Set([...ctx.testMobiles, ...ctx.existingUsers.filter((u) => u.isStaff && u.mobile).map((u) => u.mobile!)]);
  for (const p of EXCLUDED_PHONES) { const m = normalizeMobile(p); if (m) blockedMobiles.add(m); }

  // Customers ---------------------------------------------------------------------------------------------------
  const legacyUsers = new Map(t.users.map((u) => [u.uid as number, u]));
  const customers = new Map<number, CustomerPlan>(); const seenMobile = new Map<string, number>();
  const excludedUids = new Set<number>(EXCLUDED_USER_IDS);
  for (const u of t.users) {
    const uid = u.uid as number; const phone = clean(u.phone);
    const mobile = phone ? normalizeMobile(phone) : null;
    if (EXCLUDED_USER_IDS.has(uid) || TEAM_RE.test(`${u.uname} ${u.email}`) || (mobile && blockedMobiles.has(mobile))) { excludedUids.add(uid); rep.customers.skipped++; rep.customers.skippedExcluded++; skipped.push({ table: "users", id: uid, reason: "internal/test account" }); continue; }
    if (!phone) { rep.customers.skipped++; rep.customers.skippedEmailOnly++; skipped.push({ table: "users", id: uid, reason: "email-only account (no mobile): skipped in initial migration" }); continue; }
    rep.customers.withMobile++;
    if (!mobile) { rep.customers.skipped++; rep.customers.skippedInvalidMobile++; skipped.push({ table: "users", id: uid, reason: "invalid mobile number" }); continue; }
    if (seenMobile.has(mobile)) { rep.customers.skipped++; rep.customers.skippedDuplicateMobile++; skipped.push({ table: "users", id: uid, reason: `duplicate mobile of legacy user ${seenMobile.get(mobile)}` }); continue; }
    seenMobile.set(mobile, uid);
    const existing = existingByMobile.get(mobile);
    let email = clean(u.email).toLowerCase() || undefined;
    if (email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || takenEmails.has(email))) { warnings.push({ table: "users", id: uid, reason: "email invalid or already used by another account: not imported" }); rep.customers.emailDropped++; email = undefined; }
    if (email) takenEmails.add(email);
    const name = clean(u.uname).slice(0, 80) || undefined;
    const doc = { mobile, ...(name && { name }), ...(email && { email }), status: "ACTIVE", marketingOptIn: false, legacy: { source: SOURCE, customerId: uid, migratedAt: ctx.migratedAt } };
    customers.set(uid, { legacyUid: uid, mobile, name, email, matchedExistingId: existing?._id, doc });
    if (existing) rep.customers.matchedExisting++; else rep.customers.newCustomers++;
  }

  // Addresses ---------------------------------------------------------------------------------------------------
  const addresses: AddressPlan[] = []; const seenAddr = new Set<string>();
  const existingAddrKeys = new Set(ctx.existingAddresses.map((a) => `${a.userId}|${slugKey(a.line1)}|${a.postalCode}`));
  const ADDR_TYPE: Record<string, string> = { home: "HOME", residence: "HOME", recidence: "HOME", work: "WORK", office: "WORK" };
  for (const a of t.address) {
    const aid = a.aid as number; const uid = a.fkuid as number; const c = customers.get(uid);
    if (!c) { rep.addresses.skippedOwnerNotImported++; skipped.push({ table: "address", id: aid, reason: legacyUsers.has(uid) ? "owner not imported (excluded/skipped)" : "owner user missing in dump" }); continue; }
    const line1 = [a.doorno, a.house, a.street].map(clean).filter(Boolean).join(", ");
    const state = normalizeState(a.state); const country = normalizeCountry(a.country); const postal = clean(a.pincode); const city = clean(a.city);
    const why = !line1 ? "no street/door/house" : !city ? "no city" : !state ? `unrecognised state "${clean(a.state)}"` : !country ? `non-India country "${clean(a.country)}"` : !/^[1-9]\d{5}$/.test(postal) ? `invalid PIN "${postal}"` : !c.name ? "owner has no name" : null;
    if (why) { rep.addresses.invalid++; skipped.push({ table: "address", id: aid, reason: why }); continue; }
    if (clean(a.state) !== state) rep.addresses.stateNormalised++;
    const key = `${c.legacyUid}|${slugKey(line1)}|${postal}`; const exKey = `${c.matchedExistingId}|${slugKey(line1)}|${postal}`;
    if (seenAddr.has(key) || (c.matchedExistingId && existingAddrKeys.has(exKey))) { rep.addresses.duplicate++; skipped.push({ table: "address", id: aid, reason: "duplicate of another address of the same customer" }); continue; }
    seenAddr.add(key);
    let gstin = clean(a.gst).toUpperCase() || undefined;
    if (gstin && !GSTIN_RE.test(gstin)) { rep.addresses.gstinDropped++; warnings.push({ table: "address", id: aid, reason: `GSTIN "${gstin}" is not a valid GSTIN: address kept without it` }); gstin = undefined; }
    const type = ADDR_TYPE[clean(a.atype).toLowerCase()] ?? "OTHER";
    rep.addresses.valid++;
    addresses.push({ legacyAid: aid, legacyUid: uid, isDefault: a.deflt === 1, doc: { type, fullName: c.name, phone: c.mobile, line1, city, district: clean(a.district) || undefined, state, postalCode: postal, country, company: clean(a.company) || undefined, gstin, legacy: { source: SOURCE, addressId: aid, migratedAt: ctx.migratedAt } } });
  }

  // Payments (index) --------------------------------------------------------------------------------------------
  const paylogByOrder = new Map<number, Row[]>();
  for (const p of t.paylog) (paylogByOrder.get(p.fkoid as number) ?? paylogByOrder.set(p.fkoid as number, []).get(p.fkoid as number)!).push(p);
  const paidPay = (oid: number) => (paylogByOrder.get(oid) ?? []).filter((p) => p.paystatus === 1);
  rep.payments.paid = t.paylog.filter((p) => p.paystatus === 1).length;
  rep.payments.notPaidRows = t.paylog.length - rep.payments.paid;
  const rzSeen = new Set<string>();
  for (const p of t.paylog.filter((x) => x.paystatus === 1)) { const id = String(p.razid); if (rzSeen.has(id)) { rep.payments.duplicate++; errors.push({ table: "paylog", id: p.payid as number, reason: `duplicate Razorpay payment id ${id}` }); } rzSeen.add(id); }

  // Products ----------------------------------------------------------------------------------------------------
  const bySlug = new Map(ctx.products.map((p) => [p.slug, p]));
  const legacyVariant = new Map(t.variants.map((v) => [v.vid as number, v]));
  const legacyProduct = new Map(t.products.map((p) => [p.pid as number, p]));
  const itemsByOrder = new Map<number, Row[]>();
  for (const i of t.orditems) (itemsByOrder.get(i.fkoid as number) ?? itemsByOrder.set(i.fkoid as number, []).get(i.fkoid as number)!).push(i);
  const isFreeRow = (i: Row) => Number(i.otprice) === 0 && Number(i.otdiscount) > 0;

  // Orders ------------------------------------------------------------------------------------------------------
  const importedPhones = new Map([...customers.values()].map((c) => [c.mobile, c]));
  const reviewMobiles = new Set([...REVIEW_USER_IDS].map((id) => normalizeMobile(clean(legacyUsers.get(id)?.phone))).filter((m): m is string => !!m));
  const pendingReview: Issue[] = [];
  const orders: OrderPlan[] = []; const payments: PaymentPlan[] = []; const excludedOrders: Issue[] = [];
  const already = new Set(ctx.existingLegacyOrderIds); const alreadyPay = new Set(ctx.existingLegacyPaymentIds);
  const sample: { order: unknown; customer: unknown }[] = [];
  const exclude = (oid: number, reason: string) => { rep.orders.excluded++; bump(rep.orders.byReason, reason); excludedOrders.push({ table: "orders", id: oid, reason }); };

  for (const o of t.orders) {
    const oid = o.oid as number; const status = o.ostatus as number; const pays = paidPay(oid); const rows = itemsByOrder.get(oid) ?? [];
    const eligible = pays.length > 0 || status === 2 || status === 4;
    if (!eligible) { exclude(oid, status === 3 ? "cancelled, never paid" : "unpaid / abandoned checkout"); continue; }
    rep.orders.eligibleByRule++;
    const uid = o.fkuid as number; const guest = uid === 0; const u = guest ? null : legacyUsers.get(uid);
    if (excludedUids.has(uid)) { exclude(oid, "internal/test account (user)"); continue; }
    if (!guest && !u) { exclude(oid, "customer missing in legacy users table"); errors.push({ table: "orders", id: oid, reason: `eligible but user ${uid} does not exist in dump: no contact details, cannot import` }); continue; }
    const contactName = clean(guest ? o.gname : u!.uname); const contactEmail = clean(guest ? o.gemail : u!.email).toLowerCase() || undefined;
    const mobile = normalizeMobile(clean(guest ? o.gphone : u!.phone));
    if (TEAM_RE.test(`${contactName} ${contactEmail ?? ""}`) || TEST_NAME_RE.test(contactName) || (mobile && blockedMobiles.has(mobile))) { exclude(oid, "internal/test account (contact)"); continue; }
    if (!mobile) { exclude(oid, "no valid mobile number on order"); errors.push({ table: "orders", id: oid, reason: "eligible but no valid mobile number" }); continue; }
    if (!contactName) { exclude(oid, "no customer name"); errors.push({ table: "orders", id: oid, reason: "eligible but no customer name" }); continue; }
    if (!rows.length) { exclude(oid, "no order items"); errors.push({ table: "orders", id: oid, reason: "no items" }); continue; }
    if (!ctx.releaseReview && (REVIEW_USER_IDS.has(uid) || reviewMobiles.has(mobile))) { rep.orders.pendingReview++; rep.payments.heldWithReviewOrders += pays.length; pendingReview.push({ table: "orders", id: oid, reason: "held for owner review (same customer/phone as a flagged account): not imported" }); continue; }

    // Items: paid rows + free rows (price 0, otdiscount = value of the free unit)
    type Item = Record<string, unknown> & { legacy: { rowIds: number[]; freeRowIds: number[]; imageFile?: string }; _key: number };
    const items: Item[] = []; const freeRows: Row[] = [];
    for (const r of rows) {
      rep.products.itemRows++;
      if (isFreeRow(r)) { freeRows.push(r); continue; }
      if (Number(r.otprice) === 0) warnings.push({ table: "orditems", id: r.otid as number, reason: "zero price without discount info" });
      const lv = legacyVariant.get(r.fkvid as number); const lp = lv ? legacyProduct.get(lv.fkpid as number) : undefined;
      const name = clean(r.otname).replace(/\s*-\s*[\d.]+\s*ml\s*$/i, "") || clean(lp?.pname) || "Unknown product";
      const size = sizeOf(clean(r.otname)) ?? (lv ? Number(lv.value) : null);
      const slug = clean(r.otslug) || clean(lp?.pslug);
      const prod = bySlug.get(slug); const variant = prod && size != null ? prod.variants.find((v) => v.sizeValue === size && (v.sizeUnit ?? "ml") === "ml") : undefined;
      let linked = false;
      // Identity: slug + size + the product name recorded on the order line. Legacy variant ids are NOT used to link: in the dump
      // itself, 22 order lines carry an fkvid that now belongs to a different product (ids were re-keyed after the orders).
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (prod && variant) {
        const sameName = norm(name) === norm(prod.name);
        const slugReused = lp?.delstatus === 1 && clean(lp?.pslug) === slug; // the product that was sold is the deleted one: the live product with this slug is a different record
        if (variant.legacyId === String(r.fkvid)) rep.products.legacyIdAgrees++; else rep.products.legacyIdDisagrees++;
        if (sameName && !slugReused) linked = true;
        else { const why = !sameName ? "product name on the order differs from the catalogue product" : "legacy product was deleted and its slug now belongs to a different product"; warnings.push({ table: "orditems", id: r.otid as number, reason: `slug+size matched a current product but ${why}: kept snapshot-only, not linked` }); bump(rep.products.unmatchedReasons, `slug+size matched but ${why}`); }
      } else bump(rep.products.unmatchedReasons, !slug ? "no slug on item" : !prod ? "product slug not in current catalogue (deleted on the old site)" : "size not in current catalogue");
      const price = paise(r.otprice); const qty = Number(r.qty);
      const file = clean(r.otimg); const imgs = prod?.images ?? [];
      const exact = linked && file ? imgs.find((im) => im.sourceUrl?.endsWith(`/${file}`)) : undefined;
      const fallback = linked ? [...imgs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] : undefined;
      if (linked) { rep.products.linked++; if (exact) rep.products.imageExact++; else if (fallback) rep.products.imageFallback++; else rep.products.imageNone++; } else { rep.products.snapshotOnly++; rep.products.imageNone++; }
      const base: Item = {
        ...(linked && { productId: prod!._id, variantId: variant!._id }), snapshotOnly: !linked,
        sku: linked ? variant!.sku : `LEGACY-${r.fkvid}`, productName: name, variantLabel: size != null ? `${size} ml` : clean(lv?.value ? `${lv.value} ml` : "—"),
        imageUrl: (exact ?? fallback)?.url, unitRegularPrice: price, unitSalePrice: price, quantity: qty, freeQuantity: 0, lineDiscount: 0, lineTotal: price * qty, taxAmount: 0,
        offer: null, legacy: { rowIds: [r.otid as number], freeRowIds: [], ...(file && { imageFile: file }) }, _key: r.fkvid as number,
      };
      items.push(base);
    }
    let modeBDiff = 0; let discOk = true;
    for (const f of freeRows) {
      rep.discounts.freeRows++;
      const qty = Number(f.qty); const value = paise(f.otdiscount);
      const target = items.find((i) => i._key === f.fkvid);
      if (target) {
        const unit = target.unitSalePrice as number;
        if (value === unit * qty) rep.discounts.validated++; else { rep.discounts.discrepancies++; discOk = false; warnings.push({ table: "orditems", id: f.otid as number, reason: `free row value ${value / 100} != unit price ${unit / 100} x ${qty}` }); }
        target.freeQuantity = (target.freeQuantity as number) + qty; target.legacy.freeRowIds.push(f.otid as number);
        target.offer = { legacy: true, note: clean(f.otnote), freeUnits: ((target.offer as { freeUnits?: number } | null)?.freeUnits ?? 0) + qty, savedPaise: ((target.offer as { savedPaise?: number } | null)?.savedPaise ?? 0) + value };
      } else {
        // The free unit is a variant not bought at a price in this order: keep it as its own zero-priced line.
        const lv = legacyVariant.get(f.fkvid as number); const lp = lv ? legacyProduct.get(lv.fkpid as number) : undefined;
        rep.discounts.discrepancies++; discOk = false; warnings.push({ table: "orditems", id: f.otid as number, reason: "free row has no matching paid row in the same order: kept as its own line" });
        items.push({ snapshotOnly: true, sku: `LEGACY-${f.fkvid}`, productName: clean(lp?.pname) || "Free item", variantLabel: lv ? `${lv.value} ml` : "—", unitRegularPrice: Math.round(value / Math.max(qty, 1)), unitSalePrice: Math.round(value / Math.max(qty, 1)), quantity: 0, freeQuantity: qty, lineDiscount: 0, lineTotal: 0, taxAmount: 0, offer: { legacy: true, note: clean(f.otnote), freeUnits: qty, savedPaise: value }, legacy: { rowIds: [], freeRowIds: [f.otid as number] }, _key: f.fkvid as number });
      }
      modeBDiff += value;
    }
    if (freeRows.length) { rep.discounts.ordersWithFree++; rep.discounts.modeBDiffPaise += modeBDiff; }
    void discOk;

    // Totals (rupees -> paise). Free rows are priced 0, so the customer-paid subtotal is the sum of paid rows only.
    const subtotal = items.reduce((a, i) => a + (i.lineTotal as number), 0);
    const shipping = paise(o.dcharge);
    const grandTotal = subtotal + shipping;
    if (subtotal <= TEST_AMOUNT_MAX_PAISE) { exclude(oid, "test transaction (subtotal ≤ ₹1)"); continue; }
    if (already.has(oid)) rep.orders.alreadyImported++;

    // Customer link: legacy account, else guest phone match against an imported/existing customer (exact normalised mobile only).
    let customerKey: OrderPlan["customerKey"] = null; let guestMatch = false;
    if (!guest) { const c = customers.get(uid); customerKey = c ? (c.matchedExistingId ? { existingId: c.matchedExistingId } : { legacyUid: uid }) : null; if (!c) warnings.push({ table: "orders", id: oid, reason: `user ${uid} not imported (skipped): order kept as guest order` }); }
    else {
      rep.guests.guestOrders++;
      const c = importedPhones.get(mobile); const ex = existingByMobile.get(mobile);
      if (c) { customerKey = c.matchedExistingId ? { existingId: c.matchedExistingId } : { legacyUid: c.legacyUid }; guestMatch = true; }
      else if (ex && !ex.isStaff) { customerKey = { existingId: ex._id }; guestMatch = true; }
      if (guestMatch) rep.guests.matchedToCustomer++; else rep.guests.remainingGuests++;
    }

    const placedAt = istDate(o.odt)!; const shippedAt = istDate(o.ddt); const deliveredAt = istDate(o.deldt);
    const mapped = status === 4 ? "DELIVERED" : status === 3 ? "CANCELLED" : status === 2 ? "CONFIRMED" : "PROCESSING";
    const paymentStatus = pays.length ? "CAPTURED" : "PENDING";
    if (!pays.length) warnings.push({ table: "orders", id: oid, reason: "delivered but no successful payment record in paylog: payment status left PENDING, no Payment document created" });
    bump(rep.orders.byStatus, mapped);
    if (status === 4) rep.orders.delivered++; else if (status === 2) rep.orders.confirmed++; else if (status === 3) rep.orders.cancelled++; else rep.orders.paidProcessing++;

    const pay0 = pays[0]; const rz = pay0 ? ctx.razorpay?.get(String(pay0.razid)) : undefined;
    const pv = !pay0 ? { status: "NO_PAYMENT_RECORD" } : !ctx.razorpay ? { status: "UNVERIFIED" } : !rz ? { status: "NOT_FOUND" } : rz.status !== "captured" ? { status: "STATUS_MISMATCH" } : rz.amountPaise !== grandTotal ? { status: "AMOUNT_MISMATCH" } : { status: "VERIFIED" };
    const ship = parseAddressText(o.addr as string); const bill = parseAddressText(o.baddr as string);
    if ("blank" in ship) warnings.push({ table: "orders", id: oid, reason: "legacy order stored no shipping address (blank text, address row gone): shipping address left empty, nothing invented" });
    else if (!ship.parsed) warnings.push({ table: "orders", id: oid, reason: "shipping address text could not be split into fields: stored whole in line1" });
    const snap = (p: ReturnType<typeof parseAddressText>) => ({ fullName: contactName, phone: mobile, line1: "line1" in p ? p.line1 : undefined, city: "city" in p ? p.city : undefined, district: "district" in p ? p.district : undefined, state: "state" in p ? p.state : undefined, postalCode: "postalCode" in p ? p.postalCode : undefined, country: "country" in p ? p.country : undefined, company: "company" in p ? p.company : undefined });
    const courier = clean(o.courier);
    const orderDoc = {
      orderNumber: legacyOrderNumber(oid), status: mapped, paymentStatus, currency: "INR",
      items: items.map(({ _key, ...rest }) => { void _key; return rest; }), subtotal, discountTotal: 0, shippingTotal: shipping, packingTotal: 0, taxTotal: 0, grandTotal,
      pricingSnapshot: { legacy: true, source: SOURCE, reconstructed: true, formula: "sum(qty*price of paid rows) + delivery charge; free rows priced 0", freeRowValuePaise: modeBDiff },
      contact: { name: contactName, ...(contactEmail && { email: contactEmail }), phone: mobile },
      shippingAddress: snap(ship), billingAddress: snap(bill), shippingMethodId: null, shippingMethodName: clean(o.odmthd).replace(/^\s*\|\s*-\s*Days$/, "") || "Delivery (legacy order)",
      idempotencyKey: `legacy-${SOURCE}-${oid}`, statusHistory: [],
      shipments: courier ? [{ carrier: courier, trackingNumber: clean(o.trackno) || undefined, status: status === 4 ? "DELIVERED" : "SHIPPED", shippedAt: shippedAt ?? undefined, deliveredAt: deliveredAt ?? undefined }] : [],
      placedAt, ...(status === 4 && deliveredAt && { deliveredAt }), ...(status === 3 && { cancelReason: clean(o.reason) || undefined }),
      legacy: { source: SOURCE, orderId: oid, orderNumber: legacyOrderNumber(oid), paymentVerification: pv.status, paymentUnverified: pv.status !== "VERIFIED", originalStatus: status, originalDeliveryStatus: o.delstatus, customerId: uid, guest, reason: clean(o.reason) || undefined, shippingAddressText: clean(o.addr), billingAddressText: clean(o.baddr), deliveryMethodText: clean(o.odmthd), deliveryCharge: clean(o.dcharge), dispatchDate: o.ddt, deliveredDateRaw: o.deldt, paymentIds: pays.map((p) => p.payid), migratedAt: ctx.migratedAt },
    };
    orders.push({ legacyOid: oid, customerKey, guestMatch, doc: orderDoc, grandTotal });
    rep.totals.reconstructed++; rep.totals.grandTotalSumPaise += grandTotal;
    if (grandTotal <= 0) rep.totals.ordersWithZeroOrNegative++;

    if (!pay0) { errors.push({ table: "orders", id: oid, reason: "payment unverified: delivered order with no payment record (kept, flagged)" }); }
    for (const p of pays) {
      if (alreadyPay.has(p.payid as number)) continue;
      const actual = ctx.razorpay?.get(String(p.razid));
      const st = !ctx.razorpay ? "UNVERIFIED" : !actual ? "NOT_FOUND" : actual.status !== "captured" ? "STATUS_MISMATCH" : actual.amountPaise !== grandTotal ? "AMOUNT_MISMATCH" : "VERIFIED";
      if (st === "VERIFIED") rep.payments.verified++; else if (st === "UNVERIFIED") rep.payments.unverified++; else if (st === "NOT_FOUND") rep.payments.notFoundAtRazorpay++; else if (st === "AMOUNT_MISMATCH") rep.payments.amountMismatch++; else rep.payments.statusMismatch++;
      if (st !== "VERIFIED" && st !== "UNVERIFIED") errors.push({ table: "paylog", id: p.payid as number, reason: `${st}: ${p.razid}${actual ? ` razorpay ₹${actual.amountPaise / 100} (${actual.status}) vs order total ₹${grandTotal / 100}` : ""}` });
      const amountVerified = !!actual && actual.status === "captured";
      payments.push({ legacyPayId: p.payid as number, legacyOid: oid, doc: { provider: "RAZORPAY", providerOrderId: `legacy-order-${oid}`, providerPaymentId: String(p.razid), amount: amountVerified ? actual!.amountPaise : grandTotal, currency: "INR", status: "CAPTURED", capturedAt: istDate(p.paydt) ?? undefined, legacy: { source: SOURCE, paymentId: p.payid, verification: st, amountVerified, amountSource: amountVerified ? "razorpay" : "UNVERIFIED: reconstructed from the order, not an actual captured amount (legacy paylog stores none)", reconstructedAmount: grandTotal, migratedAt: ctx.migratedAt } } });
    }
    if (sample.length < 3 && items.length > 1) sample.push({ order: maskOrder(orderDoc), customer: customerKey && "legacyUid" in customerKey ? maskCustomer(customers.get(customerKey.legacyUid!)?.doc) : { matchedExisting: !!customerKey } });
  }
  rep.orders.importCandidates = orders.length;
  rep.payments.matched = payments.length;
  rep.payments.paymentOfExcludedOrder = rep.payments.paid - payments.length - rep.payments.heldWithReviewOrders; // belong to excluded test/invalid orders: not imported
  const referenced = new Set(orders.map((o) => (o.customerKey && "legacyUid" in o.customerKey ? o.customerKey.legacyUid : undefined)));
  const addrOwners = new Set(addresses.map((a) => a.legacyUid));
  for (const c of customers.values()) if (!referenced.has(c.legacyUid) && !addrOwners.has(c.legacyUid)) rep.customers.noOrdersNoAddress++;
  return { customers: [...customers.values()], addresses, orders, payments, report: rep, skipped, warnings, errors, excludedOrders, pendingReview, sample };
}

function maskOrder(d: Record<string, unknown>) {
  const c = d.contact as { name: string; email?: string; phone: string }; const sa = d.shippingAddress as Record<string, unknown>;
  return { ...d, contact: { name: c.name.slice(0, 1) + "•••", email: maskEmail(c.email), phone: maskPhone(c.phone) }, shippingAddress: { ...sa, fullName: "•••", phone: maskPhone(c.phone), line1: "•••" }, billingAddress: "(masked)", legacy: { ...(d.legacy as object), shippingAddressText: "(masked)", billingAddressText: "(masked)" } };
}
function maskCustomer(d: Record<string, unknown> | undefined) {
  return d ? { ...d, mobile: maskPhone(d.mobile as string), name: String(d.name ?? "").slice(0, 1) + "•••", email: maskEmail(d.email as string | undefined) } : null;
}
