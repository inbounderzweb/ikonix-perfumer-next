import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { Order, Payment, Refund, WebhookEvent } from "@/server/models";
import { markOrderPaid } from "@/server/commerce/orders";
import { verifyWebhookSignature, webhookConfigured } from "@/server/commerce/razorpay";

export const runtime = "nodejs";

type Entity = Record<string, unknown> & { id?: string; order_id?: string; amount?: number; status?: string; method?: string; vpa?: string; bank?: string; wallet?: string; payment_id?: string; error_code?: string; error_description?: string; card?: { network?: string } };
type Payload = { event?: string; payload?: { payment?: { entity?: Entity }; order?: { entity?: Entity }; refund?: { entity?: Entity } } };

/**
 * Razorpay → us. Authenticity = HMAC of the RAW body (never the parsed JSON). The event is stored before processing and
 * keyed by Razorpay's event id, so redeliveries are acknowledged without being processed twice.
 */
export async function POST(req: Request) {
  if (!webhookConfigured()) {
    console.error("razorpay webhook hit but RAZORPAY_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 }); // Razorpay will retry once it is
  }
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"))) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  let body: Payload;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const eventId = req.headers.get("x-razorpay-event-id");
  const type = body.event;
  if (!eventId || !type) return NextResponse.json({ error: "Missing event id" }, { status: 400 });

  await db();
  try {
    await WebhookEvent.create({ provider: "RAZORPAY", eventId, eventType: type, signatureValid: true, payload: body } as never);
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    // Redelivery: acknowledge if it was fully processed, otherwise process it now (an earlier attempt failed).
    const prior = (await WebhookEvent.findOne({ provider: "RAZORPAY", eventId }, "processedAt").lean()) as unknown as { processedAt?: Date } | null;
    if (prior?.processedAt) return NextResponse.json({ ok: true, duplicate: true });
  }

  let error: string | undefined;
  try {
    const pay = body.payload?.payment?.entity;
    if ((type === "payment.captured" || type === "order.paid") && (pay?.order_id || body.payload?.order?.entity?.id)) {
      const rzOrderId = (pay?.order_id ?? body.payload?.order?.entity?.id) as string;
      const payment = (await Payment.findOne({ providerOrderId: rzOrderId }).lean()) as unknown as { orderId: unknown; amount: number } | null;
      const paid = pay ?? undefined;
      if (!payment) error = `No payment for razorpay order ${rzOrderId}`;
      else if (!paid?.id || paid.amount !== payment.amount) error = "Amount mismatch or missing payment id; needs manual review";
      else await markOrderPaid(payment.orderId as string, { providerPaymentId: paid.id, method: paid.method, methodDetail: (paid.vpa ?? paid.bank ?? paid.wallet ?? paid.card?.network) as string | undefined, fromWebhook: true });
    } else if (type === "payment.failed" && pay?.order_id) {
      const p = await Payment.findOneAndUpdate({ providerOrderId: pay.order_id, status: { $ne: "CAPTURED" } }, { status: "FAILED", providerPaymentId: pay.id, method: pay.method, failureCode: pay.error_code, failureReason: pay.error_description });
      // The order stays PENDING so the customer can retry until the stock hold lapses.
      if (p) await Order.updateOne({ _id: (p as unknown as { orderId: unknown }).orderId, paymentStatus: { $ne: "CAPTURED" } }, { paymentStatus: "FAILED" });
    } else if ((type === "refund.processed" || type === "refund.failed") && body.payload?.refund?.entity?.id) {
      const rf = body.payload.refund.entity;
      await Refund.updateOne({ providerRefundId: rf.id }, { status: type === "refund.processed" ? "PROCESSED" : "FAILED", ...(type === "refund.processed" ? { processedAt: new Date() } : {}) });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "processing failed";
    console.error("razorpay webhook processing", type, error);
  }
  await WebhookEvent.updateOne({ provider: "RAZORPAY", eventId }, error ? { processingError: error, $inc: { attempts: 1 } } : { processedAt: new Date(), $inc: { attempts: 1 } });
  // A non-2xx makes Razorpay redeliver (with the same event id), which the branch above then retries.
  return error ? NextResponse.json({ error: "Processing failed" }, { status: 500 }) : NextResponse.json({ ok: true });
}
