"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteOffer, saveOffer, setOfferStatus, type OfferResult } from "@/app/actions/admin/offers";
import { bxgyPrice, offerLabel, type PricingBasis } from "@/lib/bxgy";
import { Card, Field, Notice, button, inputCls } from "./ui";

export type CatalogueProduct = { id: string; name: string; variants: { id: string; label: string; sku: string; sale: number; mrp: number }[] };
export type RuleInput = { productId: string; variantId: string; buy: number; free: number };
export type OfferInitial = {
  id?: string; name: string; description: string; status: "ACTIVE" | "INACTIVE"; startsAt: string; endsAt: string;
  usageLimitTotal: string; usageLimitPerCustomer: string; minQuantity: string; pricingBasis: PricingBasis; stackable: boolean; poolMode: "NONE" | "SAME_SIZE" | "ANY"; priority: number; rules: RuleInput[];
};
const EMPTY: OfferInitial = { name: "", description: "", status: "INACTIVE", startsAt: "", endsAt: "", usageLimitTotal: "", usageLimitPerCustomer: "", minQuantity: "", pricingBasis: "SELLING", stackable: false, poolMode: "NONE", priority: 0, rules: [] };
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0 })}`;

/** Plain typed number box: you can clear it and type freely; a valid 1-99 value is applied as you type, and the box is tidied on blur. */
function NumInput({ value, onCommit, label, mixed = false, className = "" }: { value: number; onCommit: (n: number) => void; label: string; mixed?: boolean; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (mixed ? "" : String(value));
  return (
    <input
      type="text" inputMode="numeric" maxLength={2} aria-label={label} placeholder={mixed ? "mixed" : ""} className={className} value={shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => { const t = e.target.value.replace(/\D/g, ""); setDraft(t); const n = Number(t); if (t !== "" && n >= 1) onCommit(Math.min(99, n)); }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function OfferRowActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<OfferResult>) => start(async () => { await fn(); router.refresh(); });
  return (
    <div className="flex gap-2">
      <button className={button("secondary", "!py-1")} disabled={pending} onClick={() => run(() => setOfferStatus(id, active ? "INACTIVE" : "ACTIVE"))}>{active ? "Disable" : "Enable"}</button>
      <button className={button("danger", "!py-1")} disabled={pending} onClick={() => { if (confirm("Delete this offer? Existing orders keep their own record of it.")) run(() => deleteOffer(id)); }}>Delete</button>
    </div>
  );
}

export function OfferForm({ catalogue, initial }: { catalogue: CatalogueProduct[]; initial?: OfferInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<OfferInitial>(initial ?? EMPTY);
  const [res, setRes] = useState<OfferResult | null>(null);
  const [q, setQ] = useState("");
  const byVariant = useMemo(() => new Map(catalogue.flatMap((p) => p.variants.map((v) => [v.id, { p, v }] as const))), [catalogue]);
  const searching = q.trim().length >= 2;
  const matches = useMemo(() => (!searching ? [] : catalogue.filter((p) => { const t = q.trim().toLowerCase(); return p.name.toLowerCase().includes(t) || p.variants.some((v) => v.sku.toLowerCase().includes(t)); })), [q, searching, catalogue]);
  const scope = searching ? matches : catalogue; // quick-add buttons act on the search results, or on the whole catalogue when the box is empty
  const sizes = useMemo(() => { const m = new Map<string, number>(); for (const p of scope) for (const v of p.variants) m.set(v.label, (m.get(v.label) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [scope]);
  const [dflt, setDflt] = useState({ buy: 2, free: 1 });
  const [previewId, setPreviewId] = useState("");
  const set = <K extends keyof OfferInitial>(k: K, v: OfferInitial[K]) => setF((p) => ({ ...p, [k]: v }));
  const has = (vid: string) => f.rules.some((r) => r.variantId === vid);
  const clamp = (n: number) => Math.max(1, Math.min(99, Math.floor(n) || 1));
  const addMany = (pairs: { productId: string; variantId: string }[]) => setF((p) => { const have = new Set(p.rules.map((r) => r.variantId)); return { ...p, rules: [...p.rules, ...pairs.filter((x) => !have.has(x.variantId)).map((x) => ({ ...x, buy: dflt.buy, free: dflt.free }))] }; });
  const addSize = (label: string) => addMany(scope.flatMap((p) => p.variants.filter((v) => v.label === label).map((v) => ({ productId: p.id, variantId: v.id }))));
  const addProduct = (p: CatalogueProduct) => addMany(p.variants.map((v) => ({ productId: p.id, variantId: v.id })));
  const toggle = (p: CatalogueProduct, vid: string) => set("rules", has(vid) ? f.rules.filter((r) => r.variantId !== vid) : [...f.rules, { productId: p.id, variantId: vid, buy: dflt.buy, free: dflt.free }]);
  const patch = (vid: string, k: "buy" | "free", n: number) => set("rules", f.rules.map((r) => (r.variantId === vid ? { ...r, [k]: clamp(n) } : r)));
  const patchSize = (label: string, k: "buy" | "free", n: number) => set("rules", f.rules.map((r) => (byVariant.get(r.variantId)?.v.label === label ? { ...r, [k]: clamp(n) } : r)));
  const removeSize = (label: string) => set("rules", f.rules.filter((r) => byVariant.get(r.variantId)?.v.label !== label));
  const groups = useMemo(() => { const m = new Map<string, RuleInput[]>(); for (const r of f.rules) { const l = byVariant.get(r.variantId)?.v.label ?? "?"; m.set(l, [...(m.get(l) ?? []), r]); } return [...m.entries()]; }, [f.rules, byVariant]);
  const previewRule = f.rules.find((r) => r.variantId === previewId) ?? f.rules[0];
  const minQ = Number(f.minQuantity) || 0;

  const submit = (status: "ACTIVE" | "INACTIVE") => start(async () => {
    const r = await saveOffer({ ...f, status, id: initial?.id, priority: Number(f.priority) || 0 });
    setRes(r);
    if (r.ok) { setF((p) => ({ ...p, status })); if (!initial?.id && r.id) router.replace(`/admin/offers/${r.id}`); else router.refresh(); }
  });

  return (
    <div className="space-y-5">
      {res && (res.ok ? <Notice tone="ok">{res.message}</Notice> : <Notice tone="danger">{res.error}</Notice>)}
      <Card title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Offer name" htmlFor="o-name"><input id="o-name" className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Winter bundle" /></Field>
          <Field label="Description (internal)" htmlFor="o-desc"><input id="o-desc" className={inputCls} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Starts (IST)" hint="Empty = starts immediately" htmlFor="o-start"><input id="o-start" type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
          <Field label="Expires (IST)" hint="Empty = no expiry" htmlFor="o-end"><input id="o-end" type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></Field>
          <Field label="Max uses per customer" hint="Orders per signed-in customer. Empty = unlimited" htmlFor="o-pc"><input id="o-pc" inputMode="numeric" className={inputCls} value={f.usageLimitPerCustomer} onChange={(e) => set("usageLimitPerCustomer", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Max total redemptions" hint="Orders across all customers. Empty = unlimited" htmlFor="o-tot"><input id="o-tot" inputMode="numeric" className={inputCls} value={f.usageLimitTotal} onChange={(e) => set("usageLimitTotal", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Minimum purchase quantity" hint="Units of the variant needed before the offer applies" htmlFor="o-min"><input id="o-min" inputMode="numeric" className={inputCls} value={f.minQuantity} onChange={(e) => set("minQuantity", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Priority" hint="If several offers match one variant, the higher number wins" htmlFor="o-pri"><input id="o-pri" inputMode="numeric" className={inputCls} value={f.priority} onChange={(e) => set("priority", Number(e.target.value.replace(/\D/g, "")) || 0)} /></Field>
          <Field label="Price of paid units while the offer applies" htmlFor="o-basis" hint={f.pricingBasis === "MRP" ? "Once the cart earns free units, each paid unit is charged at MRP (original price) instead of the selling price. Below the threshold the customer pays the normal selling price." : "Paid units stay at the normal selling price."}>
            <select id="o-basis" className={inputCls} value={f.pricingBasis} onChange={(e) => set("pricingBasis", e.target.value as PricingBasis)}><option value="SELLING">Selling price (default)</option><option value="MRP">MRP (original price)</option></select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="How units are counted" htmlFor="o-pool" hint={f.poolMode === "ANY" ? "Example (Buy 4 Get 1): any 5 eligible items in the cart — different products or sizes — and the lowest-priced one is free." : f.poolMode === "SAME_SIZE" ? "Example (Buy 4 Get 1 on 30 ml): 3 of one perfume + 2 of another, both 30 ml = 5 units → the cheapest is free. 30 ml and 50 ml units are counted separately." : "Each variant is counted on its own: you need X + Y units of the same variant."}>
              <select id="o-pool" className={inputCls} value={f.poolMode} onChange={(e) => set("poolMode", e.target.value as OfferInitial["poolMode"])}>
                <option value="NONE">Per variant (default)</option>
                <option value="SAME_SIZE">Same size across different products</option>
                <option value="ANY">Any variants in this offer (mix &amp; match, lowest price free)</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.stackable} onChange={(e) => set("stackable", e.target.checked)} /> Can be combined with other promotions <span className="text-a-muted">(no other automatic discounts are applied by the store today)</span></label>
        </div>
      </Card>

      <Card title="Products & variants">
        <div className="flex flex-wrap items-end gap-3">
          <input className={`${inputCls} max-w-md`} placeholder="Search by product name or SKU (leave empty to work on the whole catalogue)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          <div className="flex items-end gap-2 text-sm">
            <span className="pb-2 text-a-muted">New rows start as</span>
            <NumInput label="Default buy" className={`${inputCls} !w-16`} value={dflt.buy} onCommit={(n) => setDflt((d) => ({ ...d, buy: n }))} />
            <span className="pb-2">Buy +</span>
            <NumInput label="Default free" className={`${inputCls} !w-16`} value={dflt.free} onCommit={(n) => setDflt((d) => ({ ...d, free: n }))} />
            <span className="pb-2">Free</span>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-a-border p-3">
          <p className="text-sm font-medium">Quick add by size <span className="font-normal text-a-muted">— {searching ? `${matches.length} product${matches.length === 1 ? "" : "s"} in your search` : `all ${catalogue.length} products`}</span></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {sizes.length === 0 && <span className="text-sm text-a-muted">{searching ? `No product matches “${q.trim()}”.` : "No products."}</span>}
            {sizes.map(([label, n]) => <button type="button" key={label} className={button("secondary", "!py-1 !text-xs")} onClick={() => addSize(label)}>+ All {label} ({n})</button>)}
            {sizes.length > 0 && <button type="button" className={button("secondary", "!py-1 !text-xs")} onClick={() => addMany(scope.flatMap((p) => p.variants.map((v) => ({ productId: p.id, variantId: v.id }))))}>+ Every size</button>}
          </div>
        </div>

        {searching && matches.length > 0 && (
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {matches.map((p) => (
              <li key={p.id} className="rounded-lg border border-a-border p-3">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{p.name}</p><button type="button" className="text-xs underline" onClick={() => addProduct(p)}>Add all sizes</button></div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.variants.map((v) => <label key={v.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${has(v.id) ? "border-a-accent bg-a-raised" : "border-a-border"}`}><input type="checkbox" className="mr-1" checked={has(v.id)} onChange={() => toggle(p, v.id)} />{v.label} · {inr(v.sale)}</label>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Selected (${f.rules.length})`} actions={f.rules.length > 0 ? <button type="button" className="text-xs underline" onClick={() => { if (confirm("Remove all selected variants?")) set("rules", []); }}>Clear all</button> : undefined}>
        {f.rules.length === 0 ? <p className="text-sm text-a-muted">Nothing selected yet. Use “Quick add by size” above, or search for a product.</p> : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">By size <span className="font-normal text-a-muted">— set Buy / Get once for every variant of that size</span></p>
              <table className="w-full text-sm" aria-label="Offer by size">
                <thead className="text-left text-a-muted"><tr><th className="py-1 pr-3">Size</th><th className="pr-3">Variants</th><th className="pr-3">Buy (X)</th><th className="pr-3">Get free (Y)</th><th /></tr></thead>
                <tbody>{groups.map(([label, rs]) => { const same = rs.every((r) => r.buy === rs[0].buy && r.free === rs[0].free); return (
                  <tr key={label}>
                    <td className="py-1 pr-3 font-medium">{label}</td><td className="pr-3">{rs.length}</td>
                    <td className="pr-3"><NumInput label={`Buy for ${label}`} className={`${inputCls} !w-20`} value={rs[0].buy} mixed={!same} onCommit={(n) => patchSize(label, "buy", n)} /></td>
                    <td className="pr-3"><NumInput label={`Free for ${label}`} className={`${inputCls} !w-20`} value={rs[0].free} mixed={!same} onCommit={(n) => patchSize(label, "free", n)} /></td>
                    <td><button type="button" className="text-xs underline" onClick={() => removeSize(label)}>Remove all {label}</button></td>
                  </tr>); })}</tbody>
              </table>
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-medium">Edit individual variants ({f.rules.length})</summary>
              <div className="mt-2 max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>{f.rules.map((r) => { const hit = byVariant.get(r.variantId); return (
                    <tr key={r.variantId} className="border-t border-a-border">
                      <td className="py-1 pr-3">{hit ? <>{hit.p.name} <span className="text-a-muted">· {hit.v.label}</span></> : <span className="text-a-warn">Variant no longer exists</span>}</td>
                      <td className="pr-2"><NumInput label="Buy" className={`${inputCls} !w-16`} value={r.buy} onCommit={(n) => patch(r.variantId, "buy", n)} /></td>
                      <td className="pr-2"><NumInput label="Free" className={`${inputCls} !w-16`} value={r.free} onCommit={(n) => patch(r.variantId, "free", n)} /></td>
                      <td><button type="button" className="text-xs underline" onClick={() => set("rules", f.rules.filter((x) => x.variantId !== r.variantId))}>Remove</button></td>
                    </tr>); })}</tbody>
                </table>
              </div>
            </details>

            {previewRule && byVariant.get(previewRule.variantId) && (() => {
              const hit = byVariant.get(previewRule.variantId)!;
              const top = Math.min(30, (previewRule.buy + previewRule.free) * 2 + 1);
              return (
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">Preview</span>
                    <select aria-label="Preview variant" className={`${inputCls} !w-auto max-w-xs`} value={previewRule.variantId} onChange={(e) => setPreviewId(e.target.value)}>
                      {f.rules.slice(0, 300).map((r) => { const h = byVariant.get(r.variantId); return h ? <option key={r.variantId} value={r.variantId}>{h.p.name} · {h.v.label} — {offerLabel(r)}</option> : null; })}
                    </select>
                    <span className="text-a-muted">MRP {inr(hit.v.mrp)} · selling {inr(hit.v.sale)}</span>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-sm" aria-label="Offer preview">
                      <thead className="text-left text-a-muted"><tr><th className="py-1 pr-4">In cart</th><th className="pr-4">Paid</th><th className="pr-4">Free</th><th className="pr-4">Customer pays</th><th>Saved (vs {f.pricingBasis === "MRP" ? "MRP" : "selling price"})</th></tr></thead>
                      <tbody>{Array.from({ length: top }, (_, i) => i + 1).map((n) => { const c = bxgyPrice(n, previewRule, { sale: hit.v.sale, mrp: hit.v.mrp }, f.pricingBasis, minQ); return (
                        <tr key={n} className={c.free ? "font-medium text-a-ok" : ""}><td className="py-0.5 pr-4">{n}</td><td className="pr-4">{c.paid}</td><td className="pr-4">{c.free}</td><td className="pr-4">{c.paid} × {inr(c.unit)} = {inr(c.payable)}</td><td>{c.free ? inr(c.savings) : "—"}</td></tr>
                      ); })}</tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-a-muted">Free units = floor(quantity ÷ (X+Y)) × Y; free units are part of the cart quantity and are deducted from stock.</p>
                </div>
              );
            })()}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <button className={button("primary")} disabled={pending} onClick={() => submit("ACTIVE")}>{initial?.id ? "Save & publish" : "Publish offer"}</button>
        <button className={button("secondary")} disabled={pending} onClick={() => submit("INACTIVE")}>Save as draft (disabled)</button>
      </div>
    </div>
  );
}
