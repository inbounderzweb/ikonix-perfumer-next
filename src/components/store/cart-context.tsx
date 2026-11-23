"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

// Guest cart lives in the browser (per spec); prices are always re-read on the server (getCartView).
// Signed-in carts move to MongoDB and merge this on login (Phase 4).
type Line = { variantId: string; qty: number };
type Toast = { id: number; text: string; tone: "ok" | "error" };

type CartCtx = {
  lines: Line[];
  count: number;
  add: (variantId: string, qty?: number, label?: string) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  notify: (text: string, tone?: Toast["tone"]) => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "ikx_cart_v1";

const parse = (raw: string | null): Line[] => {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((l) => typeof l?.variantId === "string" && Number.isInteger(l?.qty) && l.qty > 0).slice(0, 50) : [];
  } catch {
    return [];
  }
};

// localStorage as an external store: other tabs ("storage") and this tab ("ikx-cart") notify subscribers.
let memory = "[]"; // fallback when storage is unavailable (private mode, blocked site data)
const rawCart = () => { try { return localStorage.getItem(KEY) ?? "[]"; } catch { return memory; } };
const read = () => parse(rawCart());
const subscribe = (cb: () => void) => {
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener("ikx-cart", cb);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("ikx-cart", cb); };
};

export function CartProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, rawCart, () => "[]");
  const lines = useMemo(() => parse(raw), [raw]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const persist = useCallback((next: Line[]) => {
    const json = JSON.stringify(next);
    memory = json;
    try { localStorage.setItem(KEY, json); } catch { /* storage unavailable: cart stays in memory */ }
    window.dispatchEvent(new Event("ikx-cart"));
  }, []);

  const notify = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }, []);

  const add = useCallback((variantId: string, qty = 1, label?: string) => {
    const current = read();
    const existing = current.find((l) => l.variantId === variantId);
    const next = existing
      ? current.map((l) => (l.variantId === variantId ? { ...l, qty: Math.min(99, l.qty + qty) } : l))
      : [...current, { variantId, qty }];
    persist(next);
    notify(label ? `${label} ${existing ? "quantity increased" : "added to cart"}` : "Added to cart");
  }, [persist, notify]);

  const setQty = useCallback((variantId: string, qty: number) => {
    persist(read().map((l) => (l.variantId === variantId ? { ...l, qty: Math.max(1, Math.min(99, qty)) } : l)));
  }, [persist]);

  const remove = useCallback((variantId: string) => persist(read().filter((l) => l.variantId !== variantId)), [persist]);
  const clear = useCallback(() => persist([]), [persist]);

  const value = useMemo(
    () => ({ lines, count: lines.reduce((a, l) => a + l.qty, 0), add, setQty, remove, clear, open, setOpen, notify }),
    [lines, add, setQty, remove, clear, open, notify],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[100px] z-[300] flex flex-col items-center gap-2.5" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-lg bg-white px-4 py-3 text-sm shadow-lg ${t.tone === "error" ? "text-red-700" : "text-[#2f3647]"}`}>
            {t.tone === "error" ? "⚠️ " : "✅ "}{t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside <CartProvider>");
  return c;
}
