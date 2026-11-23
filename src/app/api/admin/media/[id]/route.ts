import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guard";
import { assertSameOrigin } from "@/server/auth/request";
import { handle } from "@/server/auth/http";
import { db } from "@/server/db";
import { MediaAsset, Product } from "@/server/models";
import { destroyRemote, toMediaDTO } from "@/server/media/cloudinary";
import { audit } from "@/server/admin/audit";

export const runtime = "nodejs";
const idRe = /^[a-f0-9]{24}$/;
const patchBody = z.object({
  alt: z.string().trim().max(300).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
}).strict();

export function PATCH(req: Request, ctx: RouteContext<"/api/admin/media/[id]">) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin("media.write");
    const { id } = await ctx.params;
    if (!idRe.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = patchBody.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    await db();
    const doc = (await MediaAsset.findByIdAndUpdate(id, { $set: body.data }, { returnDocument: "after" }).lean()) as unknown as Record<string, unknown> | null;
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Keep product image alt text in step with the library entry when an alt is set.
    if (body.data.alt !== undefined) await Product.updateMany({ "images.url": String(doc.url) }, { $set: { "images.$[i].alt": body.data.alt } }, { arrayFilters: [{ "i.url": String(doc.url) }] });
    await audit(admin, "media.update", "MediaAsset", id, { after: body.data });
    return NextResponse.json({ asset: toMediaDTO(doc) });
  });
}

export function DELETE(req: Request, ctx: RouteContext<"/api/admin/media/[id]">) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin("media.delete");
    const { id } = await ctx.params;
    if (!idRe.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db();
    const doc = (await MediaAsset.findById(id).lean()) as unknown as Record<string, unknown> | null;
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const used = await Product.find({ "images.url": String(doc.url), deletedAt: null }, "name").limit(5).lean();
    if (used.length) {
      return NextResponse.json({ error: "This image is used by products. Remove it from them first.", usedBy: used.map((p) => (p as { name: string }).name) }, { status: 409 });
    }
    await MediaAsset.deleteOne({ _id: id });
    await destroyRemote(String(doc.publicId)).catch((e) => console.error("cloudinary destroy failed", e instanceof Error ? e.message : e));
    await audit(admin, "media.delete", "MediaAsset", id, { before: { publicId: doc.publicId } });
    return NextResponse.json({ ok: true });
  });
}
