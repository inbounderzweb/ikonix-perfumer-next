import Link from "next/link";
import type { ReactNode } from "react";
import StoreImage from "@/components/store/store-image";
import { fmtDate, inr } from "@/lib/format";
import type { OrderSummary } from "@/server/customer/orders";

export const field = "w-full rounded-lg border border-[#d9c9bf] bg-white px-3 py-2.5 font-fancy text-[#3f342c] outline-none focus:border-[#8C7367] disabled:bg-[#f1ebe6] disabled:text-[#8a7b72]";
export const btnPrimary = "inline-flex items-center justify-center rounded-full bg-[#b49d91] px-6 py-2.5 font-fancy text-[#3f342c] transition hover:bg-[#a38c80] disabled:opacity-60";
export const btnGhost = "inline-flex items-center justify-center rounded-full border border-[#d9c9bf] px-5 py-2 font-fancy text-sm text-[#53443D] transition hover:bg-[#f4ece6] disabled:opacity-60";

export const Card = ({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-[#e7dbd3] bg-[#fbf7f4] p-4 sm:p-5 ${className}`}>
    {(title || action) && <div className="mb-3 flex items-center justify-between gap-3">{title && <h2 className="font-heading text-xl text-[#8C7367]">{title}</h2>}{action}</div>}
    {children}
  </section>
);

export const Empty = ({ title, text, href, cta }: { title: string; text: string; href?: string; cta?: string }) => (
  <div className="rounded-2xl border border-dashed border-[#d9c9bf] px-6 py-12 text-center">
    <p className="font-heading text-xl text-[#8C7367]">{title}</p><p className="mx-auto mt-1 max-w-sm font-fancy text-sm text-[#53443D]">{text}</p>
    {href && <Link href={href} className={`${btnPrimary} mt-5`}>{cta}</Link>}
  </div>
);

const TONE: Record<string, string> = { DELIVERED: "bg-green-100 text-green-800", CANCELLED: "bg-red-100 text-red-800", REFUNDED: "bg-red-100 text-red-800", DELIVERY_FAILED: "bg-orange-100 text-orange-800", RETURNED: "bg-stone-200 text-stone-700", RETURN_REQUESTED: "bg-stone-200 text-stone-700" };
export const StatusBadge = ({ status, label }: { status: string; label: string }) => <span className={`inline-block rounded-full px-3 py-1 font-fancy text-xs ${TONE[status] ?? "bg-[#ecdfd6] text-[#6b5446]"}`}>{label}</span>;

export function OrderCard({ o }: { o: OrderSummary }) {
  return (
    <Link href={`/account/orders/${o.orderNumber}`} className="flex items-center gap-4 rounded-xl border border-[#e7dbd3] bg-white p-3 transition hover:border-[#b49d91] sm:p-4">
      <div className="flex -space-x-3">
        {o.thumbs.map((t, i) => <div key={i} className="relative h-14 w-14 overflow-hidden rounded-lg border-2 border-white bg-[#f4ece6]">{t.image && <StoreImage src={t.image} alt={t.name} fill sizes="56px" className="object-cover" />}</div>)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-fancy font-semibold text-[#3f342c]">{o.orderNumber}</p>
        <p className="font-fancy text-xs text-[#6b5446]">{fmtDate(o.placedAt)} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}</p>
      </div>
      <div className="text-right"><p className="font-fancy font-semibold text-[#3f342c]">{inr(o.total)}</p><StatusBadge status={o.status} label={o.statusLabel} /></div>
    </Link>
  );
}

export const Skeleton = ({ className = "" }: { className?: string }) => <div className={`animate-pulse rounded-xl bg-[#ecdfd6] ${className}`} />;
