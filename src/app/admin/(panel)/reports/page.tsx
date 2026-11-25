import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";

export const metadata: Metadata = { title: "Reports" };

const REPORTS = [
  { href: "/admin/reports/sales", perm: "orders.read" as const, title: "Sales report", body: "Revenue, orders, units, average order value, discounts and tax for any period. Filter by status, payment, state, coupon, product, customer type and order value. Export to CSV." },
  { href: "/admin/reports/otp", perm: "customers.read" as const, title: "OTP usage", body: "Every number that tried to sign in with an OTP: how many codes it requested, verified and got wrong, with the full history per number. Block numbers that abuse OTP." },
];

export default async function ReportsPage() {
  const admin = await requireAdminPage();
  return (
    <>
      <PageHeader title="Reports" subtitle="Usage and activity reports." />
      <div className="grid gap-4 sm:grid-cols-2">
        {REPORTS.filter((r) => admin.permissions.has(r.perm)).map((r) => (
          <Link key={r.href} href={r.href}><Card title={r.title}><p className="p-4 text-sm text-a-muted">{r.body}</p></Card></Link>
        ))}
      </div>
    </>
  );
}
