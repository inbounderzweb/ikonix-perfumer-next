import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { dashboardStats } from "@/server/customer/orders";
import { getProfile } from "@/server/customer/profile";
import { listAddresses } from "@/server/customer/addresses";
import { Card, Empty, OrderCard } from "@/components/account/ui";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "My Account", robots: { index: false } };

export default async function AccountHome() {
  const me = await requireCustomerPage("/account");
  const [stats, profile, addresses] = await Promise.all([dashboardStats(me.id), getProfile(me.id), listAddresses(me.id)]);
  const cards = [["Total orders", stats.total], ["Active", stats.active], ["Delivered", stats.delivered], ["Cancelled", stats.cancelled]] as const;
  const pct = profile?.completion.percent ?? 0;
  return (
    <div className="space-y-5">
      <h1 className="font-heading text-[28px] text-[#8C7367]">Hello{me.name ? `, ${me.name.split(" ")[0]}` : ""}</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([l, n]) => <div key={l} className="rounded-2xl border border-[#e7dbd3] bg-[#fbf7f4] p-4"><p className="font-heading text-3xl text-[#8C7367]">{n}</p><p className="font-fancy text-sm text-[#53443D]">{l}</p></div>)}
      </div>
      {pct < 100 && (
        <Card title="Complete your profile">
          <div className="h-2 overflow-hidden rounded-full bg-[#ecdfd6]"><div className="h-full bg-[#8C7367]" style={{ width: `${pct}%` }} /></div>
          <p className="mt-2 font-fancy text-sm text-[#53443D]">{pct}% complete. Still missing: {profile?.completion.missing.join(", ")}. <Link href="/account/profile" className="underline">Update profile</Link></p>
        </Card>
      )}
      <Card title="Recent orders" action={stats.total > 0 ? <Link href="/account/orders" className="font-fancy text-sm text-[#8C7367] underline">View all</Link> : undefined}>
        {stats.recent.length ? <div className="space-y-2">{stats.recent.map((o) => <OrderCard key={o.orderNumber} o={o} />)}</div> : <Empty title="No orders yet" text="When you place an order it will appear here with live tracking." href="/shop" cta="Start shopping" />}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Recent activity">
          {stats.activities.length ? <ul className="space-y-3">{stats.activities.map((a, i) => <li key={i} className="font-fancy text-sm text-[#3f342c]"><Link href={`/account/orders/${a.orderNumber}`} className="font-semibold underline">{a.orderNumber}</Link>: {a.label}{a.description ? ` — ${a.description}` : ""}<span className="block text-xs text-[#6b5446]">{fmtDate(a.at, true)}</span></li>)}</ul> : <p className="font-fancy text-sm text-[#6b5446]">Nothing yet.</p>}
        </Card>
        <Card title="Saved addresses" action={<Link href="/account/addresses" className="font-fancy text-sm text-[#8C7367] underline">Manage</Link>}>
          {addresses.length ? <ul className="space-y-2">{addresses.slice(0, 2).map((a) => <li key={a.id} className="font-fancy text-sm text-[#3f342c]"><b>{a.fullName}</b>{a.isDefault && <span className="ml-2 rounded-full bg-[#ecdfd6] px-2 py-0.5 text-xs">Default</span>}<br />{a.line1}, {a.city}, {a.state} {a.postalCode}</li>)}</ul> : <p className="font-fancy text-sm text-[#6b5446]">No saved addresses. Add one to check out faster.</p>}
        </Card>
      </div>
      <Card title="Quick links">
        <div className="flex flex-wrap gap-2">{[["/account/orders", "Track an order"], ["/account/wishlist", "My wishlist"], ["/account/addresses", "Addresses"], ["/account/settings", "Settings"], ["/shop", "Continue shopping"]].map(([h, l]) => <Link key={h} href={h} className="rounded-full border border-[#d9c9bf] px-4 py-2 font-fancy text-sm text-[#53443D] hover:bg-[#f4ece6]">{l}</Link>)}</div>
      </Card>
    </div>
  );
}
