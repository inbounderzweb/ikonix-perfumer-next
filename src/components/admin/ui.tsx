import Link from "next/link";
import type { ReactNode } from "react";

export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-accent disabled:cursor-not-allowed disabled:opacity-50",
  primary: "bg-a-accent text-a-accent-fg hover:opacity-90",
  secondary: "border border-a-border bg-a-surface text-a-fg hover:bg-a-raised",
  danger: "border border-a-danger/40 bg-a-surface text-a-danger hover:bg-a-danger/10",
  ghost: "text-a-muted hover:bg-a-raised hover:text-a-fg",
};
export const button = (v: keyof Omit<typeof btn, "base"> = "primary", extra = "") => `${btn.base} ${btn[v]} ${extra}`;

export const inputCls =
  "w-full rounded-lg border border-a-border bg-a-surface px-3 py-2 text-sm text-a-fg placeholder:text-a-muted/70 focus:border-a-accent focus:outline-none focus:ring-2 focus:ring-a-accent/25 disabled:opacity-60";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-a-fg md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-a-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-a-border bg-a-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-a-border px-4 py-3">
          <h2 className="text-sm font-semibold text-a-fg">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-a-fg">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-a-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-a-danger">{error}</p>}
    </div>
  );
}

const tones = {
  neutral: "bg-a-raised text-a-muted border-a-border",
  ok: "bg-a-ok/10 text-a-ok border-a-ok/30",
  warn: "bg-a-warn/10 text-a-warn border-a-warn/30",
  danger: "bg-a-danger/10 text-a-danger border-a-danger/30",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Notice({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-a-border bg-a-surface">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-a-border bg-a-raised text-xs uppercase tracking-wide text-a-muted">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-a-border [&_td]:px-4 [&_td]:py-3">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-10 text-center text-sm text-a-muted">{empty}</p>}
    </div>
  );
}

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-a-muted">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className={button("secondary")} href={href(page - 1)}>Previous</Link> : <span className={button("secondary", "pointer-events-none opacity-40")}>Previous</span>}
        {page < pages ? <Link className={button("secondary")} href={href(page + 1)}>Next</Link> : <span className={button("secondary", "pointer-events-none opacity-40")}>Next</span>}
      </div>
    </nav>
  );
}

export const formatINR = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
export const formatDate = (d: Date | string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));

export function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
const ICONS = {
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10", "M10 20v-6h4v6"],
  box: ["M21 8l-9-5-9 5 9 5 9-5z", "M3 8v8l9 5 9-5V8", "M12 13v8"],
  image: ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9h.01"],
  users: ["M16 20v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1", "M9 11a4 4 0 100-8 4 4 0 000 8z", "M22 20v-1a4 4 0 00-3-3.9", "M16 3.1a4 4 0 010 7.8"],
  truck: ["M2 6h12v10H2z", "M14 10h4l4 3v3h-8", "M7 19a2 2 0 100-4 2 2 0 000 4z", "M18 19a2 2 0 100-4 2 2 0 000 4z"],
  cart: ["M3 4h2l2.4 11h10.2L20 7H6", "M9 20h.01", "M17 20h.01"],
  card: ["M2 6h20v12H2z", "M2 10h20", "M6 15h4"],
  shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  sun: ["M12 16a4 4 0 100-8 4 4 0 000 8z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  moon: ["M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"],
  logout: ["M9 21H5V3h4", "M16 17l5-5-5-5", "M21 12H9"],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 20h16"],
  search: ["M11 19a8 8 0 100-16 8 8 0 000 16z", "M21 21l-4.3-4.3"],
  plus: ["M12 5v14", "M5 12h14"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  copy: ["M9 9h11v11H9z", "M5 15V4h11"],
  check: ["M5 12l5 5 9-10"],
  log: ["M5 4h14v16H5z", "M9 9h6", "M9 13h6", "M9 17h3"],
};
