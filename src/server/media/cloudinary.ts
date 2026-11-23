import "server-only";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { db } from "@/server/db";
import { MediaAsset } from "@/server/models";
import { sha256 } from "@/server/auth/crypto";

let configured = false;
function client() {
  if (!configured) {
    const { CLOUDINARY_CLOUD_NAME: cloud_name, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: api_secret } = process.env;
    if (!cloud_name || !api_key || !api_secret) throw new Error("Cloudinary is not configured (CLOUDINARY_* in .env)");
    cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
    configured = true;
  }
  return cloudinary;
}

export const MEDIA_FOLDERS = ["products", "banners", "categories", "brands", "general", "avatars"] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 50_000_000; // decompression-bomb guard (Cloudinary also caps at 100 MP)
// SVG is deliberately excluded: it can carry script and is served same-origin-ish through CDNs.
const ALLOWED = new Set(["jpg", "png", "webp", "avif", "gif"]);

export type ValidatedImage = { buffer: Buffer; ext: string; width: number; height: number; sha256: string };
export type ValidationFailure = { ok: false; error: string };

/** Validates by real content (magic bytes + decode), never by filename or the client-declared MIME type. */
export async function validateImage(file: File): Promise<({ ok: true } & ValidatedImage) | ValidationFailure> {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `Larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = await fileTypeFromBuffer(buffer);
  if (!kind || !ALLOWED.has(kind.ext)) return { ok: false, error: "Only JPG, PNG, WEBP, AVIF or GIF images are allowed." };
  let dims: { width?: number; height?: number };
  try { dims = imageSize(buffer); } catch { return { ok: false, error: "Not a valid image." }; }
  if (!dims.width || !dims.height) return { ok: false, error: "Not a valid image." };
  if (dims.width * dims.height > MAX_PIXELS) return { ok: false, error: "Image dimensions are too large." };
  return { ok: true, buffer, ext: kind.ext, width: dims.width, height: dims.height, sha256: sha256(buffer) };
}

const slug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "image";

export type MediaDTO = {
  id: string; url: string; publicId: string; width: number; height: number; bytes: number; format: string;
  alt: string; filename: string; folder: string; tags: string[]; createdAt: string;
};

export function toMediaDTO(m: Record<string, unknown>): MediaDTO {
  return {
    id: String(m._id), url: String(m.url), publicId: String(m.publicId), width: Number(m.width), height: Number(m.height),
    bytes: Number(m.bytes), format: String(m.format), alt: String(m.alt ?? ""), filename: String(m.filename ?? ""),
    folder: String(m.folder ?? "general"), tags: (m.tags as string[]) ?? [], createdAt: new Date(m.createdAt as Date).toISOString(),
  };
}

/**
 * Stores a validated image in Cloudinary and the media library. Identical content (SHA-256) is stored once:
 * a re-upload returns the existing asset instead of burning storage.
 */
export async function storeImage(img: ValidatedImage, opts: { folder: MediaFolder; filename: string; uploadedById: string | null; legacySource?: string; alt?: string }) {
  await db();
  const existing = (await MediaAsset.findOne({ sha256: img.sha256 }).lean()) as Record<string, unknown> | null;
  if (existing) return { asset: toMediaDTO(existing), duplicate: true };

  const publicId = `${slug(opts.filename)}-${img.sha256.slice(0, 10)}`;
  const res = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = client().uploader.upload_stream(
      { folder: `ikonix/${opts.folder}`, public_id: publicId, resource_type: "image", overwrite: false, unique_filename: false, use_filename: false },
      (err, r) => (err || !r ? reject(err ?? new Error("Cloudinary upload failed")) : resolve(r)),
    );
    stream.end(img.buffer);
  });
  try {
    const doc = await MediaAsset.create({
      publicId: res.public_id, url: res.secure_url, format: res.format, width: res.width, height: res.height, bytes: res.bytes,
      sha256: img.sha256, folder: opts.folder, filename: opts.filename.slice(0, 200), alt: opts.alt, uploadedById: opts.uploadedById, legacySource: opts.legacySource,
    });
    return { asset: toMediaDTO(doc.toObject() as unknown as Record<string, unknown>), duplicate: false };
  } catch (e) {
    // Lost a race with an identical concurrent upload: return the winner's record.
    if ((e as { code?: number }).code === 11000) {
      const winner = (await MediaAsset.findOne({ sha256: img.sha256 }).lean()) as Record<string, unknown> | null;
      if (winner) return { asset: toMediaDTO(winner), duplicate: true };
    }
    await client().uploader.destroy(res.public_id).catch(() => {}); // don't leave an orphan in the bucket
    throw e;
  }
}

export async function destroyRemote(publicId: string) {
  await client().uploader.destroy(publicId, { invalidate: true });
}
