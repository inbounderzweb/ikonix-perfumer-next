"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { Order, ShippingMethod } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";

const rupees = z.coerce.number().min(0).max(1_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimals");
const methodInput = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, "2–30 letters, digits, - or _"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  charge: rupees,
  freeAboveSubtotal: z.union([rupees, z.literal("").transform(() => undefined), z.null().transform(() => undefined)]).optional(),
  minDays: z.coerce.number().int().min(0).max(90).optional(),
  maxDays: z.coerce.number().int().min(0).max(90).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
}).refine((v) => v.minDays == null || v.maxDays == null || v.minDays <= v.maxDays, { message: "Min days cannot exceed max days", path: ["maxDays"] });

export type DeliveryResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

export async function saveShippingMethod(raw: unknown): Promise<DeliveryResult> {
  try {
    const admin = await requireAdmin("delivery.write");
    const p = methodInput.safeParse(raw);
    if (!p.success) {
      const fields: Record<string, string> = {};
      for (const i of p.error.issues) fields[i.path.join(".")] ??= i.message;
      return { ok: false, error: "Please fix the highlighted fields.", fields };
    }
    const v = p.data;
    await db();
    const data = {
      code: v.code, name: v.name, description: v.description || undefined, charge: Math.round(v.charge * 100),
      freeAboveSubtotal: v.freeAboveSubtotal == null ? undefined : Math.round(Number(v.freeAboveSubtotal) * 100),
      minDays: v.minDays, maxDays: v.maxDays, status: v.status, sortOrder: v.sortOrder,
    };
    // $unset the optional fields that were cleared so they don't linger.
    const unset: Record<string, 1> = {};
    if (data.freeAboveSubtotal === undefined) unset.freeAboveSubtotal = 1;
    if (data.minDays === undefined) unset.minDays = 1;
    if (data.maxDays === undefined) unset.maxDays = 1;
    const clean = Object.fromEntries(Object.entries(data).filter(([, x]) => x !== undefined));
    let id = v.id;
    if (v.id) {
      const r = await ShippingMethod.updateOne({ _id: v.id }, { $set: clean, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      if (!r.matchedCount) return { ok: false, error: "Delivery method not found." };
    } else {
      id = String((await ShippingMethod.create(clean))._id);
    }
    await audit(admin, v.id ? "delivery.update" : "delivery.create", "ShippingMethod", String(id), { after: data });
    revalidatePath("/admin/delivery");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "That code is already used.", fields: { code: "Already in use" } };
    console.error("saveShippingMethod", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not save. Try again." };
  }
}

export async function deleteShippingMethod(id: string): Promise<DeliveryResult> {
  try {
    const admin = await requireAdmin("delivery.write");
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Invalid method." };
    await db();
    if (await Order.exists({ shippingMethodId: id })) return { ok: false, error: "Orders use this method. Set it to Inactive instead." };
    await ShippingMethod.deleteOne({ _id: id });
    await audit(admin, "delivery.delete", "ShippingMethod", id);
    revalidatePath("/admin/delivery");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
    console.error("deleteShippingMethod", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not delete." };
  }
}
