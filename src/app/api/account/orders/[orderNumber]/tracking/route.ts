import { NextResponse } from "next/server";
import { handle } from "@/server/auth/http";
import { requireCustomer } from "@/server/auth/customer-session";
import { getOrder } from "@/server/customer/orders";
import { rateLimit } from "@/server/auth/rate-limit";

export async function GET(_req: Request, ctx: RouteContext<"/api/account/orders/[orderNumber]/tracking">) {
  return handle(async () => {
    const c = await requireCustomer();
    if (!(await rateLimit(`track:${c.id}`, 240, 600))) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const { orderNumber } = await ctx.params;
    const o = await getOrder(c.id, orderNumber);
    if (!o) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ timeline: o.timeline, events: o.events, shipment: o.shipment, status: o.status, statusLabel: o.statusLabel, cancelReason: o.cancelReason }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
