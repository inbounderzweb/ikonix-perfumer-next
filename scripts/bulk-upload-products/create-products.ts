// Step 3: create the products through the application's product service (same validation, uniqueness,
// inventory and audit trail as the admin form). Existing products are reported as "exists" and never touched.
// Images are taken from the media library (step 2) by content hash; any not yet stored are uploaded here.
// Writes audit/bulk-upload/create-report.json.
// Flags: --dry-run, --only=86,87, --retry-failed (only products that failed in the last report), --concurrency=3
import { auditMeta, connectTarget, diskLoader, disconnect, flag, option, pool, progress, readReport, readSource, signInAdmin, writeReport } from "./_common";
import { importProduct, type ImportResult } from "../../src/server/catalogue/bulk-import";

async function main() {
  const dryRun = flag("dry-run");
  await connectTarget({ needCloudinary: true });
  const admin = await signInAdmin();

  let rows = readSource();
  const last = readReport<{ results: ImportResult[] }>("create-report.json");
  if (flag("retry-failed")) {
    const failed = new Set((last?.results ?? []).filter((r) => r.status === "failed").map((r) => r.legacyId));
    rows = rows.filter((r) => failed.has(String((r as { id?: unknown }).id)));
    console.log(`retrying ${rows.length} failed product(s)`);
  }

  const results = await pool(rows, Number(option("concurrency") ?? 3), (r) => importProduct(r, diskLoader, admin, { dryRun, auditMeta }).catch((e): ImportResult => ({
    legacyId: String((r as { id?: unknown }).id), slug: String((r as { slug?: unknown }).slug), name: String((r as { name?: unknown }).name),
    status: "failed", error: e instanceof Error ? e.message : "unexpected error", issues: [], variants: 0, images: [],
  })), progress("products", rows.length));

  const count = (s: ImportResult["status"]) => results.filter((r) => r.status === s).length;
  const summary = {
    processed: results.length, created: count("created"), wouldCreate: count("would-create"), alreadyExisting: count("exists"), failed: count("failed"),
    createdAsDraft: results.filter((r) => r.status === "created" && r.productStatus === "DRAFT").length,
    variantsCreated: results.filter((r) => r.status === "created").reduce((s, r) => s + r.variants, 0),
    imagesLinked: results.filter((r) => r.status === "created").reduce((s, r) => s + r.images.length, 0),
    imagesNewlyUploaded: results.reduce((s, r) => s + r.images.filter((i) => i.ok && !i.duplicate && i.mediaId).length, 0),
    imageFailures: results.reduce((s, r) => s + r.images.filter((i) => !i.ok).length, 0),
  };
  console.table(summary);
  // Merge with the previous report so a retry run keeps earlier outcomes.
  const merged = new Map((dryRun ? [] : last?.results ?? []).map((r) => [r.legacyId, r]));
  for (const r of results) merged.set(r.legacyId, r);
  const file = writeReport(dryRun ? "create-report.dry-run.json" : "create-report.json", { ranAt: new Date().toISOString(), dryRun, admin: admin.email, summary, results: [...merged.values()] });
  console.log(`report: ${file}`);
  const failed = results.filter((r) => r.status === "failed");
  if (failed.length) { console.log("failed:", failed.slice(0, 20).map((f) => `${f.legacyId} ${f.slug}: ${f.error}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error("create failed:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(disconnect);
