import Image from "next/image";
import { redirect } from "next/navigation";
import { getAdmin } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin");
  return (
    <div className="flex min-h-screen bg-a-bg">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden w-[46%] max-w-[720px] overflow-hidden lg:block">
        <Image src="/ikonix/site/raster/makeperfume.webp" alt="" fill preload sizes="46vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1b1411] via-[#1b1411]/60 to-[#1b1411]/20" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white xl:p-14">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-sm font-bold ring-1 ring-white/25 backdrop-blur">IK</span>
            <span className="text-sm font-medium tracking-[0.2em] text-white/85 uppercase">Ikonix Perfumer</span>
          </div>
          <div className="max-w-md">
            <h2 className="font-heading text-4xl leading-tight font-medium xl:text-5xl">Crafted scents,<br />managed with care.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-white/75">Products, orders, deliveries and customers in one place. Sign in with your staff account to continue.</p>
            <div className="mt-8 flex flex-wrap gap-2 text-xs text-white/80">
              {["Catalogue", "Orders", "Delivery", "Customers"].map((t) => (
                <span key={t} className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/20 backdrop-blur">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Form */}
      <main className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
          <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-a-accent/10 blur-3xl" />
          <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-[#c5a291]/20 blur-3xl" />
        </div>
        <div className="relative w-full max-w-[420px]">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-a-accent text-base font-bold text-a-accent-fg shadow-lg shadow-a-accent/25 lg:hidden">IK</span>
            <h1 className="text-2xl font-semibold tracking-tight text-a-fg sm:text-[28px]">Welcome back</h1>
            <p className="mt-1.5 text-sm text-a-muted">Sign in to the Ikonix admin panel.</p>
          </div>
          <div className="rounded-2xl border border-a-border bg-a-surface/90 p-6 shadow-xl shadow-black/[0.04] backdrop-blur sm:p-8">
            <LoginForm />
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-a-muted lg:justify-start">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden><path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" /></svg>
            Staff only. Forgot your password? Ask an administrator to reset it.
          </p>
        </div>
      </main>
    </div>
  );
}
