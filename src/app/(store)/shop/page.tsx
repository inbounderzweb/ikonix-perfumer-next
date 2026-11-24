import { capFirst } from "@/lib/format";
import type { Metadata } from "next";
import Link from "next/link";
import { getCategories, getShopPage, searchProducts } from "@/server/catalogue/queries";
import { Breadcrumb } from "@/components/store/breadcrumb";
import { ShopProductCard } from "@/components/store/product-cards";

export const metadata: Metadata = {
  title: "Shop",
  description: "Shop Ikonix Perfumer fragrances for men and women — long-lasting perfumes in 30 ml, 50 ml and 100 ml.",
  alternates: { canonical: "/shop" },
};

const qs = (cat: string, page = 1) => {
  const p = new URLSearchParams();
  if (cat !== "all") p.set("cat", cat);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/shop${s ? `?${s}` : ""}`;
};

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = str(sp.q).trim().slice(0, 60);
  const categories = await getCategories();
  const known = new Set(["all", "featured", ...categories.map((c) => c.slug)]);
  const cat = known.has(str(sp.cat)) ? str(sp.cat) : "all";
  const page = Math.max(1, Number.parseInt(str(sp.page), 10) || 1);
  const tabs = [{ slug: "all", label: "All" }, { slug: "featured", label: "Featured" }, ...categories.map((c) => ({ slug: c.slug, label: capFirst(c.name) }))];

  const result = q ? { items: await searchProducts(q, 40), page: 1, totalPages: 1, total: 0 } : await getShopPage(cat, page);

  return (
    <>
      <div className="mx-auto mt-10 hidden h-[242px] w-[95%] justify-end rounded-2xl bg-cover bg-center md:flex xl:w-[80%]" style={{ backgroundImage: "url(/ikonix/site/aboutBannerDesk.webp)" }} />
      <section className="mx-auto w-[95%] py-8 xl:w-[80%]">
        <Breadcrumb className="mb-6" items={[{ label: "Home", href: "/" }, { label: "Shop" }]} />
        {q ? (
          <div className="mb-6 flex flex-wrap items-center gap-3 font-fancy text-[#53443D]">
            <span>Results for “{q}” ({result.items.length})</span>
            <Link href="/shop" className="rounded-full border border-[#b49d91] px-4 py-1 text-sm text-[#b49d91]">Clear search</Link>
          </div>
        ) : (
          <div className="no-scrollbar mb-6 flex gap-4 overflow-x-auto pb-2 md:pb-4" role="tablist">
            {tabs.map((t) => (
              <Link key={t.slug} href={qs(t.slug)} role="tab" aria-selected={cat === t.slug} scroll={false}
                className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-[15px] transition md:px-4 md:py-2 md:text-base ${cat === t.slug ? "bg-[#b49d91] text-white" : "border border-[#b49d91] bg-white text-[#b49d91]"}`}>
                {t.label}
              </Link>
            ))}
          </div>
        )}
        {result.items.length === 0 ? (
          <p className="py-16 text-center font-fancy text-[#53443D]">No products found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {result.items.map((p) => <ShopProductCard key={p.id} p={p} />)}
          </div>
        )}
        {!q && result.totalPages > 1 && <Pagination cat={cat} page={result.page} totalPages={result.totalPages} />}
      </section>
    </>
  );
}

function Pagination({ cat, page, totalPages }: { cat: string; page: number; totalPages: number }) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1);
  const base = "flex h-10 min-w-10 items-center justify-center rounded-full px-3 font-fancy text-sm";
  return (
    <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 && <Link href={qs(cat, page - 1)} className={`${base} border border-[#b49d91] text-[#8C7367]`} aria-label="Previous page">‹</Link>}
      {pages.map((n, i) => (
        <span key={n} className="flex items-center gap-2">
          {i > 0 && n - pages[i - 1] > 1 && <span className="text-[#b49d91]">…</span>}
          <Link href={qs(cat, n)} aria-current={n === page ? "page" : undefined}
            className={`${base} ${n === page ? "bg-[#b49d91] text-white" : "border border-[#b49d91] text-[#8C7367]"}`}>{n}</Link>
        </span>
      ))}
      {page < totalPages && <Link href={qs(cat, page + 1)} className={`${base} border border-[#b49d91] text-[#8C7367]`} aria-label="Next page">›</Link>}
    </nav>
  );
}
