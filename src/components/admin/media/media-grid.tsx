"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Icon, Notice, button, inputCls } from "../ui";
import { thumb } from "@/lib/cloudinary-loader";
import { uploadFiles, type UploadItem } from "./upload";
import type { MediaDTO } from "@/server/media/cloudinary";

type Props = {
  mode: "manage" | "select";
  canWrite: boolean;
  canDelete?: boolean;
  selectedIds?: string[];
  onToggle?: (a: MediaDTO) => void;
};
const FOLDERS = ["", "products", "banners", "categories", "brands", "general"];
const fmtBytes = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function MediaGrid({ mode, canWrite, canDelete = false, selectedIds = [], onToggle }: Props) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [folder, setFolder] = useState("");
  const [uploadFolder, setUploadFolder] = useState("products");
  const [tick, setTick] = useState(0);
  const [items, setItems] = useState<MediaDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [drag, setDrag] = useState(false);
  const [detail, setDetail] = useState<MediaDTO | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const key = `${dq}|${folder}|${tick}`;
  const loading = loadedKey !== key;
  const buildUrl = useCallback((c?: string | null) => {
    const p = new URLSearchParams({ limit: "40" });
    if (dq) p.set("q", dq);
    if (folder) p.set("folder", folder);
    if (c) p.set("cursor", c);
    return `/api/admin/media?${p}`;
  }, [dq, folder]);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let live = true;
    fetch(buildUrl()).then(async (r) => {
      const j = await r.json();
      if (!live) return;
      if (!r.ok) { setError(j.error ?? "Could not load media"); setItems([]); setCursor(null); }
      else { setError(""); setItems(j.items); setCursor(j.nextCursor); }
      setLoadedKey(key);
    }).catch(() => { if (live) { setError("Could not load media"); setLoadedKey(key); } });
    return () => { live = false; };
  }, [buildUrl, key]);

  async function loadMore() {
    if (!cursor) return;
    const r = await fetch(buildUrl(cursor));
    const j = await r.json();
    if (r.ok) { setItems((prev) => [...prev, ...j.items]); setCursor(j.nextCursor); }
  }

  async function onFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length || !canWrite) return;
    const keys = files.map((f, i) => `${Date.now()}-${i}-${f.name}`);
    setUploads((u) => [...files.map((f, i) => ({ key: keys[i], name: f.name, status: "queued" as const })), ...u].slice(0, 30));
    const added = await uploadFiles(files, uploadFolder, (k, patch) => setUploads((u) => u.map((x) => (x.key === k ? { ...x, ...patch } : x))), keys);
    if (added.length) {
      setItems((prev) => [...added.filter((a) => !prev.some((p) => p.id === a.id)), ...prev]);
      if (mode === "select") added.forEach((a) => !selectedIds.includes(a.id) && onToggle?.(a));
    }
  }

  const busy = uploads.some((u) => u.status === "queued" || u.status === "uploading");

  return (
    <div className="space-y-4">
      {canWrite && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void onFiles(e.dataTransfer.files); }}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${drag ? "border-a-accent bg-a-accent/10" : "border-a-border bg-a-raised"}`}>
          <Icon name="upload" className="h-6 w-6 text-a-muted" />
          <p className="text-sm text-a-fg">Drag images here or <button type="button" className="font-medium underline" onClick={() => fileRef.current?.click()}>browse</button></p>
          <p className="text-xs text-a-muted">JPG, PNG, WEBP, AVIF or GIF, up to 10 MB each. Identical files are stored once.</p>
          <div className="flex items-center gap-2 text-xs text-a-muted">
            <label htmlFor="upload-folder">Save to</label>
            <select id="upload-folder" value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)} className={`${inputCls} !w-auto !py-1`}>
              {FOLDERS.filter(Boolean).map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="sr-only" aria-label="Choose images to upload"
            onChange={(e) => { if (e.target.files) void onFiles(e.target.files); e.target.value = ""; }} />
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="space-y-1 text-xs" aria-live="polite">
          {uploads.slice(0, 6).map((u) => (
            <li key={u.key} className="flex items-center justify-between gap-2 rounded-md border border-a-border bg-a-surface px-3 py-1.5">
              <span className="truncate">{u.name}</span>
              <Badge tone={u.status === "done" ? "ok" : u.status === "duplicate" ? "neutral" : u.status === "error" ? "danger" : "warn"}>
                {u.status === "error" ? u.error : u.status === "duplicate" ? "already in library" : u.status}
              </Badge>
            </li>
          ))}
          {!busy && <li><button type="button" onClick={() => setUploads([])} className="text-a-muted underline">Clear</button></li>}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-a-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, alt text or tag" aria-label="Search media" className={`${inputCls} pl-9`} />
        </div>
        <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Filter by folder" className={`${inputCls} !w-auto`}>
          {FOLDERS.map((f) => <option key={f} value={f}>{f || "All folders"}</option>)}
        </select>
        <button type="button" onClick={() => setTick((t) => t + 1)} className={button("secondary")}>Refresh</button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {loading && <p className="py-10 text-center text-sm text-a-muted">Loading…</p>}
      {!loading && !error && items.length === 0 && <p className="py-10 text-center text-sm text-a-muted">No images yet. Upload some above.</p>}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {items.map((a) => {
          const picked = selectedIds.includes(a.id);
          return (
            <li key={a.id}>
              <button type="button" onClick={() => (mode === "select" ? onToggle?.(a) : setDetail(a))} aria-pressed={mode === "select" ? picked : undefined}
                className={`group relative block w-full overflow-hidden rounded-lg border bg-a-raised text-left transition focus-visible:outline-2 focus-visible:outline-a-accent ${picked ? "border-a-accent ring-2 ring-a-accent" : "border-a-border hover:border-a-accent/60"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(a.url, 320)} alt={a.alt || a.filename} loading="lazy" width={320} height={320} className="aspect-square w-full object-cover" />
                {picked && <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-a-accent text-a-accent-fg"><Icon name="check" className="h-4 w-4" /></span>}
                <span className="block truncate px-2 py-1.5 text-xs text-a-muted">{a.filename || a.publicId}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {cursor && !loading && <div className="text-center"><button type="button" onClick={loadMore} className={button("secondary")}>Load more</button></div>}

      {detail && mode === "manage" && (
        <Detail asset={detail} canWrite={canWrite} canDelete={canDelete} onClose={() => setDetail(null)}
          onSaved={(a) => { setItems((p) => p.map((x) => (x.id === a.id ? a : x))); setDetail(a); }}
          onDeleted={(id) => { setItems((p) => p.filter((x) => x.id !== id)); setDetail(null); }} />
      )}
    </div>
  );
}

function Detail({ asset, canWrite, canDelete, onClose, onSaved, onDeleted }: { asset: MediaDTO; canWrite: boolean; canDelete: boolean; onClose: () => void; onSaved: (a: MediaDTO) => void; onDeleted: (id: string) => void }) {
  const [alt, setAlt] = useState(asset.alt);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/admin/media/${asset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alt, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setMsg({ tone: "ok", text: "Saved" }); onSaved(j.asset); } else setMsg({ tone: "danger", text: j.error ?? "Could not save" });
  }
  async function remove() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/admin/media/${asset.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) onDeleted(asset.id); else { setConfirm(false); setMsg({ tone: "danger", text: `${j.error ?? "Could not delete"}${j.usedBy ? ` (${j.usedBy.join(", ")})` : ""}` }); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Image details">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-a-border bg-a-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Image details</h2><button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-a-muted hover:bg-a-raised"><Icon name="close" /></button></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(asset.url, 800).replace("c_fill,g_auto", "c_fit")} alt={asset.alt || asset.filename} className="max-h-72 w-full rounded-lg border border-a-border bg-a-raised object-contain" />
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-a-muted">
          <div><dt>Size</dt><dd className="text-a-fg">{asset.width} × {asset.height}px · {fmtBytes(asset.bytes)}</dd></div>
          <div><dt>Format</dt><dd className="text-a-fg uppercase">{asset.format}</dd></div>
          <div className="col-span-2"><dt>File</dt><dd className="truncate text-a-fg">{asset.filename || asset.publicId}</dd></div>
        </dl>
        <div className="mt-3 flex gap-2">
          <input readOnly value={asset.url} aria-label="Image URL" className={`${inputCls} text-xs`} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={button("secondary")} onClick={() => navigator.clipboard?.writeText(asset.url).then(() => setMsg({ tone: "ok", text: "URL copied" }))} aria-label="Copy URL"><Icon name="copy" className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-3">
          <div><label htmlFor="m-alt" className="mb-1 block text-sm font-medium">Alt text</label><input id="m-alt" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} disabled={!canWrite} className={inputCls} placeholder="Describe the image for screen readers and SEO" /></div>
          <div><label htmlFor="m-tags" className="mb-1 block text-sm font-medium">Tags</label><input id="m-tags" value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canWrite} className={inputCls} placeholder="comma, separated" /></div>
        </div>
        {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {canWrite && <button type="button" onClick={save} disabled={busy} className={button("primary")}>Save</button>}
          {canDelete && !confirm && <button type="button" onClick={() => setConfirm(true)} disabled={busy} className={button("danger", "ml-auto")}><Icon name="trash" className="h-4 w-4" />Delete</button>}
          {canDelete && confirm && <button type="button" onClick={remove} disabled={busy} className={button("danger", "ml-auto")}>Confirm delete</button>}
        </div>
      </div>
    </div>
  );
}
