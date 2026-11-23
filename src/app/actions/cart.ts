"use server";

import { z } from "zod";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Inventory, Product } from "@/server/models";

const linesSchema = z.array(z.object({ variantId: z.string().regex(/^[a-f0-9]{24}$/), qty: z.number().int().min(1).max(99) })).max(50);

export type CartLineView = {
  variantId: string;
  productSlug: string;
  name: string;
  label: string;
  image: string | null;
  unitPrice: number; // paise, current sale price (re-read from the DB, never trusted from the client)
  qty: number;
  inStock: boolean;
};

/**
 * Re-prices a browser-held guest cart against the live catalogue. Unknown, unpublished or inactive
 * variants are dropped. Offers (free bottles) are applied by the pricing engine at checkout (Phase 5).
 */
export async function getCartView(input: unknown): Promise<CartLineView[]> {
  const lines = linesSchema.safeParse(input);
  if (!lines.success || lines.data.length === 0) return [];
  await db();
  const ids = lines.data.map((l) => new Types.ObjectId(l.variantId));
  type P = { slug: string; name: string; status: string; deletedAt?: Date | null; variants: { _id: Types.ObjectId; label: string; salePrice: number; isActive: boolean }[]; images: { url: string; variantId?: Types.ObjectId | null; sortOrder: number }[]; primaryImageId?: Types.ObjectId | null };
  const products = (await Product.find({ "variants._id": { $in: ids }, status: "ACTIVE", deletedAt: null }, "slug name status variants images primaryImageId").lean()) as unknown as P[];
  const inv = (await Inventory.find({ variantId: { $in: ids } }).lean()) as unknown as { variantId: Types.ObjectId; tracked: boolean; manualAvailability: string; onHand: number; reserved: number }[];
  const stock = new Map(inv.map((r) => [String(r.variantId), r.tracked ? r.onHand - r.reserved > 0 : r.manualAvailability === "IN_STOCK"]));
  const out: CartLineView[] = [];
  for (const l of lines.data) {
    const p = products.find((x) => x.variants.some((v) => String(v._id) === l.variantId));
    const v = p?.variants.find((x) => String(x._id) === l.variantId);
    if (!p || !v || !v.isActive) continue;
    const img = p.images.find((i) => i.variantId && String(i.variantId) === l.variantId) ?? p.images.find((i) => !i.variantId);
    out.push({ variantId: l.variantId, productSlug: p.slug, name: p.name, label: v.label, image: img?.url ?? null, unitPrice: v.salePrice, qty: l.qty, inStock: stock.get(l.variantId) ?? false });
  }
  return out;
}
