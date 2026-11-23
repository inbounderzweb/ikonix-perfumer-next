import { handle } from "@/server/auth/http";
import { clientMeta } from "@/server/auth/request";
import { rateLimit } from "@/server/auth/rate-limit";
import { buildGuestInvoice } from "@/server/customer/invoice";

/** Guest invoice download, authorised by the order's private token (?t=). Paid orders only. */
export async function GET(req: Request, ctx: RouteContext<"/api/orders/[orderNumber]/invoice">) {
  return handle(async () => {
    const { ip } = await clientMeta();
    if (!(await rateLimit(`guest-invoice:${ip}`, 30, 600))) return new Response("Too many requests", { status: 429 });
    const { orderNumber } = await ctx.params;
    const token = new URL(req.url).searchParams.get("t") ?? "";
    const pdf = await buildGuestInvoice(orderNumber, token);
    if (!pdf) return new Response("Invoice not available", { status: 404 });
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="invoice-${orderNumber}.pdf"`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  });
}
