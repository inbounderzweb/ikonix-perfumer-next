import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guard";
import { assertSameOrigin } from "@/server/auth/request";
import { handle } from "@/server/auth/http";
import { rateLimit } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { MediaAsset } from "@/server/models";
import { MEDIA_FOLDERS, storeImage, toMediaDTO, validateImage } from "@/server/media/cloudinary";
import { audit } from "@/server/admin/audit";

export const runtime = "nodejs";
const MAX_FILES = 10;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  folder: z.enum(MEDIA_FOLDERS).optional(),
  cursor: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export function GET(req: Request) {
  return handle(async () => {
    await requireAdmin("media.read");
    const parsed = listQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Bad query" }, { status: 400 });
    const { q, folder, cursor, limit } = parsed.data;
    await db();
    const filter: Record<string, unknown> = {};
    if (folder) filter.folder = folder;
    if (cursor) filter._id = { $lt: cursor };
    if (q) { const re = new RegExp(escapeRe(q), "i"); filter.$or = [{ filename: re }, { alt: re }, { tags: re }]; }
    const rows = (await MediaAsset.find(filter).sort({ _id: -1 }).limit(limit + 1).lean()) as unknown as Record<string, unknown>[];
    const page = rows.slice(0, limit);
    return NextResponse.json({ items: page.map(toMediaDTO), nextCursor: rows.length > limit ? String(page[page.length - 1]._id) : null });
  });
}

export function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin("media.write");
    if (!(await rateLimit(`upload:${admin.id}`, 120, 60))) return NextResponse.json({ error: "Too many uploads. Slow down." }, { status: 429 });
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    const folder = z.enum(MEDIA_FOLDERS).catch("general").parse(form.get("folder"));
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} files per request` }, { status: 400 });

    const results: ({ name: string } & ({ ok: true; asset: ReturnType<typeof toMediaDTO>; duplicate: boolean } | { ok: false; error: string }))[] = [];
    for (const file of files) {
      const v = await validateImage(file);
      if (!v.ok) { results.push({ name: file.name, ok: false, error: v.error }); continue; }
      try {
        const { asset, duplicate } = await storeImage(v, { folder, filename: file.name, uploadedById: admin.id });
        if (!duplicate) await audit(admin, "media.upload", "MediaAsset", asset.id, { after: { publicId: asset.publicId, bytes: asset.bytes } });
        results.push({ name: file.name, ok: true, asset, duplicate });
      } catch (e) {
        console.error("upload failed", e instanceof Error ? e.message : e);
        results.push({ name: file.name, ok: false, error: "Upload to storage failed. Try again." });
      }
    }
    return NextResponse.json({ results });
  });
}
