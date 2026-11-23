import type { MediaDTO } from "@/server/media/cloudinary";

export type UploadItem = { key: string; name: string; status: "queued" | "uploading" | "done" | "duplicate" | "error"; error?: string };
const MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];

/** Uploads in small batches so one slow/oversized file does not block the rest. The server re-validates everything. */
export async function uploadFiles(
  files: File[], folder: string,
  onUpdate: (key: string, patch: Partial<UploadItem>) => void,
  keys: string[],
): Promise<MediaDTO[]> {
  const out: MediaDTO[] = [];
  const valid: { file: File; key: string }[] = [];
  files.forEach((file, i) => {
    if (!OK_TYPES.includes(file.type)) return onUpdate(keys[i], { status: "error", error: "Only JPG, PNG, WEBP, AVIF or GIF" });
    if (file.size > MAX_BYTES) return onUpdate(keys[i], { status: "error", error: "Larger than 10 MB" });
    valid.push({ file, key: keys[i] });
  });
  for (let i = 0; i < valid.length; i += 3) {
    const batch = valid.slice(i, i + 3);
    batch.forEach((b) => onUpdate(b.key, { status: "uploading" }));
    const form = new FormData();
    form.set("folder", folder);
    batch.forEach((b) => form.append("files", b.file));
    try {
      const res = await fetch("/api/admin/media", { method: "POST", body: form });
      const json = (await res.json()) as { results?: ({ ok: true; asset: MediaDTO; duplicate: boolean } | { ok: false; error: string })[]; error?: string };
      if (!res.ok || !json.results) throw new Error(json.error ?? `Upload failed (${res.status})`);
      json.results.forEach((r, j) => {
        if (r.ok) { out.push(r.asset); onUpdate(batch[j].key, { status: r.duplicate ? "duplicate" : "done" }); }
        else onUpdate(batch[j].key, { status: "error", error: r.error });
      });
    } catch (e) {
      batch.forEach((b) => onUpdate(b.key, { status: "error", error: e instanceof Error ? e.message : "Upload failed" }));
    }
  }
  return out;
}
