"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { Product, Promotion } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";

export type OfferResult = { ok: true; id?: string; message?: string } | { ok: false; error: string };
const oid = z.string().regex(/^[a-f0-9]{24}$/);
const optInt = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(1).max(10_000_000).optional());
const istDate = (s: string | undefined) => (s ? new Date(`${s}:00+05:30`) : undefined); // admin enters IST

const input = z.object({
  id: oid.optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().or(z.literal("")),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().or(z.literal("")),
  usageLimitTotal: optInt, usageLimitPerCustomer: optInt, minQuantity: optInt,
  pricingBasis: z.enum(["SELLING", "MRP"]),
  stackable: z.boolean(),
  poolMode: z.enum(["NONE", "SAME_SIZE", "ANY"]).default("NONE"),
  priority: z.number().int().min(0).max(1000),
  rules: z.array(z.object({ productId: oid, variantId: oid, buy: z.number().int().min(1).max(99), free: z.number().int().min(1).max(99) })).min(1, "Select at least one variant.").max(3000),
});

function fail(e: unknown): OfferResult {
  if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
  console.error("offer action", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function saveOffer(raw: unknown): Promise<OfferResult> {
  try {
    const admin = await requireAdmin("promotions.write");
    const p = input.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the offer details." };
    const d = p.data;
    const startsAt = istDate(d.startsAt), endsAt = istDate(d.endsAt);
    if (startsAt && endsAt && startsAt >= endsAt) return { ok: false, error: "The end date must be after the start date." };
    if (new Set(d.rules.map((r) => r.variantId)).size !== d.rules.length) return { ok: false, error: "A variant can only appear once in an offer." };
    await db();
    // Every (product, variant) pair must really exist: never trust ids from the browser.
    const prods = (await Product.find({ _id: { $in: [...new Set(d.rules.map((r) => r.productId))] }, deletedAt: null }, "variants._id").lean()) as unknown as { _id: { toString(): string }; variants: { _id: { toString(): string } }[] }[];
    const ok = new Map(prods.map((x) => [String(x._id), new Set(x.variants.map((v) => String(v._id)))]));
    if (d.rules.some((r) => !ok.get(r.productId)?.has(r.variantId))) return { ok: false, error: "One of the selected variants no longer exists. Reload and try again." };

    const doc = {
      name: d.name, description: d.description || undefined, trigger: "AUTOMATIC", type: "BUY_X_GET_Y", scope: "TARGETS",
      targets: d.rules.map((r) => ({ kind: "VARIANT", refId: r.variantId })), variantRules: d.rules,
      buyQuantity: d.rules[0].buy, getQuantity: d.rules[0].free, getDiscountBps: 10000, // legacy generic fields; the per-variant rules are authoritative
      pricingBasis: d.pricingBasis, poolMode: d.poolMode, poolAcrossProducts: d.poolMode === "SAME_SIZE", stackable: d.stackable, priority: d.priority, status: d.status,
      minQuantity: d.minQuantity ?? undefined, usageLimitTotal: d.usageLimitTotal ?? undefined, usageLimitPerCustomer: d.usageLimitPerCustomer ?? undefined,
      startsAt, endsAt,
    };
    if (d.id) {
      const cur = (await Promotion.findOne({ _id: d.id, type: "BUY_X_GET_Y", deletedAt: null }).lean()) as unknown as { usageCount: number } | null;
      if (!cur) return { ok: false, error: "Offer not found." };
      if (d.usageLimitTotal != null && cur.usageCount > d.usageLimitTotal) return { ok: false, error: `${cur.usageCount} redemptions are already used; the total limit can't be lower.` };
      const unset = { ...(startsAt ? {} : { startsAt: 1 }), ...(endsAt ? {} : { endsAt: 1 }), ...(d.minQuantity ? {} : { minQuantity: 1 }), ...(d.usageLimitTotal ? {} : { usageLimitTotal: 1 }), ...(d.usageLimitPerCustomer ? {} : { usageLimitPerCustomer: 1 }), ...(d.description ? {} : { description: 1 }) };
      await Promotion.findByIdAndUpdate(d.id, { $set: Object.fromEntries(Object.entries(doc).filter(([k, v]) => v !== undefined && !(k in unset))), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { runValidators: true });
      await audit(admin, "offer.update", "Promotion", d.id, { after: { name: d.name, status: d.status, rules: d.rules } });
      revalidatePath("/admin/offers");
      return { ok: true, id: d.id, message: "Offer saved." };
    }
    const created = await Promotion.create(doc as never) as unknown as { _id: unknown };
    await audit(admin, "offer.create", "Promotion", String(created._id), { after: { name: d.name, status: d.status, rules: d.rules } });
    revalidatePath("/admin/offers");
    return { ok: true, id: String(created._id), message: "Offer created." };
  } catch (e) { return fail(e); }
}

export async function setOfferStatus(id: string, status: "ACTIVE" | "INACTIVE"): Promise<OfferResult> {
  try {
    const admin = await requireAdmin("promotions.write");
    if (!oid.safeParse(id).success) return { ok: false, error: "Invalid request." };
    await db();
    const r = await Promotion.updateOne({ _id: id, type: "BUY_X_GET_Y", deletedAt: null }, { status });
    if (!r.matchedCount) return { ok: false, error: "Offer not found." };
    await audit(admin, `offer.${status === "ACTIVE" ? "enable" : "disable"}`, "Promotion", id);
    revalidatePath("/admin/offers");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Soft delete: orders keep their own snapshot of the offer, so history is unaffected. */
export async function deleteOffer(id: string): Promise<OfferResult> {
  try {
    const admin = await requireAdmin("promotions.write");
    if (!oid.safeParse(id).success) return { ok: false, error: "Invalid request." };
    await db();
    const r = await Promotion.updateOne({ _id: id, type: "BUY_X_GET_Y", deletedAt: null }, { deletedAt: new Date(), status: "INACTIVE" });
    if (!r.matchedCount) return { ok: false, error: "Offer not found." };
    await audit(admin, "offer.delete", "Promotion", id);
    revalidatePath("/admin/offers");
    return { ok: true };
  } catch (e) { return fail(e); }
}
