import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/product-form";
import { requireAdminPage } from "@/server/auth/guard";
import { getCategoryOptions, getProductForm } from "@/server/admin/products";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  const admin = await requireAdminPage("products.read");
  const { id } = await params;
  const product = await getProductForm(id);
  if (!product) notFound();
  const canWrite = admin.permissions.has("products.write");
  return (
    <>
      <PageHeader title={product.name} subtitle={canWrite ? undefined : "You have read-only access."} />
      <ProductForm initial={product} categories={await getCategoryOptions()} readOnly={!canWrite} canWriteMedia={admin.permissions.has("media.write")} canDelete={admin.permissions.has("products.delete")} />
    </>
  );
}
