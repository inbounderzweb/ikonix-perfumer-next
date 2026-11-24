import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Promotion, PromotionRedemption } from "@/server/models";
import { bxgyPool, bxgyPrice, offerLabel, pickOffer, type BxgyRule, type OfferCandidate, type PricingBasis } from "@/lib/bxgy";

/** What is stored on an order line (and shown to the customer). Frozen at purchase time. */
export type OfferSnapshot = {
  offerId: string; name: string; buy: number; free: number; pricingBasis: PricingBasis; minQuantity: number; stackable: boolean;
  cycles: number; totalQuantity: number; paidQuantity: number; freeQuantity: number;
  unitSalePrice: number; unitMrp: number; savedAmount: number; label: string;
  chargedUnitPrice?: number; // what a paid unit actually cost on this order (differs from unitSalePrice when the offer is priced at MRP)
  pooled?: boolean; poolSize?: string; groupQuantity?: number; groupFree?: number; // set when units of the same size from several products were counted together
};
export type LineOffer = { paid: number; free: number; unit: number; payable: number; snapshot: OfferSnapshot; hintUnits: number | null; pooled: boolean };
type Cand = OfferCandidate & { name: string; basis: PricingBasis; stackable: boolean; pool: boolean; poolAny: boolean; groupMin: number; usageLimitTotal?: number | null };

/** Live automatic BXGY offers for these variants (date window, status, redemption caps and the customer's own cap applied). */
async function loadCandidates(variantIds: string[], userId: string | null, now = new Date()): Promise<Map<string, Cand[]>> {
  await db();
  const ids = variantIds.map((v) => new Types.ObjectId(v));
  type P = { _id: Types.ObjectId; name: string; priority: number; createdAt: Date; pricingBasis?: PricingBasis; minQuantity?: number; stackable?: boolean; poolAcrossProducts?: boolean; poolMode?: "NONE" | "SAME_SIZE" | "ANY"; usageLimitTotal?: number | null; usageLimitPerCustomer?: number | null; usageCount: number; variantRules: { variantId: Types.ObjectId; buy: number; free: number }[] };
  const promos = (await Promotion.find({
    type: "BUY_X_GET_Y", trigger: "AUTOMATIC", status: "ACTIVE", deletedAt: null, "variantRules.variantId": { $in: ids },
    $and: [{ $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }] }],
  }).lean()) as unknown as P[];

  let used = new Map<string, number>();
  if (userId && promos.some((p) => p.usageLimitPerCustomer != null)) {
    const rows = await PromotionRedemption.aggregate([{ $match: { userId: new Types.ObjectId(userId), promotionId: { $in: promos.map((p) => p._id) } } }, { $group: { _id: "$promotionId", n: { $sum: 1 } } }]);
    used = new Map(rows.map((r) => [String(r._id), r.n as number]));
  }
  const out = new Map<string, Cand[]>();
  for (const p of promos) {
    if (p.usageLimitTotal != null && p.usageCount >= p.usageLimitTotal) continue;
    if (p.usageLimitPerCustomer != null && (used.get(String(p._id)) ?? 0) >= p.usageLimitPerCustomer) continue;
    for (const r of p.variantRules) {
      const k = String(r.variantId);
      if (!variantIds.includes(k)) continue;
      const c: Cand = { id: String(p._id), name: p.name, priority: p.priority ?? 0, createdAt: new Date(p.createdAt).getTime(), rule: { buy: r.buy, free: r.free }, minQuantity: (p.poolMode ?? (p.poolAcrossProducts ? "SAME_SIZE" : "NONE")) !== "NONE" ? 0 : (p.minQuantity ?? 0), groupMin: p.minQuantity ?? 0, pool: (p.poolMode ?? (p.poolAcrossProducts ? "SAME_SIZE" : "NONE")) !== "NONE", poolAny: p.poolMode === "ANY", basis: p.pricingBasis ?? "SELLING", stackable: !!p.stackable, usageLimitTotal: p.usageLimitTotal };
      out.set(k, [...(out.get(k) ?? []), c]);
    }
  }
  return out;
}

/**
 * Applies variant-level offers. Each line is evaluated alone (no cross-variant pooling).
 * `total` is the quantity in the cart; the result splits it into paid and free units.
 */
export async function evaluateOffers(lines: { variantId: string; label: string; total: number; sale: number; mrp: number }[], userId: string | null): Promise<Map<string, LineOffer>> {
  const result = new Map<string, LineOffer>();
  if (!lines.length) return result;
  const cands = await loadCandidates(lines.map((l) => l.variantId), userId);
  const pools = new Map<string, { win: Cand; label: string; lines: typeof lines }>();
  for (const l of lines) {
    const win = pickOffer(cands.get(l.variantId) ?? [], l.total) as Cand | null;
    if (!win) continue;
    if (win.pool) {
      // Same offer + same rule = one pool; SAME_SIZE additionally splits by size, ANY pools every variant of the offer.
      const scope = win.poolAny ? "*" : l.label;
      const key = `${win.id}|${scope}|${win.rule.buy}|${win.rule.free}`;
      const g = pools.get(key) ?? { win, label: win.poolAny ? "item" : l.label, lines: [] };
      g.lines.push(l); pools.set(key, g);
      continue;
    }
    const p = bxgyPrice(l.total, win.rule as BxgyRule, { sale: l.sale, mrp: l.mrp }, win.basis, win.minQuantity ?? 0);
    // Always return the matched offer, even with 0 free units, so the UI can nudge ("add 1 more to get 1 free").
    result.set(l.variantId, {
      paid: p.paid, free: p.free, unit: p.unit, payable: p.payable, hintUnits: p.hintUnits, pooled: false,
      snapshot: { offerId: win.id, name: win.name, buy: win.rule.buy, free: win.rule.free, pricingBasis: win.basis, minQuantity: win.minQuantity ?? 0, stackable: win.stackable, cycles: p.cycles, totalQuantity: p.total, paidQuantity: p.paid, freeQuantity: p.free, unitSalePrice: l.sale, unitMrp: l.mrp, savedAmount: p.savings, label: offerLabel(win.rule), chargedUnitPrice: p.unit },
    });
  }
  for (const g of pools.values()) {
    const r = bxgyPool(g.lines.map((l) => ({ id: l.variantId, total: l.total, sale: l.sale, mrp: l.mrp })), g.win.rule, g.win.basis, g.win.groupMin);
    for (const l of g.lines) {
      const x = r.lines.get(l.variantId)!;
      result.set(l.variantId, {
        paid: x.paid, free: x.free, unit: x.unit, payable: x.payable, hintUnits: r.group.hintUnits, pooled: true,
        snapshot: { offerId: g.win.id, name: g.win.name, buy: g.win.rule.buy, free: g.win.rule.free, pricingBasis: g.win.basis, minQuantity: g.win.groupMin, stackable: g.win.stackable, cycles: r.group.cycles, totalQuantity: l.total, paidQuantity: x.paid, freeQuantity: x.free, unitSalePrice: l.sale, unitMrp: l.mrp, savedAmount: x.savings, label: offerLabel(g.win.rule), chargedUnitPrice: x.unit, pooled: true, poolSize: g.label, groupQuantity: r.group.total, groupFree: r.group.free },
      });
    }
  }
  return result;
}

/** Atomically takes one redemption per applied offer (respecting the total cap). All-or-nothing. */
export async function claimOffers(offerIds: string[]): Promise<{ ok: true; claimed: string[] } | { ok: false }> {
  const claimed: string[] = [];
  for (const id of [...new Set(offerIds)]) {
    const r = await Promotion.updateOne(
      { _id: id, status: "ACTIVE", deletedAt: null, $or: [{ usageLimitTotal: null }, { usageLimitTotal: { $exists: false } }, { $expr: { $lt: ["$usageCount", "$usageLimitTotal"] } }] },
      { $inc: { usageCount: 1 } },
    );
    if (!r.modifiedCount) { await unclaimOffers(claimed); return { ok: false }; }
    claimed.push(id);
  }
  return { ok: true, claimed };
}
export async function unclaimOffers(ids: string[]) {
  for (const id of ids) await Promotion.updateOne({ _id: id, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
}

/** Records who used which offer on which order (powers the per-customer cap). */
export async function recordRedemptions(orderId: Types.ObjectId, userId: string | null, items: { offer?: OfferSnapshot | null }[]) {
  const byOffer = new Map<string, number>();
  for (const it of items) if (it.offer && it.offer.freeQuantity > 0) byOffer.set(it.offer.offerId, (byOffer.get(it.offer.offerId) ?? 0) + it.offer.savedAmount);
  for (const [promotionId, discountAmount] of byOffer) await PromotionRedemption.create({ promotionId, orderId, userId: userId ? new Types.ObjectId(userId) : null, discountAmount });
}

/** Cancelled / failed orders give their redemption back. Idempotent: the redemption row is the token. */
export async function releaseRedemptions(orderId: Types.ObjectId | string) {
  await db();
  const rows = (await PromotionRedemption.find({ orderId }).lean()) as unknown as { _id: Types.ObjectId; promotionId: Types.ObjectId }[];
  for (const r of rows) {
    const del = await PromotionRedemption.deleteOne({ _id: r._id });
    if (del.deletedCount) await Promotion.updateOne({ _id: r.promotionId, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
  }
}
