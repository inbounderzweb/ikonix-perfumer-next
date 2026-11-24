"use client";

import { useMemo, useState } from "react";
import { button, inputCls, pageWindow, type SortState } from "./ui";

/**
 * Search + sort + pagination for small tables whose rows are already on the page (staff, test users).
 * Server-backed lists use URL params instead (see src/server/admin/util.ts).
 */
export function useClientTable<T>(rows: T[], opts: { text: (r: T) => string; sorts: Record<string, (a: T, b: T) => number>; defaultSort?: SortState; size?: number }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState | undefined>(opts.defaultSort);
  const [size, setSizeState] = useState(opts.size ?? 10);
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = needle ? rows.filter((r) => opts.text(r).toLowerCase().includes(needle)) : rows;
    const cmp = sort && opts.sorts[sort.key];
    return cmp ? [...f].sort((a, b) => (sort!.dir === "asc" ? 1 : -1) * cmp(a, b)) : f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const cur = Math.min(page, pages);
  return {
    view: filtered.slice((cur - 1) * size, cur * size), total: filtered.length, all: rows.length, q, size, page: cur, pages, sort,
    setQ: (v: string) => { setQ(v); setPage(1); },
    setSize: (n: number) => { setSizeState(n); setPage(1); },
    setPage,
    onSort: (key: string) => { setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })); setPage(1); },
  };
}

type T = ReturnType<typeof useClientTable>;

export function ClientSearch({ t, placeholder }: { t: Pick<T, "q" | "setQ">; placeholder: string }) {
  return <input value={t.q} onChange={(e) => t.setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${inputCls} mb-3 max-w-xs`} />;
}

/** Numbered pages with Previous/Next and a rows-per-page switch (10 / 25 / 50 / 100). */
export function ClientPagination({ t }: { t: Pick<T, "page" | "pages" | "total" | "size" | "setPage" | "setSize"> }) {
  if (t.total <= 10) return null;
  const from = (t.page - 1) * t.size + 1; const to = Math.min(t.page * t.size, t.total);
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-a-muted">
      <span>{from}–{to} of {t.total}{t.pages > 1 ? ` · page ${t.page} of ${t.pages}` : ""}</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 flex items-center gap-1" role="group" aria-label="Rows per page">Rows
          {[10, 25, 50, 100].map((n) => n === t.size ? <span key={n} aria-current="true" className="rounded-md bg-a-raised px-2 py-1 font-medium text-a-fg">{n}</span> : <button key={n} type="button" onClick={() => t.setSize(n)} className="rounded-md px-2 py-1 hover:bg-a-raised hover:text-a-fg">{n}</button>)}
        </span>
        {t.pages > 1 && <>
          <button type="button" className={button("secondary")} disabled={t.page <= 1} onClick={() => t.setPage(t.page - 1)}>Previous</button>
          {pageWindow(t.page, t.pages).map((n, i) => n === null ? <span key={`g${i}`} aria-hidden className="px-1">…</span> : n === t.page ? <span key={n} aria-current="page" className="min-w-8 rounded-lg bg-a-accent px-2.5 py-1.5 text-center font-medium text-white">{n}</span> : <button key={n} type="button" aria-label={`Page ${n}`} onClick={() => t.setPage(n)} className="min-w-8 rounded-lg border border-a-border px-2.5 py-1.5 text-center hover:bg-a-raised hover:text-a-fg">{n}</button>)}
          <button type="button" className={button("secondary")} disabled={t.page >= t.pages} onClick={() => t.setPage(t.page + 1)}>Next</button>
        </>}
      </div>
    </nav>
  );
}
