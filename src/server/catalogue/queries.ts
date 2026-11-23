import "server-only";
import { Types } from "mongoose";
import { db } from "../db";
import { Category, Inventory, Product, ProductCollection } from "../models";
import type { CategoryDTO, ImageDTO, ProductCardDTO, ProductDetailDTO, VariantDTO } from "@/lib/catalogue-types";

// Narrow shapes of what we read (keeps tsc fast; Mongoose's inferred lean types are very deep).
type LeanImage = { _id: Types.ObjectId; variantId?: Types.ObjectId | null; url: string; width: number; height: number; alt?: string; sortOrder: number };
type LeanVariant = { _id: Types.ObjectId; sku: string; label: string; sizeValue?: number | null; regularPrice: number; salePrice: number; isActive: boolean; sortOrder: number };
type LeanProduct = {
  _id: Types.ObjectId; legacyId?: string; slug: string; name: string; subtitle?: string; description?: string;
  primaryCategoryId?: Types.ObjectId | null; inspiredByName?: string; notes?: { top: string[]; middle: string[]; base: string[] };
  variants: LeanVariant[]; images: LeanImage[]; primaryImageId?: Types.ObjectId | null; seo?: { title?: string; description?: string };
};
type LeanInventory = { variantId: Types.ObjectId; tracked: boolean; manualAvailability: string; onHand: number; reserved: number };

const PUBLIC = { status: "ACTIVE", deletedAt: null } as const;
const CARD_FIELDS = "slug name primaryCategoryId variants images primaryImageId";

async function categoryNames(): Promise<Map<string, CategoryDTO>> {
  const cats = (await Category.find({ status: "ACTIVE", deletedAt: null }).sort({ sortOrder: 1 }).lean()) as unknown as { _id: Types.ObjectId; slug: string; name: string }[];
  return new Map(cats.map((c) => [String(c._id), { id: String(c._id), slug: c.slug, name: c.name }]));
}

async function availability(variantIds: Types.ObjectId[]): Promise<Map<string, boolean>> {
  const rows = (await Inventory.find({ variantId: { $in: variantIds } }, "variantId tracked manualAvailability onHand reserved").lean()) as unknown as LeanInventory[];
  return new Map(rows.map((r) => [String(r.variantId), r.tracked ? r.onHand - r.reserved > 0 : r.manualAvailability === "IN_STOCK"]));
}

const toImage = (i: LeanImage | undefined, alt: string): ImageDTO | null => (i ? { url: i.url, width: i.width, height: i.height, alt: i.alt || alt } : null);

function toVariant(p: LeanProduct, v: LeanVariant, stock: Map<string, boolean>): VariantDTO {
  const img = p.images.find((i) => i.variantId && String(i.variantId) === String(v._id));
  return {
    id: String(v._id), sku: v.sku, label: v.label, sizeValue: v.sizeValue ?? null,
    regularPrice: v.regularPrice, salePrice: v.salePrice, inStock: stock.get(String(v._id)) ?? false, image: toImage(img, p.name),
  };
}

const sellable = (p: LeanProduct) => [...p.variants].filter((v) => v.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
const mainImage = (p: LeanProduct) => p.images.find((i) => String(i._id) === String(p.primaryImageId)) ?? [...p.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];

function toCard(p: LeanProduct, cats: Map<string, CategoryDTO>, stock: Map<string, boolean>): ProductCardDTO {
  const variants = sellable(p).map((v) => toVariant(p, v, stock));
  return {
    id: String(p._id), slug: p.slug, name: p.name,
    categoryName: p.primaryCategoryId ? cats.get(String(p.primaryCategoryId))?.name ?? null : null,
    image: toImage(mainImage(p), p.name),
    variant: variants[0] ?? null,
    inStock: variants.some((v) => v.inStock),
  };
}

async function cards(products: LeanProduct[]): Promise<ProductCardDTO[]> {
  const [cats, stock] = await Promise.all([categoryNames(), availability(products.flatMap((p) => p.variants.map((v) => v._id)))]);
  return products.map((p) => toCard(p, cats, stock));
}

export async function getCategories(): Promise<CategoryDTO[]> {
  await db();
  return [...(await categoryNames()).values()];
}

/** Products of a merchandising collection (e.g. "best-sellers"), in curated order. */
export async function getCollectionProducts(key: string, limit = 8): Promise<ProductCardDTO[]> {
  await db();
  const col = (await ProductCollection.findOne({ key, status: "ACTIVE" }).lean()) as unknown as { productIds: Types.ObjectId[] } | null;
  if (!col) return [];
  const ids = col.productIds.slice(0, limit * 2);
  const found = (await Product.find({ _id: { $in: ids }, ...PUBLIC }, CARD_FIELDS).lean()) as unknown as LeanProduct[];
  const byId = new Map(found.map((p) => [String(p._id), p]));
  return cards(ids.map((id) => byId.get(String(id))).filter((p): p is LeanProduct => !!p).slice(0, limit));
}

export async function getCategoryProducts(categorySlug: string, limit = 8): Promise<ProductCardDTO[]> {
  await db();
  const cat = (await Category.findOne({ slug: categorySlug, status: "ACTIVE" }, "_id").lean()) as unknown as { _id: Types.ObjectId } | null;
  if (!cat) return [];
  const found = (await Product.find({ categoryIds: cat._id, ...PUBLIC }, CARD_FIELDS).sort({ legacyId: 1, _id: 1 }).limit(limit).lean()) as unknown as LeanProduct[];
  return cards(found);
}

/** Related products for a product page: same category first, topped up with best sellers. Never includes the product itself. */
export async function getRelatedProducts(productId: string, categorySlug: string | null, limit = 12): Promise<ProductCardDTO[]> {
  const seen = new Set<string>([productId]);
  const out: ProductCardDTO[] = [];
  const add = (list: ProductCardDTO[]) => { for (const c of list) if (!seen.has(c.id) && out.length < limit) { seen.add(c.id); out.push(c); } };
  if (categorySlug) add(await getCategoryProducts(categorySlug, limit + 1));
  if (out.length < limit) add(await getCollectionProducts("best-sellers", limit + 1));
  return out;
}

export type ShopFilter = "all" | "featured" | string; // string = category slug

/** Shop grid: 10 per page like the legacy site; ordered by legacy listing order. */
export async function getShopPage(filter: ShopFilter, page: number, pageSize = 10) {
  await db();
  let query: Record<string, unknown> = { ...PUBLIC };
  let orderedIds: Types.ObjectId[] | null = null;
  if (filter === "featured") {
    const col = (await ProductCollection.findOne({ key: "best-sellers", status: "ACTIVE" }).lean()) as unknown as { productIds: Types.ObjectId[] } | null;
    orderedIds = col?.productIds ?? [];
    query = { ...query, _id: { $in: orderedIds } };
  } else if (filter !== "all") {
    const cat = (await Category.findOne({ slug: filter, status: "ACTIVE" }, "_id").lean()) as unknown as { _id: Types.ObjectId } | null;
    if (!cat) return { items: [] as ProductCardDTO[], total: 0, page: 1, totalPages: 1 };
    query = { ...query, categoryIds: cat._id };
  }
  const total = await Product.countDocuments(query);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  let products: LeanProduct[];
  if (orderedIds) {
    const all = (await Product.find(query, CARD_FIELDS).lean()) as unknown as LeanProduct[];
    const rank = new Map(orderedIds.map((id, i) => [String(id), i]));
    products = all.sort((a, b) => (rank.get(String(a._id)) ?? 0) - (rank.get(String(b._id)) ?? 0)).slice((current - 1) * pageSize, current * pageSize);
  } else {
    // Numeric legacy id order mirrors the legacy API listing.
    products = (await Product.aggregate([
      { $match: query },
      { $addFields: { _order: { $toInt: { $ifNull: ["$legacyId", "999999"] } } } },
      { $sort: { _order: 1, _id: 1 } },
      { $skip: (current - 1) * pageSize },
      { $limit: pageSize },
      { $project: { slug: 1, name: 1, primaryCategoryId: 1, variants: 1, images: 1, primaryImageId: 1 } },
    ])) as unknown as LeanProduct[];
  }
  return { items: await cards(products), total, page: current, totalPages };
}

export async function getProductBySlug(slug: string): Promise<ProductDetailDTO | null> {
  await db();
  const p = (await Product.findOne({ slug, ...PUBLIC }).lean()) as unknown as LeanProduct | null;
  if (!p) return null;
  const [cats, stock] = await Promise.all([categoryNames(), availability(p.variants.map((v) => v._id))]);
  const card = toCard(p, cats, stock);
  const cat = p.primaryCategoryId ? cats.get(String(p.primaryCategoryId)) : undefined;
  const gallery = [...p.images].filter((i) => !i.variantId).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    ...card,
    description: p.description ?? null,
    subtitle: p.subtitle ?? null,
    categorySlug: cat?.slug ?? null,
    inspiredByName: p.inspiredByName ?? null,
    notes: p.notes ?? { top: [], middle: [], base: [] },
    images: gallery.map((i) => toImage(i, p.name)!).filter(Boolean),
    variants: sellable(p).map((v) => toVariant(p, v, stock)),
    seoTitle: p.seo?.title ?? null,
    seoDescription: p.seo?.description ?? null,
  };
}

/** Legacy /product-details/:pid?vid= → new slug (+ variant id) for 301 redirects. */
export async function resolveLegacyProduct(pid: string, vid?: string | null) {
  await db();
  const p = (await Product.findOne({ legacyId: pid, deletedAt: null }, "slug variants._id variants.legacyId").lean()) as unknown as
    | { slug: string; variants: { _id: Types.ObjectId; legacyId?: string }[] } | null;
  if (!p) return null;
  const variant = vid ? p.variants.find((v) => v.legacyId === vid) : undefined;
  return { slug: p.slug, variantId: variant ? String(variant._id) : null };
}

/** Header search: prefix/substring match on name, inspiration, SKU. Escaped regex, max 10 results. */
export async function searchProducts(q: string, limit = 10): Promise<ProductCardDTO[]> {
  const term = q.trim().slice(0, 60);
  if (!term) return [];
  await db();
  const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const found = (await Product.find({ ...PUBLIC, $or: [{ name: rx }, { inspiredByName: rx }, { "variants.sku": rx }] }, CARD_FIELDS).limit(limit).lean()) as unknown as LeanProduct[];
  return cards(found);
}
