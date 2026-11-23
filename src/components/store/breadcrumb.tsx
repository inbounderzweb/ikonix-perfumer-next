"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type Crumb = { label: string; href?: string };

export function Breadcrumb({ items, fallback = "/", className = "" }: { items: Crumb[]; fallback?: string; className?: string }) {
  const router = useRouter();
  return (
    <div className={`flex items-center gap-3 font-fancy text-sm text-[#6C5950]/80 ${className}`}>
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
        aria-label="Go back"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#e6d9d0] text-[#8C7367] transition hover:bg-[#f3ebe5]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      </button>
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 items-center">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${c.label}-${i}`} className={`flex items-center ${last ? "min-w-0" : "flex-shrink-0"}`}>
                {last || !c.href ? (
                  <span aria-current={last ? "page" : undefined} className="truncate font-medium text-[#53443D]">{c.label}</span>
                ) : (
                  <Link href={c.href} className="hover:underline">{c.label}</Link>
                )}
                {!last && (
                  <svg className="mx-1.5 h-3.5 w-3.5 flex-shrink-0 text-[#b49d91]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
