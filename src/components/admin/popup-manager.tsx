"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePopup, savePopup, setPopupEnabled } from "@/app/actions/admin/banners";
import { Badge, Card, Field, Notice, button, inputCls } from "./ui";
import { MediaPicker } from "./media/media-picker";
import { thumb } from "@/lib/cloudinary-loader";

export type PopupRow = { id?: string; title: string; alt: string; desktopImageUrl: string; mobileImageUrl: string; linkUrl: string; delaySeconds: number; frequency: "ALWAYS" | "SESSION" | "DAILY" | "WEEKLY"; enabled: boolean; startsAt: string; endsAt: string };
const blank: PopupRow = { title: "", alt: "", desktopImageUrl: "", mobileImageUrl: "", linkUrl: "", delaySeconds: 3, frequency: "SESSION", enabled: true, startsAt: "", endsAt: "" };
const FREQ = { ALWAYS: "Every page load", SESSION: "Once per browser session", DAILY: "Once a day", WEEKLY: "Once a week" } as const;

export function PopupManager({ popups, canWriteMedia }: { popups: PopupRow[]; canWriteMedia: boolean }) {
  const [editing, setEditing] = useState<PopupRow | null>(null);
  return (
    <div className="space-y-4">
      {editing ? <PopupForm key={editing.id ?? "new"} initial={editing} canWriteMedia={canWriteMedia} onDone={() => setEditing(null)} /> : (
        <>
          {popups.length === 0 && <Notice tone="neutral">No popup banner yet. Create one and switch it on to show it to visitors.</Notice>}
          {popups.map((p) => <PopupItem key={p.id} p={p} onEdit={() => setEditing(p)} />)}
          <button className={button("primary")} onClick={() => setEditing(blank)}>+ New popup banner</button>
        </>
      )}
    </div>
  );
}

function PopupItem({ p, onEdit }: { p: PopupRow; onEdit: () => void }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState(""); const [confirm, setConfirm] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (r.ok) { setConfirm(false); router.refresh(); } else setErr(r.error ?? "Failed"); });
  return (
    <div className="rounded-xl border border-a-border bg-a-surface p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(p.desktopImageUrl, 160)} alt="Desktop version" className="h-16 w-24 rounded-md border border-a-border object-cover" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(p.mobileImageUrl, 160)} alt="Mobile version" className="h-16 w-12 rounded-md border border-a-border object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{p.title} <Badge tone={p.enabled ? "ok" : "neutral"}>{p.enabled ? "Live" : "Off"}</Badge></p>
          <p className="text-sm text-a-muted">{FREQ[p.frequency]} · after {p.delaySeconds}s{p.linkUrl ? ` · links to ${p.linkUrl}` : ""}{p.startsAt || p.endsAt ? ` · ${p.startsAt ? p.startsAt.replace("T", " ") : "now"} to ${p.endsAt ? p.endsAt.replace("T", " ") : "no end"} (IST)` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" role="switch" className="h-5 w-9 cursor-pointer accent-[var(--a-accent,#8C7367)]" checked={p.enabled} disabled={pending} onChange={(e) => run(() => setPopupEnabled(p.id!, e.target.checked))} /> {p.enabled ? "Enabled" : "Disabled"}</label>
          <button className={button("secondary")} onClick={onEdit}>Edit</button>
          {confirm ? <button className={button("danger")} disabled={pending} onClick={() => run(() => deletePopup(p.id!))}>Confirm delete</button> : <button className={button("ghost")} onClick={() => setConfirm(true)}>Delete</button>}
        </div>
      </div>
      {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
    </div>
  );
}

function PopupForm({ initial, canWriteMedia, onDone }: { initial: PopupRow; canWriteMedia: boolean; onDone: () => void }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [f, setF] = useState(initial); const [fe, setFe] = useState<Record<string, string>>({}); const [err, setErr] = useState("");
  const [pick, setPick] = useState<null | "desktopImageUrl" | "mobileImageUrl">(null); const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const set = <K extends keyof PopupRow>(k: K, v: PopupRow[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setFe({});
    start(async () => { const r = await savePopup({ id: f.id, title: f.title, alt: f.alt, desktopImageUrl: f.desktopImageUrl, mobileImageUrl: f.mobileImageUrl, linkUrl: f.linkUrl, delaySeconds: f.delaySeconds, frequency: f.frequency, startsAt: f.startsAt, endsAt: f.endsAt, enabled: f.enabled }); if (r.ok) { router.refresh(); onDone(); } else { setErr(r.error); setFe(r.fields ?? {}); } });
  };
  const slot = (k: "desktopImageUrl" | "mobileImageUrl", label: string, hint: string) => (
    <Field label={label} hint={hint} error={fe[k]}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {f[k] ? <img src={thumb(f[k], 200)} alt="" className="h-20 w-20 rounded-md border border-a-border object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-a-border text-xs text-a-muted">None</div>}
        <button type="button" className={button("secondary")} onClick={() => setPick(k)}>{f[k] ? "Change image" : "Choose image"}</button>
      </div>
    </Field>
  );
  return (
    <Card title={initial.id ? "Edit popup banner" : "New popup banner"}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        {err && <Notice tone="danger">{err}</Notice>}
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (internal)" error={fe.title}><input className={inputCls} maxLength={80} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Diwali offer" /></Field>
          <Field label="Image description (for screen readers)" error={fe.alt}><input className={inputCls} maxLength={160} value={f.alt} onChange={(e) => set("alt", e.target.value)} placeholder="Flat 20% off on all perfumes" /></Field>
          {slot("desktopImageUrl", "Desktop image", "Landscape, about 1200 × 800 px (3:2). Shown on screens wider than 768 px.")}
          {slot("mobileImageUrl", "Mobile image", "Portrait, about 800 × 1000 px (4:5). Shown on phones.")}
          <Field label="Link when clicked (optional)" error={fe.linkUrl} hint="A page like /shop or a full https:// link. Leave empty for a non-clickable banner."><input className={inputCls} value={f.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} placeholder="/shop" /></Field>
          <Field label="Show after (seconds)" error={fe.delaySeconds}><input type="number" min={0} max={120} className={inputCls} value={f.delaySeconds} onChange={(e) => set("delaySeconds", Number(e.target.value))} /></Field>
          <Field label="How often per visitor" error={fe.frequency}><select className={inputCls} value={f.frequency} onChange={(e) => set("frequency", e.target.value as PopupRow["frequency"])}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start (optional, IST)" error={fe.startsAt}><input type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
            <Field label="End (optional, IST)" error={fe.endsAt}><input type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Enabled (visible to visitors; switches any other popup off)</label>
        </fieldset>

        <div>
          <div className="mb-2 flex items-center gap-2"><span className="text-sm font-medium">Preview</span>
            {(["desktop", "mobile"] as const).map((v) => <button key={v} type="button" className={button(view === v ? "primary" : "secondary")} onClick={() => setView(v)}>{v === "desktop" ? "Desktop" : "Mobile"}</button>)}</div>
          <div className="grid place-items-center rounded-xl bg-black/50 p-4">
            {(view === "desktop" ? f.desktopImageUrl : f.mobileImageUrl) ? (
              <div className={`relative ${view === "desktop" ? "w-full max-w-xl" : "w-60"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(view === "desktop" ? f.desktopImageUrl : f.mobileImageUrl, 900)} alt={f.alt} className="w-full rounded-2xl shadow-2xl" />
                <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-white text-black shadow">×</span>
              </div>
            ) : <p className="py-10 text-sm text-white/70">Choose the {view} image to preview it.</p>}
          </div>
        </div>
        <div className="flex gap-2"><button className={button("primary")} disabled={pending}>{pending ? "Saving…" : "Save popup"}</button><button type="button" className={button("secondary")} onClick={onDone}>Cancel</button></div>
      </form>
      <MediaPicker open={pick !== null} multiple={false} canWrite={canWriteMedia} onClose={() => setPick(null)} onSelect={(items) => { if (pick && items[0]) set(pick, items[0].url); }} />
    </Card>
  );
}
