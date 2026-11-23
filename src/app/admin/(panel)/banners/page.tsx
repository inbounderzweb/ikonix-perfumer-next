import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { PopupManager, type PopupRow } from "@/components/admin/popup-manager";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Banner } from "@/server/models";

export const metadata: Metadata = { title: "Popup banner" };

// datetime-local value in India time (what the admin typed), from a stored instant
const toIst = (d?: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 16) : "");

export default async function BannersPage() {
  const admin = await requireAdminPage("promotions.write");
  await db();
  type B = { _id: unknown; title?: string; alt: string; desktopImageUrl: string; mobileImageUrl: string; linkUrl?: string; popupDelaySeconds?: number; popupFrequency?: PopupRow["frequency"]; status: "ACTIVE" | "INACTIVE"; startsAt?: Date | null; endsAt?: Date | null };
  const rows = (await Banner.find({ placement: "POPUP", deletedAt: null } as never).sort({ updatedAt: -1 }).lean()) as unknown as B[];
  const popups: PopupRow[] = rows.map((b) => ({ id: String(b._id), title: b.title ?? "", alt: b.alt, desktopImageUrl: b.desktopImageUrl, mobileImageUrl: b.mobileImageUrl, linkUrl: b.linkUrl ?? "", delaySeconds: b.popupDelaySeconds ?? 3, frequency: b.popupFrequency ?? "SESSION", enabled: b.status === "ACTIVE", startsAt: toIst(b.startsAt), endsAt: toIst(b.endsAt) }));
  return (
    <>
      <PageHeader title="Popup banner" subtitle="A promotional popup shown to storefront visitors while it is enabled. Upload a landscape image for desktop and a portrait image for phones. Only one popup is live at a time." />
      <PopupManager popups={popups} canWriteMedia={admin.permissions.has("media.write")} />
    </>
  );
}
