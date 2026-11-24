"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/store/cart-context";
import { createCheckout, getCheckoutQuote, verifyPayment, type Quote } from "@/app/actions/checkout";
import { getCartView, type CartLineView } from "@/app/actions/cart";
import { lookupPincode, reverseGeocode } from "@/app/actions/location";
import { INDIAN_STATES } from "@/lib/india";
import { areaSummary, notServiceableMessage, serviceable, type DeliveryArea } from "@/lib/delivery-area";
import { saveAddressAction } from "@/app/actions/customer/account";
import type { AddressDTO } from "@/server/customer/addresses";

declare global {
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: { error?: { description?: string } }) => void): void } }
}
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;
const field = "w-full rounded-md border border-[#d8c9c1] bg-white px-3 py-2.5 font-fancy text-[15px] text-ink focus:border-taupe-600 focus:outline-none focus:ring-2 focus:ring-taupe-400/40";
const label = "mb-1 block font-fancy text-sm font-bold text-taupe-900";

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function CheckoutClient({ customer, addresses, area }: { customer: { name: string; email: string; mobile: string } | null; addresses: AddressDTO[]; area: DeliveryArea }) {
  const { lines, clear } = useCart();
  const router = useRouter();
  const [view, setView] = useState<CartLineView[] | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [methodId, setMethodId] = useState("");
  const def = addresses.find((a) => a.isDefault) ?? addresses[0];
  const [f, setF] = useState({ name: def?.fullName ?? customer?.name ?? "", phone: (def?.phone ?? customer?.mobile ?? "").replace(/^\+91/, ""), email: customer?.email ?? "", line1: def?.line1 ?? "", line2: def?.line2 ?? "", landmark: def?.landmark ?? "", city: def?.city ?? "", state: def?.state ?? "", postalCode: def?.postalCode ?? "", note: "" });
  const [picked, setPicked] = useState<string>(def?.id ?? "");
  const [saveIt, setSaveIt] = useState(false);
  const [guest, setGuest] = useState(false); // signed-out visitors choose: sign in, or continue as guest
  const pick = (a: AddressDTO | null) => {
    setPicked(a?.id ?? "");
    setF((p) => a ? { ...p, name: a.fullName, phone: a.phone.replace(/^\+91/, ""), line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, state: a.state, postalCode: a.postalCode } : { ...p, line1: "", line2: "", landmark: "", city: "", state: "", postalCode: "" });
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Address auto-fill: PIN code -> city/state/localities, and "Use my current location". Typed values are never overwritten:
  // a field is only auto-filled while it is empty or still holds the value we filled last time.
  const [geoNote, setPinNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null); // location-button messages
  const [lookup, setLookup] = useState<{ pin: string; note: { tone: "ok" | "warn"; text: string }; areas: string[] } | null>(null);
  const current = lookup?.pin === f.postalCode ? lookup : null; // a result only counts for the PIN it was fetched for
  const pinNote = geoNote ?? current?.note ?? null;
  const areas = current?.areas ?? [];
  const [locating, setLocating] = useState(false);
  const auto = useRef({ city: "", state: "" });
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(f.postalCode)) return;
    let live = true;
    const pin = f.postalCode;
    lookupPincode(pin).then((r) => {
      if (!live) return;
      if (!r.ok) { setLookup({ pin, note: { tone: "warn", text: r.error }, areas: [] }); return; }
      setLookup({ pin, note: { tone: "ok", text: `${r.city}, ${r.state}` }, areas: r.areas });
      setF((p) => {
        const city = !p.city || p.city === auto.current.city ? r.city : p.city;
        const state = !p.state || p.state === auto.current.state ? r.state : p.state;
        auto.current = { city, state };
        return { ...p, city, state };
      });
    });
    return () => { live = false; };
  }, [f.postalCode]);

  function locate() {
    if (!navigator.geolocation) { setPinNote({ tone: "warn", text: "Your browser can't share its location. Please enter your PIN code." }); return; }
    setLocating(true); setPinNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const r = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
        if (!r.ok) { setPinNote({ tone: "warn", text: r.error }); return; }
        auto.current = { city: r.city, state: r.state };
        setPicked("");
        setF((p) => ({ ...p, postalCode: r.postalCode, city: r.city, state: r.state, line1: r.line1 || p.line1, line2: r.area || p.line2 }));
      },
      () => { setLocating(false); setPinNote({ tone: "warn", text: "Location permission was denied. Please enter your PIN code instead." }); },
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  useEffect(() => {
    let live = true;
    getCartView(lines).then((v) => live && setView(v));
    getCheckoutQuote(lines, methodId || undefined).then((q) => { if (!live) return; setQuote(q); if (q.ok && !methodId && q.methods[0]) setMethodId(q.methods[0].id); });
    return () => { live = false; };
  }, [lines, methodId]);

  const loading = view === null || quote === null;
  const empty = !loading && view.length === 0;
  const inArea = serviceable(area, f.state, f.postalCode);
  const ready = quote?.ok && quote.methods.length > 0 && inArea;

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true); setMsg(""); setErrors({});
    const payload = {
      lines, shippingMethodId: methodId,
      contact: { name: f.name, phone: f.phone, email: f.email },
      address: { line1: f.line1, line2: f.line2, landmark: f.landmark, city: f.city, state: f.state, postalCode: f.postalCode },
      customerNote: f.note,
    };
    // Same details → same key (retrying a dismissed payment reuses the order). Anything changed → a new order.
    const sig = JSON.stringify(payload);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() };
    const res = await createCheckout({ ...payload, idempotencyKey: attempt.current.key });
    if (!res.ok) { setBusy(false); setMsg(res.error); setErrors(res.fields ?? {}); return; }
    // Best-effort: a failure to save the address must never block the payment.
    if (customer && saveIt && !picked) void saveAddressAction({ type: "HOME", fullName: f.name, phone: f.phone, line1: f.line1, line2: f.line2, landmark: f.landmark, city: f.city, state: f.state, postalCode: f.postalCode, country: "IN", makeDefault: addresses.length === 0 }).catch(() => {});
    if (!(await loadRazorpay()) || !window.Razorpay) { setBusy(false); setMsg("Could not load the payment window. Check your connection and try again."); return; }

    const rz = new window.Razorpay({
      key: res.razorpay.keyId, amount: res.razorpay.amount, currency: res.razorpay.currency, order_id: res.razorpay.orderId,
      name: "Ikonix Perfumer", description: `Order ${res.orderNumber}`, prefill: res.prefill, theme: { color: "#53443D" },
      notes: { order: res.orderNumber },
      handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        const v = await verifyPayment({ orderNumber: res.orderNumber, accessToken: res.accessToken, ...r });
        if (v.ok) { clear(); router.push(`/order/${v.orderNumber}?t=${encodeURIComponent(res.accessToken)}`); }
        else { setBusy(false); setMsg(v.error); }
      },
      modal: { ondismiss: () => { setBusy(false); setMsg("Payment window closed. Your items are held for 30 minutes; press Pay to try again."); } },
    });
    rz.on("payment.failed", (r) => { setMsg(r.error?.description ?? "Payment failed. You can try again."); setBusy(false); });
    rz.open();
  }

  if (empty) {
    return (
      <section className="mx-auto flex w-[90%] flex-col items-center py-24 text-center">
        <h1 className="font-heading text-[32px] text-taupe-600">Your cart is empty</h1>
        <Link href="/shop" className="mt-8 rounded-full bg-taupe-400 px-10 py-3 font-fancy text-[#3f342c]">Continue shopping</Link>
      </section>
    );
  }
  if (!customer && !guest) {
    return (
      <div className="mx-auto w-[92%] max-w-3xl py-10 md:py-16">
        <h1 className="mb-6 text-center font-heading text-[30px] text-taupe-600 md:text-[38px]">Checkout</h1>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="font-heading text-xl text-taupe-900">Sign in</h2>
            <p className="mt-1 font-fancy text-sm text-taupe-900">Use saved addresses, track every order and keep a wishlist.</p>
            <Link href="/login?next=/checkout" className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-taupe-400 px-6 py-3 font-fancy text-[#3f342c]">Sign in / Sign up</Link>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="font-heading text-xl text-taupe-900">Continue as guest</h2>
            <p className="mt-1 font-fancy text-sm text-taupe-900">No account needed. We&apos;ll give you a private link to track this order.</p>
            <button type="button" onClick={() => setGuest(true)} className="mt-5 inline-flex w-full items-center justify-center rounded-full border border-taupe-400 px-6 py-3 font-fancy text-[#3f342c] hover:bg-[#f4ece6]">Checkout as guest</button>
          </div>
        </div>
      </div>
    );
  }
  const fe = (k: string) => errors[k] && <p role="alert" className="mt-1 text-xs text-red-700">{errors[k]}</p>;

  return (
    <div className="mx-auto w-[92%] max-w-6xl py-8 md:py-12">
      <h1 className="mb-6 text-center font-heading text-[30px] text-taupe-600 md:text-[38px]">Checkout</h1>
      <form onSubmit={pay} className="grid gap-8 lg:grid-cols-[1fr_380px]" noValidate>
        <div className="space-y-8">
          <fieldset className="space-y-4 rounded-2xl bg-white p-5 shadow-sm md:p-6 [&>legend+*]:clear-both" disabled={busy}>
            <legend className="float-left mb-4 w-full p-0 font-heading text-xl text-taupe-900">Contact</legend>
            {!customer && <p className="font-fancy text-sm text-taupe-900">Checking out as a guest. <Link href="/login?next=/checkout" className="underline">Sign in instead</Link></p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={label} htmlFor="name">Full name</label><input id="name" autoComplete="name" required className={field} value={f.name} onChange={(e) => set("name", e.target.value)} />{fe("contact.name")}</div>
              <div><label className={label} htmlFor="phone">Mobile number</label><input id="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit number" required className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} />{fe("contact.phone")}</div>
              <div className="sm:col-span-2"><label className={label} htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required placeholder="you@example.com" className={field} value={f.email} onChange={(e) => set("email", e.target.value)} /><p className="mt-1 font-fancy text-xs text-taupe-600">We&apos;ll email your invoice and order status updates here.</p>{fe("contact.email")}</div>
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl bg-white p-5 shadow-sm md:p-6 [&>legend+*]:clear-both" disabled={busy}>
            <legend className="float-left mb-4 w-full p-0 font-heading text-xl text-taupe-900">Delivery address</legend>
            {addresses.length > 0 && (
              <div className="space-y-2" role="radiogroup" aria-label="Saved addresses">
                {addresses.map((a) => (
                  <label key={a.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 font-fancy text-sm ${picked === a.id ? "border-taupe-600 bg-[#f8f1ec]" : "border-[#e7dbd3]"}`}>
                    <input type="radio" name="saved" checked={picked === a.id} onChange={() => pick(a)} />
                    <span><b>{a.fullName}</b>{a.isDefault && <span className="ml-2 rounded-full bg-[#ecdfd6] px-2 py-0.5 text-xs">Default</span>}<br />{a.line1}, {a.city}, {a.state} {a.postalCode}</span>
                  </label>
                ))}
                <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 font-fancy text-sm ${picked === "" ? "border-taupe-600 bg-[#f8f1ec]" : "border-[#e7dbd3]"}`}><input type="radio" name="saved" checked={picked === ""} onChange={() => pick(null)} /> Use a new address</label>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <button type="button" onClick={locate} disabled={locating} className="inline-flex items-center gap-2 rounded-full border border-taupe-400 px-4 py-2 font-fancy text-sm text-taupe-900 transition hover:bg-[#faf5f2] disabled:opacity-60">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
                  {locating ? "Finding your location…" : "Use my current location"}
                </button>
              </div>
              <div><label className={label} htmlFor="pin">PIN code</label><input id="pin" inputMode="numeric" autoComplete="postal-code" maxLength={6} required className={field} value={f.postalCode} onChange={(e) => { setPinNote(null); set("postalCode", e.target.value.replace(/\D/g, "")); }} />
                {pinNote && <p role="status" className={`mt-1 font-fancy text-xs ${pinNote.tone === "ok" ? "text-[#2e7d32]" : "text-amber-800"}`}>{pinNote.text}</p>}{fe("address.postalCode")}</div>
              <div className="hidden sm:block" aria-hidden />
              <div className="sm:col-span-2"><label className={label} htmlFor="line1">Address</label><input id="line1" autoComplete="address-line1" placeholder="House no., building, street" required className={field} value={f.line1} onChange={(e) => set("line1", e.target.value)} />{fe("address.line1")}</div>
              <div><label className={label} htmlFor="line2">Area / locality <span className="font-normal text-taupe-600">(optional)</span></label><input id="line2" list="areas" autoComplete="address-line2" className={field} value={f.line2} onChange={(e) => set("line2", e.target.value)} /></div>
              <datalist id="areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
              <div><label className={label} htmlFor="landmark">Landmark <span className="font-normal text-taupe-600">(optional)</span></label><input id="landmark" className={field} value={f.landmark} onChange={(e) => set("landmark", e.target.value)} /></div>
              <div><label className={label} htmlFor="city">City</label><input id="city" autoComplete="address-level2" required className={field} value={f.city} onChange={(e) => set("city", e.target.value)} />{fe("address.city")}</div>
              <div><label className={label} htmlFor="state">State</label><select id="state" autoComplete="address-level1" required className={field} value={f.state} onChange={(e) => set("state", e.target.value)}><option value="">Select state</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select>{fe("address.state")}</div>
              {customer && !picked && <label className="flex items-center gap-2 font-fancy text-sm text-taupe-900 sm:col-span-2"><input type="checkbox" checked={saveIt} onChange={(e) => setSaveIt(e.target.checked)} /> Save this address to my account</label>}
              <div><label className={label} htmlFor="note">Delivery note <span className="font-normal text-taupe-600">(optional)</span></label><input id="note" maxLength={300} className={field} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
            </div>
            {inArea ? <p className="font-fancy text-xs text-taupe-600">{areaSummary(area)}</p> : <p role="alert" className="rounded-md bg-amber-50 p-3 font-fancy text-sm text-amber-900">{notServiceableMessage(area)}</p>}
          </fieldset>

          {/* Delivery method picker removed: the first active method is applied automatically (see methodId). */}
          {quote?.ok && quote.methods.length === 0 && <p role="alert" className="rounded-md bg-amber-50 p-3 font-fancy text-sm text-amber-900">Delivery isn’t set up yet, so orders can’t be placed right now. Please contact us at ikonixperfumer@gmail.com.</p>}
          {fe("shippingMethodId")}
        </div>

        <aside className="h-fit space-y-4 rounded-2xl bg-white p-5 shadow-sm md:p-6 lg:sticky lg:top-28">
          <h2 className="font-heading text-xl text-taupe-900">Order summary</h2>
          {loading ? <p className="font-fancy text-sm text-taupe-600">Loading…</p> : (
            <ul className="divide-y divide-[#eee3dd]">
              {view.map((l) => (
                <li key={l.variantId} className="flex justify-between gap-3 py-2.5 font-fancy text-sm"><span>{l.name} <span className="text-taupe-600">· {l.label} × {l.paidQty}{l.freeQty > 0 && ` + ${l.freeQty} free`}</span>{l.freeQty > 0 && <span className="block text-xs text-[#2e7d32]">{l.offerLabel} – you saved {inr(l.saved)}</span>}{!l.inStock && <span className="ml-1 text-red-700">(out of stock)</span>}</span><span className="font-bold">{inr(l.lineTotal)}</span></li>
              ))}
            </ul>
          )}
          {quote && !quote.ok && <p role="alert" className="rounded-md bg-red-50 p-3 font-fancy text-sm text-red-800">{quote.error} <Link href="/shop" className="underline">Back to shop</Link></p>}
          {quote?.ok && (
            <dl className="space-y-1.5 border-t border-[#eee3dd] pt-3 font-fancy text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{inr(quote.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>Delivery</dt><dd>{quote.shipping === 0 ? "Free" : inr(quote.shipping)}</dd></div>
              <div className="flex justify-between border-t border-[#eee3dd] pt-2 text-base font-bold text-ink"><dt>Total</dt><dd>{inr(quote.total)}</dd></div>
            </dl>
          )}
          {msg && <p role="alert" className="rounded-md bg-red-50 p-3 font-fancy text-sm text-red-800">{msg}</p>}
          <button type="submit" disabled={busy || !ready || loading} className="w-full rounded-md bg-taupe-900 py-3 font-fancy text-lg text-white transition hover:bg-[#44322b] disabled:cursor-not-allowed disabled:bg-gray-300">
            {busy ? "Processing…" : quote?.ok ? `Pay ${inr(quote.total)}` : "Pay"}
          </button>
          <p className="text-center font-fancy text-xs text-taupe-600">Secure payment by Razorpay (UPI, cards, netbanking, wallets).</p>
        </aside>
      </form>
    </div>
  );
}
