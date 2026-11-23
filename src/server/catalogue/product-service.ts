import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Category, Inventory, InventoryMovement, MediaAsset, Product } from "@/server/models";
import { audit, type AuditActor, type AuditMeta } from "@/server/admin/audit";
import { toPaise, type ProductParsed } from "@/server/admin/product-schema";

/**
 * The one product write path. The admin form (Server Action) and the bulk importer (admin route + CLI)
 * all call this, so every product gets the same validation, uniqueness, inventory and audit handling.
 * Callers are responsible for authentication/permission checks and for cache revalidation.
 */
export type SaveResult = { ok: true; id: string; slug: string; created: boolean } | { ok: false; error: string; fields?: Record<string, string>; conflict?: boolean };

/** Fields the admin form does not edit; only trusted server code (the importer) passes them. */
export type ImportExtras = {
  legacyId?: string;
  brandId?: Types.ObjectId | null;
  inspiredByBrandId?: Types.ObjectId | null;
  fragranceFamily?: string;
  launchYear?: number;
  perfumers?: string[];
  legacy?: { stockStatus?: string | null; sourceUrl?: string };
  /** Kept on DRAFT products so staff can see why they were not published. */
  reviewIssues?: string[];
  /** Variant SKU → legacy variant id (drives /product-details/:pid?vid= redirects). */
  variantLegacyIds?: Record<string, string>;
  /** Per image (same order as input.images): the variant SKU the photo belongs to, and its original URL. */
  imageMeta?: { variantSku?: string | null; sourceUrl?: string }[];
};

const fail = (error: string, fields?: Record<string, string>, conflict?: boolean): SaveResult => ({ ok: false, error, fields, conflict });
const oid = (s: string) => new Types.ObjectId(s);

type ImgLean = { _id: Types.ObjectId; url: string; storageKey: string; alt?: string; width: number; height: number; bytes?: number; sha256?: string; sourceUrl?: string; variantId?: Types.ObjectId | null };

export async function saveProductRecord(input: ProductParsed, actor: AuditActor, opts: { extras?: ImportExtras; createOnly?: boolean; auditMeta?: AuditMeta } = {}): Promise<SaveResult> {
  const { extras, createOnly, auditMeta } = opts;
  await db();

  // ── cross-field rules ───────────────────────────────────────────────
  const skus = input.variants.map((v) => v.sku.toLowerCase());
  if (new Set(skus).size !== skus.length) return fail("Two sizes share the same SKU.");
  for (const [i, v] of input.variants.entries()) {
    if (v.isActive && v.salePrice > v.regularPrice) return fail(`Size "${v.label}": sale price cannot exceed the regular price.`, { [`variants.${i}.salePrice`]: "Sale price exceeds regular price" });
    if (v.isActive && v.salePrice <= 0) return fail(`Size "${v.label}": an active size needs a price above zero.`, { [`variants.${i}.salePrice`]: "Must be above zero" });
  }
  if (input.status === "ACTIVE" && !input.variants.some((v) => v.isActive)) return fail("A published product needs at least one active size.");
  if (createOnly && input.id) return fail("Create-only save cannot target an existing product.");

  // Categories must exist (client ids are never trusted).
  if (input.categoryIds.length) {
    const found = await Category.countDocuments({ _id: { $in: input.categoryIds.map(oid) }, deletedAt: null });
    if (found !== new Set(input.categoryIds).size) return fail("A selected category no longer exists.");
  }

  // Images: only library assets or images the product already owns. URLs are read from the DB, never from the client.
  const existing = input.id ? await Product.findOne({ _id: input.id }) : null;
  if (input.id && !existing) return fail("Product not found.");
  const ownImages = new Map(((existing?.images ?? []) as unknown as ImgLean[]).map((i) => [String(i._id), i]));
  const mediaIds = input.images.flatMap((i) => (i.kind === "media" ? [i.mediaId] : []));
  const media = (await MediaAsset.find({ _id: { $in: mediaIds } }).lean()) as unknown as { _id: Types.ObjectId; url: string; publicId: string; width: number; height: number; bytes: number; sha256: string; alt?: string }[];
  const mediaMap = new Map(media.map((m) => [String(m._id), m]));
  const images: Record<string, unknown>[] = [];
  for (const [idx, img] of input.images.entries()) {
    const sourceUrl = extras?.imageMeta?.[idx]?.sourceUrl;
    if (img.kind === "media") {
      const m = mediaMap.get(img.mediaId);
      if (!m) return fail("An image is no longer in the media library.");
      images.push({ storageKey: m.publicId, url: m.url, alt: img.alt ?? m.alt ?? input.name, width: m.width, height: m.height, bytes: m.bytes, sha256: m.sha256, sortOrder: idx, variantId: null, ...(sourceUrl ? { sourceUrl } : {}) });
    } else {
      const o = ownImages.get(img.id);
      if (!o) return fail("An image does not belong to this product.");
      images.push({ _id: o._id, storageKey: o.storageKey, url: o.url, alt: img.alt ?? o.alt ?? input.name, width: o.width, height: o.height, bytes: o.bytes, sha256: o.sha256, sourceUrl: o.sourceUrl, sortOrder: idx, variantId: o.variantId ?? null });
    }
  }

  // ── variants ────────────────────────────────────────────────────────
  const prevVariants = new Map(((existing?.variants ?? []) as unknown as { _id: Types.ObjectId }[]).map((v) => [String(v._id), v]));
  const variants: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const [idx, v] of input.variants.entries()) {
    if (v.id && !prevVariants.has(v.id)) return fail("A size does not belong to this product.");
    if (v.id) seen.add(v.id);
    const legacyId = extras?.variantLegacyIds?.[v.sku];
    variants.push({
      ...(v.id ? { _id: oid(v.id) } : {}),
      ...(legacyId ? { legacyId } : {}),
      sku: v.sku, label: v.label, sizeValue: v.sizeValue, sizeUnit: "ml", regularPrice: toPaise(v.regularPrice), salePrice: toPaise(v.salePrice),
      isActive: v.isActive, sortOrder: idx,
    });
  }
  // Sizes missing from the form are never deleted (orders may reference them): they are switched off.
  for (const [id, old] of prevVariants) if (!seen.has(id)) variants.push({ ...(old as unknown as { toObject(): object }).toObject(), isActive: false });

  const fields: Record<string, unknown> = {
    name: input.name, slug: input.slug, subtitle: input.subtitle || undefined, status: input.status, gender: input.gender || null,
    inspiredByName: input.inspiredByName || undefined, categoryIds: input.categoryIds.map(oid), primaryCategoryId: input.categoryIds[0] ? oid(input.categoryIds[0]) : null,
    description: input.description || undefined, shortDescription: input.shortDescription || undefined, notes: input.notes,
    seo: { title: input.seo.title || undefined, description: input.seo.description || undefined }, images, variants,
  };
  if (extras) {
    if (extras.legacyId) fields.legacyId = extras.legacyId;
    if (extras.brandId !== undefined) fields.brandId = extras.brandId;
    if (extras.inspiredByBrandId !== undefined) fields.inspiredByBrandId = extras.inspiredByBrandId;
    if (extras.fragranceFamily) fields.fragranceFamily = extras.fragranceFamily;
    if (extras.launchYear) fields.launchYear = extras.launchYear;
    if (extras.perfumers) fields.perfumers = extras.perfumers;
    if (extras.legacy) fields.legacy = extras.legacy;
  }

  const before = existing ? { name: existing.name, slug: existing.slug, status: existing.status } : undefined;
  const doc = existing ?? new Product();
  doc.set(fields);
  const imgs = doc.images as unknown as { _id: Types.ObjectId; variantId?: Types.ObjectId | null }[];
  // Variant photos: link each to its (now id-bearing) variant.
  if (extras?.imageMeta) {
    const bySku = new Map((doc.variants as unknown as { _id: Types.ObjectId; sku: string }[]).map((v) => [v.sku, v._id]));
    extras.imageMeta.forEach((m, i) => { if (m.variantSku && imgs[i]) imgs[i].variantId = bySku.get(m.variantSku) ?? null; });
  }
  doc.primaryImageId = imgs[0]?._id ?? null;
  if (input.status === "ACTIVE") { doc.reviewIssues = []; doc.publishedAt ??= new Date(); doc.deletedAt = undefined; }
  else if (extras?.reviewIssues) doc.reviewIssues = extras.reviewIssues;
  try {
    await doc.save();
  } catch (e) {
    const err = e as { code?: number; keyPattern?: Record<string, unknown> };
    if (err.code === 11000) {
      const k = Object.keys(err.keyPattern ?? {})[0] ?? "";
      const msg = k === "slug" ? "That URL slug is already used by another product." : k === "legacyId" ? "A product with this legacy id already exists." : k.startsWith("variants.legacyId") ? "A size with this legacy id already exists." : "A SKU is already used by another product.";
      return fail(msg, k === "slug" ? { slug: "Already in use" } : undefined, true);
    }
    throw e;
  }

  // ── inventory (one row per size) ────────────────────────────────────
  const saved = doc.variants as unknown as { _id: Types.ObjectId; sku: string }[];
  for (const v of input.variants) {
    const sv = saved.find((s) => s.sku === v.sku);
    if (!sv) continue;
    const inv = (await Inventory.findOne({ variantId: sv._id }).lean()) as unknown as { onHand: number; reserved: number } | null;
    const reserved = inv?.reserved ?? 0;
    if (v.tracked && v.onHand < reserved) return fail(`Size "${v.label}": ${reserved} units are reserved by open orders; on-hand cannot go below that.`);
    await Inventory.updateOne(
      { variantId: sv._id },
      { $set: { productId: doc._id, sku: v.sku, tracked: v.tracked, manualAvailability: v.availability, ...(v.tracked ? { onHand: v.onHand } : {}) }, $setOnInsert: { reserved: 0, ...(v.tracked ? {} : { onHand: 0 }) } },
      { upsert: true },
    );
    if (v.tracked && inv && inv.onHand !== v.onHand) {
      await InventoryMovement.create({ variantId: sv._id, productId: doc._id, type: "ADJUSTMENT", onHandDelta: v.onHand - inv.onHand, onHandAfter: v.onHand, reservedAfter: reserved, reason: "Edited in admin", actorUserId: actor.id });
    }
  }

  await audit(actor, existing ? "product.update" : "product.create", "Product", String(doc._id), { before, after: { name: doc.name, slug: doc.slug, status: doc.status, variants: input.variants.length, images: images.length, ...(extras?.legacyId ? { legacyId: extras.legacyId, via: "bulk-import" } : {}) } }, auditMeta);
  return { ok: true, id: String(doc._id), slug: doc.slug, created: !existing };
}
