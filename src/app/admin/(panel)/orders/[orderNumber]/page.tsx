import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Badge, Card, PageHeader, Table, formatDate, formatINR } from "@/components/admin/ui";
import { OrderActions } from "@/components/admin/order-actions";
import { allowedNext } from "@/server/commerce/order-flow";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Notification, Order, Payment, Refund } from "@/server/models";
import { NotificationHistory, type NotificationRow } from "@/components/admin/notification-history";

export const metadata: Metadata = { title: "Order" };

export default async function OrderDetail({ params }: PageProps<"/admin/orders/[orderNumber]">) {
  const admin = await requireAdminPage("orders.read");
  const { orderNumber } = await params;
  if (!/^IKX-\d{6}-\d{5}$/.test(orderNumber)) notFound();
  await db();
  type A = { fullName?: string; phone?: string; line1?: string; line2?: string; landmark?: string; city?: string; state?: string; postalCode?: string };
  type O = { _id: Types.ObjectId; orderNumber: string; status: string; paymentStatus: string; items: { productName: string; variantLabel: string; sku: string; freeQuantity?: number; offer?: { offerId: string; label: string; pricingBasis: string; savedAmount: number } | null; quantity: number; unitSalePrice: number; lineTotal: number; imageUrl?: string }[]; subtotal: number; discountTotal: number; shippingTotal: number; taxTotal: number; grandTotal: number; contact: { name: string; phone: string; email?: string }; shippingAddress: A; shippingMethodName: string; customerNote?: string; placedAt: Date; statusHistory: { from?: string; to: string; note?: string; description?: string; actorType: string; at: Date }[]; shipments?: { carrier: string; trackingNumber?: string; trackingUrl?: string }[] };
  const o = (await Order.findOne({ orderNumber }).lean()) as unknown as O | null;
  if (!o) notFound();
  const [pay, refunds] = await Promise.all([
    Payment.findOne({ orderId: o._id }).lean() as unknown as Promise<{ providerOrderId: string; providerPaymentId?: string; method?: string; methodDetail?: string; status: string; amount: number; failureReason?: string } | null>,
    Refund.find({ orderId: o._id }).sort({ createdAt: -1 }).lean() as unknown as Promise<{ amount: number; status: string; reason?: string; createdAt: Date }[]>,
  ]);
  type N = { _id: Types.ObjectId; channel: string; recipient: string; status: string; lastError?: string; attempts: number; createdAt: Date; sentAt?: Date; audience: string; payload?: { event?: string; fromStatus?: string | null; toStatus?: string } };
  const notes = ((await Notification.find({ "payload.orderId": o._id }).sort({ createdAt: -1 }).limit(50).lean()) as unknown as N[]).map((n): NotificationRow => ({ id: String(n._id), channel: n.channel, event: n.payload?.event ?? "", from: n.payload?.fromStatus ?? null, to: n.payload?.toStatus ?? "", recipient: n.recipient, status: n.status, at: (n.sentAt ?? n.createdAt).toISOString(), error: n.lastError ?? null, attempts: n.attempts }));
  const refunded = refunds.filter((r) => r.status !== "FAILED").reduce((a, r) => a + r.amount, 0);
  const a = o.shippingAddress;
  return (
    <>
      <PageHeader title={o.orderNumber} subtitle={`Placed ${formatDate(o.placedAt)}`} actions={<><Badge tone={o.status === "CANCELLED" ? "danger" : "ok"}>{o.status.toLowerCase().replace(/_/g, " ")}</Badge><Badge tone={o.paymentStatus === "CAPTURED" ? "ok" : "warn"}>{o.paymentStatus.toLowerCase().replace(/_/g, " ")}</Badge><Link href="/admin/orders" className="text-sm text-a-muted underline">All orders</Link></>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Items">
            <Table head={["Item", "SKU", "Qty", "Price", "Total"]}>
              {o.items.map((i, k) => <tr key={k}><td className="font-medium">{i.productName} <span className="text-a-muted">· {i.variantLabel}</span></td><td className="font-mono text-xs">{i.sku}</td><td>{i.quantity}{!!i.freeQuantity && <span className="text-a-ok"> + {i.freeQuantity} free</span>}{i.offer && !!i.freeQuantity && <span className="block text-xs text-a-muted">{i.offer.label} · {i.offer.pricingBasis.toLowerCase()} basis · saved {formatINR(i.offer.savedAmount)}</span>}</td><td>{formatINR(i.unitSalePrice)}</td><td>{formatINR(i.lineTotal)}</td></tr>)}
            </Table>
            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-a-muted">Subtotal</dt><dd>{formatINR(o.subtotal)}</dd></div>
              {o.discountTotal > 0 && <div className="flex justify-between"><dt className="text-a-muted">Discount</dt><dd>−{formatINR(o.discountTotal)}</dd></div>}
              <div className="flex justify-between"><dt className="text-a-muted">Delivery ({o.shippingMethodName})</dt><dd>{formatINR(o.shippingTotal)}</dd></div>
              <div className="flex justify-between border-t border-a-border pt-1 text-base font-semibold"><dt>Total</dt><dd>{formatINR(o.grandTotal)}</dd></div>
              {refunded > 0 && <div className="flex justify-between text-a-danger"><dt>Refunded</dt><dd>−{formatINR(refunded)}</dd></div>}
            </dl>
          </Card>
          <Card title="Timeline">
            <ol className="space-y-3 text-sm">
              {[...o.statusHistory].reverse().map((h, i) => <li key={i} className="flex justify-between gap-3"><span><b className="font-medium">{h.to.toLowerCase().replace(/_/g, " ")}</b>{h.description && <span className="text-a-muted"> · to customer: {h.description}</span>}{h.note && <span className="text-a-muted"> · internal: {h.note}</span>}<span className="text-xs text-a-muted"> ({h.actorType.toLowerCase()})</span></span><span className="whitespace-nowrap text-a-muted">{formatDate(h.at)}</span></li>)}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          <OrderActions orderNumber={o.orderNumber} next={allowedNext(o.status)} canWrite={admin.permissions.has("orders.write")} />
          <NotificationHistory rows={notes} canRetry={admin.permissions.has("orders.write")} />
          <Card title="Customer"><p className="text-sm">{o.contact.name}<br />{o.contact.phone}<br />{o.contact.email}</p></Card>
          <Card title="Ship to"><p className="text-sm">{a.fullName}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}{a.landmark ? ` (${a.landmark})` : ""}<br />{a.city}, {a.state} {a.postalCode}<br />{a.phone}</p>{o.customerNote && <p className="mt-2 text-xs text-a-muted">Note: {o.customerNote}</p>}</Card>
          <Card title="Payment">
            {pay ? <dl className="space-y-1 text-sm"><div className="flex justify-between"><dt className="text-a-muted">Gateway</dt><dd>Razorpay</dd></div><div className="flex justify-between"><dt className="text-a-muted">Method</dt><dd>{pay.method ?? "—"}{pay.methodDetail ? ` · ${pay.methodDetail}` : ""}</dd></div><div className="flex justify-between gap-2"><dt className="text-a-muted">Payment id</dt><dd className="truncate font-mono text-xs">{pay.providerPaymentId ?? "—"}</dd></div>{pay.failureReason && <p className="text-xs text-a-danger">{pay.failureReason}</p>}</dl> : <p className="text-sm text-a-muted">No payment record.</p>}
            {refunds.length > 0 && <ul className="mt-3 space-y-1 border-t border-a-border pt-3 text-xs">{refunds.map((r, i) => <li key={i} className="flex justify-between"><span>{formatINR(r.amount)} · {r.status.toLowerCase()}{r.reason ? ` · ${r.reason}` : ""}</span><span className="text-a-muted">{formatDate(r.createdAt)}</span></li>)}</ul>}
          </Card>
          {o.shipments?.map((s, i) => <Card key={i} title="Shipment"><p className="text-sm">{s.carrier} {s.trackingNumber}{s.trackingUrl && <> · <a className="text-a-accent underline" href={s.trackingUrl} target="_blank" rel="noopener noreferrer">Track</a></>}</p></Card>)}
        </div>
      </div>
    </>
  );
}
