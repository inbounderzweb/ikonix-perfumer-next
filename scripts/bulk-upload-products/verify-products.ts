// Step 4: read-only verification of every source product against the target database and Cloudinary.
// Checks product, variants (SKU, prices in paise, active flag, legacy ids), images (byte-identical by SHA-256,
// order, variant links, primary image, hosted on the expected Cloudinary account, reachable over HTTPS) and
// inventory rows. Writes audit/bulk-upload/verify-report.{json,md}; exits 1 on any discrepancy.
// Flags: --only=86,87, --skip-http (no HEAD requests)
import { EXPECTED_CLOUD, connectTarget, disconnect, flag, pool, progress, readReport, readSource, sha256File, writeReport } from "./_common";
import { planProduct, sourceProduct } from "../../src/server/catalogue/bulk-import";
import { Inventory, MediaAsset, Product } from "../../src/server/models";

type P = {
  _id: unknown; legacyId: string; slug: string; name: string; status: string; primaryImageId?: unknown;
  variants: { _id: unknown; legacyId?: string; sku: string; regularPrice: number; salePrice: number; isActive: boolean }[];
  images: { _id: unknown; url: string; storageKey: string; sha256?: string; sortOrder: number; variantId?: unknown }[];
};

async function main() {
  await connectTarget();
  const plans = readSource().flatMap((r) => { const p = sourceProduct.safeParse(r); return p.success ? [{ plan: planProduct(p.data), src: p.data }] : []; });
  const problems: { legacyId: string; slug: string; check: string; detail: string }[] = [];
  const bad = (legacyId: string, slug: string, check: string, detail: string) => problems.push({ legacyId, slug, check, detail });

  const products = (await Product.find({ legacyId: { $in: plans.map((p) => p.plan.legacyId) } }).lean()) as unknown as P[];
  const byLegacy = new Map(products.map((p) => [p.legacyId, p]));
  const inv = (await Inventory.find({ productId: { $in: products.map((p) => p._id) } } as never, "variantId").lean()) as unknown as { variantId: unknown }[];
  const invSet = new Set(inv.map((i) => String(i.variantId)));

  let sourceImages = 0, matchedImages = 0, variants = 0, sourceVariants = 0;
  const urls = new Set<string>();
  const shaByUrl = new Map<string, string>();
  for (const { plan, src } of plans) {
    const { legacyId, slug } = plan;
    const p = byLegacy.get(legacyId);
    sourceImages += plan.images.length;
    sourceVariants += plan.skus.length;
    if (!p) { bad(legacyId, slug, "product", "missing on target"); continue; }
    if (p.slug !== slug) bad(legacyId, slug, "slug", `target has ${p.slug}`);
    if (p.name.trim() !== plan.name) bad(legacyId, slug, "name", `target "${p.name}"`);
    if (p.status === "ARCHIVED") bad(legacyId, slug, "status", "archived on target");

    // Variants
    variants += p.variants.length;
    for (const sv of src.variants) {
      const tv = p.variants.find((v) => v.legacyId === sv.id);
      const want = plan.input.variants.find((v) => v.sku === Object.keys(plan.variantLegacyIds).find((k) => plan.variantLegacyIds[k] === sv.id));
      if (!tv || !want) { bad(legacyId, slug, "variant", `size id ${sv.id} missing`); continue; }
      if (tv.sku !== want.sku) bad(legacyId, slug, "sku", `${tv.sku} ≠ ${want.sku}`);
      if (tv.regularPrice !== Math.round(Number(want.regularPrice) * 100)) bad(legacyId, slug, "mrp", `${tv.sku}: ${tv.regularPrice} ≠ ${Math.round(Number(want.regularPrice) * 100)} paise`);
      if (tv.salePrice !== Math.round(Number(want.salePrice) * 100)) bad(legacyId, slug, "sale price", `${tv.sku}: ${tv.salePrice} ≠ ${Math.round(Number(want.salePrice) * 100)} paise`);
      if (tv.isActive !== want.isActive) bad(legacyId, slug, "active", `${tv.sku}: ${tv.isActive} ≠ ${want.isActive}`);
      if (!invSet.has(String(tv._id))) bad(legacyId, slug, "inventory", `${tv.sku}: no inventory row`);
    }
    if (p.variants.length !== src.variants.length) bad(legacyId, slug, "variant count", `${p.variants.length} ≠ ${src.variants.length}`);

    // Images: same bytes, same order, same variant links
    const ordered = [...p.images].sort((a, b) => a.sortOrder - b.sortOrder);
    if (ordered.length !== plan.images.length) bad(legacyId, slug, "image count", `${ordered.length} ≠ ${plan.images.length}`);
    plan.images.forEach((img, i) => {
      const t = ordered[i];
      if (!t) return;
      const sha = sha256File(img.path);
      if (t.sha256 !== sha) { bad(legacyId, slug, "image bytes/order", `#${i} ${img.path} differs`); return; }
      matchedImages++;
      const wantVariant = img.variantSku ? p.variants.find((v) => v.sku === img.variantSku)?._id : null;
      if (String(t.variantId ?? null) !== String(wantVariant ?? null)) bad(legacyId, slug, "variant image", `#${i} ${img.path} not linked to ${img.variantSku ?? "product"}`);
      if (!t.url.startsWith(`https://res.cloudinary.com/${EXPECTED_CLOUD}/`)) bad(legacyId, slug, "cloudinary account", `#${i} ${t.url.split("/")[3]}`);
      urls.add(t.url);
      shaByUrl.set(t.url, sha);
    });
    if (ordered[0] && String(p.primaryImageId) !== String(ordered[0]._id)) bad(legacyId, slug, "primary image", "primaryImageId is not the first image");
  }

  // Collection-wide uniqueness
  const dupSlugs = await Product.aggregate([{ $group: { _id: "$slug", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const dupSkus = await Product.aggregate([{ $unwind: "$variants" }, { $group: { _id: "$variants.sku", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const dupLegacy = await Product.aggregate([{ $match: { legacyId: { $type: "string" } } }, { $group: { _id: "$legacyId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  // The media library is content-addressed (one asset per SHA-256). A product photo that is byte-identical to
  // another product's photo may have its own Cloudinary URL while the library lists the first copy: not an error.
  const lib = (await MediaAsset.find({ sha256: { $in: [...new Set(shaByUrl.values())] } }, "url sha256").lean()) as unknown as { url: string; sha256: string }[];
  const libUrls = new Set(lib.map((m) => m.url));
  const libShas = new Set(lib.map((m) => m.sha256));
  const mediaMissing = [...urls].filter((u) => !libShas.has(shaByUrl.get(u)!));
  const sharedContent = [...urls].filter((u) => !libUrls.has(u) && libShas.has(shaByUrl.get(u)!));

  let reachable = 0;
  const unreachable: string[] = [];
  if (!flag("skip-http")) {
    const list = [...urls];
    await pool(list, 12, async (u) => {
      for (let a = 0; a < 3; a++) {
        const r = await fetch(u, { method: "HEAD" }).catch(() => null);
        if (r?.ok) { reachable++; return; }
      }
      unreachable.push(u);
    }, progress("HEAD", list.length));
  }
  for (const u of unreachable) problems.push({ legacyId: "-", slug: "-", check: "image reachable", detail: u });
  for (const u of mediaMissing) problems.push({ legacyId: "-", slug: "-", check: "media library", detail: `${u}: content not in media_assets` });

  const create = readReport<{ summary: Record<string, number> }>("create-report.json")?.summary ?? null;
  const totals = {
    sourceProducts: plans.length, foundOnTarget: byLegacy.size, missing: plans.length - byLegacy.size,
    sourceVariants, targetVariants: variants, inventoryRows: inv.length,
    sourceImages, imagesVerifiedByteIdentical: matchedImages, uniqueImageUrls: urls.size, mediaLibraryAssets: libUrls.size, urlsSharingContentWithAnotherProduct: sharedContent.length, reachable: flag("skip-http") ? "skipped" : reachable, unreachable: unreachable.length,
    duplicateSlugs: dupSlugs.length, duplicateSkus: dupSkus.length, duplicateLegacyIds: dupLegacy.length, discrepancies: problems.length,
  };
  console.table(totals);
  const md = [
    "# Bulk upload verification", "", `Run: ${new Date().toISOString()}`, "",
    "| Check | Result |", "|---|---:|", ...Object.entries(totals).map(([k, v]) => `| ${k} | ${v} |`), "",
    ...(create ? ["## Last create run", "", "| | |", "|---|---:|", ...Object.entries(create).map(([k, v]) => `| ${k} | ${v} |`), ""] : []),
    "## Discrepancies", "", problems.length ? problems.slice(0, 200).map((p) => `- ${p.legacyId} ${p.slug}: **${p.check}**: ${p.detail}`).join("\n") : "None.", "",
  ].join("\n");
  writeReport("verify-report.json", { verifiedAt: new Date().toISOString(), totals, lastCreateRun: create, problems });
  console.log(`report: ${writeReport("verify-report.md", md)}`);
  if (problems.length) { console.log(problems.slice(0, 15)); process.exitCode = 1; }
}

main().catch((e) => { console.error("verify failed:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(disconnect);
