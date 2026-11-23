import Link from "next/link";
import type { ProductCardDTO } from "@/lib/catalogue-types";
import { HomeProductCard } from "./product-cards";

/** "You may also like" row: a static, swipe/scroll-able list (no auto-animation). */
export function RelatedProducts({ products, title = "You may also like" }: { products: ProductCardDTO[]; title?: string }) {
  if (products.length === 0) return null;
  return (
    <section className="mt-14" aria-label={title}>
      <div className="mb-5 flex items-end justify-between gap-3">
        <h2 className="font-heading text-[26px] text-[#8C7367] md:text-[32px]">{title}</h2>
        <Link href="/shop" className="font-fancy text-sm text-[#8C7367] underline">View all</Link>
      </div>
      <ul className="flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {products.map((p) => (
          <li key={p.id} className="w-[210px] shrink-0 snap-start sm:w-[240px] [&>div]:!w-full">
            <HomeProductCard p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
