"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "./cart-context";
import { SearchModal } from "./search-modal";
import { CartDrawer } from "./cart-drawer";

const SITE = "/ikonix/site";
const WHATSAPP = "https://wa.me/919019951335";

// Legacy "Products" mega-menu targets (mens / women's / all / best sellers).
const COLLECTIONS = [
  { label: "Men’s Perfume", href: "/shop?cat=mens" },
  { label: "Women’s Perfume", href: "/shop?cat=womens" },
  { label: "best sellers", href: "/shop?cat=featured" },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { count, open: cartOpen, setOpen: setCartOpen } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  // Close overlays on navigation (render-time reset avoids an effect cascade).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
    setDrawerOpen(false);
  }

  return (
    <>
      <div
        className={`fixed top-0 left-1/2 z-50 mt-2 w-[90%] -translate-x-1/2 rounded-[5px] font-fancy ring-1 ring-white/5 transition-colors duration-300 md:mt-5 md:rounded-[8px] lg:w-[80%] ${scrolled ? "bg-[#2d3545]/95 shadow-md backdrop-blur-md" : "bg-[#2d3545]"}`}
      >
        <div className="h-[60px] rounded-[5px] bg-[#2d3545] md:h-[82px] md:rounded-[8px]">
          <div className="flex h-full items-center justify-between">
            <div className="m-2 -mt-1 pl-4 md:pl-6">
              <Link href="/" aria-label="Ikonix Perfumer home">
                {/* eslint-disable-next-line @next/next/no-img-element -- legacy vector logo */}
                <img src={`${SITE}/logo.svg`} alt="Ikonix logo" className="h-6 md:h-8" />
              </Link>
            </div>
            <button onClick={() => setDrawerOpen(true)} className="pr-4 md:hidden" aria-label="Open menu">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${SITE}/burger.svg`} alt="" className="h-8 w-8" />
            </button>
            <div className="hidden items-center gap-7 pr-5 text-white md:flex">
              <ul className="flex items-center gap-7 text-[13px] font-normal lg:text-[14px]">
                <li><Link href="/">Home</Link></li>
                <li><Link href="/about">About us</Link></li>
                <li ref={menuRef} className="relative">
                  <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-1" aria-expanded={menuOpen} aria-haspopup="true">
                    Products
                    <svg viewBox="0 0 20 20" fill="currentColor" className={`h-5 w-5 transition-transform ${menuOpen ? "rotate-180" : ""}`} aria-hidden="true">
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <div className={`absolute z-30 transition-all duration-200 ${menuOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-3 opacity-0"}`}>
                    <div className="absolute left-1/2 mt-2 h-5 w-5 -translate-x-1/2 rotate-45 border-l border-t border-slate-300 bg-gray-100" />
                    <div className="relative mx-auto w-[80%]">
                      <div className="absolute right-0 mt-4 -mr-[20.5rem] w-[700px] rounded-[16px] border border-gray-400 bg-gray-100">
                        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
                          <div>
                            <Link href={COLLECTIONS[0].href} className="mb-2 block text-lg font-semibold text-gray-600">{COLLECTIONS[0].label}</Link>
                          </div>
                          <div>
                            <Link href={COLLECTIONS[1].href} className="mb-2 block text-lg font-semibold text-gray-600">{COLLECTIONS[1].label}</Link>
                            <div className="mt-4">
                              <Link href="/shop" className="block w-full rounded-md bg-[#BEC2C7] px-2 py-2 text-center text-sm font-light tracking-wide text-black">View all collections</Link>
                            </div>
                          </div>
                          <div>
                            <Link href={COLLECTIONS[2].href} className="mb-2 block text-lg font-semibold text-gray-600">{COLLECTIONS[2].label}</Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
                <li><Link href="/contact">Contact us</Link></li>
              </ul>
              <div className="flex items-center gap-3">
                <button onClick={() => setSearchOpen(true)} className="grid place-items-center rounded-full" aria-label="Search">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${SITE}/search.svg`} alt="" className="h-6 w-6" />
                </button>
                <Link href="/account" className="grid place-items-center rounded-full" aria-label="Account">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${SITE}/profile.svg`} alt="" className="h-6 w-6" />
                </Link>
                <button onClick={() => setCartOpen(true)} className="relative" aria-label={`Cart, ${count} items`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${SITE}/Cart.svg`} alt="" className="h-6 w-6" />
                  {count > 0 && (
                    <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">{count}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <MobileBottomBar count={count} onSearch={() => setSearchOpen(true)} onCart={() => setCartOpen(true)} onProfile={() => router.push("/account")} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp"
        className="fixed right-6 bottom-6 z-50 hidden items-center justify-center rounded-full bg-[#25D366] shadow-lg transition-colors hover:bg-[#128C7E] md:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${SITE}/whatsapp.png`} alt="" className="h-8 w-8" />
      </a>
    </>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  const link = "text-xl font-light text-white transition-colors hover:text-gray-300";
  const sub = "text-left text-lg font-light text-white transition-colors hover:text-gray-300";
  return (
    <>
      <div className={`fixed inset-0 z-[110] bg-black/50 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} aria-hidden="true" />
      <aside className={`fixed top-0 right-0 z-[120] h-full w-[85%] transform bg-[#2A3443] shadow-2xl transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`} aria-hidden={!open}>
        <div className="flex items-center justify-between border-b border-gray-700/50 p-6">
          <Link href="/" onClick={onClose}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${SITE}/logo.svg`} alt="Ikonix logo" className="h-8" />
          </Link>
          <button onClick={onClose} className="text-3xl text-white/70 transition-colors hover:text-white" aria-label="Close menu">×</button>
        </div>
        <nav className="flex flex-col space-y-6 p-6">
          <Link href="/" className={link}>Home</Link>
          <Link href="/about" className={link}>About us</Link>
          <div className="flex flex-col space-y-4 pt-2">
            <h3 className="text-sm font-semibold tracking-widest text-gray-400 uppercase">Collections</h3>
            <div className="flex flex-col space-y-4 border-l border-gray-700 pl-4">
              <Link href="/shop" className={sub}>All Products</Link>
              {COLLECTIONS.map((c) => <Link key={c.href} href={c.href} className={sub}>{c.label}</Link>)}
            </div>
          </div>
          <Link href="/contact" className={link}>Contact us</Link>
        </nav>
      </aside>
    </>
  );
}

function MobileBottomBar({ count, onSearch, onCart, onProfile }: { count: number; onSearch: () => void; onCart: () => void; onProfile: () => void }) {
  const btn = "flex flex-col items-center justify-center gap-0.5 px-4 py-1 text-[#3D3934] transition-opacity active:opacity-60";
  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[45] flex w-[92%] max-w-[420px] -translate-x-1/2 items-center gap-3 md:hidden">
      <div className="flex flex-1 items-center justify-around rounded-2xl bg-white px-2 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.12)]">
        <button onClick={onSearch} className={btn}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="22" y2="22" strokeLinecap="round" /></svg>
          <span className="text-[10px] font-medium tracking-wide">Search</span>
        </button>
        <div className="h-8 w-px bg-[#E8E0DB]" />
        <button onClick={onCart} className={`relative ${btn}`}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" /><path strokeLinecap="round" d="M16 10a4 4 0 01-8 0" /></svg>
          {count > 0 && <span className="absolute top-0.5 right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white">{count}</span>}
          <span className="text-[10px] font-medium tracking-wide">Cart</span>
        </button>
        <div className="h-8 w-px bg-[#E8E0DB]" />
        <button onClick={onProfile} className={btn}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          <span className="text-[10px] font-medium tracking-wide">Profile</span>
        </button>
      </div>
      <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp"
        className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-white shadow-[0_4px_20px_rgba(37,211,102,0.35)] transition-opacity active:opacity-80">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${SITE}/whatsapp.png`} alt="" className="h-8 w-8" />
      </a>
    </div>
  );
}
