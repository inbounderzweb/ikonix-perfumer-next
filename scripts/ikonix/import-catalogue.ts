// Imports the extracted legacy catalogue (public/ikonix/export/*.json + product images) into MongoDB.
// Idempotent: products are matched by legacyId; variant/image _ids are preserved across runs;
// inventory is only created, never overwritten (so real stock entered later is safe).
//
// Usage: npx tsx scripts/ikonix/import-catalogue.ts
//
// Data rules (docs/rebuild/02-architecture.md §3):
// - Nothing is guessed. Invalid legacy values are kept, the variant is made inactive, and the
//   product is imported as DRAFT with `reviewIssues` explaining why.
// - Legacy categories mens / women's / unisex become categories; "best sellers" becomes a collection.
// - Prices: legacy rupees → integer paise. Sizes are ml (the legacy UI renders "<n> ml").
// - SKU: IKX-{legacyProductId}-{size} (provisional; pattern awaiting approval).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { Types } from "mongoose";
import { connect, disconnect } from "./_env";
import { Brand, Category, Inventory, Product, ProductCollection } from "../../src/server/models";

const ROOT = process.cwd();
const EXPORT = path.join(ROOT, "public/ikonix/export");
const STANDARD_SIZES = new Set([30, 50, 100]);
const GENDER: Record<string, "MEN" | "WOMEN" | "UNISEX"> = { Men: "MEN", Women: "WOMEN", Unisex: "UNISEX" };
const CATEGORY_GENDER: Record<string, "MEN" | "WOMEN" | "UNISEX"> = { "4": "MEN", "5": "WOMEN", "6": "UNISEX" };
const BEST_SELLERS_LEGACY_ID = "2";

type Extracted = {
  id: string; name: string; slug: string; subtitle: string | null; description: string | null;
  category: { id: string; name: string; slug: string };
  variants: { id: string; size: string | null; sizeValue: number | null; regularPrice: number | null; salePrice: number | null; image: string | null; sourceImageUrl: string | null }[];
  specifications: { fragranceNotes: { top: string[]; middle: string[]; base: string[] } };
  derivedFromDescription: { inspiredByFragrance: string | null; inspiredByBrand: string | null; fragranceFamily: string | null; gender: string | null; launchYear: number | null; perfumers: string[] };
  inventory: { stockStatus: string | null };
  images: { main: string | null; gallery: string[]; variants: Record<string, string | null> };
  source: { productUrl: string; originalImageUrls: string[] };
};
type ExtractedCategory = { id: string; name: string; slug: string; image: string | null; productIds: string[] };

const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(EXPORT, f), "utf8")) as T;
const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const paise = (rupees: number | null) => (rupees == null ? null : Math.round(rupees * 100));

const imageMetaCache = new Map<string, { width: number; height: number; bytes: number; sha256: string }>();
async function imageMeta(publicUrl: string) {
  const cached = imageMetaCache.get(publicUrl);
  if (cached) return cached;
  const abs = path.join(ROOT, "public", publicUrl);
  const buf = fs.readFileSync(abs);
  const m = await sharp(buf).metadata();
  if (!m.width || !m.height) throw new Error(`cannot read dimensions of ${publicUrl}`);
  const meta = { width: m.width, height: m.height, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
  imageMetaCache.set(publicUrl, meta);
  return meta;
}

async function main() {
  await connect();
  const { products: extracted } = readJson<{ products: Extracted[] }>("all-products.json");
  const { categories: extractedCategories } = readJson<{ categories: ExtractedCategory[] }>("categories.json");
  const report = { products: 0, created: 0, updated: 0, draft: [] as { id: string; slug: string; issues: string[] }[], variants: 0, inactiveVariants: 0, images: 0, inventoryCreated: 0, genderConflicts: [] as string[] };

  // ── Brands ──
  const house = await Brand.findOneAndUpdate(
    { slug: "ikonix-perfumer" },
    { $setOnInsert: { kind: "HOUSE", name: "Ikonix Perfumer", slug: "ikonix-perfumer", status: "ACTIVE" } },
    { upsert: true, returnDocument: "after" },
  );
  const brandIdByName = new Map<string, Types.ObjectId>();
  for (const name of new Set(extracted.map((p) => p.derivedFromDescription.inspiredByBrand).filter((b): b is string => !!b))) {
    const slug = slugify(name);
    if ([...brandIdByName.keys()].some((n) => slugify(n) === slug)) {
      brandIdByName.set(name, brandIdByName.get([...brandIdByName.keys()].find((n) => slugify(n) === slug)!)!);
      continue;
    }
    const b = await Brand.findOneAndUpdate({ slug }, { $setOnInsert: { kind: "INSPIRATION", name, slug, status: "ACTIVE" } }, { upsert: true, returnDocument: "after" });
    brandIdByName.set(name, b._id);
  }

  // ── Categories (gendered) + best-sellers collection ──
  const categoryIdByLegacy = new Map<string, Types.ObjectId>();
  let sort = 0;
  for (const c of extractedCategories) {
    if (c.id === BEST_SELLERS_LEGACY_ID) continue;
    const doc = await Category.findOneAndUpdate(
      { legacyId: c.id },
      { $setOnInsert: { legacyId: c.id, name: c.name, slug: c.slug, imageUrl: c.image, sortOrder: sort++, status: "ACTIVE" } },
      { upsert: true, returnDocument: "after" },
    );
    categoryIdByLegacy.set(c.id, doc._id);
  }
  const legacyCategoryForGender: Record<string, string> = { MEN: "4", WOMEN: "5", UNISEX: "6" };

  // ── Products ──
  const productIdByLegacy = new Map<string, Types.ObjectId>();
  for (const x of extracted) {
    const issues: string[] = [];
    const derivedGender = x.derivedFromDescription.gender ? GENDER[x.derivedFromDescription.gender] : undefined;
    const isBestSeller = x.category.id === BEST_SELLERS_LEGACY_ID;
    let gender: "MEN" | "WOMEN" | "UNISEX" | null = CATEGORY_GENDER[x.category.id] ?? derivedGender ?? null;
    if (!isBestSeller && derivedGender && derivedGender !== CATEGORY_GENDER[x.category.id]) {
      report.genderConflicts.push(`${x.id}: legacy category ${x.category.name}, description says ${derivedGender}`);
    }
    const categoryLegacyId = isBestSeller ? (gender ? legacyCategoryForGender[gender] : undefined) : x.category.id;
    const categoryId = categoryLegacyId ? categoryIdByLegacy.get(categoryLegacyId) : undefined;
    if (!categoryId) {
      issues.push(`No category: legacy category was "${x.category.name}" and the description states no gender.`);
      gender = gender ?? null;
    }
    if (!x.description?.trim()) issues.push("Description is empty in the legacy data.");

    const existing = await Product.findOne({ legacyId: x.id });
    const doc = existing ?? new Product({ legacyId: x.id });
    const existingVariants = new Map((existing?.variants ?? []).map((v) => [v.legacyId, v._id]));
    const existingImages = new Map((existing?.images ?? []).map((i) => [i.storageKey, i._id]));

    const variants = x.variants.map((v, i) => {
      const vIssues: string[] = [];
      const regular = paise(v.regularPrice);
      const sale = paise(v.salePrice);
      if (regular == null || sale == null) vIssues.push("Price missing in legacy data.");
      else if (sale > regular) vIssues.push(`Legacy sale price ₹${v.salePrice} is higher than MRP ₹${v.regularPrice}.`);
      if (v.sizeValue != null && !STANDARD_SIZES.has(v.sizeValue)) vIssues.push(`Unusual size "${v.size}" (all other variants use 30/50/100 ml); confirm the bottle size.`);
      const priceInvalid = regular == null || sale == null || sale > regular;
      issues.push(...vIssues.map((m) => `Variant ${v.size} ml (vid ${v.id}): ${m}`));
      return {
        _id: existingVariants.get(v.id) ?? new Types.ObjectId(),
        legacyId: v.id,
        sku: `IKX-${x.id}-${v.size ?? `v${v.id}`}`,
        sizeValue: v.sizeValue ?? undefined,
        sizeUnit: "ml",
        label: v.size ? `${v.size} ml` : `Variant ${v.id}`,
        regularPrice: regular ?? 0,
        salePrice: sale ?? 0,
        isActive: !priceInvalid, // an unsellable price is kept for correction but cannot be bought
        sortOrder: i,
        issues: vIssues,
      };
    });

    // Images: main (sortOrder 0), gallery, then variant photos linked to their variant.
    const srcUrls = x.source.originalImageUrls;
    const images: Record<string, unknown>[] = [];
    let primaryImageId: Types.ObjectId | null = null;
    const addImage = async (url: string | null, sourceUrl: string | undefined, variantId: Types.ObjectId | null) => {
      if (!url) return null;
      const meta = await imageMeta(url);
      const storageKey = url.replace(/^\//, "");
      const _id = existingImages.get(storageKey) ?? new Types.ObjectId();
      images.push({ _id, variantId, storageKey, url, alt: x.name.trim(), ...meta, sortOrder: images.length, sourceUrl });
      return _id;
    };
    let srcIdx = 0;
    if (x.images.main) primaryImageId = await addImage(x.images.main, srcUrls[srcIdx++], null);
    for (const g of x.images.gallery) await addImage(g, srcUrls[srcIdx++], null);
    for (const v of x.variants) {
      const local = x.images.variants[v.id];
      if (local) await addImage(local, v.sourceImageUrl ?? undefined, variants.find((vv) => vv.legacyId === v.id)!._id);
    }
    report.images += images.length;

    doc.set({
      name: x.name,
      slug: x.slug,
      subtitle: x.subtitle ?? undefined,
      description: x.description ?? undefined,
      status: issues.length ? "DRAFT" : "ACTIVE",
      brandId: house._id,
      inspiredByBrandId: x.derivedFromDescription.inspiredByBrand ? brandIdByName.get(x.derivedFromDescription.inspiredByBrand) : null,
      inspiredByName: x.derivedFromDescription.inspiredByFragrance ?? undefined,
      categoryIds: categoryId ? [categoryId] : [],
      primaryCategoryId: categoryId ?? null,
      gender,
      fragranceFamily: x.derivedFromDescription.fragranceFamily ?? undefined,
      launchYear: x.derivedFromDescription.launchYear ?? undefined,
      perfumers: x.derivedFromDescription.perfumers,
      notes: x.specifications.fragranceNotes,
      variants,
      images,
      primaryImageId,
      reviewIssues: issues,
      legacy: { stockStatus: x.inventory.stockStatus, sourceUrl: x.source.productUrl },
      publishedAt: issues.length ? undefined : (doc.publishedAt ?? new Date()),
    });
    await doc.save();
    if (existing) report.updated++;
    else report.created++;
    report.products++;
    report.variants += variants.length;
    report.inactiveVariants += variants.filter((v) => !v.isActive).length;
    if (issues.length) report.draft.push({ id: x.id, slug: x.slug, issues });
    productIdByLegacy.set(x.id, doc._id);

    // Inventory: create once at 0, untracked, with availability from the legacy in/out-of-stock flag.
    // Never overwrite stock or availability that was entered later.
    const legacyAvailability = x.inventory.stockStatus === "in_stock" ? "IN_STOCK" : "OUT_OF_STOCK";
    for (const v of variants) {
      const r = await Inventory.updateOne(
        { variantId: v._id },
        { $setOnInsert: { variantId: v._id, productId: doc._id, sku: v.sku, onHand: 0, reserved: 0, lowStockThreshold: 5, tracked: false, manualAvailability: legacyAvailability } },
        { upsert: true },
      );
      report.inventoryCreated += r.upsertedCount;
      // Backfill rows created before these fields existed (only where unset).
      await Inventory.updateOne({ variantId: v._id, tracked: { $exists: false } }, { $set: { tracked: false, manualAvailability: legacyAvailability } });
    }
  }

  // Best sellers collection, in legacy API order.
  const best = extractedCategories.find((c) => c.id === BEST_SELLERS_LEGACY_ID);
  if (best) {
    await ProductCollection.findOneAndUpdate(
      { key: "best-sellers" },
      { $set: { name: best.name, productIds: best.productIds.map((id) => productIdByLegacy.get(id)).filter(Boolean) }, $setOnInsert: { key: "best-sellers", status: "ACTIVE" } },
      { upsert: true },
    );
  }

  const out = path.join(ROOT, "public/ikonix/logs/import-report.json");
  fs.writeFileSync(out, JSON.stringify({ importedAt: new Date().toISOString(), ...report }, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, draft: report.draft.length, genderConflicts: report.genderConflicts.length }, null, 2));
  console.log(`report: ${path.relative(ROOT, out)}`);
}

main().then(disconnect, async (e) => { console.error(e); await disconnect(); process.exit(1); });
