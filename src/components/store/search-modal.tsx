"use client";

import Image from "@/components/store/store-image";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ProductCardDTO } from "@/lib/catalogue-types";
import { rupees } from "@/lib/catalogue-types";

function highlight(text: string, q: string) {
  if (!q) return text;
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${safe})`, "ig")).map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? <mark key={i} className="rounded bg-yellow-200 px-0.5">{part}</mark> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fetched, setResults] = useState<ProductCardDTO[]>([]);
  const [fetchedFor, setFetchedFor] = useState(""); // query the current results belong to
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); }, [open]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    if (!debounced) return;
    const ctrl = new AbortController();
    fetch(`/api/search/suggest?q=${encodeURIComponent(debounced)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: ProductCardDTO[] }) => { setResults(d.items); setFetchedFor(debounced); setActive(0); })
      .catch((e) => { if (e?.name !== "AbortError") { setResults([]); setFetchedFor(debounced); } });
    return () => ctrl.abort();
  }, [debounced]);

  const results = debounced ? fetched : []; // derived: an empty query shows nothing without an extra state reset
  const close = () => { setQ(""); setActive(0); onClose(); };
  const pick = (p: ProductCardDTO) => { router.push(`/products/${p.slug}${p.variant ? `?variant=${p.variant.id}` : ""}`); close(); };
  const pending = Boolean(q.trim()) && (q.trim() !== debounced || fetchedFor !== debounced);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Search products">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
      <div className="relative w-[90%] max-w-lg rounded-2xl bg-white px-6 pt-6 pb-4 shadow-xl">
        <button onClick={close} className="absolute top-4 right-4 rounded-full p-1.5 hover:bg-gray-100" aria-label="Close search">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (results.length) pick(results[active]);
            else if (q.trim()) { router.push(`/shop?q=${encodeURIComponent(q.trim())}`); close(); }
          }}
          className="mt-2 flex items-center gap-3"
        >
          <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (!results.length) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
                setActive(n);
                listRef.current?.children[n]?.scrollIntoView({ block: "nearest" });
              }
            }}
            placeholder="Search products, collections …"
            aria-label="Search products"
            className="flex-1 text-lg caret-[#b49d91] outline-none placeholder:text-gray-400"
          />
        </form>
        <div className="mt-5 max-h-80 overflow-y-auto" ref={listRef}>
          {pending && <p className="py-4 text-center text-sm text-gray-500">Loading products…</p>}
          {!pending && q && results.length === 0 && <p className="py-4 text-center text-sm text-gray-500">No matches found.</p>}
          {!pending && results.map((p, i) => (
            <button key={p.id} onClick={() => pick(p)}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-gray-100 ${i === active ? "bg-gray-100" : ""}`}>
              {p.image && <Image src={(p.variant?.image ?? p.image).url} alt={p.name} width={48} height={48} className="h-12 w-12 flex-shrink-0 rounded-md object-cover" />}
              <div className="flex-1 overflow-hidden">
                <p className="line-clamp-1 text-sm leading-tight font-medium">{highlight(p.name, q)}</p>
                <p className="line-clamp-1 text-xs text-gray-500">{p.categoryName ?? ""} • ₹{p.variant ? rupees(p.variant.salePrice) : "—"}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
