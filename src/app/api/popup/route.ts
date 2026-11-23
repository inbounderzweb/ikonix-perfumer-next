import { NextResponse } from "next/server";
import { getActivePopup } from "@/server/marketing/popup";

/** Public, cacheable for a minute (an admin enabling or disabling the popup shows up within about a minute). */
export async function GET() {
  try {
    return NextResponse.json({ popup: await getActivePopup() }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (e) {
    console.error("popup lookup failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ popup: null });
  }
}
