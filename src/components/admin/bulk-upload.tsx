"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Badge, Card, Notice, Table, button, inputCls } from "./ui";

type Status = "pending" | "ready" | "exists" | "invalid" | "missing-images" | "uploading" | "created" | "failed";
type Row = {
  key: string; legacyId: string; slug: string; name: string; raw: unknown; status: Status; message?: string;
  images: string[]; productId?: string; productStatus?: "ACTIVE" | "DRAFT"; issues?: string[]; variants?: number;
  uploaded?: number; reused?: number;
};
type CheckRow = { legacyId: string; slug: string; name: string; valid: boolean; error?: string; productStatus?: "ACTIVE" | "DRAFT"; issues?: string[]; variants?: number; images?: string[]; existing?: { productId: string; slug: string; matchedBy: string[] } | null };
type ImportResult = { status: "created" | "exists" | "failed" | "would-create"; productId?: string; productStatus?: "ACTIVE" | "DRAFT"; matchedBy?: string[]; error?: string; images: { path: string; ok: boolean; duplicate?: boolean; error?: string }[] };

const CHUNK = 100;
const CONCURRENCY = 2;
const LABEL: Record<Status, string> = { pending: "Not checked", ready: "Ready", exists: "Already present", invalid: "Invalid data", "missing-images": "Images missing", uploading: "Uploading…", created: "Created", failed: "Failed" };
const TONE: Record<Status, "neutral" | "ok" | "warn" | "danger"> = { pending: "neutral", ready: "neutral", exists: "warn", invalid: "danger", "missing-images": "danger", uploading: "neutral", created: "ok", failed: "danger" };

/** "<slug>/images/<file>" — the part of a path shared by the data file and a chosen folder. */
const imageKey = (p: string) => p.split("/").filter(Boolean).slice(-3).join("/");
const baseName = (p: string) => p.split("/").pop() ?? p;

/** Finds the chosen file for a source path: by "<slug>/images/<file>", or by file name when that name is unique. */
function findFile(m: Map<string, File>, p: string): File | undefined {
  const exact = m.get(imageKey(p));
  if (exact) return exact;
  const name = baseName(p);
  const hits = [...m.entries()].filter(([k]) => !k.includes("/") && k === name);
  return hits.length === 1 ? hits[0][1] : undefined;
}

export function BulkUpload() {
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [dataName, setDataName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "checking" | "uploading">("");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const stop = useRef(false);

  const counts = useMemo(() => {
    const c = Object.fromEntries(Object.keys(LABEL).map((k) => [k, 0])) as Record<Status, number>;
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function readData(f: File | undefined) {
    setError(""); setRows([]);
    if (!f) return;
    try {
      const json = JSON.parse(await f.text()) as { products?: unknown[] } | unknown[];
      const list = Array.isArray(json) ? json : json.products;
      if (!Array.isArray(list) || list.length === 0) throw new Error("No products found. Expected an array or { products: [...] }.");
      setDataName(f.name);
      setRows(list.map((raw, i) => {
        const r = raw as { id?: unknown; slug?: unknown; name?: unknown };
        return { key: `${i}-${String(r.id)}`, legacyId: String(r.id ?? "?"), slug: String(r.slug ?? ""), name: String(r.name ?? "(no name)").trim(), raw, status: "pending", images: [] };
      }));
    } catch (e) {
      setError(`Could not read ${f.name}: ${e instanceof Error ? e.message : "invalid JSON"}`);
    }
  }

  function readImages(list: FileList | null) {
    if (!list) return;
    const m = new Map(files);
    for (const f of Array.from(list)) {
      if (!/\.(webp|jpe?g|png|avif|gif)$/i.test(f.name)) continue;
      m.set(imageKey(f.webkitRelativePath || f.name), f);
    }
    setFiles(m);
    // Re-evaluate rows that were waiting for images.
    setRows((rs) => rs.map((r) => (r.status === "missing-images" || r.status === "ready" ? { ...r, ...imageState(r.images, m) } : r)));
  }

  function imageState(images: string[], m: Map<string, File>): Pick<Row, "status" | "message"> {
    const missing = images.filter((p) => !findFile(m, p));
    return missing.length ? { status: "missing-images", message: `${missing.length} of ${images.length} image(s) not in the chosen folder, e.g. ${missing[0]}` } : { status: "ready", message: undefined };
  }

  async function check() {
    setBusy("checking"); setError("");
    try {
      const next = [...rows];
      for (let i = 0; i < next.length; i += CHUNK) {
        const slice = next.slice(i, i + CHUNK);
        const res = await fetch("/api/admin/products/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "check", rows: slice.map((r) => r.raw) }) });
        const body = (await res.json().catch(() => ({}))) as { rows?: CheckRow[]; error?: string };
        if (!res.ok || !body.rows) throw new Error(body.error ?? `Check failed (${res.status})`);
        body.rows.forEach((c, j) => {
          const r = next[i + j];
          if (!c.valid) next[i + j] = { ...r, status: "invalid", message: c.error };
          else if (c.existing) next[i + j] = { ...r, status: "exists", productId: c.existing.productId, message: `Matched by ${c.existing.matchedBy.join(", ")}; not changed.`, images: c.images ?? [] };
          else next[i + j] = { ...r, images: c.images ?? [], productStatus: c.productStatus, issues: c.issues, variants: c.variants, ...imageState(c.images ?? [], files) };
        });
        setRows([...next]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy("");
    }
  }

  async function uploadOne(r: Row) {
    patch(r.key, { status: "uploading", message: undefined });
    const form = new FormData();
    form.append("row", JSON.stringify(r.raw));
    for (const p of r.images) { const f = findFile(files, p); if (f) form.append(p, f, f.name); }
    try {
      const res = await fetch("/api/admin/products/bulk", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { result?: ImportResult; error?: string };
      const x = body.result;
      if (!res.ok || !x) return patch(r.key, { status: "failed", message: body.error ?? `Request failed (${res.status})` });
      const uploaded = x.images.filter((i) => i.ok && !i.duplicate).length;
      const reused = x.images.filter((i) => i.ok && i.duplicate).length;
      if (x.status === "created") patch(r.key, { status: "created", productId: x.productId, productStatus: x.productStatus, uploaded, reused, message: x.productStatus === "DRAFT" ? "Created as draft: needs review before publishing." : undefined });
      else if (x.status === "exists") patch(r.key, { status: "exists", productId: x.productId, message: `Matched by ${(x.matchedBy ?? []).join(", ")}; not changed.` });
      else patch(r.key, { status: "failed", uploaded, reused, message: [x.error, ...x.images.filter((i) => !i.ok).map((i) => `${i.path}: ${i.error}`)].filter(Boolean).join(" · ") });
    } catch {
      patch(r.key, { status: "failed", message: "Network error. Safe to retry." });
    }
  }

  async function upload(statuses: Status[]) {
    stop.current = false;
    setBusy("uploading");
    const queue = rows.filter((r) => statuses.includes(r.status));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (next < queue.length && !stop.current) await uploadOne(queue[next++]);
    }));
    setBusy("");
  }

  function download(kind: "csv" | "json") {
    const data = rows.map((r) => ({ legacyId: r.legacyId, slug: r.slug, name: r.name, result: LABEL[r.status], productStatus: r.productStatus ?? "", productId: r.productId ?? "", variants: r.variants ?? "", images: r.images.length, imagesUploaded: r.uploaded ?? "", imagesReused: r.reused ?? "", message: r.message ?? "", reviewIssues: (r.issues ?? []).join(" | ") }));
    const text = kind === "json"
      ? JSON.stringify({ generatedAt: new Date().toISOString(), source: dataName, summary: counts, rows: data }, null, 2)
      : [Object.keys(data[0]).join(","), ...data.map((d) => Object.values(d).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: kind === "json" ? "application/json" : "text/csv" }));
    a.download = `bulk-upload-report-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const checked = rows.length > 0 && counts.pending === 0;
  const done = counts.created + counts.exists + counts.failed + counts.invalid + counts["missing-images"];
  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const dirProps = { webkitdirectory: "", directory: "" } as Record<string, string>;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="1. Product data file">
          <p className="mb-3 text-sm text-a-muted">The product export (for example <code>all-products.json</code>): an array of products, or <code>{"{ products: [...] }"}</code>. Prices are in rupees; they are stored in paise.</p>
          <input type="file" accept="application/json,.json" aria-label="Product data file" disabled={!!busy} onChange={(e) => readData(e.target.files?.[0])} className={inputCls} />
          {rows.length > 0 && <p className="mt-2 text-sm text-a-fg">{rows.length} product(s) in {dataName}</p>}
        </Card>
        <Card title="2. Product images">
          <p className="mb-3 text-sm text-a-muted">Choose the products folder (each product in <code>{"<slug>/images/"}</code>). Images are matched to products by that path. Nothing is deleted from your computer.</p>
          <div className="flex flex-wrap gap-2">
            <label className={button("secondary", busy ? "pointer-events-none opacity-50" : "cursor-pointer")}>
              Choose folder
              <input type="file" multiple className="sr-only" {...dirProps} onChange={(e) => readImages(e.target.files)} />
            </label>
            <label className={button("ghost", busy ? "pointer-events-none opacity-50" : "cursor-pointer")}>
              or choose files
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="sr-only" onChange={(e) => readImages(e.target.files)} />
            </label>
          </div>
          {files.size > 0 && <p className="mt-2 text-sm text-a-fg">{files.size} image(s) selected</p>}
        </Card>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {rows.length > 0 && (
        <Card title="3. Check and upload" actions={busy === "uploading" ? <button type="button" className={button("danger")} onClick={() => (stop.current = true)}>Stop after current</button> : null}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([["Products", rows.length], ["Ready", counts.ready], ["Already present", counts.exists], ["Created", counts.created], ["Failed", counts.failed + counts.invalid + counts["missing-images"]], ["Not checked", counts.pending]] as const).map(([l, n]) => (
              <div key={l} className="rounded-lg border border-a-border bg-a-raised px-3 py-2">
                <p className="text-xs text-a-muted">{l}</p>
                <p className="text-lg font-semibold text-a-fg tabular-nums">{n}</p>
              </div>
            ))}
          </div>
          {busy === "uploading" && (
            <div className="mt-4" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-a-raised"><div className="h-full bg-a-accent transition-all" style={{ width: `${Math.round((done / rows.length) * 100)}%` }} /></div>
              <p className="mt-1 text-xs text-a-muted">{done} of {rows.length} processed</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={button("secondary")} disabled={!!busy} onClick={check}>{busy === "checking" ? "Checking…" : checked ? "Check again" : "Check products"}</button>
            <button type="button" className={button("primary")} disabled={!!busy || counts.ready === 0} onClick={() => upload(["ready"])}>Upload {counts.ready} product(s)</button>
            {counts.failed > 0 && <button type="button" className={button("secondary")} disabled={!!busy} onClick={() => upload(["failed"])}>Retry {counts.failed} failed</button>}
            <button type="button" className={button("ghost")} disabled={!checked} onClick={() => download("csv")}>Download report (CSV)</button>
            <button type="button" className={button("ghost")} disabled={!checked} onClick={() => download("json")}>JSON</button>
          </div>
          <p className="mt-3 text-xs text-a-muted">Products that already exist (same legacy id, slug or SKU) are reported and left unchanged. Identical images are stored once. Products with data issues are created as drafts.</p>
        </Card>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <label htmlFor="bulk-filter" className="text-sm text-a-muted">Show</label>
            <select id="bulk-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={`${inputCls} w-auto`}>
              <option value="all">All ({rows.length})</option>
              {(Object.keys(LABEL) as Status[]).filter((s) => counts[s] > 0).map((s) => <option key={s} value={s}>{LABEL[s]} ({counts[s]})</option>)}
            </select>
          </div>
          <Table head={["Product", "Result", "Details"]} empty={visible.length ? undefined : "Nothing to show."}>
            {visible.slice(0, 500).map((r) => (
              <tr key={r.key}>
                <td>
                  <p className="font-medium text-a-fg">{r.name}</p>
                  <p className="text-xs text-a-muted">#{r.legacyId} · {r.slug}</p>
                </td>
                <td className="whitespace-nowrap">
                  <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  {r.productStatus === "DRAFT" && r.status !== "exists" && <span className="ml-1"><Badge tone="warn">Draft</Badge></span>}
                </td>
                <td className="text-xs text-a-muted">
                  {r.message}
                  {r.status === "created" && <span> {r.uploaded ?? 0} uploaded, {r.reused ?? 0} reused. </span>}
                  {r.productId && <Link href={`/admin/products/${r.productId}`} className="ml-1 text-a-accent underline">Open</Link>}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
