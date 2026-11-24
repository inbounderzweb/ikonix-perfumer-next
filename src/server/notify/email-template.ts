import "server-only";
import type { OrderEvent } from "./order-notify";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inr = (paise: number) => `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** Customer-facing copy per status. Keyed by the existing order statuses; no new statuses are introduced. */
export const COPY: Record<OrderEvent, { subject: string; headline: string; body: string }> = {
  CONFIRMED: { subject: "Order confirmed", headline: "Thank you, your order is confirmed", body: "We've received your payment and your order is confirmed. Your invoice is attached." },
  PROCESSING: { subject: "Order is being processed", headline: "We're preparing your order", body: "Your order is being processed and will be packed shortly." },
  PACKED: { subject: "Order packed", headline: "Your order is packed", body: "Your order has been carefully packed and is ready to be handed to the courier." },
  SHIPPED: { subject: "Order shipped", headline: "Your order is on its way", body: "Your order has been shipped. You can follow it with the courier details below." },
  OUT_FOR_DELIVERY: { subject: "Out for delivery", headline: "Your order is out for delivery", body: "Your order will reach you today. Please keep your phone handy for the courier." },
  DELIVERED: { subject: "Order delivered", headline: "Your order has been delivered", body: "We hope you love your fragrance. Your invoice is attached for your records." },
  DELIVERY_FAILED: { subject: "Delivery unsuccessful", headline: "We couldn't deliver your order", body: "The courier could not complete the delivery. We'll contact you shortly to arrange another attempt." },
  CANCELLED: { subject: "Order cancelled", headline: "Your order has been cancelled", body: "Your order has been cancelled. If you paid online, the amount will be refunded to your original payment method." },
  REFUNDED: { subject: "Refund processed", headline: "Your refund is on its way", body: "A refund for your order has been initiated to your original payment method. Banks usually take 5 to 7 working days to show it." },
  RETURN_REQUESTED: { subject: "Return request received", headline: "We received your return request", body: "Our team will review your return request and get back to you soon." },
  RETURNED: { subject: "Return received", headline: "Your return has been received", body: "We've received your returned items. Any refund due will be processed shortly." },
};

export type EmailOrder = {
  orderNumber: string; placedAt: Date; grandTotal: number; paymentStatus: string; cancelReason?: string;
  contact: { name: string }; items: { productName: string; variantLabel: string; quantity: number; freeQuantity?: number }[];
  shipments: { carrier?: string; trackingNumber?: string; trackingUrl?: string; estimatedDeliveryDate?: Date }[];
};

const label = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function renderOrderEmail(o: EmailOrder, event: OrderEvent, note?: string) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const link = site ? `${site}/account/orders/${o.orderNumber}` : undefined;
  const c = COPY[event]; const sh = o.shipments[0];
  const supportMail = (process.env.SUPPORT_EMAIL?.trim() || "ikonixperfumer@gmail.com"), supportPhone = process.env.SUPPORT_PHONE?.trim();
  const date = new Date(o.placedAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  const track = safeUrl(sh?.trackingUrl);
  const rows: [string, string][] = [
    ["Order ID", o.orderNumber], ["Order date", date], ["Status", label(event === "CONFIRMED" ? "CONFIRMED" : event)],
    ["Order total", inr(o.grandTotal)], ["Payment", label(o.paymentStatus)],
    ...(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED"].includes(event) && sh?.carrier ? ([["Courier", sh.carrier], ...(sh.trackingNumber ? [["Tracking number", sh.trackingNumber]] : []), ...(sh.estimatedDeliveryDate && event === "SHIPPED" ? [["Estimated delivery", new Date(sh.estimatedDeliveryDate).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })]] : [])] as [string, string][]) : []),
    ...(event === "CANCELLED" && o.cancelReason ? ([["Reason", o.cancelReason]] as [string, string][]) : []),
  ];
  const items = o.items.slice(0, 8).map((i) => `${i.productName} (${i.variantLabel}) × ${i.quantity}${i.freeQuantity ? ` + ${i.freeQuantity} free` : ""}`);
  if (o.items.length > 8) items.push(`and ${o.items.length - 8} more`);
  const btn = (href: string, text: string) => `<a href="${esc(href)}" style="display:inline-block;background:#b49d91;color:#3f342c;text-decoration:none;padding:12px 26px;border-radius:24px;font-size:15px;margin:4px 6px 0 0">${esc(text)}</a>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f9f6f4;font-family:Arial,Helvetica,sans-serif;color:#2f2a26"><div style="display:none;max-height:0;overflow:hidden">${esc(c.headline)} · ${esc(o.orderNumber)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#2d3545;padding:22px;text-align:center"><span style="font-family:Georgia,serif;letter-spacing:4px;font-size:22px;color:#fff">IKONIX</span><br><span style="letter-spacing:5px;font-size:10px;color:#ddb849">PERFUMER</span></td></tr>
<tr><td style="padding:28px 26px 8px"><p style="margin:0 0 6px;color:#8a7f78;font-size:14px">Hi ${esc(o.contact.name)},</p><h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#3f342c">${esc(c.headline)}</h1><p style="margin:0;font-size:15px;line-height:1.55">${esc(c.body)}</p>${note ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.55;background:#f9f6f4;padding:10px 12px;border-radius:8px">${esc(note)}</p>` : ""}</td></tr>
<tr><td style="padding:14px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #eee4dd">${rows.map(([k, v]) => `<tr><td style="padding:9px 0;color:#8a7f78;border-bottom:1px solid #f1e9e3">${esc(k)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #f1e9e3">${esc(v)}</td></tr>`).join("")}</table></td></tr>
<tr><td style="padding:0 26px 14px"><p style="margin:0 0 6px;font-size:13px;color:#8a7f78">Items</p>${items.map((i) => `<p style="margin:0 0 4px;font-size:14px">${esc(i)}</p>`).join("")}</td></tr>
<tr><td style="padding:6px 26px 26px">${track ? btn(track, "Track shipment") : ""}${link ? btn(link, "View order details") : ""}</td></tr>
<tr><td style="background:#f9f6f4;padding:18px 26px;font-size:12px;color:#8a7f78;line-height:1.6">Need help? ${supportMail ? `Email <a href="mailto:${esc(supportMail)}" style="color:#8a7f78">${esc(supportMail)}</a>` : "Reply to this email"}${supportPhone ? ` or call ${esc(supportPhone)}` : ""}.<br>Ikonix Perfumer · This is an automated message about your order.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Hi ${o.contact.name},`, c.headline + ".", c.body, ...(note ? [note] : []), "", ...rows.map(([k, v]) => `${k}: ${v}`), "", ...items, ...(track ? ["", `Track: ${track}`] : []), ...(link ? ["", `View order: ${link}`] : []), "", `Ikonix Perfumer${supportMail ? ` · ${supportMail}` : ""}`].join("\n");
  return { subject: `${c.subject} · ${o.orderNumber}`, html, text };
}
