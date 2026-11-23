"use client";

import Image from "@/components/store/store-image";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { ImageDTO, ProductDetailDTO } from "@/lib/catalogue-types";
import { discountPercent, rupees } from "@/lib/catalogue-types";
import { useCart } from "./cart-context";
import { WishlistButton } from "./wishlist-button";

// Fixed copy shown on every legacy product page (the store's own marketing/spec text).
const FEATURES = ["Premium fragrances", "Long-lasting freshness", "A perfume for every mood", "Perfect for everyday use"];
const ABOUT = [
  "Premium long-lasting fragrance — crafted with high-quality ingredients",
  "Suitable for everyday wear and special occasions",
  "Perfect for gifting — elegantly packaged",
  "Cruelty-free and ethically sourced ingredients",
  "Available in multiple sizes to suit your lifestyle",
];

export function ProductView({ product: p, initialVariantId }: { product: ProductDetailDTO; initialVariantId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { add, setOpen } = useCart();
  const [variantId, setVariantId] = useState(initialVariantId);
  const [qty, setQty] = useState(1);
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const thumbs = useRef<HTMLDivElement>(null);

  const variant = p.variants.find((v) => v.id === variantId) ?? null;
  // Selected size's own photo first, then the product gallery (deduplicated by URL).
  const images = useMemo(() => {
    const list: ImageDTO[] = [...(variant?.image ? [variant.image] : []), ...p.images];
    return list.filter((img, i) => list.findIndex((x) => x.url === img.url) === i);
  }, [variant, p.images]);
  const current = images[Math.min(index, images.length - 1)];

  const outOfStock = !variant || !variant.inStock;
  const off = variant ? discountPercent(variant.regularPrice, variant.salePrice) : 0;
  const unitSale = variant ? rupees(variant.salePrice) : 0;
  const unitRegular = variant ? rupees(variant.regularPrice) : 0;
  const save = unitRegular - unitSale;

  const selectVariant = (id: string) => {
    setVariantId(id);
    setIndex(0);
    setQty(1);
    router.replace(`${pathname}?variant=${id}`, { scroll: false });
  };
  const step = (d: number) => setIndex((i) => (i + d + images.length) % images.length);
  const addToCart = () => { if (variant && !outOfStock) add(variant.id, qty, p.name); };

  return (
    <>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        {/* Gallery */}
        <div className="flex w-full flex-col gap-4 md:max-w-[500px]">
          <div className="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 shadow-md transition-shadow duration-300 hover:shadow-lg md:h-[500px]">
            {current ? (
              <button type="button" onClick={() => setFullscreen(true)} className="relative h-full w-full cursor-zoom-in overflow-hidden" aria-label="Open image in full screen">
                <Image key={current.url} src={current.url} alt={p.name} fill preload sizes="(min-width:768px) 500px, 92vw"
                  className="image-slide-in object-cover transition-transform duration-300 ease-out md:group-hover:scale-105" />
              </button>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 p-6 text-gray-400">
                <span className="font-fancy text-sm font-medium tracking-wide text-gray-500">No Image Available</span>
              </div>
            )}
            {images.length > 1 && (
              <>
                <button onClick={() => step(-1)} aria-label="Previous image" className="absolute top-1/2 left-4 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-3 text-gray-800 opacity-0 shadow-md transition-all duration-200 group-hover:opacity-100 hover:scale-110 hover:bg-white focus:opacity-100">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                </button>
                <button onClick={() => step(1)} aria-label="Next image" className="absolute top-1/2 right-4 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-3 text-gray-800 opacity-0 shadow-md transition-all duration-200 group-hover:opacity-100 hover:scale-110 hover:bg-white focus:opacity-100">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
                <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/20 px-3 py-1.5 backdrop-blur-sm">
                  {images.map((img, i) => <span key={img.url} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} />)}
                </div>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div ref={thumbs} className="no-scrollbar mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2">
              {images.map((img, i) => (
                <button key={img.url} onClick={() => setIndex(i)} aria-label={`Show image ${i + 1}`}
                  className={`relative h-20 w-20 flex-shrink-0 snap-start overflow-hidden rounded-xl border-2 transition-all duration-200 ${i === index ? "scale-95 border-[#b49d91] shadow-sm ring-2 ring-[#b49d91]/20" : "border-gray-200 hover:border-[#b49d91]/50"}`}>
                  <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex flex-col">
          <h1 className="font-fancy text-[32px] font-bold tracking-[0.5px] text-[#8C7367] md:text-[36px]">{p.name}</h1>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/ikonix/site/checkcircle.svg" alt="" className="h-5 w-5" />
                <span className="font-fancy text-[16px] text-[#6C5950]">{f}</span>
              </div>
            ))}
          </div>
          <hr className="mt-6 border-[#B39384]/60" />
          <div className="mt-6 grid gap-4">
            <span className="inline-block rounded-[24px] border border-[#B39384] bg-[#EDE2DD] px-[20px] py-[8px] font-fancy text-[16px] tracking-[0.5px] text-[#8C7367]">Enjoy Free Delivery on Orders Over ₹1,099/-</span>
          </div>
          <hr className="my-6 border-[#B39384]/60" />

          {variant && (
            <div className="mb-5 rounded-xl border border-[#E8D9D0] bg-[#FDF8F5] p-4">
              <p className="mb-1 font-fancy text-xs tracking-widest text-[#8C7367] uppercase">{off >= 40 ? "🔥 Best Deal" : off > 0 ? "Special Offer" : "Price"}</p>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-[32px] leading-none font-bold text-[#2A3443] md:text-[36px]">₹{unitSale * qty}</span>
                {off > 0 && <span className="font-fancy text-[18px] text-gray-400 line-through">₹{unitRegular * qty}</span>}
                {off > 0 && <span className="rounded-md bg-green-100 px-2 py-0.5 text-sm font-bold text-green-700">{off}% OFF</span>}
              </div>
              {save > 0 && <p className="mt-1 text-sm font-semibold text-green-600">You save ₹{save * qty}</p>}
            </div>
          )}

          <div>
            <p className="mb-2 font-fancy text-sm text-[#6C5950]">Size</p>
            <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Size">
              {p.variants.map((v) => {
                const vOff = discountPercent(v.regularPrice, v.salePrice);
                const selected = v.id === variantId;
                return (
                  <button key={v.id} type="button" role="radio" aria-checked={selected} onClick={() => selectVariant(v.id)}
                    className={`relative flex h-14 w-full flex-col items-center justify-center rounded-[12px] border px-3 text-[14px] transition ${selected ? "border-[#b49d91] bg-[#b49d91] text-white" : "border-[#B39384]/60 bg-white text-[#6C5950]"} ${v.inStock ? "" : "opacity-60"}`}>
                    <span>{v.label}</span>
                    {vOff > 0 && <span className={`text-[10px] font-bold ${selected ? "text-white/80" : "text-green-600"}`}>{vOff}% off</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span className="font-fancy text-sm text-[#6C5950]">Quantity</span>
            <div className="flex items-center rounded-md border border-[#B39384]">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-1 text-lg text-[#53443D]" aria-label="Decrease quantity">−</button>
              <span className="min-w-8 text-center" aria-live="polite">{qty}</span>
              <button onClick={() => setQty((q) => Math.min(99, q + 1))} className="px-3 py-1 text-lg text-[#53443D]" aria-label="Increase quantity">+</button>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {outOfStock && <p role="status" className="font-semibold text-red-600 lg:col-span-2">Out of stock</p>}
            <div className="flex gap-3"><button type="button" disabled={outOfStock} onClick={addToCart}
              className="h-12 w-full rounded-md bg-[#b49d91] font-medium text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">
              {outOfStock ? "Out of Stock" : "Add to Cart"}
            </button><WishlistButton productId={p.id} /></div>
            <button type="button" disabled={outOfStock} onClick={() => { addToCart(); setOpen(true); }}
              className="h-12 w-full rounded-md bg-[#2A3443] font-medium text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">
              Buy Now
            </button>
          </div>

          <hr className="mt-7 border-[#B39384]/60" />
          <div className="mt-7">
            <h2 className="mb-3 font-fancy text-[18px] font-bold text-[#2A3443]">About This Product</h2>
            <ul className="space-y-2">
              {ABOUT.map((a) => (
                <li key={a} className="flex items-start gap-2 font-fancy text-[15px] text-[#6C5950]"><span className="mt-0.5 font-bold text-[#b49d91]">•</span>{a}</li>
              ))}
            </ul>
          </div>
          {p.description && (
            <div className="mt-7">
              <h2 className="mb-3 font-fancy text-[18px] font-bold text-[#2A3443]">Description</h2>
              <p className="font-fancy text-[15px] leading-relaxed whitespace-pre-line text-[#6C5950]">{p.description}</p>
            </div>
          )}
          {(p.notes.top.length > 0 || p.notes.middle.length > 0 || p.notes.base.length > 0) && (
            <div className="mt-7">
              <h2 className="mb-3 font-fancy text-[18px] font-bold text-[#2A3443]">Fragrance Notes</h2>
              <dl className="grid grid-cols-[6rem_1fr] gap-y-2 font-fancy text-[15px] text-[#6C5950]">
                {(["top", "middle", "base"] as const).filter((k) => p.notes[k].length).map((k) => (
                  <div key={k} className="contents"><dt className="font-semibold text-[#8C7367] capitalize">{k}</dt><dd>{p.notes[k].join(", ")}</dd></div>
                ))}
              </dl>
            </div>
          )}
          <div className="mt-7">
            <h2 className="mb-3 font-fancy text-[18px] font-bold text-[#2A3443]">Specifications</h2>
            <div className="overflow-hidden rounded-xl border border-[#E8D9D0]">
              {[
                ["Brand", "Ikonix Perfumer"],
                ["Category", p.categoryName ?? "—"],
                ...(variant ? [["Size / Volume", variant.label]] : []),
                ["Fragrance Type", "Eau de Parfum (EDP)"],
                ["Country of Origin", "India"],
                ["Shelf Life", "36 months from manufacturing date"],
              ].map(([k, v], i) => (
                <div key={k} className={`flex items-start gap-4 px-4 py-3 font-fancy text-[14px] ${i % 2 === 0 ? "bg-[#FDF8F5]" : "bg-white"}`}>
                  <span className="w-36 flex-shrink-0 font-semibold text-[#8C7367]">{k}</span>
                  <span className="text-[#2A3443]">{v}</span>
                </div>
              ))}
            </div>
          </div>
          {save > 0 && variant && (
            <div className="mt-7 rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="mb-2 text-[15px] font-bold text-green-700">🎉 Special Offer</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-gray-500">MRP:</span><span className="text-gray-400 line-through">₹{unitRegular}</span>
                <span className="text-gray-500">Sale Price:</span><span className="font-bold text-[#2A3443]">₹{unitSale}</span>
                <span className="text-gray-500">You Save:</span><span className="font-bold text-green-600">₹{save} ({off}% OFF)</span>
              </div>
            </div>
          )}
          <hr className="mt-7 border-[#B39384]/60" />
        </div>
      </div>

      {fullscreen && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm" onClick={() => setFullscreen(false)} role="dialog" aria-modal="true" aria-label={`${p.name} image`}>
          <button type="button" className="absolute top-4 right-4 text-4xl leading-none text-white/90" onClick={() => setFullscreen(false)} aria-label="Close image">×</button>
          <Image src={current.url} alt={p.name} width={current.width} height={current.height} sizes="92vw" onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl" />
        </div>
      )}
    </>
  );
}
