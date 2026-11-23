import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductBySlug, getRelatedProducts } from "@/server/catalogue/queries";
import { Breadcrumb } from "@/components/store/breadcrumb";
import { ProductView } from "@/components/store/product-view";
import { RelatedProducts } from "@/components/store/related-products";
import { rupees } from "@/lib/catalogue-types";

export const revalidate = 300;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProductBySlug(slug);
  if (!p) return { title: "Product not found" };
  const prices = p.variants.map((v) => rupees(v.salePrice));
  const fallbackDesc = `${p.name}${p.inspiredByName ? ` — inspired by ${p.inspiredByName}` : ""}. Long-lasting perfume by Ikonix Perfumer${prices.length ? `, from ₹${Math.min(...prices)}` : ""}.`;
  return {
    title: p.seoTitle ?? p.name,
    description: p.seoDescription ?? (p.description ? p.description.slice(0, 160) : fallbackDesc),
    alternates: { canonical: `/products/${p.slug}` },
    openGraph: { title: p.name, images: p.image ? [{ url: p.image.url, width: p.image.width, height: p.image.height }] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[slug]">) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const p = await getProductBySlug(slug);
  if (!p) notFound();
  const related = await getRelatedProducts(p.id, p.categorySlug);
  const wanted = typeof sp.variant === "string" ? sp.variant : undefined;
  const initialVariantId = p.variants.find((v) => v.id === wanted)?.id ?? p.variants[0]?.id ?? null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: p.name,
        description: p.description ?? undefined,
        image: [p.image, ...p.images].filter(Boolean).map((i) => new URL(i!.url, SITE_URL).href),
        brand: { "@type": "Brand", name: "Ikonix Perfumer" },
        offers: p.variants.map((v) => ({
          "@type": "Offer",
          sku: v.sku,
          name: v.label,
          priceCurrency: "INR",
          price: (v.salePrice / 100).toFixed(2),
          availability: v.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          url: new URL(`/products/${p.slug}?variant=${v.id}`, SITE_URL).href,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: new URL("/", SITE_URL).href },
          { "@type": "ListItem", position: 2, name: "Shop", item: new URL("/shop", SITE_URL).href },
          { "@type": "ListItem", position: 3, name: p.name },
        ],
      },
    ],
  };

  return (
    <div className="mx-auto w-[92%] py-6 md:w-[75%]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Breadcrumb className="mb-6" fallback="/shop" items={[{ label: "Home", href: "/" }, { label: "Shop", href: "/shop" }, { label: p.name }]} />
      <ProductView product={p} initialVariantId={initialVariantId} />
      <RelatedProducts products={related} />
    </div>
  );
}
