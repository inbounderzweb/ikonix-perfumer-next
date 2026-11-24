"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteShippingMethod, saveShippingMethod } from "@/app/actions/admin/delivery";
import { Badge, Card, Field, Notice, button, inputCls } from "./ui";

export type MethodRow = { id?: string; code: string; name: string; description: string; charge: number; freeAbove: number | ""; minDays: number | ""; maxDays: number | ""; status: "ACTIVE" | "INACTIVE"; sortOrder: number };
const blank: MethodRow = { code: "", name: "", description: "", charge: 0, freeAbove: "", minDays: "", maxDays: "", status: "ACTIVE", sortOrder: 0 };

export function DeliveryManager({ methods, canWrite }: { methods: MethodRow[]; canWrite: boolean }) {
  return (
    <div className="space-y-4">
      {methods.length === 0 && <Notice tone="warn">No delivery methods yet. Customers can’t check out until you add at least one active method.</Notice>}
      {methods.map((m) => <Method key={m.id} initial={m} canWrite={canWrite} />)}
      {/* "Add delivery method" is switched off for now (one standard method is used at checkout). Re-enable by restoring the line below.
      {canWrite && <Method initial={blank} canWrite isNew />} */}
    </div>
  );
}

function Method({ initial, canWrite, isNew = false }: { initial: MethodRow; canWrite: boolean; isNew?: boolean }) {
  const router = useRouter();
  const [m, setM] = useState(initial);
  const [open, setOpen] = useState(isNew ? false : false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof MethodRow>(k: K, v: MethodRow[K]) => setM((p) => ({ ...p, [k]: v }));
  const n = (v: string): number | "" => (v === "" ? "" : Number(v));

  function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setFe({});
    start(async () => {
      const r = await saveShippingMethod({ id: m.id, code: m.code, name: m.name, description: m.description, charge: m.charge, freeAboveSubtotal: m.freeAbove, minDays: m.minDays === "" ? undefined : m.minDays, maxDays: m.maxDays === "" ? undefined : m.maxDays, status: m.status, sortOrder: m.sortOrder });
      if (r.ok) { setMsg({ tone: "ok", text: "Saved" }); if (isNew) { setM(blank); setOpen(false); } router.refresh(); } else { setMsg({ tone: "danger", text: r.error }); setFe(r.fields ?? {}); }
    });
  }
  function remove() {
    start(async () => { const r = await deleteShippingMethod(m.id!); if (r.ok) router.refresh(); else { setConfirm(false); setMsg({ tone: "danger", text: r.error }); } });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-a-border bg-a-surface p-4">
        {isNew ? <span className="text-sm text-a-muted">Add another delivery method</span> : (
          <div className="min-w-0"><p className="font-medium">{m.name} <span className="ml-1 font-mono text-xs text-a-muted">{m.code}</span></p>
            <p className="text-sm text-a-muted">₹{m.charge}{m.freeAbove !== "" ? ` · free above ₹${m.freeAbove}` : ""}{m.minDays !== "" ? ` · ${m.minDays}–${m.maxDays === "" ? m.minDays : m.maxDays} days` : ""}</p></div>
        )}
        <div className="flex items-center gap-2">{!isNew && <Badge tone={m.status === "ACTIVE" ? "ok" : "neutral"}>{m.status.toLowerCase()}</Badge>}{canWrite && <button className={button(isNew ? "primary" : "secondary")} onClick={() => setOpen(true)}>{isNew ? "Add method" : "Edit"}</button>}</div>
      </div>
    );
  }
  return (
    <Card title={isNew ? "New delivery method" : `Edit ${initial.name}`}>
      <form onSubmit={save} className="space-y-4" noValidate>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <fieldset disabled={pending || !canWrite} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" error={fe.name}><input className={inputCls} value={m.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Standard delivery" /></Field>
          <Field label="Code" error={fe.code} hint="Unique, e.g. STANDARD"><input className={inputCls} value={m.code} maxLength={30} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
          <Field label="Charge (₹)" error={fe.charge}><input type="number" min={0} step="0.01" className={inputCls} value={m.charge} onChange={(e) => set("charge", Number(e.target.value))} /></Field>
          <Field label="Free above subtotal (₹)" error={fe.freeAboveSubtotal} hint="Leave empty for no free threshold"><input type="number" min={0} step="0.01" className={inputCls} value={m.freeAbove} onChange={(e) => set("freeAbove", n(e.target.value))} /></Field>
          <Field label="Min days"><input type="number" min={0} className={inputCls} value={m.minDays} onChange={(e) => set("minDays", n(e.target.value))} /></Field>
          <Field label="Max days" error={fe.maxDays}><input type="number" min={0} className={inputCls} value={m.maxDays} onChange={(e) => set("maxDays", n(e.target.value))} /></Field>
          <Field label="Status"><select className={inputCls} value={m.status} onChange={(e) => set("status", e.target.value as MethodRow["status"])}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></Field>
          <Field label="Sort order"><input type="number" min={0} className={inputCls} value={m.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} /></Field>
          <div className="sm:col-span-2 lg:col-span-4"><Field label="Description"><input className={inputCls} value={m.description} maxLength={300} onChange={(e) => set("description", e.target.value)} /></Field></div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending || !canWrite} className={button("primary")}>{pending ? "Saving…" : "Save"}</button>
          <button type="button" className={button("secondary")} onClick={() => { setM(initial); setOpen(false); setMsg(null); }}>Cancel</button>
          {!isNew && canWrite && (!confirm ? <button type="button" className={button("danger", "ml-auto")} onClick={() => setConfirm(true)}>Delete</button> : <button type="button" className={button("danger", "ml-auto")} onClick={remove} disabled={pending}>Confirm delete</button>)}
        </div>
      </form>
    </Card>
  );
}
