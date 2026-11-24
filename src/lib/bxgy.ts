// Variant-level Buy X Get Y: pure, dependency-free calculation shared by the server pricing engine, the admin preview and the tests.
// Money is integer paise. `total` is the quantity the customer put in the cart; free units are carved out of it:
//   cycles = floor(total / (X + Y)),  free = cycles * Y,  paid = total - free.
// `pricingBasis` is an explicit, admin-chosen rule for the price of the PAID units while the offer is earning free units:
//   SELLING (default) = the current selling price;  MRP = the original/list price.
// It is only used when the offer actually applies (free > 0); otherwise the customer simply pays the selling price.
// The same basis values the free units for the savings figure.

export type PricingBasis = "SELLING" | "MRP";
export type BxgyRule = { buy: number; free: number };
export type BxgyLine = { total: number; paid: number; free: number; cycles: number; hintUnits: number | null };

export const isValidRule = (r: BxgyRule) => Number.isInteger(r.buy) && Number.isInteger(r.free) && r.buy >= 1 && r.free >= 1 && r.buy <= 99 && r.free <= 99;

export function bxgyQuantities(total: number, rule: BxgyRule, minQuantity = 0): BxgyLine {
  const t = Math.max(0, Math.floor(total));
  if (!isValidRule(rule) || t < Math.max(1, minQuantity)) return { total: t, paid: t, free: 0, cycles: 0, hintUnits: null };
  const group = rule.buy + rule.free;
  const cycles = Math.floor(t / group);
  const free = cycles * rule.free;
  const remaining = group - (t % group);
  // "Add N more" nudge only when the customer is exactly one unit short of the next free unit(s).
  return { total: t, paid: t - free, free, cycles, hintUnits: remaining === 1 ? 1 : null };
}

export type BxgyPrice = BxgyLine & { unit: number; payable: number; savings: number };

/** Unit price charged for paid units. MRP is only used while the offer applies, and never below the selling price. */
export const chargedUnit = (basis: PricingBasis, price: { sale: number; mrp: number }, offerApplies: boolean) => (basis === "MRP" && offerApplies ? Math.max(price.mrp, price.sale) : price.sale);

export function bxgyPrice(total: number, rule: BxgyRule, price: { sale: number; mrp: number }, basis: PricingBasis = "SELLING", minQuantity = 0): BxgyPrice {
  const q = bxgyQuantities(total, rule, minQuantity);
  const unit = chargedUnit(basis, price, q.free > 0);
  const worth = basis === "MRP" ? Math.max(price.mrp, price.sale) : price.sale;
  return { ...q, unit, payable: q.paid * unit, savings: q.free * worth };
}

export type OfferCandidate = { id: string; priority: number; createdAt: number; rule: BxgyRule; minQuantity?: number };

/** Deterministic winner when several offers target one variant: priority, then best free-ratio, then oldest, then id. */
export function pickOffer<T extends OfferCandidate>(list: T[], total: number): T | null {
  const eligible = list.filter((o) => isValidRule(o.rule) && total >= Math.max(1, o.minQuantity ?? 0));
  if (!eligible.length) return null;
  const ratio = (o: T) => o.rule.free / (o.rule.buy + o.rule.free);
  return [...eligible].sort((a, b) => b.priority - a.priority || ratio(b) - ratio(a) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0];
}

export const offerLabel = (r: BxgyRule) => `Buy ${r.buy} Get ${r.free} Free`;

export type PoolLine = { id: string; total: number; sale: number; mrp: number };
export type PoolResult = { group: BxgyLine; lines: Map<string, { paid: number; free: number; unit: number; payable: number; savings: number }> };

/**
 * Cross-product pooling (opt-in per offer): units of one pool (same offer + same size) are counted together, and the free
 * units are taken from the cheapest lines first so the store never gives away more value than the rule implies.
 */
export function bxgyPool(lines: PoolLine[], rule: BxgyRule, basis: PricingBasis = "SELLING", minQuantity = 0): PoolResult {
  const group = bxgyQuantities(lines.reduce((a, l) => a + l.total, 0), rule, minQuantity);
  let left = group.free;
  const out = new Map<string, { paid: number; free: number; unit: number; payable: number; savings: number }>();
  for (const l of [...lines].sort((a, b) => a.sale - b.sale || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const free = Math.min(left, l.total);
    left -= free;
    const worth = basis === "MRP" ? Math.max(l.mrp, l.sale) : l.sale;
    const unit = chargedUnit(basis, l, group.free > 0); // once the pool earns free units, every paid unit in it is charged on the offer basis
    out.set(l.id, { paid: l.total - free, free, unit, payable: (l.total - free) * unit, savings: free * worth });
  }
  return { group, lines: out };
}
