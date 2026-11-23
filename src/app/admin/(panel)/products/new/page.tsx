import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/product-form";
import { requireAdminPage } from "@/server/auth/guard";
import { getCategoryOptions, type ProductFormData } from "@/server/admin/products";

export const metadata: Metadata = { title: "New product" };

const blank: ProductFormData = {
  name: "", slug: "", subtitle: "", status: "DRAFT", gender: "", inspiredByName: "", categoryIds: [], description: "", shortDescription: "",
  notes: { top: [], middle: [], base: [] }, seo: { title: "", description: "" },
  variants: [{ sku: "", label: "30 ml", sizeValue: 30, regularPrice: 0, salePrice: 0, isActive: true, tracked: false, onHand: 0, availability: "IN_STOCK", reserved: 0 }],
  images: [], reviewIssues: [],
};

export default async function NewProductPage() {
  const admin = await requireAdminPage("products.write");
  return (
    <>
      <PageHeader title="New product" subtitle="Saved as a draft until you publish it." />
      <ProductForm initial={blank} categories={await getCategoryOptions()} canWriteMedia={admin.permissions.has("media.write")} canDelete={false} />
    </>
  );
}
