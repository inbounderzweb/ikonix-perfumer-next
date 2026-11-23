"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./ui";
import { setThemeAction } from "@/app/actions/admin/theme";
import { logoutAction } from "@/app/actions/admin/auth";
import type { Theme } from "@/lib/admin-theme";

export type NavItem = { href: string; label: string; icon: Parameters<typeof Icon>[0]["name"]; exact?: boolean };

function useCollapsed() {
  // Persisted per browser; the server snapshot is "expanded", so hydration never mismatches.
  const stored = useSyncExternalStore(
    (cb) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); },
    () => { try { return localStorage.getItem("ikx_admin_nav") === "1"; } catch { return false; } },
    () => false,
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? stored;
  return [collapsed, (v: boolean) => { setOverride(v); try { localStorage.setItem("ikx_admin_nav", v ? "1" : "0"); } catch { /* private mode */ } }] as const;
}

export function AdminShell({ nav, user, initialTheme, children }: { nav: NavItem[]; user: { name: string; email: string; roles: string[] }; initialTheme: Theme; children: ReactNode }) {
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null); // mobile drawer; closes itself when the route changes
  const open = openAt === pathname;
  const [collapsed, setCollapsed] = useCollapsed();
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  function applyTheme(t: Theme) {
    setTheme(t);
    document.querySelector<HTMLElement>(".admin-root")?.setAttribute("data-theme", t);
    void setThemeAction(t);
  }
  const nextTheme: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const isActive = (i: NavItem) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + "/"));

  const navList = (compact: boolean) => (
    <nav aria-label="Admin" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {nav.map((i) => (
        <Link key={i.href} href={i.href} title={compact ? i.label : undefined} aria-current={isActive(i) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive(i) ? "bg-a-accent text-a-accent-fg" : "text-a-muted hover:bg-a-raised hover:text-a-fg"} ${compact ? "justify-center px-0" : ""}`}>
          <Icon name={i.icon} className="h-5 w-5 flex-shrink-0" />
          <span className={compact ? "sr-only" : ""}>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
  const brand = (compact: boolean) => (
    <div className={`flex h-16 items-center gap-3 px-4 ${compact ? "justify-center px-0" : ""}`}>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-a-accent text-sm font-bold text-a-accent-fg">IK</span>
      {!compact && <div className="leading-tight"><p className="text-sm font-semibold">Ikonix</p><p className="text-xs text-a-muted">Admin</p></div>}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={`sticky top-0 hidden h-screen flex-shrink-0 flex-col border-r border-a-border bg-a-surface transition-[width] duration-200 lg:flex ${collapsed ? "w-[72px]" : "w-64"}`}>
        <div className="border-b border-a-border">{brand(collapsed)}</div>
        {navList(collapsed)}
        <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed}
          className="m-3 rounded-lg border border-a-border py-2 text-xs text-a-muted hover:bg-a-raised">{collapsed ? "»" : "« Collapse"}</button>
      </aside>

      <div className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div onClick={() => setOpenAt(null)} className={`absolute inset-0 bg-black/50 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} />
        <aside role="dialog" aria-modal="true" aria-label="Navigation" className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-a-surface shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between border-b border-a-border pr-3">{brand(false)}<button type="button" onClick={() => setOpenAt(null)} aria-label="Close menu" className="rounded-md p-2 text-a-muted hover:bg-a-raised"><Icon name="close" /></button></div>
          {navList(false)}
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-a-border bg-a-surface/90 px-4 backdrop-blur md:px-6">
          <button type="button" onClick={() => setOpenAt(pathname)} aria-label="Open menu" className="rounded-md p-2 text-a-muted hover:bg-a-raised lg:hidden"><Icon name="menu" /></button>
          <div className="hidden text-sm text-a-muted lg:block">{nav.find(isActive)?.label ?? "Admin"}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => applyTheme(nextTheme)} className="flex items-center gap-2 rounded-lg border border-a-border px-3 py-2 text-xs font-medium text-a-muted hover:bg-a-raised hover:text-a-fg" aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}>
              <Icon name={theme === "dark" ? "moon" : "sun"} className="h-4 w-4" />
              <span className="capitalize">{theme}</span>
            </button>
            <div className="hidden text-right leading-tight sm:block">
              <p className="max-w-[160px] truncate text-sm font-medium">{user.name}</p>
              <p className="text-xs text-a-muted">{user.roles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ")}</p>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="rounded-lg border border-a-border p-2 text-a-muted hover:bg-a-raised hover:text-a-fg" aria-label="Sign out" title="Sign out"><Icon name="logout" className="h-4 w-4" /></button>
            </form>
          </div>
        </header>
        <main id="admin-main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
