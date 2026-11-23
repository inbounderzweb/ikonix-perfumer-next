"use client";

import Image from "@/components/store/store-image";
import Link from "next/link";
import type { ProductCardDTO } from "@/lib/catalogue-types";
import { discountPercent, rupees } from "@/lib/catalogue-types";
import { useCart } from "./cart-context";

const href = (p: ProductCardDTO) => `/products/${p.slug}${p.variant ? `?variant=${p.variant.id}` : ""}`;

function AddButton({ p, className }: { p: ProductCardDTO; className: string }) {
  const { add, notify } = useCart();
  const v = p.variant;
  const disabled = !v || !v.inStock;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        if (!v || !v.inStock) return notify(`${p.name} is out of stock`, "error");
        add(v.id, 1, p.name);
      }}
      disabled={disabled}
      aria-label={`Add ${p.name} to cart`}
      className={className}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/ikonix/site/bag.svg" alt="" className="h-4 w-4" />
    </button>
  );
}

/** Homepage "Best Sellers" card (legacy bh). */
export function HomeProductCard({ p }: { p: ProductCardDTO }) {
  const v = p.variant;
  const showStrike = v && v.regularPrice > 0 && v.salePrice < v.regularPrice;
  return (
    <div className="flex w-[70%] flex-shrink-0 flex-col sm:w-full">
      <div className="relative aspect-square overflow-hidden rounded-[22px] bg-[#f0e4da]">
        {p.categoryName && (
          <span className="absolute top-3 left-3 z-10 rounded-full border border-[#c9b6a9] bg-white/60 px-2 py-0.5 text-[10px] text-[#6b5d52]">{p.categoryName}</span>
        )}
        {!p.inStock && <span className="absolute bottom-3 left-3 z-10 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Out of stock</span>}
        <AddButton p={p} className="absolute top-3 right-3 z-10 rounded-full border border-[#c9b6a9] bg-white/50 p-2.5 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40" />
        <Link href={href(p)} aria-label={p.name} className="absolute inset-0">
          {p.image && <Image src={p.image.url} alt={p.name} fill sizes="(min-width:1280px) 20vw, (min-width:640px) 45vw, 70vw" className="scale-105 object-cover" />}
        </Link>
      </div>
      <div className="mt-4 px-1">
        <h3 className="line-clamp-2 min-h-[2.6em] font-fancy text-[16px] leading-snug text-[#2f3647] sm:text-[17px]">
          <Link href={href(p)}>{p.name}</Link>
        </h3>
        {v && (
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="text-[17px] font-semibold text-[#2f3647]">Rs.{rupees(v.salePrice)}/-</span>
            {showStrike && <span className="text-sm text-[#2f3647]/50 line-through">Rs.{rupees(v.regularPrice)}/-</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Shop grid card (legacy cp). Ratings are shown only once real reviews exist (legacy hard-coded "4.8"). */
export function ShopProductCard({ p }: { p: ProductCardDTO }) {
  const v = p.variant;
  const off = v ? discountPercent(v.regularPrice, v.salePrice) : 0;
  const save = v && v.regularPrice > v.salePrice ? v.regularPrice - v.salePrice : 0;
  const badge = off >= 40 ? "Best Deal" : off > 0 ? `${off}% OFF` : null;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
      {!p.inStock && <span className="absolute bottom-2.5 left-2.5 z-10 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Out of stock</span>}
      {badge && (
        <span className="absolute top-2.5 left-2.5 z-10 flex items-center gap-0.5 rounded-full bg-[#2A3443] px-2 py-0.5 text-[9px] font-medium text-white">{off >= 40 ? "🔥 " : ""}{badge}</span>
      )}
      <AddButton p={p} className="absolute top-3 right-3 z-10 rounded-full border border-[#c9b6a9] bg-white/70 p-2.5 backdrop-blur-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40" />
      <Link href={href(p)} className="relative block h-40 w-full sm:h-64" aria-label={p.name}>
        {p.image && <Image src={p.image.url} alt={p.name} fill sizes="(min-width:1024px) 20vw, 50vw" className="object-cover" />}
      </Link>
      <div className="p-3">
        <h3 className="line-clamp-2 min-h-[2.4em] font-fancy text-[15px] leading-snug font-medium text-[#2A3443]">
          <Link href={href(p)}>{p.name}</Link>
        </h3>
        {v && (
          <div className="mt-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[17px] font-bold text-[#2A3443]">₹{rupees(v.salePrice)}/-</span>
              {off > 0 && <span className="text-xs text-gray-400 line-through">₹{rupees(v.regularPrice)}/-</span>}
            </div>
            {save > 0 && <p className="mt-0.5 text-xs font-medium text-green-600">Save ₹{rupees(save)}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
