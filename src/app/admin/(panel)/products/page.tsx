import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, button, formatINR, inputCls } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { listProducts } from "@/server/admin/products";
import { thumb } from "@/lib/cloudinary-loader";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const admin = await requireAdminPage("products.read");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).slice(0, 100);
  const status = one(sp.status);
  const page = Math.max(1, Math.min(10_000, parseInt(one(sp.page), 10) || 1));
  const { items, total, pages } = await listProducts({ q, status, page });
  const href = (p: number) => `/admin/products?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), page: String(p) })}`;
  return (
    <>
      <PageHeader title="Products" subtitle={`${total.toLocaleString("en-IN")} products`} actions={admin.permissions.has("products.write") && <><Link href="/admin/products/bulk" className={button("secondary")}>Bulk upload</Link><Link href="/admin/products/new" className={button("primary")}>Add product</Link></>} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, SKU or inspired-by" aria-label="Search products" className={`${inputCls} max-w-sm`} />
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputCls} !w-auto`}>
          <option value="">All statuses</option><option value="ACTIVE">Published</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option>
        </select>
        <button className={button("secondary")}>Filter</button>
      </form>
      <Table head={["Product", "Status", "Category", "Sizes", "From", ""]} empty={items.length ? undefined : "No products match."}>
        {items.map((p) => (
          <tr key={p.id} className="hover:bg-a-raised/60">
            <td>
              <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb(p.image, 96)} alt="" width={48} height={48} loading="lazy" className="h-12 w-12 rounded-md border border-a-border object-cover" />
                ) : <span className="h-12 w-12 rounded-md border border-a-border bg-a-raised" />}
                <span className="font-medium">{p.name}</span>
              </Link>
            </td>
            <td><Badge tone={p.status === "ACTIVE" ? "ok" : p.status === "DRAFT" ? "warn" : "neutral"}>{p.status === "ACTIVE" ? "Published" : p.status.toLowerCase()}</Badge></td>
            <td className="text-a-muted">{p.categories.join(", ") || "—"}</td>
            <td>{p.variants}</td>
            <td>{p.minPrice != null ? formatINR(p.minPrice) : "—"}</td>
            <td className="text-right"><Link href={`/admin/products/${p.id}`} className="text-a-accent underline">Edit</Link></td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} pages={pages} href={href} />
    </>
  );
}
