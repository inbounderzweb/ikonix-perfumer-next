import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import StoreImage from "@/components/store/store-image";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { getOrder } from "@/server/customer/orders";
import { Card, StatusBadge, btnGhost } from "@/components/account/ui";
import { fmtDate, inr } from "@/lib/format";
import { OrderTracker } from "@/components/account/order-tracker";
import { ReorderButton } from "@/components/account/reorder-button";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

export default async function OrderDetail({ params }: PageProps<"/account/orders/[orderNumber]">) {
  const { orderNumber } = await params;
  const me = await requireCustomerPage(`/account/orders/${orderNumber}`);
  const o = await getOrder(me.id, orderNumber);
  if (!o) notFound(); // someone else's order and a missing one look the same
  const paid = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.payment.status);
  return (
    <div className="space-y-5">
      <Link href="/account/orders" className="font-fancy text-sm text-[#8C7367] underline">← All orders</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="font-heading text-[26px] text-[#8C7367]">{o.orderNumber}</h1><p className="font-fancy text-sm text-[#6b5446]">Placed {fmtDate(o.placedAt, true)}</p></div>
        <StatusBadge status={o.status} label={o.statusLabel} />
      </div>
      <OrderTracker orderNumber={o.orderNumber} initial={{ timeline: o.timeline, events: o.events, shipment: o.shipment, status: o.status, statusLabel: o.statusLabel, cancelReason: o.cancelReason }} />
      <Card title="Items">
        <ul className="divide-y divide-[#e7dbd3]">
          {o.items.map((i, n) => (
            <li key={`${i.variantId}-${n}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#f4ece6]">{i.image && <StoreImage src={i.image} alt={i.name} fill sizes="64px" className="object-cover" />}</div>
              <div className="min-w-0 flex-1 font-fancy text-sm text-[#3f342c]"><p className="font-semibold">{i.name}</p><p className="text-[#6b5446]">{i.variant} · Qty {i.qty}{i.free ? ` + ${i.free} free` : ""} × {inr(i.unit)}</p></div>
              <p className="font-fancy font-semibold text-[#3f342c]">{inr(i.total)}</p>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Payment summary">
          <dl className="space-y-1.5 font-fancy text-sm text-[#3f342c]">
            <Row l="Subtotal" v={inr(o.subtotal)} />
            {o.discount > 0 && <Row l={`Discount${o.coupon ? ` (${o.coupon})` : ""}`} v={`− ${inr(o.discount)}`} />}
            <Row l={`Shipping (${o.shippingMethod})`} v={o.shipping ? inr(o.shipping) : "Free"} />
            {o.packing > 0 && <Row l="Packing" v={inr(o.packing)} />}
            {o.tax > 0 && <Row l="Tax" v={inr(o.tax)} />}
            <Row l={paid ? "Total paid" : "Total"} v={inr(o.total)} bold />
          </dl>
          <dl className="mt-4 space-y-1.5 border-t border-[#e7dbd3] pt-3 font-fancy text-sm text-[#3f342c]">
            <Row l="Payment status" v={o.payment.status.replace(/_/g, " ").toLowerCase()} />
            {o.payment.method && <Row l="Method" v={`${o.payment.method}${o.payment.methodDetail ? ` · ${o.payment.methodDetail}` : ""}`} />}
            {o.payment.transactionId && <Row l="Transaction ID" v={o.payment.transactionId} />}
          </dl>
        </Card>
        <Card title="Delivery address">
          <address className="font-fancy text-sm not-italic text-[#3f342c]"><b>{o.address.name}</b><br />{o.address.lines.map((l) => <span key={l}>{l}<br /></span>)}{o.address.city}, {o.address.state} {o.address.postalCode}<br />{o.address.phone}</address>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        {paid && <a href={`/api/account/orders/${o.orderNumber}/invoice`} className={btnGhost}>Download invoice (PDF)</a>}
        <ReorderButton orderNumber={o.orderNumber} />
      </div>
    </div>
  );
}
const Row = ({ l, v, bold }: { l: string; v: string; bold?: boolean }) => <div className={`flex justify-between gap-4 ${bold ? "border-t border-[#e7dbd3] pt-2 font-semibold" : ""}`}><dt>{l}</dt><dd className="text-right">{v}</dd></div>;
