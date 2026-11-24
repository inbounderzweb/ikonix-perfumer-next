import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { db } from "@/server/db";
import { Inventory, Product, ShippingMethod } from "@/server/models";
import { evaluateOffers, type OfferSnapshot } from "./offers";

export const cartLines = z.array(z.object({ variantId: z.string().regex(/^[a-f0-9]{24}$/), qty: z.number().int().min(1).max(99) })).min(1).max(50);

export type PricedItem = {
  productId: Types.ObjectId; variantId: Types.ObjectId; sku: string; productName: string; variantLabel: string; imageUrl?: string;
  unitRegularPrice: number; unitSalePrice: number; quantity: number; freeQuantity: number; lineDiscount: number; lineTotal: number; taxAmount: number;
  tracked: boolean; offer?: OfferSnapshot | null;
};
export type Priced =
  | { ok: true; items: PricedItem[]; subtotal: number; discountTotal: number; shippingTotal: number; packingTotal: number; taxTotal: number; grandTotal: number; method: { id: Types.ObjectId; code: string; name: string } | null }
  | { ok: false; error: string };

/**
 * Server-side pricing. The browser only supplies (variantId, qty); every price, stock check and charge is read here.
 * Variant-level Buy X Get Y offers are applied here (see offers.ts): `quantity` becomes the PAID units and `freeQuantity` the free ones.
 * Packing and tax are NOT applied yet: their rules come from the legacy backend and are pending
 * (prices are treated as tax-inclusive). The structure already carries those fields so they slot in without schema change.
 */
export async function priceCart(rawLines: unknown, shippingMethodId?: string, opts: { userId?: string | null } = {}): Promise<Priced> {
  const parsed = cartLines.safeParse(rawLines);
  if (!parsed.success) return { ok: false, error: "Your cart is empty or invalid." };
  const merged = new Map<string, number>();
  for (const l of parsed.data) merged.set(l.variantId, Math.min(99, (merged.get(l.variantId) ?? 0) + l.qty));
  await db();

  const ids = [...merged.keys()].map((i) => new Types.ObjectId(i));
  type P = { _id: Types.ObjectId; name: string; variants: { _id: Types.ObjectId; sku: string; label: string; regularPrice: number; salePrice: number; isActive: boolean }[]; images: { url: string; variantId?: Types.ObjectId | null; sortOrder: number }[]; primaryImageId?: Types.ObjectId | null };
  const products = (await Product.find({ "variants._id": { $in: ids }, status: "ACTIVE", deletedAt: null }, "name variants images primaryImageId").lean()) as unknown as P[];
  const inv = (await Inventory.find({ variantId: { $in: ids } }).lean()) as unknown as { variantId: Types.ObjectId; tracked: boolean; onHand: number; reserved: number; manualAvailability: string }[];
  const invBy = new Map(inv.map((r) => [String(r.variantId), r]));

  const items: PricedItem[] = [];
  for (const [vid, qty] of merged) {
    const p = products.find((x) => x.variants.some((v) => String(v._id) === vid));
    const v = p?.variants.find((x) => String(x._id) === vid);
    if (!p || !v || !v.isActive) return { ok: false, error: "An item in your cart is no longer available. Please review your cart." };
    if (v.salePrice <= 0 || v.salePrice > v.regularPrice) return { ok: false, error: `${p.name} (${v.label}) has an invalid price and can't be ordered right now.` };
    const i = invBy.get(vid);
    const tracked = i?.tracked ?? false;
    const available = tracked ? (i!.onHand - i!.reserved) : i?.manualAvailability === "IN_STOCK";
    if (tracked ? (available as number) < qty : !available) return { ok: false, error: `${p.name} (${v.label}) is ${tracked && (available as number) > 0 ? `limited to ${available} in stock` : "out of stock"}.` };
    const img = p.images.find((x) => x.variantId && String(x.variantId) === vid) ?? p.images.find((x) => !x.variantId) ?? p.images[0];
    items.push({ productId: p._id, variantId: v._id, sku: v.sku, productName: p.name, variantLabel: v.label, imageUrl: img?.url, unitRegularPrice: v.regularPrice, unitSalePrice: v.salePrice, quantity: qty, freeQuantity: 0, lineDiscount: 0, lineTotal: v.salePrice * qty, taxAmount: 0, tracked });
  }

  // Stock was validated for the FULL requested quantity above (free units leave the shelf too). Now split it into paid + free.
  const offers = await evaluateOffers(items.map((i) => ({ variantId: String(i.variantId), label: i.variantLabel, total: i.quantity, sale: i.unitSalePrice, mrp: i.unitRegularPrice })), opts.userId ?? null);
  for (const it of items) {
    const o = offers.get(String(it.variantId));
    if (!o) continue;
    it.quantity = o.paid; it.freeQuantity = o.free; it.lineTotal = o.payable; it.offer = o.snapshot;
    it.unitSalePrice = o.unit; // price actually charged per paid unit (MRP when the offer is configured that way); the catalogue sale price stays in offer.unitSalePrice
  }

  const subtotal = items.reduce((a, i) => a + i.lineTotal, 0);
  let shippingTotal = 0;
  let method: { id: Types.ObjectId; code: string; name: string } | null = null;
  if (shippingMethodId) {
    if (!/^[a-f0-9]{24}$/.test(shippingMethodId)) return { ok: false, error: "Choose a delivery method." };
    const m = (await ShippingMethod.findOne({ _id: shippingMethodId, status: "ACTIVE" }).lean()) as unknown as { _id: Types.ObjectId; code: string; name: string; charge: number; freeAboveSubtotal?: number; countries?: string[] } | null;
    if (!m || (m.countries?.length && !m.countries.includes("IN"))) return { ok: false, error: "That delivery method isn't available." };
    shippingTotal = m.freeAboveSubtotal != null && subtotal >= m.freeAboveSubtotal ? 0 : m.charge;
    method = { id: m._id, code: m.code, name: m.name };
  }
  const discountTotal = 0, packingTotal = 0, taxTotal = 0;
  return { ok: true, items, subtotal, discountTotal, shippingTotal, packingTotal, taxTotal, grandTotal: subtotal - discountTotal + shippingTotal + packingTotal + taxTotal, method };
}

export async function activeShippingMethods() {
  await db();
  const rows = (await ShippingMethod.find({ status: "ACTIVE" }).sort({ sortOrder: 1 }).lean()) as unknown as { _id: Types.ObjectId; name: string; description?: string; charge: number; freeAboveSubtotal?: number; minDays?: number; maxDays?: number }[];
  return rows.map((m) => ({ id: String(m._id), name: m.name, description: m.description ?? "", charge: m.charge, freeAbove: m.freeAboveSubtotal ?? null, minDays: m.minDays ?? null, maxDays: m.maxDays ?? null }));
}
