import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/admin/ui";
import { PasswordForm } from "@/components/admin/people";
import { requireAdminPage } from "@/server/auth/guard";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const admin = await requireAdminPage();
  const owner = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return (
    <>
      <PageHeader title="My profile" subtitle={`${admin.name} · ${admin.email}`} />
      <Card title="Password"><PasswordForm managedInEnv={!!owner && admin.email === owner} /></Card>
    </>
  );
}
