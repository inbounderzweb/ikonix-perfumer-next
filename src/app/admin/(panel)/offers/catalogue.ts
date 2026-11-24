import { db } from "@/server/db";
import { Product } from "@/server/models";
import type { CatalogueProduct } from "@/components/admin/offer-form";

export async function loadCatalogue(): Promise<CatalogueProduct[]> {
  await db();
  type P = { _id: { toString(): string }; name: string; variants: { _id: { toString(): string }; label: string; sku: string; salePrice: number; regularPrice: number; isActive: boolean }[] };
  const rows = (await Product.find({ deletedAt: null }, "name variants._id variants.label variants.sku variants.salePrice variants.regularPrice variants.isActive").sort({ name: 1 }).lean()) as unknown as P[];
  return rows.map((p) => ({ id: String(p._id), name: p.name, variants: p.variants.map((v) => ({ id: String(v._id), label: v.label, sku: v.sku, sale: v.salePrice, mrp: v.regularPrice })) }));
}
