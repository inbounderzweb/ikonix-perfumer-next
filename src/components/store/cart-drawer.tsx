"use client";

import Image from "@/components/store/store-image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getCartView, type CartLineView } from "@/app/actions/cart";
import { useCart } from "./cart-context";

const money = (paise: number) => `Rs.${Math.round(paise / 100)}`;

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lines, setQty, remove, count } = useCart();
  const [view, setView] = useState<CartLineView[] | null>(null);

  // Re-price from the server whenever the drawer is open and the cart changes.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getCartView(lines).then((v) => alive && setView(v));
    return () => { alive = false; };
  }, [open, lines]);

  const subtotal = (view ?? []).reduce((a, l) => a + l.unitPrice * l.qty, 0);
  const unavailable = (view ?? []).some((l) => !l.inStock);

  return (
    <div className={`fixed inset-0 z-[100] flex ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div onClick={onClose} className={`fixed inset-0 bg-black/40 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <div role="dialog" aria-modal="true" aria-label="Cart"
        className={`relative ml-auto flex h-[100dvh] w-full max-w-md transform flex-col overflow-hidden bg-white shadow-xl transition-transform duration-300 sm:h-[90%] sm:rounded-bl-[40px] ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2 font-heading font-semibold text-[#53443D]">
            <span className="text-[18px]">Cart</span>
            <p className="text-[14px] text-[#8C7367]">({count} items)</p>
          </div>
          <button onClick={onClose} aria-label="Close cart">
            <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {open && view === null && lines.length > 0 && <div className="border-b px-4 py-3 text-sm text-gray-600">Loading cart...</div>}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {lines.length === 0 || (view && view.length === 0) ? (
            <p className="mt-10 text-center text-gray-500">Your cart is empty.</p>
          ) : (
            (view ?? []).map((l) => (
              <div key={l.variantId} className="flex items-start justify-between border-b border-[#B39384] pb-6">
                <div className="flex w-full items-start gap-3">
                  {l.image && (
                    <Link href={`/products/${l.productSlug}?variant=${l.variantId}`} onClick={onClose} className="w-24 flex-shrink-0 sm:w-40">
                      <Image src={l.image} alt={l.name} width={160} height={160} className="w-full rounded object-cover" />
                    </Link>
                  )}
                  <div className="flex flex-1 flex-col gap-3">
                    <div>
                      <Link href={`/products/${l.productSlug}?variant=${l.variantId}`} onClick={onClose}
                        className="text-left font-fancy text-[16px] leading-[150%] font-bold tracking-[0.5px] text-[#8C7367] hover:underline sm:text-[21px]">{l.name}</Link>
                      <span className="mt-1 block w-fit rounded-full border border-[#B39384] px-2 py-0.5 text-xs text-[#53443D]">{l.label}</span>
                    </div>
                    <span className="font-fancy text-[16px] leading-[150%] font-bold tracking-[0.5px] text-[#2A3443] sm:text-[21px]">{money(l.unitPrice)}</span>
                    {!l.inStock && <p className="text-sm font-semibold text-red-600">Out of stock</p>}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center rounded-md border border-[#B39384]">
                        <button onClick={() => (l.qty > 1 ? setQty(l.variantId, l.qty - 1) : remove(l.variantId))} className="px-3 py-1 text-lg text-[#53443D]" aria-label={`Decrease ${l.name}`}>−</button>
                        <span className="min-w-8 text-center text-sm" aria-live="polite">{l.qty}</span>
                        <button onClick={() => setQty(l.variantId, l.qty + 1)} className="px-3 py-1 text-lg text-[#53443D]" aria-label={`Increase ${l.name}`}>+</button>
                      </div>
                      <button onClick={() => remove(l.variantId)} className="text-sm text-[#8C7367] underline">Remove</button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        {(view?.length ?? 0) > 0 && (
          <div className="space-y-3 border-t p-4">
            <div className="flex justify-between font-fancy text-[#2A3443]"><span>Subtotal</span><span className="font-bold">{money(subtotal)}/-</span></div>
            <p className="text-xs text-[#8C7367]">Delivery charges are added at checkout.</p>
            <Link href="/checkout" onClick={onClose} aria-disabled={unavailable || !(view ?? []).length}
              className={`block w-full rounded-md py-3 text-center text-lg text-white ${unavailable || !(view ?? []).length ? "pointer-events-none bg-gray-300" : "bg-[#53443D] hover:bg-[#44322b]"}`}>
              Checkout
            </Link>
            {unavailable && <p className="text-center text-xs text-gray-500">Remove out-of-stock items to continue.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
