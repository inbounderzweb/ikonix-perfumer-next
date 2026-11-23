import { NextResponse, type NextRequest } from "next/server";
import { searchProducts } from "@/server/catalogue/queries";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1 || q.length > 60) return NextResponse.json({ items: [] });
  const items = await searchProducts(q, 10);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
}
