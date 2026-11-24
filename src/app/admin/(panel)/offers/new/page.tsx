import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { OfferForm } from "@/components/admin/offer-form";
import { requireAdminPage } from "@/server/auth/guard";
import { loadCatalogue } from "../catalogue";

export const metadata: Metadata = { title: "New offer" };

export default async function NewOfferPage() {
  await requireAdminPage("promotions.write");
  return (<><PageHeader title="New offer" subtitle="Each variant gets its own Buy X / Get Y. Check the preview before publishing." /><OfferForm catalogue={await loadCatalogue()} /></>);
}
