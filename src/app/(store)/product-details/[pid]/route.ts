import { NextResponse, type NextRequest } from "next/server";
import { resolveLegacyProduct } from "@/server/catalogue/queries";

// Legacy URLs (/product-details/:pid?vid=) → 301 to the new slug URL, keeping the chosen size.
export async function GET(req: NextRequest, ctx: RouteContext<"/product-details/[pid]">) {
  const { pid } = await ctx.params;
  if (!/^\d{1,8}$/.test(pid)) return NextResponse.redirect(new URL("/shop", req.url), 301);
  const target = await resolveLegacyProduct(pid, req.nextUrl.searchParams.get("vid"));
  if (!target) return NextResponse.redirect(new URL("/shop", req.url), 301);
  const url = new URL(`/products/${target.slug}`, req.url);
  if (target.variantId) url.searchParams.set("variant", target.variantId);
  return NextResponse.redirect(url, 301);
}
