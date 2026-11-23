// Step 2: upload the images of products that do not exist on the target yet, into the media library
// (Cloudinary account iombhcei + media_assets). Images of products already present are skipped.
// Idempotent: identical content is stored once (SHA-256), so re-running or resuming never duplicates.
// Writes audit/bulk-upload/upload-manifest.json (source path → Cloudinary public id / URL).
// Flags: --dry-run (validate only), --only=86,87 (legacy ids), --concurrency=4
import { auditMeta, connectTarget, diskLoader, disconnect, flag, option, pool, progress, readReport, readSource, signInAdmin, writeReport } from "./_common";
import { findExisting, planProduct, sourceProduct } from "../../src/server/catalogue/bulk-import";
import { storeImage, validateImageBuffer } from "../../src/server/media/cloudinary";
import { audit } from "../../src/server/admin/audit";

type Entry = { legacyId: string; path: string; ok: boolean; publicId?: string; url?: string; mediaId?: string; duplicate?: boolean; error?: string };

async function main() {
  const dryRun = flag("dry-run");
  await connectTarget({ needCloudinary: true });
  const admin = await signInAdmin();

  const plans = readSource().flatMap((r) => { const p = sourceProduct.safeParse(r); return p.success ? [planProduct(p.data)] : []; });
  const existing = await findExisting(plans);
  const todo = plans.filter((p) => !existing.has(p.legacyId)).flatMap((p) => p.images.map((i) => ({ legacyId: p.legacyId, slug: p.slug, name: p.name, ...i })));
  const prev = new Map((readReport<{ entries: Entry[] }>("upload-manifest.json")?.entries ?? []).filter((e) => e.ok).map((e) => [e.path, e]));
  console.log(`products already on target: ${existing.size}; images to process: ${todo.length}${dryRun ? " (dry run)" : ""}`);

  const entries = await pool(todo, Number(option("concurrency") ?? 4), async (img): Promise<Entry> => {
    const f = await diskLoader(img.path);
    if (!f) return { legacyId: img.legacyId, path: img.path, ok: false, error: "file missing" };
    const v = await validateImageBuffer(f.buffer);
    if (!v.ok) return { legacyId: img.legacyId, path: img.path, ok: false, error: v.error };
    if (dryRun) return { legacyId: img.legacyId, path: img.path, ok: true };
    for (let attempt = 1; ; attempt++) {
      try {
        const { asset, duplicate } = await storeImage(v, { folder: "products", filename: `${img.slug}-${f.filename}`, uploadedById: admin.id, legacySource: img.path, alt: img.name });
        if (!duplicate) await audit(admin, "media.upload", "MediaAsset", asset.id, { after: { publicId: asset.publicId, bytes: asset.bytes, via: "bulk-upload" } }, auditMeta);
        return { legacyId: img.legacyId, path: img.path, ok: true, publicId: asset.publicId, url: asset.url, mediaId: asset.id, duplicate: duplicate || prev.has(img.path) };
      } catch (e) {
        if (attempt >= 3) return { legacyId: img.legacyId, path: img.path, ok: false, error: e instanceof Error ? e.message : "upload failed" };
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }, progress("images", todo.length));

  const summary = { images: entries.length, ok: entries.filter((e) => e.ok).length, newlyUploaded: entries.filter((e) => e.ok && !e.duplicate && !dryRun).length, alreadyStored: entries.filter((e) => e.duplicate).length, failed: entries.filter((e) => !e.ok).length, productsSkippedAsExisting: existing.size };
  console.table(summary);
  if (!dryRun) console.log(`manifest: ${writeReport("upload-manifest.json", { uploadedAt: new Date().toISOString(), cloud: process.env.CLOUDINARY_CLOUD_NAME, summary, entries: [...prev.values(), ...entries].filter((e, i, a) => a.findIndex((x) => x.path === e.path) === i) })}`);
  if (summary.failed) { console.log("failed:", entries.filter((e) => !e.ok).slice(0, 20)); process.exitCode = 1; }
}

main().catch((e) => { console.error("upload failed:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(disconnect);
