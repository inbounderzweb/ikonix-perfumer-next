// Step 1: read-only scan of the source data and images, plus which products already exist on the target.
// Writes audit/bulk-upload/scan-report.json. Nothing is written to MongoDB or Cloudinary.
import fs from "node:fs";
import path from "node:path";
import { ROOT, SOURCE_FILE, connectTarget, disconnect, readSource, writeReport } from "./_common";
import { findExisting, planProduct, sourceProduct, type ProductPlan } from "../../src/server/catalogue/bulk-import";
import { productInput } from "../../src/server/admin/product-schema";

async function main() {
  const rows = readSource();
  const invalid: { id: string; error: string }[] = [];
  const plans: ProductPlan[] = [];
  for (const r of rows) {
    const p = sourceProduct.safeParse(r);
    if (!p.success) { invalid.push({ id: String((r as { id?: unknown }).id ?? "?"), error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` }); continue; }
    const plan = planProduct(p.data);
    // Same schema the admin form uses (images/categories are attached at create time).
    const check = productInput.safeParse({ ...plan.input, categoryIds: [], images: [] });
    if (!check.success) { invalid.push({ id: plan.legacyId, error: `${check.error.issues[0].path.join(".")}: ${check.error.issues[0].message}` }); continue; }
    plans.push(plan);
  }

  // Images on disk.
  const images = plans.flatMap((p) => p.images.map((i) => ({ ...i, legacyId: p.legacyId })));
  const missing = images.filter((i) => !fs.existsSync(path.join(ROOT, "public", i.path)));
  const bytes = images.reduce((s, i) => s + (fs.statSync(path.join(ROOT, "public", i.path), { throwIfNoEntry: false })?.size ?? 0), 0);
  const tooLarge = images.filter((i) => (fs.statSync(path.join(ROOT, "public", i.path), { throwIfNoEntry: false })?.size ?? 0) > 10 * 1024 * 1024);

  // Duplicates inside the source.
  const dup = <T,>(xs: T[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
  const dupSlugs = dup(plans.map((p) => p.slug));
  const dupSkus = dup(plans.flatMap((p) => p.skus));
  const dupIds = dup(plans.map((p) => p.legacyId));

  await connectTarget();
  const existing = await findExisting(plans);
  const newPlans = plans.filter((p) => !existing.has(p.legacyId));

  const report = {
    scannedAt: new Date().toISOString(), source: path.relative(ROOT, SOURCE_FILE),
    totals: {
      sourceProducts: rows.length, valid: plans.length, invalid: invalid.length,
      wouldPublish: plans.filter((p) => p.status === "ACTIVE").length, wouldDraft: plans.filter((p) => p.status === "DRAFT").length,
      variants: plans.reduce((s, p) => s + p.skus.length, 0), images: images.length, imageMegabytes: +(bytes / 1048576).toFixed(1),
      missingImages: missing.length, imagesOver10MB: tooLarge.length,
      duplicateSlugs: dupSlugs.length, duplicateSkus: dupSkus.length, duplicateIds: dupIds.length,
      alreadyOnTarget: existing.size, toCreate: newPlans.length,
    },
    invalid, missingImages: missing.map((i) => ({ legacyId: i.legacyId, path: i.path })), duplicates: { slugs: dupSlugs, skus: dupSkus, ids: dupIds },
    drafts: plans.filter((p) => p.status === "DRAFT").map((p) => ({ legacyId: p.legacyId, slug: p.slug, issues: p.issues })),
    existing: [...existing].map(([legacyId, m]) => ({ legacyId, ...m })),
    toCreate: newPlans.map((p) => ({ legacyId: p.legacyId, slug: p.slug, variants: p.skus.length, images: p.images.length, status: p.status })),
  };
  console.table(report.totals);
  console.log(`report: ${writeReport("scan-report.json", report)}`);
  if (invalid.length || missing.length || dupSlugs.length || dupSkus.length || dupIds.length) process.exitCode = 1;
}

main().catch((e) => { console.error("scan failed:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(disconnect);
