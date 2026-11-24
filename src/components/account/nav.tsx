"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/customer/auth";

const LINKS = [["/account", "Overview"], ["/account/orders", "My orders"], ["/account/wishlist", "Wishlist"], ["/account/addresses", "Addresses"], ["/account/profile", "Profile"], ["/account/settings", "Settings"]] as const;

export function AccountNav({ name, sub, avatar }: { name: string; sub: string; avatar: string }) {
  const path = usePathname();
  const active = (h: string) => (h === "/account" ? path === h : path.startsWith(h));
  return (
    <aside className="min-w-0">
      <div className="mb-3 flex items-center gap-3 lg:mb-5">
        <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[#b49d91] font-heading text-xl text-white">
          {avatar ? <Image src={avatar} alt="" fill sizes="48px" className="object-cover" /> : (name[0] ?? "U").toUpperCase()}
        </div>
        <div className="min-w-0"><p className="truncate font-heading text-lg text-[#8C7367]">{name}</p><p className="truncate font-fancy text-xs text-[#6b5446]">{sub}</p></div>
      </div>
      <nav aria-label="Account" className="no-scrollbar -mx-[4%] flex gap-2 overflow-x-auto px-[4%] pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
        {LINKS.map(([h, l]) => (
          <Link key={h} href={h} aria-current={active(h) ? "page" : undefined} className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 font-fancy text-sm transition lg:rounded-lg ${active(h) ? "bg-[#b49d91] text-[#3f342c]" : "bg-[#f4ece6] text-[#53443D] hover:bg-[#ecdfd6]"}`}>{l}</Link>
        ))}
        <form action={logoutAction} className="shrink-0 lg:mt-2"><button className="whitespace-nowrap rounded-full bg-red-50 px-4 py-2 font-fancy text-sm text-red-700 hover:bg-red-100 lg:w-full lg:rounded-lg lg:bg-transparent lg:text-left lg:hover:bg-red-50">Sign out</button></form>
      </nav>
    </aside>
  );
}
