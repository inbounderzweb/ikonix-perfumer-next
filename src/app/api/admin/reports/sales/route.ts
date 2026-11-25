import { requireAdmin } from "@/server/auth/guard";
import { handle } from "@/server/auth/http";
import { db } from "@/server/db";
import { Order } from "@/server/models";
import { parseSalesFilters, salesMatch } from "@/server/admin/sales-report";

export const runtime = "nodejs";
const MAX_ROWS = 20_000;
/** Spreadsheet formula injection guard: a cell starting with = + - @ is read as a formula by Excel/Sheets. */
const cell = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rupees = (p: number | undefined) => ((p ?? 0) / 100).toFixed(2);

export function GET(req: Request) {
  return handle(async () => {
    await requireAdmin("orders.read");
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    const f = parseSalesFilters(sp);
    const match = await salesMatch(f);
    await db();
    type O = { orderNumber: string; placedAt: Date; status: string; paymentStatus: string; contact: { name: string; phone: string; email?: string }; shippingAddress?: { city?: string; state?: string; postalCode?: string }; items: { quantity: number; freeQuantity: number }[]; subtotal: number; discountTotal: number; shippingTotal: number; packingTotal: number; taxTotal: number; grandTotal: number; couponCode?: string; userId?: unknown; legacy?: unknown };
    const rows = (await Order.find(match, "orderNumber placedAt status paymentStatus contact shippingAddress items subtotal discountTotal shippingTotal packingTotal taxTotal grandTotal couponCode userId legacy").sort({ placedAt: -1 }).limit(MAX_ROWS).lean()) as unknown as O[];
    const head = ["Order", "Placed (IST)", "Status", "Payment", "Customer", "Phone", "Email", "City", "State", "Pincode", "Units", "Subtotal", "Discount", "Shipping", "Packing", "Tax", "Total", "Coupon", "Customer type", "Source"];
    const lines = [head.join(",")];
    for (const o of rows) {
      lines.push([o.orderNumber, new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(o.placedAt), o.status, o.paymentStatus, o.contact.name, o.contact.phone, o.contact.email, o.shippingAddress?.city, o.shippingAddress?.state, o.shippingAddress?.postalCode,
        o.items.reduce((n, i) => n + i.quantity + i.freeQuantity, 0), rupees(o.subtotal), rupees(o.discountTotal), rupees(o.shippingTotal), rupees(o.packingTotal), rupees(o.taxTotal), rupees(o.grandTotal), o.couponCode, o.userId ? "registered" : "guest", o.legacy ? "imported" : "new site"].map(cell).join(","));
    }
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sales-report-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
  });
}
