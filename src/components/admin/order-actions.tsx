"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postOrderUpdate, updateOrderStatus, type OrderResult } from "@/app/actions/admin/orders";
import { Card, Field, Notice, button, inputCls } from "./ui";

const label = (s: string) => s.toLowerCase().replace(/_/g, " ");

export function OrderActions({ orderNumber, next, canWrite }: { orderNumber: string; next: string[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<OrderResult | null>(null);
  const [to, setTo] = useState(next.find((n) => n !== "CANCELLED") ?? next[0] ?? "");
  const [ship, setShip] = useState({ carrier: "", trackingNumber: "", trackingUrl: "", note: "", description: "", estimatedDeliveryDate: "" });
  const [upd, setUpd] = useState({ carrier: "", trackingNumber: "", trackingUrl: "", estimatedDeliveryDate: "", description: "" });
  const run = (fn: () => Promise<OrderResult>) => start(async () => { const r = await fn(); setRes(r); if (r.ok) router.refresh(); });

  return (
    <div className="space-y-5">
      <datalist id="couriers"><option value="India Post" /></datalist>
      {res && <Notice tone={res.ok ? "ok" : "danger"}>{res.ok ? res.message ?? "Updated." : res.error}</Notice>}
      {canWrite && next.length > 0 && (
        <Card title="Update status">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (to === "CANCELLED" && !confirm("Cancel this order and return its stock?")) return; run(() => updateOrderStatus({ orderNumber, to, ...ship })); }}>
            <Field label="Move to" htmlFor="to"><select id="to" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>{next.map((n) => <option key={n} value={n}>{label(n)}</option>)}</select></Field>
            {to === "SHIPPED" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Courier" htmlFor="carrier" hint="Choose India Post for automatic tracking"><input id="carrier" list="couriers" className={inputCls} value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} required /></Field>
                <Field label="Tracking number" htmlFor="trk"><input id="trk" className={inputCls} value={ship.trackingNumber} onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })} /></Field>
                <div className="sm:col-span-2"><Field label="Tracking link" htmlFor="trku" hint="Optional, https://…"><input id="trku" className={inputCls} value={ship.trackingUrl} onChange={(e) => setShip({ ...ship, trackingUrl: e.target.value })} /></Field></div>
                <Field label="Estimated delivery date" htmlFor="eta" hint="Only if the courier gave one"><input id="eta" type="date" className={inputCls} value={ship.estimatedDeliveryDate} onChange={(e) => setShip({ ...ship, estimatedDeliveryDate: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Message to customer" htmlFor="desc" hint="Shown in their order timeline"><input id="desc" className={inputCls} maxLength={500} value={ship.description} onChange={(e) => setShip({ ...ship, description: e.target.value })} /></Field>
            <Field label="Note" htmlFor="note" hint="Visible to staff only"><input id="note" className={inputCls} maxLength={300} value={ship.note} onChange={(e) => setShip({ ...ship, note: e.target.value })} /></Field>
            <button className={button(to === "CANCELLED" ? "danger" : "primary")} disabled={pending}>{pending ? "Saving…" : "Update"}</button>
          </form>
        </Card>
      )}
      {canWrite && (
        <Card title="Delivery update">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await postOrderUpdate({ orderNumber, ...upd }); if (r.ok) setUpd({ carrier: "", trackingNumber: "", trackingUrl: "", estimatedDeliveryDate: "", description: "" }); return r; }); }}>
            <p className="text-xs opacity-70">Post a message and/or courier details without changing the status. The customer sees this on their order.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Courier" htmlFor="ucar"><input id="ucar" list="couriers" className={inputCls} value={upd.carrier} onChange={(e) => setUpd({ ...upd, carrier: e.target.value })} /></Field>
              <Field label="Tracking number" htmlFor="utrk"><input id="utrk" className={inputCls} value={upd.trackingNumber} onChange={(e) => setUpd({ ...upd, trackingNumber: e.target.value })} /></Field>
              <Field label="Tracking link" htmlFor="utrku"><input id="utrku" className={inputCls} value={upd.trackingUrl} onChange={(e) => setUpd({ ...upd, trackingUrl: e.target.value })} /></Field>
              <Field label="Estimated delivery date" htmlFor="ueta"><input id="ueta" type="date" className={inputCls} value={upd.estimatedDeliveryDate} onChange={(e) => setUpd({ ...upd, estimatedDeliveryDate: e.target.value })} /></Field>
            </div>
            <Field label="Message" htmlFor="udesc"><input id="udesc" className={inputCls} maxLength={500} value={upd.description} onChange={(e) => setUpd({ ...upd, description: e.target.value })} /></Field>
            <button className={button("primary")} disabled={pending}>{pending ? "Saving…" : "Post update"}</button>
          </form>
        </Card>
      )}
    </div>
  );
}
