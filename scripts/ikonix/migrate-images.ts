// Uploads every local product image (public/ikonix/products/**) to Cloudinary, records it in the media
// library and repoints product.images[].url at the Cloudinary URL. Idempotent and resumable: images already on
// Cloudinary are skipped, identical content is stored once (SHA-256), local files are NEVER deleted.
// Usage: npx tsx scripts/ikonix/migrate-images.ts [--limit N] [--dry]
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { connect, disconnect } from "./_env";
import { MediaAsset, Product } from "../../src/server/models";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const DRY = process.argv.includes("--dry");
const CONCURRENCY = 4;
const PUBLIC_DIR = path.join(process.cwd(), "public");

type Img = { _id: { toString(): string }; url: string; alt?: string; width: number; height: number };
type Prod = { _id: unknown; slug: string; name: string; images: Img[] };

async function uploadBuffer(buf: Buffer, publicId: string) {
  return new Promise<import("cloudinary").UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: "image", overwrite: false, unique_filename: false, use_filename: false },
      (err, r) => (err || !r ? reject(err ?? new Error("upload failed")) : resolve(r)),
    ).end(buf);
  });
}

async function main() {
  const { CLOUDINARY_CLOUD_NAME: cloud_name, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: api_secret } = process.env;
  if (!cloud_name || !api_key || !api_secret) throw new Error("CLOUDINARY_* missing in .env");
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  await connect();

  const products = (await Product.find({ "images.url": /^\/ikonix\// }, "slug name images").lean()) as unknown as Prod[];
  const jobs = products.flatMap((p) => p.images.filter((i) => i.url.startsWith("/ikonix/")).map((i) => ({ p, i })));
  const todo = jobs.slice(0, LIMIT);
  console.log(`products: ${products.length}, local images: ${jobs.length}, this run: ${todo.length}${DRY ? " (dry)" : ""}`);
  if (DRY) return;

  let done = 0, uploaded = 0, reused = 0;
  const failures: string[] = [];
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const { p, i } = todo[next++];
      try {
        const file = path.join(PUBLIC_DIR, i.url);
        if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new Error("path escapes public/");
        const buf = await readFile(file);
        const sha = createHash("sha256").update(buf).digest("hex");
        let asset = (await MediaAsset.findOne({ sha256: sha }).lean()) as unknown as { url: string; publicId: string } | null;
        if (asset) reused++;
        else {
          const base = path.basename(i.url).replace(/\.[a-z0-9]+$/i, "");
          const res = await uploadBuffer(buf, `ikonix/products/${p.slug}/${base}`);
          try {
            await MediaAsset.create({
              publicId: res.public_id, url: res.secure_url, format: res.format, width: res.width, height: res.height, bytes: res.bytes,
              sha256: sha, folder: "products", filename: `${p.slug}-${base}.${res.format}`, alt: i.alt || p.name, legacySource: i.url,
            });
          } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
          asset = { url: res.secure_url, publicId: res.public_id };
          uploaded++;
        }
        await Product.updateOne({ _id: p._id, "images._id": i._id }, { $set: { "images.$.url": asset.url, "images.$.storageKey": asset.publicId } });
      } catch (e) {
        failures.push(`${p.slug} ${i.url}: ${e instanceof Error ? e.message : e}`);
      }
      if (++done % 100 === 0) console.log(`progress ${done}/${todo.length} (uploaded ${uploaded}, reused ${reused}, failed ${failures.length})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`finished: uploaded ${uploaded}, reused ${reused}, failed ${failures.length}`);
  failures.slice(0, 20).forEach((f) => console.log("FAIL", f));
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(disconnect);
