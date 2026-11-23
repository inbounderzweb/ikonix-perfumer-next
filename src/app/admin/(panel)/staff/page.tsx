import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { StaffManager, type StaffRow } from "@/components/admin/people";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { User } from "@/server/models";

export const metadata: Metadata = { title: "Staff & roles" };

export default async function StaffPage() {
  const admin = await requireAdminPage("staff.manage");
  await db();
  type U = { _id: unknown; name?: string; email?: string; roleKeys: string[]; status: string; lastLoginAt?: Date };
  const rows = (await User.find({ "roleKeys.0": { $exists: true }, deletedAt: null }, "name email roleKeys status lastLoginAt").sort({ createdAt: 1 }).lean()) as unknown as U[];
  const owner = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const staff: StaffRow[] = rows.map((u) => ({ id: String(u._id), name: u.name ?? "Staff", email: u.email ?? "", roles: u.roleKeys, status: u.status, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, isOwner: !!owner && u.email === owner, isSelf: String(u._id) === admin.id }));
  return (
    <>
      <PageHeader title="Staff & roles" subtitle="Only people listed here can open the admin. Changing roles signs that person out so the new access applies at their next sign-in." />
      <StaffManager staff={staff} />
    </>
  );
}
