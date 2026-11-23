import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Banner } from "@/server/models";

export type PopupDTO = { id: string; version: string; alt: string; desktopImageUrl: string; mobileImageUrl: string; linkUrl: string | null; delaySeconds: number; frequency: "ALWAYS" | "SESSION" | "DAILY" | "WEEKLY" };
type Row = { _id: Types.ObjectId; alt: string; desktopImageUrl: string; mobileImageUrl: string; linkUrl?: string; popupDelaySeconds?: number; popupFrequency?: PopupDTO["frequency"]; updatedAt: Date };

/** The one popup visitors should see now: enabled, inside its schedule window, not deleted. Null when none. */
export async function getActivePopup(): Promise<PopupDTO | null> {
  await db();
  const now = new Date();
  const r = (await Banner.findOne({
    placement: "POPUP", status: "ACTIVE", deletedAt: null,
    $and: [{ $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] }],
  } as never).sort({ updatedAt: -1 }).lean()) as unknown as Row | null;
  if (!r) return null;
  // `version` changes whenever the admin edits the banner, so visitors who dismissed an old one see the new one.
  return { id: String(r._id), version: String(r.updatedAt.getTime()), alt: r.alt, desktopImageUrl: r.desktopImageUrl, mobileImageUrl: r.mobileImageUrl, linkUrl: r.linkUrl ?? null, delaySeconds: r.popupDelaySeconds ?? 3, frequency: r.popupFrequency ?? "SESSION" };
}
