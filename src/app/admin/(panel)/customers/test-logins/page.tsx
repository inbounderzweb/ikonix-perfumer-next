import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { TestLoginManager, type TestLoginRow } from "@/components/admin/test-logins";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { TestLogin } from "@/server/models";

export const metadata: Metadata = { title: "Test users" };

export default async function TestLoginsPage() {
  const admin = await requireAdminPage("customers.write");
  await db();
  type T = { _id: unknown; name: string; mobile: string; code: string; active: boolean };
  const docs = (await TestLogin.find({}).sort({ createdAt: -1 }).lean()) as unknown as T[];
  const rows: TestLoginRow[] = docs.map((t) => ({ id: String(t._id), name: t.name, mobile: t.mobile, code: t.code, active: t.active }));
  return (
    <>
      <PageHeader title="Test users" subtitle="Numbers listed here sign in with a fixed OTP and no SMS is sent, on any environment. Use only for testing." />
      <TestLoginManager rows={rows} canWrite={admin.permissions.has("customers.write")} />
    </>
  );
}
