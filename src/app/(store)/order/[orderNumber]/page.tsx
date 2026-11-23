import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { Order } from "@/server/models";
import { safeEqual, sha256 } from "@/server/auth/crypto";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0 })}`;

export default async function OrderPage({ params, searchParams }: PageProps<"/order/[orderNumber]">) {
  const { orderNumber } = await params;
  const t = (await searchParams).t;
  const token = Array.isArray(t) ? t[0] : t;
  type O = { orderNumber: string; status: string; paymentStatus: string; items: { productName: string; variantLabel: string; quantity: number; lineTotal: number }[]; subtotal: number; shippingTotal: number; grandTotal: number; shippingAddress: { fullName: string; line1: string; line2?: string; city: string; state: string; postalCode: string; phone: string }; shippingMethodName: string; placedAt: Date; accessTokenHash?: string; shipments?: { carrier: string; trackingNumber?: string; trackingUrl?: string }[] };
  let order: O | null = null;
  if (/^IKX-\d{6}-\d{5}$/.test(orderNumber) && token && token.length < 80) {
    await db();
    const o = (await Order.findOne({ orderNumber }, "+accessTokenHash").lean()) as unknown as O | null;
    // Same response for "no such order" and "wrong token": order numbers are sequential, so they must not be an oracle.
    if (o?.accessTokenHash && safeEqual(sha256(token), o.accessTokenHash)) order = o;
  }
  if (!order) {
    return (
      <section className="mx-auto flex w-[90%] max-w-lg flex-col items-center py-24 text-center">
        <h1 className="font-heading text-[30px] text-[#8C7367]">Order not found</h1>
        <p className="mt-3 font-fancy text-[#53443D]">This link is missing its secure key or has expired. Please use the link from your confirmation, or contact us at ikonixperfumer@gmail.com.</p>
        <Link href="/shop" className="mt-8 rounded-full bg-[#b49d91] px-10 py-3 font-fancy text-[#3f342c]">Back to shop</Link>
      </section>
    );
  }
  const paid = order.paymentStatus === "CAPTURED" || order.paymentStatus.includes("REFUND");
  const a = order.shippingAddress;
  return (
    <div className="mx-auto w-[92%] max-w-3xl py-10 md:py-14">
      {!paid && order.status === "PENDING" && <AutoRefresh />}
      <div className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
        <p className="font-fancy text-sm text-[#8C7367]">Order {order.orderNumber}</p>
        <h1 className="mt-1 font-heading text-[28px] text-[#53443D] md:text-[34px]">
          {paid ? "Thank you! Your order is confirmed." : order.status === "CANCELLED" ? "This order was cancelled" : "Confirming your payment…"}
        </h1>
        <p className="mt-2 font-fancy text-[#53443D]">
          {paid ? `We’re preparing it for ${order.shippingMethodName.toLowerCase()}.` : order.status === "CANCELLED" ? "If you were charged, the amount will be refunded to your original payment method." : "This page updates automatically. Please don’t pay again."}
        </p>
        <ul className="mt-6 divide-y divide-[#eee3dd] border-y border-[#eee3dd]">
          {order.items.map((i, k) => <li key={k} className="flex justify-between gap-3 py-3 font-fancy text-sm"><span>{i.productName} <span className="text-[#8C7367]">· {i.variantLabel} × {i.quantity}</span></span><span className="font-bold">{inr(i.lineTotal)}</span></li>)}
        </ul>
        <dl className="mt-4 space-y-1.5 font-fancy text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{inr(order.subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Delivery</dt><dd>{order.shippingTotal ? inr(order.shippingTotal) : "Free"}</dd></div>
          <div className="flex justify-between border-t border-[#eee3dd] pt-2 text-base font-bold"><dt>Total paid</dt><dd>{inr(order.grandTotal)}</dd></div>
        </dl>
        <div className="mt-6 grid gap-6 font-fancy text-sm text-[#53443D] sm:grid-cols-2">
          <div><h2 className="mb-1 font-bold">Delivering to</h2><p>{a.fullName}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.state} {a.postalCode}<br />{a.phone}</p></div>
          {order.shipments?.[0] && <div><h2 className="mb-1 font-bold">Tracking</h2><p>{order.shipments[0].carrier} {order.shipments[0].trackingNumber}</p></div>}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {paid && token && <a href={`/api/orders/${order.orderNumber}/invoice?t=${encodeURIComponent(token)}`} className="rounded-full border border-[#b49d91] px-8 py-3 font-fancy text-[#3f342c] hover:bg-[#f4ece6]">Download order confirmation (PDF)</a>}
        <Link href="/shop" className="rounded-full bg-[#b49d91] px-10 py-3 font-fancy text-[#3f342c]">Continue shopping</Link></div>
    </div>
  );
}
