import type { Metadata } from "next";
import { MediaGrid } from "@/components/admin/media/media-grid";
import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";

export const metadata: Metadata = { title: "Media library" };

export default async function MediaPage() {
  const admin = await requireAdminPage("media.read");
  return (
    <>
      <PageHeader title="Media library" subtitle="All images are stored on Cloudinary and reused across products. Click an image to edit its alt text or copy its URL." />
      <MediaGrid mode="manage" canWrite={admin.permissions.has("media.write")} canDelete={admin.permissions.has("media.delete")} />
    </>
  );
}
