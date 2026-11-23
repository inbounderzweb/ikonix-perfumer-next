import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Inventory, Product, Wishlist } from "@/server/models";

export const MAX_WISHLIST = 100;
export type WishItem = { productId: string; slug: string; name: string; image: string | null; variantId: string | null; variantLabel: string | null; regularPrice: number | null; salePrice: number | null; inStock: boolean; available: boolean; addedAt: string };

export async function wishlistIds(userId: string): Promise<string[]> {
  await db();
  const w = (await Wishlist.findOne({ userId }, "items.productId").lean()) as unknown as { items: { productId: Types.ObjectId }[] } | null;
  return (w?.items ?? []).map((i) => String(i.productId));
}

/** Live view: prices and availability are read now, never copied at save time. */
export async function listWishlist(userId: string): Promise<WishItem[]> {
  await db();
  const w = (await Wishlist.findOne({ userId }).lean()) as unknown as { items: { productId: Types.ObjectId; addedAt: Date }[] } | null;
  if (!w?.items.length) return [];
  type P = { _id: Types.ObjectId; slug: string; name: string; status: string; deletedAt?: Date | null; variants: { _id: Types.ObjectId; label: string; regularPrice: number; salePrice: number; isActive: boolean; sortOrder: number }[]; images: { _id: Types.ObjectId; url: string }[]; primaryImageId?: Types.ObjectId | null };
  const ps = (await Product.find({ _id: { $in: w.items.map((i) => i.productId) } }, "slug name status deletedAt variants images primaryImageId").lean()) as unknown as P[];
  const vids = ps.flatMap((p) => p.variants.map((v) => v._id));
  const inv = (await Inventory.find({ variantId: { $in: vids } }).lean()) as unknown as { variantId: Types.ObjectId; tracked: boolean; onHand: number; reserved: number; manualAvailability: string }[];
  const stock = new Map(inv.map((r) => [String(r.variantId), r.tracked ? r.onHand - r.reserved > 0 : r.manualAvailability === "IN_STOCK"]));
  const out: WishItem[] = [];
  for (const it of [...w.items].reverse()) {
    const p = ps.find((x) => String(x._id) === String(it.productId));
    if (!p) continue;
    const live = p.status === "ACTIVE" && !p.deletedAt;
    const vs = [...p.variants].filter((v) => v.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
    const v = vs.find((x) => stock.get(String(x._id))) ?? vs[0];
    const img = p.images.find((i) => String(i._id) === String(p.primaryImageId)) ?? p.images[0];
    out.push({ productId: String(p._id), slug: p.slug, name: p.name, image: img?.url ?? null, variantId: v ? String(v._id) : null, variantLabel: v?.label ?? null, regularPrice: v?.regularPrice ?? null, salePrice: v?.salePrice ?? null, inStock: !!v && !!stock.get(String(v._id)), available: live && !!v, addedAt: it.addedAt.toISOString() });
  }
  return out;
}

export async function addToWishlist(userId: string, productId: string): Promise<{ ok: boolean; error?: string }> {
  await db();
  if (!(await Product.exists({ _id: productId, status: "ACTIVE", deletedAt: null }))) return { ok: false, error: "Product not found." };
  const cur = (await Wishlist.findOne({ userId }, "items.productId").lean()) as unknown as { items: unknown[] } | null;
  if ((cur?.items.length ?? 0) >= MAX_WISHLIST) return { ok: false, error: `Your wishlist can hold ${MAX_WISHLIST} products.` };
  // $ne guard + upsert: adding twice (or two tabs at once) never duplicates.
  const r = await Wishlist.updateOne({ userId, "items.productId": { $ne: productId } }, { $push: { items: { productId, addedAt: new Date() } } });
  if (!r.matchedCount && !cur) { try { await Wishlist.create({ userId, items: [{ productId }] }); } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; } }
  return { ok: true };
}

export async function removeFromWishlist(userId: string, productId: string) {
  await db();
  await Wishlist.updateOne({ userId }, { $pull: { items: { productId } } });
  return { ok: true };
}
