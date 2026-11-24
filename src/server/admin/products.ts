import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Category, Inventory, Product } from "@/server/models";

export const PAGE_SIZE = 10;
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type AdminProductRow = { id: string; name: string; slug: string; status: string; image: string | null; variants: number; minPrice: number | null; categories: string[]; updatedAt: string };

export async function listProducts(opts: { q?: string; status?: string; categoryId?: string; page: number; size?: number; sort?: Record<string, 1 | -1> }) {
  const size = opts.size ?? PAGE_SIZE;
  await db();
  const filter: Record<string, unknown> = {};
  if (opts.status === "ARCHIVED") filter.deletedAt = { $ne: null };
  else { filter.deletedAt = null; if (["DRAFT", "ACTIVE"].includes(opts.status ?? "")) filter.status = opts.status; }
  if (opts.categoryId && /^[a-f0-9]{24}$/.test(opts.categoryId)) filter.categoryIds = new Types.ObjectId(opts.categoryId);
  if (opts.q) { const re = new RegExp(escapeRe(opts.q), "i"); filter.$or = [{ name: re }, { "variants.sku": re }, { inspiredByName: re }]; }
  const [total, rows, cats] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter, "name slug status images primaryImageId variants.isActive minSalePrice categoryIds updatedAt").sort(opts.sort ?? { updatedAt: -1, _id: -1 }).skip((opts.page - 1) * size).limit(size).lean(),
    Category.find({}, "name").lean(),
  ]);
  const catName = new Map((cats as unknown as { _id: Types.ObjectId; name: string }[]).map((c) => [String(c._id), c.name]));
  type R = { _id: Types.ObjectId; name: string; slug: string; status: string; images: { _id: Types.ObjectId; url: string }[]; primaryImageId?: Types.ObjectId; variants: { isActive: boolean }[]; minSalePrice?: number; categoryIds: Types.ObjectId[]; updatedAt: Date };
  const items: AdminProductRow[] = (rows as unknown as R[]).map((p) => ({
    id: String(p._id), name: p.name, slug: p.slug, status: p.status,
    image: (p.images.find((i) => String(i._id) === String(p.primaryImageId)) ?? p.images[0])?.url ?? null,
    variants: p.variants.filter((v) => v.isActive).length, minPrice: p.minSalePrice ?? null,
    categories: p.categoryIds.map((c) => catName.get(String(c))).filter((x): x is string => !!x), updatedAt: p.updatedAt.toISOString(),
  }));
  return { items, total, pages: Math.max(1, Math.ceil(total / size)) };
}

export type ProductFormData = {
  id?: string; name: string; slug: string; subtitle: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; gender: "MEN" | "WOMEN" | "UNISEX" | "";
  inspiredByName: string; categoryIds: string[]; description: string; shortDescription: string;
  notes: { top: string[]; middle: string[]; base: string[] }; seo: { title: string; description: string };
  variants: { id?: string; sku: string; label: string; sizeValue?: number; regularPrice: number; salePrice: number; isActive: boolean; tracked: boolean; onHand: number; availability: "IN_STOCK" | "OUT_OF_STOCK"; reserved: number }[];
  images: { id: string; url: string; alt: string; width: number; height: number }[];
  reviewIssues: string[];
};

export async function getCategoryOptions() {
  await db();
  return ((await Category.find({ deletedAt: null }, "name").sort({ name: 1 }).lean()) as unknown as { _id: Types.ObjectId; name: string }[]).map((c) => ({ id: String(c._id), name: c.name }));
}

export async function getProductForm(id: string): Promise<ProductFormData | null> {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  await db();
  type P = { _id: Types.ObjectId; name: string; slug: string; subtitle?: string; status: ProductFormData["status"]; gender?: ProductFormData["gender"] | null; inspiredByName?: string; categoryIds: Types.ObjectId[]; description?: string; shortDescription?: string; notes?: { top?: string[]; middle?: string[]; base?: string[] }; seo?: { title?: string; description?: string }; variants: { _id: Types.ObjectId; sku: string; label: string; sizeValue?: number; regularPrice: number; salePrice: number; isActive: boolean; sortOrder: number }[]; images: { _id: Types.ObjectId; url: string; alt?: string; width: number; height: number; sortOrder: number }[]; reviewIssues?: string[] };
  const p = (await Product.findById(id).lean()) as unknown as P | null;
  if (!p) return null;
  const inv = (await Inventory.find({ productId: p._id }).lean()) as unknown as { variantId: Types.ObjectId; tracked: boolean; onHand: number; reserved: number; manualAvailability: "IN_STOCK" | "OUT_OF_STOCK" }[];
  const invBy = new Map(inv.map((i) => [String(i.variantId), i]));
  return {
    id: String(p._id), name: p.name, slug: p.slug, subtitle: p.subtitle ?? "", status: p.status, gender: p.gender ?? "", inspiredByName: p.inspiredByName ?? "",
    categoryIds: p.categoryIds.map(String), description: p.description ?? "", shortDescription: p.shortDescription ?? "",
    notes: { top: p.notes?.top ?? [], middle: p.notes?.middle ?? [], base: p.notes?.base ?? [] }, seo: { title: p.seo?.title ?? "", description: p.seo?.description ?? "" },
    variants: [...p.variants].sort((a, b) => a.sortOrder - b.sortOrder).map((v) => {
      const i = invBy.get(String(v._id));
      return { id: String(v._id), sku: v.sku, label: v.label, sizeValue: v.sizeValue, regularPrice: v.regularPrice / 100, salePrice: v.salePrice / 100, isActive: v.isActive, tracked: i?.tracked ?? false, onHand: i?.onHand ?? 0, availability: i?.manualAvailability ?? "OUT_OF_STOCK", reserved: i?.reserved ?? 0 };
    }),
    images: [...p.images].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => ({ id: String(i._id), url: i.url, alt: i.alt ?? "", width: i.width, height: i.height })),
    reviewIssues: p.reviewIssues ?? [],
  };
}
