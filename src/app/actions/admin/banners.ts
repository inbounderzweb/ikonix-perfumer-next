"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { Banner } from "@/server/models";
import { ForbiddenError, requireAdmin } from "@/server/auth/guard";
import { audit } from "@/server/admin/audit";

export type BannerResult = { ok: true; id?: string } | { ok: false; error: string; fields?: Record<string, string> };

const imageUrl = z.string().trim().url().max(500).refine((u) => u.startsWith("https://res.cloudinary.com/"), "Choose an image from the media library");
// Internal path ("/shop") or https URL only: blocks javascript:, data: and protocol-relative links.
const link = z.string().trim().max(300).refine((u) => u === "" || /^\/(?!\/)[^\s]*$/.test(u) || /^https:\/\/[^\s]+$/.test(u), "Use a path like /shop or a full https:// link");
const input = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  title: z.string().trim().min(2, "Give it a name").max(80),
  alt: z.string().trim().min(2, "Describe the image for accessibility").max(160),
  desktopImageUrl: imageUrl, mobileImageUrl: imageUrl,
  linkUrl: link.default(""),
  delaySeconds: z.coerce.number().int().min(0).max(120),
  frequency: z.enum(["ALWAYS", "SESSION", "DAILY", "WEEKLY"]),
  startsAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]).default(""),
  endsAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]).default(""),
  enabled: z.boolean(),
}).refine((v) => !v.startsAt || !v.endsAt || v.startsAt < v.endsAt, { message: "End must be after start", path: ["endsAt"] });

const ist = (s: string) => (s ? new Date(`${s}:00+05:30`) : undefined); // admin enters India time

function fail(e: unknown): BannerResult {
  if (e instanceof ForbiddenError || e instanceof Response) return { ok: false, error: "You do not have permission to do that." };
  console.error("banner action", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function savePopup(raw: unknown): Promise<BannerResult> {
  try {
    const admin = await requireAdmin("promotions.write");
    const p = input.safeParse(raw);
    if (!p.success) { const fields: Record<string, string> = {}; for (const i of p.error.issues) fields[i.path.join(".")] ??= i.message; return { ok: false, error: "Please fix the highlighted fields.", fields }; }
    const v = p.data;
    await db();
    const data = { placement: "POPUP", title: v.title, alt: v.alt, desktopImageUrl: v.desktopImageUrl, mobileImageUrl: v.mobileImageUrl, linkUrl: v.linkUrl || undefined, popupDelaySeconds: v.delaySeconds, popupFrequency: v.frequency, status: v.enabled ? "ACTIVE" : "INACTIVE", startsAt: ist(v.startsAt) ?? null, endsAt: ist(v.endsAt) ?? null };
    let id = v.id;
    if (id) { if (!(await Banner.findOneAndUpdate({ _id: id, placement: "POPUP", deletedAt: null } as never, data as never))) return { ok: false, error: "Banner not found." }; }
    else id = String((await Banner.create(data as never))._id);
    // Only one popup is shown at a time: enabling this one switches the others off.
    if (v.enabled) await Banner.updateMany({ placement: "POPUP", _id: { $ne: id }, status: "ACTIVE" } as never, { status: "INACTIVE" });
    await audit(admin, v.id ? "popup.update" : "popup.create", "Banner", id!, { after: { title: v.title, enabled: v.enabled } });
    revalidatePath("/admin/banners");
    return { ok: true, id };
  } catch (e) { return fail(e); }
}

export async function setPopupEnabled(id: string, enabled: boolean): Promise<BannerResult> {
  try {
    const admin = await requireAdmin("promotions.write");
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Banner not found." };
    await db();
    if (!(await Banner.findOneAndUpdate({ _id: id, placement: "POPUP", deletedAt: null } as never, { status: enabled ? "ACTIVE" : "INACTIVE" }))) return { ok: false, error: "Banner not found." };
    if (enabled) await Banner.updateMany({ placement: "POPUP", _id: { $ne: id }, status: "ACTIVE" } as never, { status: "INACTIVE" });
    await audit(admin, enabled ? "popup.enable" : "popup.disable", "Banner", id);
    revalidatePath("/admin/banners");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deletePopup(id: string): Promise<BannerResult> {
  try {
    const admin = await requireAdmin("promotions.write");
    if (!/^[a-f0-9]{24}$/.test(id)) return { ok: false, error: "Banner not found." };
    await db();
    if (!(await Banner.findOneAndUpdate({ _id: id, placement: "POPUP", deletedAt: null } as never, { deletedAt: new Date(), status: "INACTIVE" }))) return { ok: false, error: "Banner not found." };
    await audit(admin, "popup.delete", "Banner", id);
    revalidatePath("/admin/banners");
    return { ok: true };
  } catch (e) { return fail(e); }
}
