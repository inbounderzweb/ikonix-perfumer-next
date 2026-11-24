import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getOrder, getOrderByToken, getOrderTrusted } from "./orders";

const inr = (paise: number) => `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; // StandardFonts lack the rupee glyph
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "?"); // WinAnsi-safe

/** Invoice for a PAID order only. Tax lines appear only if tax was actually charged (no invented GST breakdown). */
export const buildInvoice = async (userId: string, orderNumber: string) => renderInvoice(await getOrder(userId, orderNumber));
/** For emails sent by the server after payment/status changes. */
export const buildInvoiceForNotification = async (orderNumber: string) => renderInvoice(await getOrderTrusted(orderNumber));
export const buildGuestInvoice = async (orderNumber: string, token: string) => renderInvoice(await getOrderByToken(orderNumber, token));

async function renderInvoice(o: Awaited<ReturnType<typeof getOrder>>): Promise<Uint8Array | null> {
  if (!o || !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.payment.status)) return null;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${o.orderNumber}`); pdf.setProducer("Ikonix");
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]); let y = 800;
  const text = (t: string, x: number, size = 10, f = font, color = rgb(0.2, 0.17, 0.15)) => page.drawText(clean(t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, size = 10, f = font) => page.drawText(clean(t), { x: xr - f.widthOfTextAtSize(clean(t), size), y, size, font: f, color: rgb(0.2, 0.17, 0.15) });
  text("IKONIX PERFUMER", 40, 18, bold); y -= 16; text("TAX INVOICE / RECEIPT", 40, 9); right(`Invoice for ${o.orderNumber}`, 555, 11, bold);
  y -= 14; right(`Date: ${new Date(o.placedAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}`, 555);
  y -= 30; text("Billed / shipped to", 40, 9, bold); right("Payment", 555, 9, bold); y -= 14;
  const addr = [o.address.name, ...o.address.lines, `${o.address.city}, ${o.address.state} ${o.address.postalCode}`, o.address.phone];
  const pay = [`Status: ${o.payment.status.replace(/_/g, " ").toLowerCase()}`, o.payment.method ? `Method: ${o.payment.method}${o.payment.methodDetail ? ` (${o.payment.methodDetail})` : ""}` : "", o.payment.transactionId ? `Txn: ${o.payment.transactionId}` : ""].filter(Boolean);
  for (let i = 0; i < Math.max(addr.length, pay.length); i++) { if (addr[i]) text(addr[i], 40); if (pay[i]) right(pay[i], 555); y -= 13; }
  y -= 12; page.drawRectangle({ x: 40, y: y - 4, width: 515, height: 18, color: rgb(0.93, 0.89, 0.86) });
  text("Item", 46, 9, bold); right("Qty", 350, 9, bold); right("Price", 450, 9, bold); right("Amount", 550, 9, bold); y -= 20;
  for (const i of o.items) {
    if (y < 120) { page = pdf.addPage([595, 842]); y = 800; }
    text(`${i.name} (${i.variant})`.slice(0, 62), 46); right(String(i.qty + (i.free ? 0 : 0)), 350); right(inr(i.unit), 450); right(inr(i.total), 550); y -= 14;
    if (i.free) { text(`  + ${i.free} free`, 46, 8); y -= 12; }
  }
  y -= 8; page.drawLine({ start: { x: 330, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.7, 0.65, 0.6) }); y -= 16;
  const row = (l: string, v: string, b = false) => { text(l, 360, 10, b ? bold : font); right(v, 555, 10, b ? bold : font); y -= 15; };
  row("Subtotal", inr(o.subtotal));
  if (o.discount) row(`Discount${o.coupon ? ` (${o.coupon})` : ""}`, `- ${inr(o.discount)}`);
  row(`Shipping (${o.shippingMethod})`, o.shipping ? inr(o.shipping) : "Free");
  if (o.packing) row("Packing", inr(o.packing));
  if (o.tax) row("Tax", inr(o.tax));
  row("Total paid", inr(o.total), true);
  y -= 24; text("Prices are inclusive of applicable taxes. This is a computer-generated document.", 40, 8);
  return pdf.save();
}
