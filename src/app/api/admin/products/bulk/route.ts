import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guard";
import { assertSameOrigin } from "@/server/auth/request";
import { handle } from "@/server/auth/http";
import { rateLimit } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { MAX_UPLOAD_BYTES } from "@/server/media/cloudinary";
import { findExisting, importProduct, planProduct, sourceProduct } from "@/server/catalogue/bulk-import";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_CHECK_ROWS = 100;
const MAX_FILES = 20;

/**
 * Admin bulk product upload (legacy export format). Two calls, both admin-only and same-origin:
 *  - JSON { mode: "check", rows }: validates rows and reports which products already exist. Writes nothing.
 *  - multipart { row, <image path>: File, ... }: imports ONE product (images → Cloudinary → product service).
 * The browser drives the loop one product per request, so there is no long-running server job to lose.
 */
export function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin("products.write");
    if (!admin.permissions.has("media.write")) return NextResponse.json({ error: "Your role cannot upload images." }, { status: 403 });
    const type = req.headers.get("content-type") ?? "";

    if (type.startsWith("application/json")) {
      if (!(await rateLimit(`bulk-check:${admin.id}`, 60, 60))) return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
      const body = z.object({ mode: z.literal("check"), rows: z.array(z.unknown()).min(1).max(MAX_CHECK_ROWS) }).safeParse(await req.json().catch(() => null));
      if (!body.success) return NextResponse.json({ error: `Send { mode: "check", rows } with 1–${MAX_CHECK_ROWS} rows.` }, { status: 400 });
      await db();
      const checked = body.data.rows.map((r) => {
        const p = sourceProduct.safeParse(r);
        const raw = r as { id?: unknown; slug?: unknown; name?: unknown } | null;
        if (!p.success) return { legacyId: String(raw?.id ?? "?"), slug: String(raw?.slug ?? "?"), name: String(raw?.name ?? "?"), valid: false as const, error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` };
        const plan = planProduct(p.data);
        return { legacyId: plan.legacyId, slug: plan.slug, name: plan.name, valid: true as const, plan };
      });
      const plans = checked.flatMap((c) => (c.valid ? [c.plan] : []));
      const existing = plans.length ? await findExisting(plans) : new Map();
      return NextResponse.json({
        rows: checked.map((c) => c.valid
          ? { legacyId: c.legacyId, slug: c.slug, name: c.name, valid: true, productStatus: c.plan.status, issues: c.plan.issues, variants: c.plan.skus.length, images: c.plan.images.map((i) => i.path), existing: existing.get(c.legacyId) ?? null }
          : { legacyId: c.legacyId, slug: c.slug, name: c.name, valid: false, error: c.error }),
      });
    }

    if (!(await rateLimit(`bulk-import:${admin.id}`, 120, 60))) return NextResponse.json({ error: "Too many uploads. Slow down." }, { status: 429 });
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    let row: unknown;
    try { row = JSON.parse(String(form.get("row") ?? "")); } catch { return NextResponse.json({ error: "Missing product row" }, { status: 400 }); }
    const files = new Map<string, File>();
    for (const [k, v] of form.entries()) if (k !== "row" && v instanceof File) files.set(k, v);
    if (files.size > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} images per product` }, { status: 400 });

    const result = await importProduct(row, async (path) => {
      const f = files.get(path);
      if (!f || f.size > MAX_UPLOAD_BYTES) return null;
      return { buffer: Buffer.from(await f.arrayBuffer()), filename: path.split("/").pop() ?? f.name };
    }, admin);
    if (result.status === "created") {
      revalidatePath("/", "layout");
      revalidatePath(`/products/${result.slug}`);
    }
    return NextResponse.json({ result });
  });
}
