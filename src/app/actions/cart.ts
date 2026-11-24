"use server";

import { z } from "zod";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Inventory, Product } from "@/server/models";
import { evaluateOffers } from "@/server/commerce/offers";
import { getCustomer } from "@/server/auth/customer-session";

const linesSchema = z.array(z.object({ variantId: z.string().regex(/^[a-f0-9]{24}$/), qty: z.number().int().min(1).max(99) })).max(50);

export type CartLineView = {
  variantId: string;
  productSlug: string;
  name: string;
  label: string;
  image: string | null;
  unitPrice: number; // paise per paid unit: the sale price, or the offer's configured price (e.g. MRP) while an offer applies; (re-read from the DB, never trusted from the client)
  qty: number;
  inStock: boolean;
  // Buy X Get Y (all computed server-side; the browser only ever sends variantId + qty)
  paidQty: number;
  freeQty: number;
  lineTotal: number; // paise actually payable for this line
  offerLabel: string | null; // "Buy 4 Get 1 Free"
  saved: number; // paise saved by the offer
  hint: string | null; // "Add 1 more to get 1 free"
};

/**
 * Re-prices a browser-held guest cart against the live catalogue. Unknown, unpublished or inactive
 * variants are dropped. Variant Buy X Get Y offers are evaluated by the same engine as checkout (offers.ts), so cart and payment can't disagree.
 */
export async function getCartView(input: unknown): Promise<CartLineView[]> {
  const lines = linesSchema.safeParse(input);
  if (!lines.success || lines.data.length === 0) return [];
  await db();
  const ids = lines.data.map((l) => new Types.ObjectId(l.variantId));
  type P = { slug: string; name: string; status: string; deletedAt?: Date | null; variants: { _id: Types.ObjectId; label: string; salePrice: number; regularPrice?: number; isActive: boolean }[]; images: { url: string; variantId?: Types.ObjectId | null; sortOrder: number }[]; primaryImageId?: Types.ObjectId | null };
  const products = (await Product.find({ "variants._id": { $in: ids }, status: "ACTIVE", deletedAt: null }, "slug name status variants images primaryImageId").lean()) as unknown as P[];
  const inv = (await Inventory.find({ variantId: { $in: ids } }).lean()) as unknown as { variantId: Types.ObjectId; tracked: boolean; manualAvailability: string; onHand: number; reserved: number }[];
  const stock = new Map(inv.map((r) => [String(r.variantId), r.tracked ? r.onHand - r.reserved > 0 : r.manualAvailability === "IN_STOCK"]));
  const me = await getCustomer();
  const info = new Map<string, { label: string; sale: number; mrp: number }>();
  for (const p of products) for (const v of p.variants) info.set(String(v._id), { label: v.label, sale: v.salePrice, mrp: v.regularPrice ?? 0 });
  const offers = await evaluateOffers(lines.data.filter((l) => info.has(l.variantId)).map((l) => ({ variantId: l.variantId, label: info.get(l.variantId)!.label, total: l.qty, sale: info.get(l.variantId)!.sale, mrp: info.get(l.variantId)!.mrp })), me?.id ?? null);
  const out: CartLineView[] = [];
  for (const l of lines.data) {
    const p = products.find((x) => x.variants.some((v) => String(v._id) === l.variantId));
    const v = p?.variants.find((x) => String(x._id) === l.variantId);
    if (!p || !v || !v.isActive) continue;
    const img = p.images.find((i) => i.variantId && String(i.variantId) === l.variantId) ?? p.images.find((i) => !i.variantId);
    const o = offers.get(l.variantId);
    const hint = o && o.hintUnits ? (o.pooled ? `Add ${o.hintUnits} more ${o.snapshot.poolSize === "item" ? "eligible item" : o.snapshot.poolSize} (any product in this offer) to get ${o.snapshot.free} free` : `Add ${o.hintUnits} more to get ${o.snapshot.free} free`) : null;
    out.push({
      variantId: l.variantId, productSlug: p.slug, name: p.name, label: v.label, image: img?.url ?? null, unitPrice: o ? o.unit : v.salePrice, qty: l.qty, inStock: stock.get(l.variantId) ?? false,
      paidQty: o ? o.paid : l.qty, freeQty: o ? o.free : 0, lineTotal: o ? o.payable : v.salePrice * l.qty,
      offerLabel: o ? (o.pooled ? (o.snapshot.poolSize === "item" ? `${o.snapshot.label} (mix & match)` : `${o.snapshot.label} (any ${o.snapshot.poolSize})`) : o.snapshot.label) : null, saved: o ? o.snapshot.savedAmount : 0, hint,
    });
  }
  return out;
}
