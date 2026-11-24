import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Table, button, formatDate } from "@/components/admin/ui";
import { OfferRowActions } from "@/components/admin/offer-form";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { Promotion } from "@/server/models";

export const metadata: Metadata = { title: "Offers" };

type R = { _id: unknown; name: string; status: string; startsAt?: Date; endsAt?: Date; usageCount: number; usageLimitTotal?: number; variantRules: { buy: number; free: number }[] };
function state(r: R) {
  const now = Date.now();
  if (r.status !== "ACTIVE") return ["disabled", "neutral"] as const;
  if (r.endsAt && r.endsAt.getTime() < now) return ["expired", "danger"] as const;
  if (r.startsAt && r.startsAt.getTime() > now) return ["scheduled", "warn"] as const;
  return ["live", "ok"] as const;
}

export default async function OffersPage() {
  await requireAdminPage("promotions.write");
  await db();
  const rows = (await Promotion.find({ type: "BUY_X_GET_Y", deletedAt: null }).sort({ createdAt: -1 }).lean()) as unknown as R[];
  return (
    <>
      <PageHeader title="Offers" subtitle="Buy X Get Y offers, configured per product variant." actions={<Link href="/admin/offers/new" className={button("primary")}>New offer</Link>} />
      <Table head={["Offer", "Variants", "Window", "Used", "Status", ""]} empty={rows.length ? undefined : "No offers yet."}>
        {rows.map((r) => { const [label, tone] = state(r); return (
          <tr key={String(r._id)}>
            <td><Link href={`/admin/offers/${String(r._id)}`} className="font-medium text-a-accent underline">{r.name}</Link></td>
            <td className="text-a-muted">{r.variantRules.length} · {[...new Set(r.variantRules.map((v) => `B${v.buy}G${v.free}`))].slice(0, 4).join(", ")}</td>
            <td className="whitespace-nowrap text-a-muted">{r.startsAt ? formatDate(r.startsAt) : "Now"} → {r.endsAt ? formatDate(r.endsAt) : "No end"}</td>
            <td>{r.usageCount}{r.usageLimitTotal ? ` / ${r.usageLimitTotal}` : ""}</td>
            <td><Badge tone={tone}>{label}</Badge></td>
            <td><OfferRowActions id={String(r._id)} active={r.status === "ACTIVE"} /></td>
          </tr>
        ); })}
      </Table>
    </>
  );
}
