"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveDeliveryArea } from "@/app/actions/admin/delivery";
import { INDIAN_STATES } from "@/lib/india";
import { areaSummary, type DeliveryArea } from "@/lib/delivery-area";
import { Card, Field, Notice, button, inputCls } from "./ui";

const MODES: { value: DeliveryArea["mode"]; label: string; hint: string }[] = [
  { value: "ALL_INDIA", label: "All over India", hint: "Every state and PIN code." },
  { value: "STATES", label: "Selected states only", hint: "Deliver only to the states you tick." },
  { value: "EXCLUDE_STATES", label: "All India except some states", hint: "Tick the states you do NOT deliver to." },
  { value: "PINCODES", label: "Selected PIN codes only", hint: "A list of PIN codes; 3 to 5 digits count as a prefix (560 = all Bengaluru)." },
];

export function DeliveryAreaForm({ area, canWrite }: { area: DeliveryArea; canWrite: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState(area.mode);
  const [states, setStates] = useState(new Set(area.states));
  const [pins, setPins] = useState(area.pincodes.join(", "));
  const [message, setMessage] = useState(area.message);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const toggle = (s: string) => setStates((p) => { const n = new Set(p); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const showStates = mode === "STATES" || mode === "EXCLUDE_STATES";

  return (
    <Card title="Delivery area">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setMsg(null); start(async () => { const r = await saveDeliveryArea({ mode, states: [...states], pincodes: pins, message }); setMsg(r.ok ? { tone: "ok", text: "Saved. Checkout now uses this delivery area." } : { tone: "danger", text: r.error }); if (r.ok) router.refresh(); }); }}>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="space-y-2" role="radiogroup" aria-label="Delivery area">
          {MODES.map((m) => (
            <label key={m.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${mode === m.value ? "border-a-accent bg-a-raised" : "border-a-border"}`}>
              <input type="radio" name="mode" className="mt-1" checked={mode === m.value} disabled={!canWrite} onChange={() => setMode(m.value)} />
              <span><b className="font-medium">{m.label}</b><span className="block text-xs text-a-muted">{m.hint}</span></span>
            </label>
          ))}
        </div>
        {showStates && (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-a-muted"><span>{states.size} selected</span>{canWrite && <span><button type="button" className="underline" onClick={() => setStates(new Set(INDIAN_STATES))}>All</button> · <button type="button" className="underline" onClick={() => setStates(new Set())}>None</button></span>}</div>
            <div className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-a-border p-3 sm:grid-cols-2 lg:grid-cols-3">
              {INDIAN_STATES.map((s) => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={states.has(s)} disabled={!canWrite} onChange={() => toggle(s)} />{s}</label>)}
            </div>
          </div>
        )}
        {mode === "PINCODES" && (
          <Field label="PIN codes" htmlFor="pins" hint="Separate with commas, spaces or new lines."><textarea id="pins" rows={5} className={inputCls} value={pins} disabled={!canWrite} onChange={(e) => setPins(e.target.value)} placeholder="560001, 560002, 6820" /></Field>
        )}
        <Field label="Message for customers outside the area" htmlFor="msg" hint="Optional. Shown at checkout instead of the default."><input id="msg" className={inputCls} value={message} maxLength={200} disabled={!canWrite} onChange={(e) => setMessage(e.target.value)} placeholder="Sorry, we don't deliver to this location yet." /></Field>
        <p className="text-xs text-a-muted">Currently live: {areaSummary(area)}</p>
        {canWrite && <button type="submit" disabled={pending} className={button("primary")}>{pending ? "Saving…" : "Save delivery area"}</button>}
      </form>
    </Card>
  );
}
