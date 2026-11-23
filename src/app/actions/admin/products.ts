"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { Product } from "@/server/models";
import { requireAdmin, ForbiddenError } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";
import { productInput } from "@/server/admin/product-schema";
import { saveProductRecord } from "@/server/catalogue/product-service";

export type SaveResult = { ok: true; id: string; slug: string } | { ok: false; error: string; fields?: Record<string, string> };

const fail = (error: string, fields?: Record<string, string>): SaveResult => ({ ok: false, error, fields });

function refresh(slug: string) {
  revalidatePath("/", "layout"); // storefront lists/search/home all read the catalogue
  revalidatePath(`/products/${slug}`);
}

export async function saveProduct(raw: unknown): Promise<SaveResult> {
  try {
    const parsed = productInput.safeParse(raw);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join(".")] ??= i.message;
      return fail("Please fix the highlighted fields.", fields);
    }
    const admin = await requireAdmin("products.write");
    const r = await saveProductRecord(parsed.data, admin);
    if (!r.ok) return fail(r.error, r.fields);
    refresh(r.slug);
    return { ok: true, id: r.id, slug: r.slug };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof Response) return fail("You do not have permission to do that.");
    console.error("saveProduct", e instanceof Error ? e.stack : e);
    return fail("Could not save the product. Nothing was lost; try again.");
  }
}

export async function archiveProduct(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Invalid product" };
    const admin = await requireAdmin("products.delete");
    await db();
    const p = await Product.findOneAndUpdate({ _id: id }, { status: "ARCHIVED", deletedAt: new Date() }, { returnDocument: "after" });
    if (!p) return { ok: false, error: "Product not found" };
    await audit(admin, "product.archive", "Product", id, { before: { status: "?" }, after: { slug: p.slug } });
    refresh(p.slug);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
    console.error("archiveProduct", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not archive the product." };
  }
}
