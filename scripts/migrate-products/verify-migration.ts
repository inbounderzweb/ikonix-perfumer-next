// Reconciles the ORIGINAL catalogue (public/ikonix/export/all-products.json + public/ikonix/products/**) against what is in
// MongoDB and on Cloudinary. Read-only: it never writes to the database, Cloudinary or the public folder.
//
//   npx tsx scripts/migrate-products/verify-migration.ts            (uses MONGODB_URI from .env)
//   MONGODB_URI=<other db> npx tsx scripts/migrate-products/verify-migration.ts
//
// Writes audit/migration-report.json and audit/migration-report.md. Exit code 1 if any discrepancy is unexplained.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connect, disconnect } from "../ikonix/_env";

type SrcVariant = { id: string; sizeValue: number | null; regularPrice: number | null; salePrice: number | null };
type Src = { id: string; name: string; slug: string; description: string | null; category: { slug: string } | null; variants: SrcVariant[]; images: { main?: string | null; gallery?: string[]; variants?: Record<string, string> }; inventory?: { stockStatus?: string } };
type DbVariant = { legacyId?: string; sizeValue?: number; regularPrice: number; salePrice: number; isActive: boolean; sku: string; issues?: unknown[] };
type DbImage = { url: string; sha256?: string; width?: number; height?: number };
type Db = { _id: { toString(): string }; legacyId?: string; name: string; slug: string; description?: string; status: string; primaryCategoryId?: { toString(): string }; variants: DbVariant[]; images: DbImage[]; reviewIssues?: string[] };

const ROOT = process.cwd();
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const toPaise = (r: number | null) => (r == null ? null : Math.round(r * 100));
const mismatches: { legacyId: string; slug: string; code: string; detail: string }[] = [];
const flag = (s: Src, code: string, detail: string) => mismatches.push({ legacyId: s.id, slug: s.slug, code, detail });

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function main() {
  const src = (JSON.parse(fs.readFileSync(path.join(ROOT, "public/ikonix/export/all-products.json"), "utf8")) as { products: Src[] }).products;
  const extraction = JSON.parse(fs.readFileSync(path.join(ROOT, "public/ikonix/export/extraction-report.json"), "utf8")) as { totals: Record<string, unknown> };
  const db = await connect();
  const dbProducts = (await db.collection("products").find({}).toArray()) as unknown as Db[];
  const cats = new Map((await db.collection("categories").find({}).toArray()).map((c) => [String(c._id), String(c.slug)]));
  const col = (await db.collection("collections").findOne({ key: "best-sellers" })) as { productIds?: { toString(): string }[] } | null;
  const bestSellers = new Set((col?.productIds ?? []).map(String));
  let bestSellerChecked = 0; const noGenderCategory: string[] = [];
  const byLegacy = new Map<string, Db[]>();
  for (const p of dbProducts) byLegacy.set(p.legacyId ?? "", [...(byLegacy.get(p.legacyId ?? "") ?? []), p]);

  let missing = 0, duplicates = 0, migrated = 0, srcImageRefs = 0, srcImagesOnDisk = 0, missingImageRefs = 0, imagesMatchedInDb = 0;
  const missingFiles: string[] = [];
  const urls = new Set<string>();

  for (const s of src) {
    const found = byLegacy.get(s.id) ?? [];
    if (found.length === 0) { missing++; flag(s, "MISSING_PRODUCT", "no MongoDB product with this legacyId"); continue; }
    if (found.length > 1) { duplicates++; flag(s, "DUPLICATE_PRODUCT", `${found.length} products share legacyId`); }
    const p = found[0]; migrated++;
    // The importer trims surrounding whitespace in names (153 source names had a trailing space); anything else is a mismatch.
    if (p.name !== s.name.trim()) flag(s, "NAME", `${s.name} != ${p.name}`);
    if (p.slug !== s.slug) flag(s, "SLUG", `${s.slug} != ${p.slug}`);
    if ((s.description ?? "").trim() !== (p.description ?? "").trim()) flag(s, "DESCRIPTION", "text differs");
    const catSlug = p.primaryCategoryId ? cats.get(String(p.primaryCategoryId)) : undefined;
    const want = s.category?.slug === "women's" || s.category?.slug === "womens" ? ["women's", "womens", "women"] : [s.category?.slug];
    if (s.category?.slug === "best-sellers") {
      // "Best sellers" is a merchandising collection, not a category: the product must be in that collection instead.
      if (!bestSellers.has(String(p._id))) flag(s, "COLLECTION", "source category best-sellers but product is not in the best-sellers collection");
      else bestSellerChecked++;
      if (!catSlug) noGenderCategory.push(s.slug);
    } else if (s.category && !want.includes(catSlug)) flag(s, "CATEGORY", `${s.category.slug} != ${catSlug ?? "none"}`);
    // Variants: same count, and each source variant matched by legacy id with identical size and prices (paise).
    if (p.variants.length !== s.variants.length) flag(s, "VARIANT_COUNT", `${s.variants.length} != ${p.variants.length}`);
    for (const v of s.variants) {
      const d = p.variants.find((x) => x.legacyId === v.id);
      if (!d) { flag(s, "VARIANT_MISSING", `legacy variant ${v.id}`); continue; }
      if (v.sizeValue != null && d.sizeValue !== v.sizeValue) flag(s, "VARIANT_SIZE", `${v.id}: ${v.sizeValue} != ${d.sizeValue}`);
      if (toPaise(v.regularPrice) !== d.regularPrice) flag(s, "PRICE_REGULAR", `${v.id}: ${v.regularPrice} != ${d.regularPrice / 100}`);
      if (toPaise(v.salePrice) !== d.salePrice) flag(s, "PRICE_SALE", `${v.id}: ${v.salePrice} != ${d.salePrice / 100}`);
    }
    // Images: every source file must exist locally and its exact bytes must be present on the product (by SHA-256).
    const refs = [...(s.images.main ? [s.images.main] : []), ...(s.images.gallery ?? []), ...Object.values(s.images.variants ?? {})].filter((r): r is string => !!r); // null = the source had no file for that slot (reported by the extractor)
    const have = new Set(p.images.map((i) => i.sha256));
    for (const ref of new Set(refs)) {
      srcImageRefs++;
      const file = path.join(ROOT, "public", ref);
      if (!fs.existsSync(file)) { missingImageRefs++; missingFiles.push(ref); flag(s, "SOURCE_FILE_MISSING", ref); continue; }
      srcImagesOnDisk++;
      if (have.has(sha(fs.readFileSync(file)))) imagesMatchedInDb++; else flag(s, "IMAGE_NOT_IN_DB", ref);
    }
    if (p.images.length === 0) flag(s, "NO_IMAGES", "product has no images in MongoDB");
    for (const i of p.images) urls.add(i.url);
  }
  const srcIds = new Set(src.map((s) => s.id));
  const extra = dbProducts.filter((p) => !srcIds.has(p.legacyId ?? ""));
  const dup = (k: (p: Db) => string | undefined) => { const m = new Map<string, number>(); for (const p of dbProducts) { const v = k(p); if (v) m.set(v, (m.get(v) ?? 0) + 1); } return [...m].filter(([, n]) => n > 1).length; };
  const dupSlug = dup((p) => p.slug), dupSku = (() => { const m = new Map<string, number>(); for (const p of dbProducts) for (const v of p.variants) m.set(v.sku, (m.get(v.sku) ?? 0) + 1); return [...m].filter(([, n]) => n > 1).length; })();

  // Every image URL the storefront will use must be reachable over HTTPS and be an image.
  const bad: string[] = []; const nonHttps: string[] = [];
  let checked = 0;
  await pool([...urls], 12, async (u) => {
    if (!u.startsWith("https://")) nonHttps.push(u);
    try { const r = await fetch(u, { method: "HEAD" }); if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) bad.push(`${r.status} ${u}`); } catch (e) { bad.push(`ERR ${(e as Error).message} ${u}`); }
    if (++checked % 500 === 0) console.log(`  checked ${checked}/${urls.size}`);
  });
  const mediaTotal = await db.collection("media_assets").countDocuments();
  await disconnect();

  const draft = dbProducts.filter((p) => p.status !== "ACTIVE");
  const unexplained = missing + duplicates + mismatches.filter((m) => m.code !== "SOURCE_FILE_MISSING").length + bad.length + nonHttps.length + extra.length + dupSlug + dupSku;
  const report = {
    generatedAt: new Date().toISOString(), database: process.env.MONGODB_URI?.startsWith("mongodb+srv") ? "atlas" : "local",
    sourceExtractionTotals: extraction.totals,
    totalSourceProducts: src.length, migratedProducts: migrated, missingProducts: missing, duplicateProducts: duplicates, extraProductsNotInSource: extra.length,
    importedAsDraftForReview: draft.length, draftSlugs: draft.map((p) => p.slug), duplicateSlugs: dupSlug, duplicateSkus: dupSku,
    sourceVariants: src.reduce((a, s) => a + s.variants.length, 0), dbVariants: dbProducts.reduce((a, p) => a + p.variants.length, 0),
    totalSourceImageRefs: srcImageRefs, sourceImagesFoundOnDisk: srcImagesOnDisk, missingImageRefs, missingImageFiles: missingFiles,
    imagesVerifiedByteIdenticalInDb: imagesMatchedInDb, uniqueImageUrlsInProducts: urls.size, mediaLibraryAssets: mediaTotal,
    urlsReachable: urls.size - bad.length, urlsFailed: bad.length, failedUrls: bad.slice(0, 50), nonHttpsUrls: nonHttps.length,
    dataMismatches: mismatches.length, mismatchByCode: mismatches.reduce<Record<string, number>>((a, m) => ((a[m.code] = (a[m.code] ?? 0) + 1), a), {}), mismatchSamples: mismatches.slice(0, 40),
    bestSellersCollectionMembersVerified: bestSellerChecked, productsWithoutGenderCategory: noGenderCategory.length, productsWithoutGenderCategorySlugs: noGenderCategory,
    unexplainedDiscrepancies: unexplained,
  };
  fs.mkdirSync(path.join(ROOT, "audit"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "audit/migration-report.json"), JSON.stringify({ ...report, allMismatches: mismatches }, null, 1));
  const md = `# Catalogue migration verification\n\nGenerated ${report.generatedAt} against the **${report.database}** database.\n\n| Check | Result |\n|---|---:|\n` + [
    ["Total source products", report.totalSourceProducts], ["Migrated (found in MongoDB)", migrated], ["Missing", missing], ["Duplicate products", duplicates], ["Extra products not in source", extra.length],
    ["Imported as DRAFT for review (source data issues)", draft.length], ["Duplicate slugs / duplicate SKUs", `${dupSlug} / ${dupSku}`], ["Source variants / MongoDB variants", `${report.sourceVariants} / ${report.dbVariants}`],
    ["Source image references", srcImageRefs], ["Found on disk", srcImagesOnDisk], ["Missing image references", missingImageRefs], ["Byte-identical to the Cloudinary-backed record", imagesMatchedInDb],
    ["Unique image URLs used by products", urls.size], ["Reachable over HTTPS", report.urlsReachable], ["Failed", bad.length], ["Best-sellers collection members verified", bestSellerChecked], ["Products whose source category was only \"best sellers\" (no men/women/unisex category in the source)", noGenderCategory.length], ["Data mismatches (names, prices, variants, categories, images)", mismatches.length], ["**Unexplained discrepancies**", unexplained],
  ].map(([k, v]) => `| ${k} | ${v} |`).join("\n") + `\n\nMismatches by type: ${JSON.stringify(report.mismatchByCode)}\n`;
  fs.writeFileSync(path.join(ROOT, "audit/migration-report.md"), md);
  console.log(md);
  process.exitCode = unexplained ? 1 : 0;
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
