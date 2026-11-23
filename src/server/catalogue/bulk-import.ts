import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { db } from "@/server/db";
import { Brand, Category, Product, ProductCollection } from "@/server/models";
import { productInput, type ProductInput } from "@/server/admin/product-schema";
import { storeImage, validateImageBuffer } from "@/server/media/cloudinary";
import type { AuditActor, AuditMeta } from "@/server/admin/audit";
import { saveProductRecord } from "./product-service";

/**
 * Bulk import of products in the legacy export format (public/ikonix/export/all-products.json, one entry per
 * product, the same shape as each product folder's product.json). Shared by the admin bulk-upload page and the
 * scripts/bulk-upload-products CLI.
 *
 * Rules (identical to the original importer, scripts/ikonix/import-catalogue.ts): nothing is guessed; legacy
 * rupees → paise; a size with a missing or sale-above-MRP price is kept but switched off; a product with any
 * data issue is created as DRAFT with `reviewIssues`; legacy "best sellers" becomes collection membership.
 * Existing products (same legacy id, slug, SKU or legacy size id) are reported and never overwritten.
 */

const BEST_SELLERS_LEGACY_ID = "2";
const STANDARD_SIZES = new Set([30, 50, 100]);
const GENDER: Record<string, "MEN" | "WOMEN" | "UNISEX"> = { Men: "MEN", Women: "WOMEN", Unisex: "UNISEX" };
const CATEGORY_GENDER: Record<string, "MEN" | "WOMEN" | "UNISEX"> = { "4": "MEN", "5": "WOMEN", "6": "UNISEX" };
const LEGACY_CATEGORY_FOR_GENDER: Record<string, string> = { MEN: "4", WOMEN: "5", UNISEX: "6" };
const MAX_IMAGES = 20;

const imagePath = z.string().regex(/^\/ikonix\/products\/[a-z0-9-]+\/images\/[A-Za-z0-9._-]+\.(webp|jpe?g|png|avif|gif)$/i, "Unexpected image path");
const str = z.string().nullable().optional();

export const sourceProduct = z.object({
  id: z.string().regex(/^\d{1,8}$/),
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120),
  subtitle: str,
  description: str,
  category: z.object({ id: z.string(), name: z.string() }),
  variants: z.array(z.object({
    id: z.string().regex(/^\d{1,8}$/),
    size: str,
    sizeValue: z.number().nullable().optional(),
    regularPrice: z.number().nullable().optional(),
    salePrice: z.number().nullable().optional(),
    sourceImageUrl: str,
  })).min(1).max(20),
  specifications: z.object({ fragranceNotes: z.object({ top: z.array(z.string()), middle: z.array(z.string()), base: z.array(z.string()) }) }),
  derivedFromDescription: z.object({
    inspiredByFragrance: str, inspiredByBrand: str, fragranceFamily: str, gender: str,
    launchYear: z.number().nullable().optional(), perfumers: z.array(z.string()).optional(),
  }),
  inventory: z.object({ stockStatus: str }),
  images: z.object({ main: imagePath.nullable(), gallery: z.array(imagePath), variants: z.record(z.string(), imagePath.nullable()) }),
  source: z.object({ productUrl: z.string().optional(), originalImageUrls: z.array(z.string()).default([]) }).optional(),
});
export type SourceProduct = z.infer<typeof sourceProduct>;

export type PlannedImage = { path: string; role: "main" | "gallery" | "variant"; variantSku: string | null; sourceUrl?: string };
export type ProductPlan = {
  legacyId: string; slug: string; name: string; skus: string[]; variantLegacyIds: Record<string, string>;
  status: "ACTIVE" | "DRAFT"; issues: string[]; gender: "MEN" | "WOMEN" | "UNISEX" | null;
  categoryLegacyId: string | null; isBestSeller: boolean; images: PlannedImage[];
  input: Omit<ProductInput, "images" | "categoryIds">;
};

const skuFor = (legacyId: string, v: { id: string; size?: string | null }) => `IKX-${legacyId}-${v.size ?? `v${v.id}`}`;
const cleanNotes = (a: string[]) => a.map((t) => t.trim()).filter(Boolean).slice(0, 30);

/** Pure mapping, no database: source record → product input + image list + review issues. */
export function planProduct(x: SourceProduct): ProductPlan {
  const issues: string[] = [];
  const derivedGender = x.derivedFromDescription.gender ? GENDER[x.derivedFromDescription.gender] : undefined;
  const isBestSeller = x.category.id === BEST_SELLERS_LEGACY_ID;
  const gender = CATEGORY_GENDER[x.category.id] ?? derivedGender ?? null;
  const categoryLegacyId = isBestSeller ? (gender ? LEGACY_CATEGORY_FOR_GENDER[gender] : null) : x.category.id;
  if (!categoryLegacyId) issues.push(`No category: legacy category was "${x.category.name}" and the description states no gender.`);
  if (!x.description?.trim()) issues.push("Description is empty in the legacy data.");
  const availability = x.inventory.stockStatus === "in_stock" ? "IN_STOCK" as const : "OUT_OF_STOCK" as const;

  const variantLegacyIds: Record<string, string> = {};
  const variants = x.variants.map((v) => {
    const sku = skuFor(x.id, v);
    variantLegacyIds[sku] = v.id;
    const vIssues: string[] = [];
    const regular = v.regularPrice ?? null;
    const sale = v.salePrice ?? null;
    if (regular == null || sale == null) vIssues.push("Price missing in legacy data.");
    else if (sale > regular) vIssues.push(`Legacy sale price ₹${sale} is higher than MRP ₹${regular}.`);
    if (v.sizeValue != null && !STANDARD_SIZES.has(v.sizeValue)) vIssues.push(`Unusual size "${v.size}" (all other variants use 30/50/100 ml); confirm the bottle size.`);
    issues.push(...vIssues.map((m) => `Variant ${v.size} ml (vid ${v.id}): ${m}`));
    const priceInvalid = regular == null || sale == null || sale > regular;
    return {
      sku, label: v.size ? `${v.size} ml` : `Variant ${v.id}`, sizeValue: v.sizeValue ?? undefined,
      regularPrice: regular ?? 0, salePrice: sale ?? 0, isActive: !priceInvalid,
      tracked: false, onHand: 0, availability,
    };
  });

  // Images in the original order: main, gallery, then each size's photo (linked to that size).
  const src = x.source?.originalImageUrls ?? [];
  let si = 0;
  const images: PlannedImage[] = [];
  if (x.images.main) images.push({ path: x.images.main, role: "main", variantSku: null, sourceUrl: src[si++] });
  for (const g of x.images.gallery) images.push({ path: g, role: "gallery", variantSku: null, sourceUrl: src[si++] });
  for (const v of x.variants) {
    const p = x.images.variants[v.id];
    if (p) images.push({ path: p, role: "variant", variantSku: skuFor(x.id, v), sourceUrl: v.sourceImageUrl ?? undefined });
  }

  const status = issues.length ? "DRAFT" : "ACTIVE";
  return {
    legacyId: x.id, slug: x.slug, name: x.name.trim(), skus: variants.map((v) => v.sku), variantLegacyIds,
    status, issues, gender, categoryLegacyId, isBestSeller, images,
    input: {
      name: x.name, slug: x.slug, subtitle: x.subtitle ?? "", status, gender: gender ?? "",
      inspiredByName: x.derivedFromDescription.inspiredByFragrance ?? "", description: x.description ?? "", shortDescription: "",
      notes: { top: cleanNotes(x.specifications.fragranceNotes.top), middle: cleanNotes(x.specifications.fragranceNotes.middle), base: cleanNotes(x.specifications.fragranceNotes.base) },
      seo: { title: "", description: "" }, variants,
    },
  };
}

export type ExistingMatch = { productId: string; slug: string; matchedBy: string[] };

/** Which planned products already exist on the target (by legacy id, slug, any SKU or legacy size id). */
export async function findExisting(plans: Pick<ProductPlan, "legacyId" | "slug" | "skus" | "variantLegacyIds">[]): Promise<Map<string, ExistingMatch>> {
  await db();
  const legacyIds = plans.map((p) => p.legacyId);
  const slugs = plans.map((p) => p.slug);
  const skus = plans.flatMap((p) => p.skus);
  const vids = plans.flatMap((p) => Object.values(p.variantLegacyIds));
  const rows = (await Product.find(
    { $or: [{ legacyId: { $in: legacyIds } }, { slug: { $in: slugs } }, { "variants.sku": { $in: skus } }, { "variants.legacyId": { $in: vids } }] },
    "legacyId slug variants.sku variants.legacyId",
  ).lean()) as unknown as { _id: Types.ObjectId; legacyId?: string; slug: string; variants: { sku: string; legacyId?: string }[] }[];
  const out = new Map<string, ExistingMatch>();
  for (const p of plans) {
    const pv = new Set(Object.values(p.variantLegacyIds));
    for (const r of rows) {
      const by: string[] = [];
      if (r.legacyId === p.legacyId) by.push("legacyId");
      if (r.slug === p.slug) by.push("slug");
      if (r.variants.some((v) => p.skus.includes(v.sku))) by.push("sku");
      if (r.variants.some((v) => v.legacyId && pv.has(v.legacyId))) by.push("variantLegacyId");
      if (by.length) { out.set(p.legacyId, { productId: String(r._id), slug: r.slug, matchedBy: by }); break; }
    }
  }
  return out;
}

export type ImageResult = { path: string; role: PlannedImage["role"]; ok: boolean; mediaId?: string; publicId?: string; url?: string; duplicate?: boolean; error?: string };
export type ImportResult = {
  legacyId: string; slug: string; name: string;
  status: "created" | "exists" | "failed" | "would-create";
  productId?: string; productStatus?: "ACTIVE" | "DRAFT"; matchedBy?: string[]; error?: string;
  issues: string[]; variants: number; images: ImageResult[];
};

export type ImageLoader = (path: string) => Promise<{ buffer: Buffer; filename: string } | null>;

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
  throw last;
}

const brandCache = new Map<string, Types.ObjectId>();
const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
async function brandId(kind: "HOUSE" | "INSPIRATION", name: string, slug = slugify(name)) {
  const hit = brandCache.get(slug);
  if (hit) return hit;
  const b = await Brand.findOneAndUpdate({ slug }, { $setOnInsert: { kind, name, slug, status: "ACTIVE" } }, { upsert: true, returnDocument: "after" });
  brandCache.set(slug, b._id);
  return b._id as Types.ObjectId;
}

/**
 * Imports one product. Idempotent and resumable: an existing product is reported, never touched; images are
 * de-duplicated by content hash (a retried product reuses images uploaded on the failed attempt). The product
 * is created only after every image is stored, so a failure never leaves a product with missing photos.
 */
export async function importProduct(raw: unknown, loadImage: ImageLoader, actor: AuditActor, opts: { dryRun?: boolean; auditMeta?: AuditMeta } = {}): Promise<ImportResult> {
  const parsed = sourceProduct.safeParse(raw);
  const r0 = raw as { id?: unknown; slug?: unknown; name?: unknown } | null;
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { legacyId: String(r0?.id ?? "?"), slug: String(r0?.slug ?? "?"), name: String(r0?.name ?? "?"), status: "failed", error: `Invalid source data at ${issue.path.join(".")}: ${issue.message}`, issues: [], variants: 0, images: [] };
  }
  const plan = planProduct(parsed.data);
  const base = { legacyId: plan.legacyId, slug: plan.slug, name: plan.name, issues: plan.issues, variants: plan.input.variants.length, productStatus: plan.status };
  if (plan.images.length > MAX_IMAGES) return { ...base, status: "failed", error: `More than ${MAX_IMAGES} images`, images: [] };

  await db();
  const existing = (await findExisting([plan])).get(plan.legacyId);
  if (existing) return { ...base, status: "exists", productId: existing.productId, matchedBy: existing.matchedBy, images: [] };

  const category = plan.categoryLegacyId ? ((await Category.findOne({ legacyId: plan.categoryLegacyId, deletedAt: null }, "_id").lean()) as unknown as { _id: Types.ObjectId } | null) : null;
  if (plan.categoryLegacyId && !category) return { ...base, status: "failed", error: `Category with legacy id ${plan.categoryLegacyId} does not exist on the target. Run the category setup first.`, images: [] };

  // Validate every image before uploading any.
  const loaded: { img: PlannedImage; buffer: Buffer; filename: string }[] = [];
  const images: ImageResult[] = [];
  for (const img of plan.images) {
    const f = await loadImage(img.path).catch(() => null);
    if (!f) { images.push({ path: img.path, role: img.role, ok: false, error: "Image file not supplied" }); continue; }
    loaded.push({ img, ...f });
  }
  if (images.some((i) => !i.ok)) return { ...base, status: "failed", error: "Missing image files", images };
  const validated = [];
  for (const l of loaded) {
    const v = await validateImageBuffer(l.buffer);
    if (!v.ok) { images.push({ path: l.img.path, role: l.img.role, ok: false, error: v.error }); continue; }
    validated.push({ ...l, v });
  }
  if (images.length) return { ...base, status: "failed", error: "Invalid image files", images };
  if (opts.dryRun) return { ...base, status: "would-create", images: validated.map((l) => ({ path: l.img.path, role: l.img.role, ok: true })) };

  for (const l of validated) {
    try {
      const { asset, duplicate } = await withRetry(() => storeImage(l.v, { folder: "products", filename: `${plan.slug}-${l.filename}`, uploadedById: actor.id, legacySource: l.img.path, alt: plan.name }));
      images.push({ path: l.img.path, role: l.img.role, ok: true, mediaId: asset.id, publicId: asset.publicId, url: asset.url, duplicate });
    } catch (e) {
      images.push({ path: l.img.path, role: l.img.role, ok: false, error: `Upload failed: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }
  if (images.some((i) => !i.ok)) return { ...base, status: "failed", error: "Image upload failed (safe to retry)", images };

  const input = productInput.safeParse({ ...plan.input, categoryIds: category ? [String(category._id)] : [], images: images.map((i) => ({ kind: "media", mediaId: i.mediaId!, alt: plan.name })) });
  if (!input.success) {
    const issue = input.error.issues[0];
    return { ...base, status: "failed", error: `Product data rejected at ${issue.path.join(".")}: ${issue.message}`, images };
  }
  const x = parsed.data;
  const saved = await saveProductRecord(input.data, actor, {
    createOnly: true, auditMeta: opts.auditMeta,
    extras: {
      legacyId: x.id,
      brandId: await brandId("HOUSE", "Ikonix Perfumer", "ikonix-perfumer"),
      inspiredByBrandId: x.derivedFromDescription.inspiredByBrand ? await brandId("INSPIRATION", x.derivedFromDescription.inspiredByBrand) : null,
      fragranceFamily: x.derivedFromDescription.fragranceFamily ?? undefined,
      launchYear: x.derivedFromDescription.launchYear ?? undefined,
      perfumers: x.derivedFromDescription.perfumers ?? [],
      legacy: { stockStatus: x.inventory.stockStatus ?? null, sourceUrl: x.source?.productUrl },
      reviewIssues: plan.issues,
      variantLegacyIds: plan.variantLegacyIds,
      imageMeta: plan.images.map((i) => ({ variantSku: i.variantSku, sourceUrl: i.sourceUrl })),
    },
  });
  if (!saved.ok) {
    // Lost a race with another importer (unique index): the product exists now, which is the desired end state.
    if (saved.conflict) {
      const again = (await findExisting([plan])).get(plan.legacyId);
      if (again) return { ...base, status: "exists", productId: again.productId, matchedBy: again.matchedBy, images };
    }
    return { ...base, status: "failed", error: saved.error, images };
  }
  if (plan.isBestSeller) {
    await ProductCollection.updateOne({ key: "best-sellers" }, { $addToSet: { productIds: new Types.ObjectId(saved.id) }, $setOnInsert: { key: "best-sellers", name: "best sellers", status: "ACTIVE" } }, { upsert: true });
  }
  return { ...base, status: "created", productId: saved.id, images };
}
