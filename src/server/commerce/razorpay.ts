import "server-only";
import { hmacSha256Hex, safeEqual } from "@/server/auth/crypto";

// Thin REST client (no SDK): keeps the dependency surface small. Secrets never leave the server.
const API = "https://api.razorpay.com/v1";

export class RazorpayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function creds() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  return { id, secret };
}
export const razorpayPublicKey = () => creds().id;
export const razorpayMode = () => (creds().id.startsWith("rzp_live_") ? "live" : "test");

async function rzp<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { id, secret } = creds();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
  if (!res.ok) throw new RazorpayError(res.status, json.error?.description ?? `Razorpay error ${res.status}`);
  return json;
}

export type RzpOrder = { id: string; amount: number; currency: string; receipt: string; status: string };
export type RzpPayment = { id: string; order_id: string; amount: number; currency: string; status: "created" | "authorized" | "captured" | "refunded" | "failed"; method?: string; vpa?: string; bank?: string; wallet?: string; card?: { network?: string }; error_code?: string; error_description?: string; amount_refunded?: number };
export type RzpRefund = { id: string; amount: number; status: "pending" | "processed" | "failed"; payment_id: string };

export const createRazorpayOrder = (amountPaise: number, receipt: string, notes: Record<string, string>) =>
  rzp<RzpOrder>("POST", "/orders", { amount: amountPaise, currency: "INR", receipt, notes });
export const fetchRazorpayPayment = (paymentId: string) => rzp<RzpPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
export const captureRazorpayPayment = (paymentId: string, amountPaise: number) => rzp<RzpPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: "INR" });
export const refundRazorpayPayment = (paymentId: string, amountPaise: number, notes: Record<string, string>) =>
  rzp<RzpRefund>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, notes });

/** Checkout success signature: HMAC-SHA256(order_id|payment_id) with the key secret. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  return safeEqual(hmacSha256Hex(creds().secret, `${orderId}|${paymentId}`), signature.toLowerCase());
}

/** Webhook signature: HMAC-SHA256(raw body) with the webhook secret (a different secret from the API key). */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return safeEqual(hmacSha256Hex(secret, rawBody), signature.toLowerCase());
}
export const webhookConfigured = () => !!process.env.RAZORPAY_WEBHOOK_SECRET;
