import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { OfferForm, type OfferInitial } from "@/components/admin/offer-form";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Promotion } from "@/server/models";
import { loadCatalogue } from "../catalogue";

export const metadata: Metadata = { title: "Edit offer" };
const ist = (d?: Date) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16) : "");

export default async function EditOfferPage({ params }: PageProps<"/admin/offers/[id]">) {
  await requireAdminPage("promotions.write");
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/.test(id)) notFound();
  await db();
  type R = { name: string; description?: string; status: "ACTIVE" | "INACTIVE"; startsAt?: Date; endsAt?: Date; usageLimitTotal?: number; usageLimitPerCustomer?: number; minQuantity?: number; pricingBasis?: "SELLING" | "MRP"; stackable?: boolean; poolAcrossProducts?: boolean; poolMode?: "NONE" | "SAME_SIZE" | "ANY"; priority?: number; usageCount: number; variantRules: { productId: { toString(): string }; variantId: { toString(): string }; buy: number; free: number }[] };
  const o = (await Promotion.findOne({ _id: id, type: "BUY_X_GET_Y", deletedAt: null }).lean()) as unknown as R | null;
  if (!o) notFound();
  const initial: OfferInitial = {
    id, name: o.name, description: o.description ?? "", status: o.status, startsAt: ist(o.startsAt), endsAt: ist(o.endsAt),
    usageLimitTotal: o.usageLimitTotal ? String(o.usageLimitTotal) : "", usageLimitPerCustomer: o.usageLimitPerCustomer ? String(o.usageLimitPerCustomer) : "", minQuantity: o.minQuantity ? String(o.minQuantity) : "",
    pricingBasis: o.pricingBasis ?? "SELLING", stackable: !!o.stackable, poolMode: o.poolMode ?? (o.poolAcrossProducts ? "SAME_SIZE" : "NONE"), priority: o.priority ?? 0,
    rules: o.variantRules.map((r) => ({ productId: String(r.productId), variantId: String(r.variantId), buy: r.buy, free: r.free })),
  };
  return (<><PageHeader title={o.name} subtitle={`${o.usageCount} redemption${o.usageCount === 1 ? "" : "s"} so far. Past orders keep their own snapshot of this offer.`} /><OfferForm catalogue={await loadCatalogue()} initial={initial} /></>);
}
