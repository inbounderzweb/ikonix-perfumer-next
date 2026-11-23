"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import cloudinaryLoader, { isCloudinary } from "@/lib/cloudinary-loader";
import type { PopupDTO } from "@/server/marketing/popup";

const SKIP = /^\/(checkout|account|login|order)(\/|$)/; // never interrupt purchase or account flows
const DAY = 24 * 3600 * 1000;

const srcset = (url: string, widths: number[]) => (isCloudinary(url) ? widths.map((w) => `${cloudinaryLoader({ src: url, width: w })} ${w}w`).join(", ") : undefined);
const safe = (fn: () => void) => { try { fn(); } catch { /* storage blocked: just show it */ } };

function alreadySeen(p: PopupDTO): boolean {
  const key = `ikx_popup:${p.id}:${p.version}`;
  try {
    if (p.frequency === "ALWAYS") return false;
    if (p.frequency === "SESSION") return !!sessionStorage.getItem(key);
    const at = Number(localStorage.getItem(key));
    return !!at && Date.now() - at < (p.frequency === "DAILY" ? DAY : 7 * DAY);
  } catch { return false; }
}
function markSeen(p: PopupDTO) {
  const key = `ikx_popup:${p.id}:${p.version}`;
  safe(() => { if (p.frequency === "SESSION") sessionStorage.setItem(key, "1"); else if (p.frequency !== "ALWAYS") localStorage.setItem(key, String(Date.now())); });
}

/** Admin-controlled promotional popup: desktop and mobile artwork, shown after a delay, respecting how often a visitor should see it. */
export function PopupBanner() {
  const path = usePathname();
  const [popup, setPopup] = useState<PopupDTO | null>(null);
  const [open, setOpen] = useState(false);
  const fetched = useRef(false);
  const opener = useRef<Element | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const skip = SKIP.test(path);

  useEffect(() => {
    if (skip || fetched.current) return;
    fetched.current = true;
    let timer: ReturnType<typeof setTimeout>;
    fetch("/api/popup").then((r) => r.json()).then((j: { popup: PopupDTO | null }) => {
      const p = j.popup;
      if (!p || alreadySeen(p)) return;
      setPopup(p);
      timer = setTimeout(() => { opener.current = document.activeElement; setOpen(true); markSeen(p); }, p.delaySeconds * 1000);
    }).catch(() => {});
    return () => clearTimeout(timer);
  }, [skip]);

  const close = useCallback(() => { setOpen(false); (opener.current as HTMLElement | null)?.focus?.(); }, []);
  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); if (e.key === "Tab") { e.preventDefault(); closeBtn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close]);

  if (!open || !popup || skip) return null;
  const art = (
    <picture>
      <source media="(max-width: 767px)" srcSet={srcset(popup.mobileImageUrl, [480, 720, 960]) ?? popup.mobileImageUrl} sizes="92vw" />
      <source media="(min-width: 768px)" srcSet={srcset(popup.desktopImageUrl, [800, 1200, 1600]) ?? popup.desktopImageUrl} sizes="720px" />
      <img src={popup.desktopImageUrl} alt={popup.alt} className="block max-h-[82vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl md:max-h-[80vh]" />
    </picture>
  );
  const internal = popup.linkUrl?.startsWith("/");
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={popup.alt}>
      <div className="absolute inset-0 bg-black/60" onClick={close} />
      <div className="relative w-fit max-w-[92vw] md:max-w-[720px]">
        {popup.linkUrl ? (internal ? <Link href={popup.linkUrl} onClick={close}>{art}</Link> : <a href={popup.linkUrl} target="_blank" rel="noopener noreferrer nofollow" onClick={close}>{art}</a>) : art}
        <button ref={closeBtn} type="button" onClick={close} aria-label="Close popup" className="absolute -right-2 -top-2 grid h-11 w-11 place-items-center rounded-full bg-white text-2xl leading-none text-[#3f342c] shadow-lg md:-right-4 md:-top-4">×</button>
      </div>
    </div>
  );
}
