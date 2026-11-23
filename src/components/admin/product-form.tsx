"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveProduct, saveProduct } from "@/app/actions/admin/products";
import { Card, Field, Icon, Notice, button, inputCls } from "./ui";
import { MediaPicker } from "./media/media-picker";
import { thumb } from "@/lib/cloudinary-loader";
import type { ProductFormData } from "@/server/admin/products";

type Img = { key: string; kind: "existing" | "media"; refId: string; url: string; alt: string };
type Variant = ProductFormData["variants"][number];

const slugify = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
const csv = (a: string[]) => a.join(", ");
const parseCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ProductForm({ initial, categories, readOnly = false, canWriteMedia, canDelete }: {
  initial: ProductFormData; categories: { id: string; name: string }[]; readOnly?: boolean; canWriteMedia: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const isNew = !initial.id;
  const [f, setF] = useState(initial);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [notes, setNotes] = useState({ top: csv(initial.notes.top), middle: csv(initial.notes.middle), base: csv(initial.notes.base) });
  const [images, setImages] = useState<Img[]>(initial.images.map((i) => ({ key: i.id, kind: "existing", refId: i.id, url: i.url, alt: i.alt })));
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [confirmArchive, setConfirmArchive] = useState(false);

  const set = <K extends keyof ProductFormData>(k: K, v: ProductFormData[K]) => setF((p) => ({ ...p, [k]: v }));
  const setVariant = (i: number, patch: Partial<Variant>) => setF((p) => ({ ...p, variants: p.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const err = (path: string) => fieldErr[path];
  const move = (i: number, d: -1 | 1) => setImages((arr) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setMsg(null); setFieldErr({});
    start(async () => {
      const res = await saveProduct({
        id: f.id, name: f.name, slug: f.slug, subtitle: f.subtitle, status: f.status, gender: f.gender, inspiredByName: f.inspiredByName,
        categoryIds: f.categoryIds, description: f.description, shortDescription: f.shortDescription, seo: f.seo,
        notes: { top: parseCsv(notes.top), middle: parseCsv(notes.middle), base: parseCsv(notes.base) },
        variants: f.variants.map((v) => ({ id: v.id, sku: v.sku, label: v.label, sizeValue: v.sizeValue, regularPrice: v.regularPrice, salePrice: v.salePrice, isActive: v.isActive, tracked: v.tracked, onHand: v.onHand, availability: v.availability })),
        images: images.map((i) => (i.kind === "media" ? { kind: "media" as const, mediaId: i.refId, alt: i.alt || undefined } : { kind: "existing" as const, id: i.refId, alt: i.alt || undefined })),
      });
      if (res.ok) {
        setMsg({ tone: "ok", text: "Saved. The storefront is updated." });
        if (isNew) router.replace(`/admin/products/${res.id}`); else router.refresh();
      } else { setMsg({ tone: "danger", text: res.error }); setFieldErr(res.fields ?? {}); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  }

  async function archive() {
    if (!f.id) return;
    start(async () => {
      const r = await archiveProduct(f.id!);
      if (r.ok) router.replace("/admin/products"); else { setConfirmArchive(false); setMsg({ tone: "danger", text: r.error ?? "Could not archive" }); }
    });
  }

  const dis = readOnly || pending;
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {f.reviewIssues.length > 0 && <Notice tone="warn">Needs review from the legacy import: {f.reviewIssues.join("; ")}</Notice>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Basics">
            <div className="space-y-4">
              <Field label="Name" htmlFor="name" error={err("name")}>
                <input id="name" value={f.name} disabled={dis} maxLength={200} className={inputCls} required
                  onChange={(e) => { const name = e.target.value; setF((p) => ({ ...p, name, slug: slugTouched ? p.slug : slugify(name) })); }} />
              </Field>
              <Field label="URL slug" htmlFor="slug" error={err("slug")} hint={isNew ? undefined : "Changing this changes the product's web address; old links will stop working."}>
                <div className="flex items-center gap-2"><span className="text-sm text-a-muted">/products/</span>
                  <input id="slug" value={f.slug} disabled={dis} className={inputCls} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }} /></div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Subtitle" htmlFor="subtitle"><input id="subtitle" value={f.subtitle} disabled={dis} maxLength={200} className={inputCls} onChange={(e) => set("subtitle", e.target.value)} /></Field>
                <Field label="Inspired by" htmlFor="insp" hint="Designer fragrance this is a recreation of"><input id="insp" value={f.inspiredByName} disabled={dis} maxLength={120} className={inputCls} onChange={(e) => set("inspiredByName", e.target.value)} /></Field>
              </div>
              <Field label="Description" htmlFor="desc" error={err("description")}><textarea id="desc" rows={6} value={f.description} disabled={dis} maxLength={10000} className={inputCls} onChange={(e) => set("description", e.target.value)} /></Field>
              <Field label="Short description" htmlFor="sdesc"><textarea id="sdesc" rows={2} value={f.shortDescription} disabled={dis} maxLength={500} className={inputCls} onChange={(e) => set("shortDescription", e.target.value)} /></Field>
            </div>
          </Card>

          <Card title="Images" actions={!readOnly && <button type="button" onClick={() => setPicker(true)} className={button("secondary")}><Icon name="plus" className="h-4 w-4" />Add from library</button>}>
            {images.length === 0 ? (
              <p className="py-6 text-center text-sm text-a-muted">No images. The first image is the main photo shown on cards and search.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {images.map((img, i) => (
                  <li key={img.key} className="space-y-1.5 rounded-lg border border-a-border bg-a-raised p-2">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb(img.url, 280)} alt={img.alt} width={280} height={280} loading="lazy" className="aspect-square w-full rounded-md object-cover" />
                      {i === 0 && <span className="absolute left-1.5 top-1.5 rounded bg-a-accent px-1.5 py-0.5 text-[10px] font-semibold text-a-accent-fg">Main</span>}
                    </div>
                    <input value={img.alt} disabled={dis} maxLength={300} onChange={(e) => setImages((a) => a.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} placeholder="Alt text" aria-label={`Alt text for image ${i + 1}`} className={`${inputCls} !py-1 text-xs`} />
                    {!readOnly && (
                      <div className="flex justify-between">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier" className="rounded border border-a-border px-2 text-xs disabled:opacity-30">←</button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label="Move later" className="rounded border border-a-border px-2 text-xs disabled:opacity-30">→</button>
                        </div>
                        <button type="button" onClick={() => setImages((a) => a.filter((_, j) => j !== i))} aria-label="Remove image" className="rounded border border-a-danger/40 p-1 text-a-danger"><Icon name="trash" className="h-3.5 w-3.5" /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Sizes, pricing & stock" actions={!readOnly && (
            <button type="button" className={button("secondary")} onClick={() => setF((p) => ({ ...p, variants: [...p.variants, { sku: "", label: "", regularPrice: 0, salePrice: 0, isActive: true, tracked: false, onHand: 0, availability: "IN_STOCK", reserved: 0 }] }))}><Icon name="plus" className="h-4 w-4" />Add size</button>
          )}>
            {err("variants") && <p role="alert" className="mb-2 text-xs text-a-danger">{err("variants")}</p>}
            <div className="space-y-4">
              {f.variants.map((v, i) => (
                <fieldset key={v.id ?? `n${i}`} className="rounded-lg border border-a-border p-3" disabled={dis}>
                  <legend className="px-1 text-xs text-a-muted">{v.label || `Size ${i + 1}`}</legend>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Label" error={err(`variants.${i}.label`)}><input value={v.label} className={inputCls} placeholder="30 ml" onChange={(e) => { const label = e.target.value; const n = parseFloat(label); setVariant(i, { label, sizeValue: Number.isFinite(n) ? n : v.sizeValue }); }} /></Field>
                    <Field label="SKU" error={err(`variants.${i}.sku`)}><input value={v.sku} className={inputCls} placeholder="IKX-…" onChange={(e) => setVariant(i, { sku: e.target.value })} /></Field>
                    <Field label="MRP (₹)" error={err(`variants.${i}.regularPrice`)}><input type="number" inputMode="decimal" min={0} step="0.01" value={v.regularPrice} className={inputCls} onChange={(e) => setVariant(i, { regularPrice: num(e.target.value) })} /></Field>
                    <Field label="Sale price (₹)" error={err(`variants.${i}.salePrice`)}><input type="number" inputMode="decimal" min={0} step="0.01" value={v.salePrice} className={inputCls} onChange={(e) => setVariant(i, { salePrice: num(e.target.value) })} /></Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-4">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.isActive} onChange={(e) => setVariant(i, { isActive: e.target.checked })} />Active (sellable)</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.tracked} onChange={(e) => setVariant(i, { tracked: e.target.checked })} />Track quantity</label>
                    {v.tracked ? (
                      <Field label={`On hand${v.reserved ? ` (${v.reserved} reserved)` : ""}`}><input type="number" min={v.reserved} step={1} value={v.onHand} className={`${inputCls} !w-28`} onChange={(e) => setVariant(i, { onHand: Math.max(0, Math.floor(num(e.target.value))) })} /></Field>
                    ) : (
                      <Field label="Availability"><select value={v.availability} className={`${inputCls} !w-auto`} onChange={(e) => setVariant(i, { availability: e.target.value as Variant["availability"] })}><option value="IN_STOCK">In stock</option><option value="OUT_OF_STOCK">Out of stock</option></select></Field>
                    )}
                    {!v.id && f.variants.length > 1 && !readOnly && <button type="button" className={button("danger", "ml-auto")} onClick={() => setF((p) => ({ ...p, variants: p.variants.filter((_, j) => j !== i) }))}>Remove</button>}
                  </div>
                  {v.isActive && v.salePrice > v.regularPrice && <p role="alert" className="mt-2 text-xs text-a-danger">Sale price is higher than the MRP.</p>}
                </fieldset>
              ))}
            </div>
            <p className="mt-3 text-xs text-a-muted">Saved sizes can’t be deleted (past orders reference them); switch them off with “Active”.</p>
          </Card>

          <Card title="Fragrance notes">
            <div className="grid gap-4 sm:grid-cols-3">
              {(["top", "middle", "base"] as const).map((k) => (
                <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} notes`} hint="Comma separated"><input value={notes[k]} disabled={dis} className={inputCls} onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))} /></Field>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Visibility">
            <Field label="Status" htmlFor="status">
              <select id="status" value={f.status} disabled={dis} className={inputCls} onChange={(e) => set("status", e.target.value as ProductFormData["status"])}>
                <option value="DRAFT">Draft (hidden)</option><option value="ACTIVE">Published</option><option value="ARCHIVED">Archived (hidden)</option>
              </select>
            </Field>
          </Card>
          <Card title="Organisation">
            <div className="space-y-4">
              <Field label="Gender" htmlFor="gender"><select id="gender" value={f.gender} disabled={dis} className={inputCls} onChange={(e) => set("gender", e.target.value as ProductFormData["gender"])}><option value="">Not set</option><option value="MEN">Men</option><option value="WOMEN">Women</option><option value="UNISEX">Unisex</option></select></Field>
              <fieldset disabled={dis}><legend className="mb-1.5 text-sm font-medium">Categories</legend>
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {categories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.categoryIds.includes(c.id)} onChange={(e) => set("categoryIds", e.target.checked ? [...f.categoryIds, c.id] : f.categoryIds.filter((x) => x !== c.id))} />{c.name}</label>
                  ))}
                </div>
              </fieldset>
            </div>
          </Card>
          <Card title="Search engine listing">
            <div className="space-y-4">
              <Field label="Page title" htmlFor="seot" hint={`${f.seo.title.length}/70`}><input id="seot" value={f.seo.title} disabled={dis} maxLength={70} className={inputCls} onChange={(e) => set("seo", { ...f.seo, title: e.target.value })} /></Field>
              <Field label="Meta description" htmlFor="seod" hint={`${f.seo.description.length}/200`}><textarea id="seod" rows={3} value={f.seo.description} disabled={dis} maxLength={200} className={inputCls} onChange={(e) => set("seo", { ...f.seo, description: e.target.value })} /></Field>
            </div>
          </Card>
          {canDelete && f.id && (
            <Card title="Danger zone">
              {!confirmArchive ? <button type="button" className={button("danger")} onClick={() => setConfirmArchive(true)}>Archive product</button>
                : <div className="space-y-2"><p className="text-sm">Hide this product from the store?</p><div className="flex gap-2"><button type="button" onClick={archive} disabled={pending} className={button("danger")}>Yes, archive</button><button type="button" onClick={() => setConfirmArchive(false)} className={button("secondary")}>Cancel</button></div></div>}
            </Card>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-a-border bg-a-surface/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => router.push("/admin/products")} className={button("secondary")}>Back</button>
            <button type="submit" disabled={pending} className={button("primary", "min-w-28")}>{pending ? "Saving…" : "Save product"}</button>
          </div>
        </div>
      )}

      <MediaPicker open={picker} onClose={() => setPicker(false)} canWrite={canWriteMedia}
        onSelect={(items) => setImages((cur) => [...cur, ...items.filter((m) => !cur.some((c) => c.url === m.url)).map((m) => ({ key: `m-${m.id}`, kind: "media" as const, refId: m.id, url: m.url, alt: m.alt }))])} />
    </form>
  );
}
