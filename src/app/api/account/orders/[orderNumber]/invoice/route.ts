import { handle } from "@/server/auth/http";
import { requireCustomer } from "@/server/auth/customer-session";
import { buildInvoice } from "@/server/customer/invoice";
import { rateLimit } from "@/server/auth/rate-limit";

export async function GET(_req: Request, ctx: RouteContext<"/api/account/orders/[orderNumber]/invoice">) {
  return handle(async () => {
    const c = await requireCustomer();
    if (!(await rateLimit(`invoice:${c.id}`, 30, 600))) return new Response("Too many requests", { status: 429 });
    const { orderNumber } = await ctx.params;
    const pdf = await buildInvoice(c.id, orderNumber);
    if (!pdf) return new Response("Invoice not available", { status: 404 }); // not yours, not paid, or doesn't exist: same answer
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="invoice-${orderNumber}.pdf"`, "Cache-Control": "private, no-store" } });
  });
}
