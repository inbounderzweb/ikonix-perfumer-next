"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toggleWishlist } from "@/app/actions/customer/account";
import { useCart } from "./cart-context";

export function WishlistButton({ productId }: { productId: string }) {
  const router = useRouter(); const path = usePathname(); const { notify } = useCart();
  const [on, setOn] = useState(false); const [signedIn, setSignedIn] = useState<boolean | null>(null); const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    fetch("/api/account/wishlist", { cache: "no-store" }).then((r) => r.json()).then((j: { signedIn: boolean; ids: string[] }) => { if (live) { setSignedIn(j.signedIn); setOn(j.ids.includes(productId)); } }).catch(() => {});
    return () => { live = false; };
  }, [productId]);
  return (
    <button type="button" aria-pressed={on} aria-label={on ? "Remove from wishlist" : "Add to wishlist"} disabled={pending}
      onClick={() => {
        if (signedIn === false) return router.push(`/login?next=${encodeURIComponent(path)}`);
        const next = !on; setOn(next);
        start(async () => { const r = await toggleWishlist(productId, next); if (!r.ok) { setOn(!next); notify(r.error, "error"); } else notify(next ? "Saved to wishlist" : "Removed from wishlist"); });
      }}
      className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-[#b49d91] bg-white text-[#b49d91] hover:bg-[#f4ece6] disabled:opacity-60">
      <svg width="22" height="22" viewBox="0 0 24 24" fill={on ? "#c0392b" : "none"} stroke={on ? "#c0392b" : "currentColor"} strokeWidth="2" aria-hidden><path d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0 1 12 6.3 5.4 5.4 0 0 1 21.3 12C19 16.4 12 21 12 21z" /></svg>
    </button>
  );
}
