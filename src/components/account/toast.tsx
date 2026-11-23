"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type T = { id: number; kind: "ok" | "err"; text: string };
const Ctx = createContext<(kind: T["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: T["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "err" ? "alert" : "status"} className={`pointer-events-auto max-w-sm rounded-xl px-4 py-3 font-fancy text-sm shadow-lg ${t.kind === "ok" ? "bg-[#3f342c] text-white" : "bg-red-600 text-white"}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
