import Link from "next/link";
import { PageHeader, button } from "@/components/admin/ui";
import { BulkUpload } from "@/components/admin/bulk-upload";
import { requireAdminPage } from "@/server/auth/guard";

export const metadata = { title: "Bulk upload products" };

export default async function BulkUploadPage() {
  await requireAdminPage("products.write");
  return (
    <>
      <PageHeader
        title="Bulk upload products"
        subtitle="Create products from a product data file and its image folder. Existing products are never changed."
        actions={<Link href="/admin/products" className={button("secondary")}>Back to products</Link>}
      />
      <BulkUpload />
    </>
  );
}
