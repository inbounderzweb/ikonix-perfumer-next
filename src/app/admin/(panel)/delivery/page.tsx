import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { DeliveryManager, type MethodRow } from "@/components/admin/delivery-manager";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { ShippingMethod } from "@/server/models";

export const metadata: Metadata = { title: "Delivery" };

export default async function DeliveryPage() {
  const admin = await requireAdminPage("delivery.read");
  await db();
  type M = { _id: unknown; code: string; name: string; description?: string; charge: number; freeAboveSubtotal?: number; minDays?: number; maxDays?: number; status: "ACTIVE" | "INACTIVE"; sortOrder: number };
  const rows = (await ShippingMethod.find({}).sort({ sortOrder: 1, name: 1 }).lean()) as unknown as M[];
  const methods: MethodRow[] = rows.map((m) => ({ id: String(m._id), code: m.code, name: m.name, description: m.description ?? "", charge: m.charge / 100, freeAbove: m.freeAboveSubtotal != null ? m.freeAboveSubtotal / 100 : "", minDays: m.minDays ?? "", maxDays: m.maxDays ?? "", status: m.status, sortOrder: m.sortOrder }));
  return (
    <>
      <PageHeader title="Delivery" subtitle="Methods and charges offered at checkout. A free-delivery threshold waives the charge once the cart subtotal reaches it." />
      <DeliveryManager methods={methods} canWrite={admin.permissions.has("delivery.write")} />
    </>
  );
}
