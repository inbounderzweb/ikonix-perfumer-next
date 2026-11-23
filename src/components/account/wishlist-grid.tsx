"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import StoreImage from "@/components/store/store-image";
import { useCart } from "@/components/store/cart-context";
import { toggleWishlist } from "@/app/actions/customer/account";
import { inr } from "@/lib/format";
import type { WishItem } from "@/server/customer/wishlist";
import { useToast } from "./toast";
import { btnGhost, btnPrimary } from "./ui";

export function WishlistGrid({ items }: { items: WishItem[] }) {
  const cart = useCart(); const toast = useToast(); const router = useRouter(); const [pending, start] = useTransition();
  const remove = (id: string, msg = "Removed from wishlist.") => start(async () => { const r = await toggleWishlist(id, false); toast(r.ok ? "ok" : "err", r.ok ? msg : r.error); router.refresh(); });
  return (
    <ul className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 xl:grid-cols-3">
      {items.map((i) => {
        const buyable = i.available && i.inStock && i.variantId;
        return (
          <li key={i.productId} className="flex flex-col rounded-2xl border border-[#e7dbd3] bg-white p-3">
            <Link href={`/product-details/${i.slug}`} className="relative block aspect-square overflow-hidden rounded-xl bg-[#f4ece6]">{i.image && <StoreImage src={i.image} alt={i.name} fill sizes="(max-width:640px) 45vw, 240px" className="object-cover" />}</Link>
            <Link href={`/product-details/${i.slug}`} className="mt-2 line-clamp-2 font-fancy font-semibold text-[#3f342c]">{i.name}</Link>
            {i.available && i.salePrice != null ? <p className="font-fancy text-sm text-[#3f342c]">{inr(i.salePrice)} {i.regularPrice != null && i.regularPrice > i.salePrice && <span className="text-xs text-gray-400 line-through">{inr(i.regularPrice)}</span>}<span className="ml-1 text-xs text-[#6b5446]">{i.variantLabel}</span></p> : <p className="font-fancy text-sm text-[#6b5446]">No longer sold</p>}
            <p className={`font-fancy text-xs ${buyable ? "text-green-700" : "text-red-700"}`}>{buyable ? "In stock" : i.available ? "Out of stock" : "Unavailable"}</p>
            <div className="mt-3 flex gap-2">
              <button className={`${btnPrimary} flex-1 !px-3`} disabled={!buyable || pending} onClick={() => { cart.add(i.variantId!, 1, i.name); remove(i.productId, "Moved to cart."); }}>Move to cart</button>
              <button className={btnGhost} aria-label={`Remove ${i.name}`} disabled={pending} onClick={() => remove(i.productId)}>Remove</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
