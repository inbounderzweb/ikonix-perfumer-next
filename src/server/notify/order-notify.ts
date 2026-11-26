import "server-only";
import { after } from "next/server";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Notification, Order, TestLogin } from "@/server/models";
import { getSmsProvider } from "@/server/auth/otp/sms-provider";
import { buildInvoiceForNotification } from "@/server/customer/invoice";
import { emailConfigured, sendEmail, validEmail } from "./email";
import { esc, renderOrderEmail, type EmailOrder } from "./email-template";
import { carrierLabel } from "../../lib/shipment-tracking";

export const ORDER_EVENTS = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "CANCELLED", "REFUNDED", "RETURN_REQUESTED", "RETURNED"] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

/**
 * SMS wording per event. Indian operators only deliver text matching a DLT-approved template, so register these
 * (variables become {#var#}) and set SMS_TEMPLATE_ID_<EVENT>. Events without a template id send email only.
 * Override the wording with SMS_TEXT_<EVENT> if your approved template differs.
 */
const SMS_DEFAULT: Partial<Record<OrderEvent, string>> = {
  CONFIRMED: "Your Ikonix Perfumer order {order} is confirmed. Total Rs.{total}. Thank you for shopping with us.",
  SHIPPED: "Your Ikonix Perfumer order {order} has been shipped via {carrier}. Tracking number: {tracking}.",
  OUT_FOR_DELIVERY: "Your Ikonix Perfumer order {order} is out for delivery today.",
  DELIVERED: "Your Ikonix Perfumer order {order} has been delivered. Thank you for shopping with us.",
  DELIVERY_FAILED: "Delivery of your Ikonix Perfumer order {order} was unsuccessful. We will contact you shortly.",
  CANCELLED: "Your Ikonix Perfumer order {order} has been cancelled. Any amount paid will be refunded.",
};
export const smsDefaultText = (e: OrderEvent) => SMS_DEFAULT[e];
const inr = (paise: number) => (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 300);

type O = EmailOrder & { _id: Types.ObjectId; contact: { name: string; email?: string; phone: string }; statusHistory: { from?: string; to: string; description?: string }[] };
const loadOrder = async (id: unknown) => (await Order.findById(id as never, "orderNumber placedAt grandTotal paymentStatus cancelReason contact items shipments statusHistory").lean()) as unknown as O | null;
const finish = (id: unknown, patch: Record<string, unknown>) => Notification.updateOne({ _id: id as never }, { $set: patch });

/** The Notification row is written first (unique dedupeKey), so a repeated request or webhook can never send twice. */
async function claim(key: string, channel: "SMS" | "EMAIL", template: string, recipient: string, o: O, event: OrderEvent, from: string | undefined, audience: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  try { return (await Notification.create({ dedupeKey: key, channel, template, recipient, audience, payload: { orderId: o._id, orderNumber: o.orderNumber, event, fromStatus: from ?? null, toStatus: event }, status: "PENDING", attempts: 0 })) as unknown as { _id: Types.ObjectId }; }
  catch (e) { if ((e as { code?: number }).code === 11000) return null; throw e; }
}

async function deliverEmail(nid: unknown, o: O, event: OrderEvent, to: string) {
  const invoice = ["CONFIRMED", "DELIVERED"].includes(event) ? await buildInvoiceForNotification(o.orderNumber).catch(() => null) : null;
  const note = [...o.statusHistory].reverse().find((h) => h.to === event && h.description)?.description;
  const m = renderOrderEmail(o, event, note);
  try {
    const r = await sendEmail({ to, ...m, attachments: invoice ? [{ filename: `invoice-${o.orderNumber}.pdf`, content: invoice, contentType: "application/pdf" }] : undefined });
    // "SENT" = accepted by the Gmail API. Delivery itself is not confirmed by Gmail.
    await Notification.updateOne({ _id: nid as never }, { $set: { status: "SENT", sentAt: new Date(), providerMessageId: r.messageId, lastError: null }, $inc: { attempts: r.attempts } });
  } catch (e) {
    console.error("[notify] email failed", o.orderNumber, event, errText(e));
    await Notification.updateOne({ _id: nid as never }, { $set: { status: "FAILED", lastError: errText(e) }, $inc: { attempts: 3 } });
  }
}

async function deliverSms(nid: unknown, o: O, event: OrderEvent) {
  const sh = o.shipments[0];
  const vars: Record<string, string> = { order: o.orderNumber, total: inr(o.grandTotal), carrier: sh?.carrier ? carrierLabel(sh.carrier) : "our courier", tracking: sh?.trackingNumber ?? "will follow" };
  const tplId = process.env[`SMS_TEMPLATE_ID_${event}`]?.trim();
  const text = process.env[`SMS_TEXT_${event}`]?.trim() || SMS_DEFAULT[event]!;
  try {
    const mobile = o.contact.phone.startsWith("+") ? o.contact.phone : `+91${o.contact.phone.replace(/\D/g, "").slice(-10)}`;
    const provider = getSmsProvider();
    if (!tplId) return void (await finish(nid, { status: "SKIPPED", lastError: `No DLT template id (set SMS_TEMPLATE_ID_${event})` }));
    if (provider.isMock || (await TestLogin.exists({ mobile }))) return void (await finish(nid, { status: "SKIPPED", lastError: "Mock provider or test number" }));
    const r = await provider.send(mobile, text.replace(/\{(\w+)\}/g, (_, n: string) => vars[n] ?? ""), { templateId: tplId });
    await Notification.updateOne({ _id: nid as never }, { $set: { status: "SENT", sentAt: new Date(), providerMessageId: r.messageId, lastError: null }, $inc: { attempts: 1 } });
  } catch (e) { console.error("[notify] sms failed", o.orderNumber, event, errText(e)); await Notification.updateOne({ _id: nid as never }, { $set: { status: "FAILED", lastError: errText(e) }, $inc: { attempts: 1 } }); }
}

export async function notifyOrder(orderId: unknown, event: OrderEvent, from?: string): Promise<void> {
  await db();
  const o = await loadOrder(orderId);
  if (!o) return;
  // A status can legitimately repeat (e.g. back to PACKED), so the key includes how many times the order reached it.
  const key = `ORDER_${event}:${o.orderNumber}:${o.statusHistory.filter((h) => h.to === event).length}`;

  if (SMS_DEFAULT[event]) { const n = await claim(`${key}:SMS`, "SMS", `ORDER_${event}`, o.contact.phone, o, event, from); if (n) await deliverSms(n._id, o, event); }

  const to = o.contact.email?.trim().toLowerCase();
  const n = await claim(`${key}:EMAIL`, "EMAIL", `ORDER_${event}`, to || "(none)", o, event, from);
  if (n) {
    if (!to || !validEmail(to)) await finish(n._id, { status: "SKIPPED", lastError: to ? "Invalid email address on the order" : "No customer email on the order" });
    else if (!emailConfigured()) await finish(n._id, { status: "FAILED", lastError: "Gmail OAuth is not configured" });
    else await deliverEmail(n._id, o, event, to);
  }

  const adminTo = process.env.EMAIL_ADMIN_TO?.trim();
  if (event === "CONFIRMED" && adminTo && validEmail(adminTo) && emailConfigured()) {
    const a = await claim(`${key}:ADMIN`, "EMAIL", "ADMIN_NEW_ORDER", adminTo, o, event, from, "ADMIN");
    if (a) try {
      const r = await sendEmail({ to: adminTo, subject: `New paid order ${o.orderNumber} · Rs. ${inr(o.grandTotal)}`, text: `${o.contact.name} (${o.contact.phone}) placed ${o.orderNumber} for Rs. ${inr(o.grandTotal)}.`, html: `<p>${esc(o.contact.name)} (${esc(o.contact.phone)}) placed <b>${esc(o.orderNumber)}</b> for Rs. ${inr(o.grandTotal)}.</p>` });
      await Notification.updateOne({ _id: a._id }, { $set: { status: "SENT", sentAt: new Date(), providerMessageId: r.messageId }, $inc: { attempts: r.attempts } });
    } catch (e) { await Notification.updateOne({ _id: a._id }, { $set: { status: "FAILED", lastError: errText(e) } }); }
  }
}

/** Admin "Retry" for a FAILED customer notification. Rebuilds the message from the order's current data. */
export async function retryNotification(notificationId: string): Promise<{ ok: boolean; error?: string }> {
  await db();
  const n = (await Notification.findById(notificationId).lean()) as unknown as { _id: Types.ObjectId; status: string; channel: string; recipient: string; audience: string; payload?: { orderId?: unknown; event?: OrderEvent } } | null;
  if (!n || n.status !== "FAILED" || n.audience !== "CUSTOMER" || !n.payload?.orderId || !n.payload.event) return { ok: false, error: "Only failed customer notifications can be retried." };
  const o = await loadOrder(n.payload.orderId);
  if (!o) return { ok: false, error: "Order not found." };
  const claimed = await Notification.updateOne({ _id: n._id, status: "FAILED" }, { $set: { status: "PENDING" } }); // one click = one retry
  if (!claimed.modifiedCount) return { ok: false, error: "This notification is already being retried." };
  if (n.channel === "SMS") await deliverSms(n._id, o, n.payload.event);
  else {
    const to = o.contact.email?.trim().toLowerCase();
    if (!to || !validEmail(to)) { await finish(n._id, { status: "SKIPPED", lastError: "No valid customer email on the order" }); return { ok: false, error: "The order has no valid email address." }; }
    await deliverEmail(n._id, o, n.payload.event, to);
  }
  const after2 = (await Notification.findById(n._id, "status lastError").lean()) as unknown as { status: string; lastError?: string } | null;
  return after2?.status === "SENT" ? { ok: true } : { ok: false, error: after2?.lastError ?? "Retry failed." };
}

/** Runs after the response is sent (serverless keeps the function alive for it); falls back to fire-and-forget in scripts. */
export function queueOrderNotification(orderId: unknown, event: OrderEvent, from?: string) {
  const run = () => notifyOrder(orderId, event, from).catch((e) => console.error("[notify] failed", event, errText(e)));
  try { after(run); } catch { void run(); }
}
