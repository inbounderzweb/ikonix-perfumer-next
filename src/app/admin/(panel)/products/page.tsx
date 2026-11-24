import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, button, formatDate, formatINR, inputCls } from "@/components/admin/ui";
import { requireAdminPage } from "@/server/auth/guard";
import { getCategoryOptions, listProducts } from "@/server/admin/products";
import { thumb } from "@/lib/cloudinary-loader";

export const metadata: Metadata = { title: "Products" };
const SORTS = { name: "name", status: "status", price: "minSalePrice", updated: "updatedAt" } as const;

import { DEFAULT_PAGE_SIZE, one, pageParam, qs, sizeParam, sortParam } from "@/server/admin/util";
export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const admin = await requireAdminPage("products.read");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const status = one(sp.status);
  const categoryId = one(sp.category);
  const page = pageParam(sp.page);
  const size = sizeParam(sp.size);
  const sort = sortParam(sp, SORTS, "updated");
  const [{ items, total, pages }, categories] = await Promise.all([listProducts({ q, status, categoryId, page, size, sort: sort.mongo }), getCategoryOptions()]);
  const isDefaultSort = sort.key === "updated" && sort.dir === "desc";
  const base = { q, status, category: categoryId, sort: isDefaultSort ? "" : sort.key, dir: isDefaultSort ? "" : sort.dir, size: size === DEFAULT_PAGE_SIZE ? "" : size };
  const url = (o: Record<string, string | number | undefined>) => `/admin/products?${qs({ ...base, ...o })}`;
  const filtered = !!(q || status || categoryId);
  return (
    <>
      <PageHeader title="Products" subtitle={`${total.toLocaleString("en-IN")} ${filtered ? "matching " : ""}products`} actions={admin.permissions.has("products.write") && <><Link href="/admin/products/bulk" className={button("secondary")}>Bulk upload</Link><Link href="/admin/products/new" className={button("primary")}>Add product</Link></>} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, SKU or inspired-by" aria-label="Search products" className={`${inputCls} max-w-sm`} />
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputCls} !w-auto`}>
          <option value="">All statuses</option><option value="ACTIVE">Published</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option>
        </select>
        <select name="category" defaultValue={categoryId} aria-label="Category" className={`${inputCls} !w-auto`}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {base.sort && <><input type="hidden" name="sort" value={base.sort} /><input type="hidden" name="dir" value={base.dir} /></>}
        {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={size} />}
        <button className={button("secondary")}>Filter</button>
        {filtered && <Link href="/admin/products" className="px-2 py-2 text-sm text-a-muted underline">Clear</Link>}
      </form>
      <Table head={[{ label: "Product", sort: "name" }, { label: "Status", sort: "status" }, "Category", "Sizes", { label: "From", sort: "price" }, { label: "Updated", sort: "updated" }, ""]} sort={{ key: sort.key, dir: sort.dir }} sortHref={(key, dir) => url({ sort: key, dir, page: undefined })} empty={items.length ? undefined : "No products match."}>
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
            <td className="whitespace-nowrap text-a-muted">{formatDate(new Date(p.updatedAt))}</td>
            <td className="text-right"><Link href={`/admin/products/${p.id}`} className="text-a-accent underline">Edit</Link></td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} pages={pages} total={total} size={size} href={(p) => url({ page: p })} sizeHref={(n) => url({ size: n === DEFAULT_PAGE_SIZE ? "" : n, page: undefined })} />
    </>
  );
}
