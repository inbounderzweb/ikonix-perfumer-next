import type { Metadata } from "next";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { listWishlist } from "@/server/customer/wishlist";
import { WishlistGrid } from "@/components/account/wishlist-grid";
import { Empty } from "@/components/account/ui";

export const metadata: Metadata = { title: "My Wishlist", robots: { index: false } };

export default async function WishlistPage() {
  const me = await requireCustomerPage("/account/wishlist");
  const items = await listWishlist(me.id);
  return (
    <div className="space-y-5">
      <h1 className="font-heading text-[28px] text-[#8C7367]">My wishlist</h1>
      {items.length ? <WishlistGrid items={items} /> : <Empty title="Your wishlist is empty" text="Tap the heart on any fragrance to save it here." href="/shop" cta="Browse fragrances" />}
    </div>
  );
}
