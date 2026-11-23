import { NextResponse } from "next/server";
import { getCustomer } from "@/server/auth/customer-session";
import { wishlistIds } from "@/server/customer/wishlist";

/** Product pages are cached/static, so the heart's state is fetched client-side from this per-user endpoint. */
export async function GET() {
  const c = await getCustomer();
  if (!c) return NextResponse.json({ signedIn: false, ids: [] }, { headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ signedIn: true, ids: await wishlistIds(c.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
