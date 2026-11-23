"use client";

import { useEffect, useState } from "react";
import { MediaGrid } from "./media-grid";
import { Icon, button } from "../ui";
import type { MediaDTO } from "@/server/media/cloudinary";

/** Shopify-style picker: choose from the library or upload new files, then confirm. Reusable anywhere an image is needed. */
export function MediaPicker({ open, onClose, onSelect, multiple = true, canWrite }: { open: boolean; onClose: () => void; onSelect: (items: MediaDTO[]) => void; multiple?: boolean; canWrite: boolean }) {
  const [picked, setPicked] = useState<MediaDTO[]>([]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;

  const toggle = (a: MediaDTO) => setPicked((p) => (p.some((x) => x.id === a.id) ? p.filter((x) => x.id !== a.id) : multiple ? [...p, a] : [a]));
  const finish = () => { onSelect(picked); setPicked([]); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Select images">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-a-border px-5 py-3">
          <h2 className="font-semibold">Select {multiple ? "images" : "an image"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-a-muted hover:bg-a-raised"><Icon name="close" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5"><MediaGrid mode="select" canWrite={canWrite} selectedIds={picked.map((p) => p.id)} onToggle={toggle} /></div>
        <footer className="flex items-center justify-between gap-3 border-t border-a-border px-5 py-3">
          <span className="text-sm text-a-muted">{picked.length} selected</span>
          <div className="flex gap-2"><button type="button" onClick={onClose} className={button("secondary")}>Cancel</button><button type="button" onClick={finish} disabled={!picked.length} className={button("primary")}>Use selected</button></div>
        </footer>
      </div>
    </div>
  );
}
