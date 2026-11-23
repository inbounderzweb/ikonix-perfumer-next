"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAddressAction, saveAddressAction, setDefaultAddressAction } from "@/app/actions/customer/account";
import { INDIAN_STATES } from "@/lib/india";
import type { AddressDTO } from "@/server/customer/addresses";
import { useToast } from "./toast";
import { Empty, btnGhost, btnPrimary, field } from "./ui";

const blank = { id: "", type: "HOME", fullName: "", phone: "", line1: "", line2: "", landmark: "", city: "", state: "", postalCode: "", country: "IN", makeDefault: false };
type Form = typeof blank;

export function AddressManager({ initial, defaultName, defaultPhone }: { initial: AddressDTO[]; defaultName: string; defaultPhone: string }) {
  const toast = useToast(); const router = useRouter(); const [pending, start] = useTransition();
  const [form, setForm] = useState<Form | null>(null); const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => f && { ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const edit = (a: AddressDTO) => { setErrs({}); setForm({ ...blank, ...a, phone: a.phone.replace(/^\+91/, ""), makeDefault: a.isDefault }); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setErrs({});
    start(async () => {
      const { id, ...rest } = form;
      const r = await saveAddressAction({ ...rest, ...(id ? { id } : {}) });
      if (r.ok) { toast("ok", id ? "Address updated." : "Address saved."); setForm(null); router.refresh(); } else { setErrs(r.fields ?? {}); toast("err", r.error); }
    });
  };
  const E = (k: string) => (errs[k] ? <p role="alert" className="mt-1 text-xs text-red-600">{errs[k]}</p> : null);
  return (
    <div className="space-y-4">
      {!form && <button className={btnPrimary} onClick={() => { setErrs({}); setForm({ ...blank, fullName: defaultName, phone: defaultPhone.replace(/^\+91/, ""), makeDefault: initial.length === 0 }); }}>+ Add new address</button>}
      {form && (
        <form onSubmit={submit} noValidate className="grid gap-3 rounded-2xl border border-[#e7dbd3] bg-[#fbf7f4] p-4 sm:grid-cols-2">
          <div><select aria-label="Address type" className={field} value={form.type} onChange={set("type")}><option value="HOME">Home</option><option value="WORK">Office</option><option value="OTHER">Other</option></select></div>
          <div><input aria-label="Full name" placeholder="Recipient full name" className={field} value={form.fullName} onChange={set("fullName")} maxLength={80} />{E("fullName")}</div>
          <div><input aria-label="Mobile" placeholder="Mobile (10 digits)" inputMode="numeric" className={field} value={form.phone} onChange={set("phone")} maxLength={14} />{E("phone")}</div>
          <div><input aria-label="PIN code" placeholder="PIN code" inputMode="numeric" className={field} value={form.postalCode} onChange={set("postalCode")} maxLength={6} />{E("postalCode")}</div>
          <div className="sm:col-span-2"><input aria-label="Address line 1" placeholder="House no., building, street" className={field} value={form.line1} onChange={set("line1")} maxLength={150} />{E("line1")}</div>
          <div className="sm:col-span-2"><input aria-label="Address line 2" placeholder="Area, colony (optional)" className={field} value={form.line2} onChange={set("line2")} maxLength={150} /></div>
          <div><input aria-label="Landmark" placeholder="Landmark (optional)" className={field} value={form.landmark} onChange={set("landmark")} maxLength={100} /></div>
          <div><input aria-label="City" placeholder="City" className={field} value={form.city} onChange={set("city")} maxLength={80} />{E("city")}</div>
          <div><select aria-label="State" className={field} value={form.state} onChange={set("state")}><option value="">Select state</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select>{E("state")}</div>
          <label className="flex items-center gap-2 font-fancy text-sm text-[#53443D]"><input type="checkbox" checked={form.makeDefault} onChange={set("makeDefault")} /> Make this my default address</label>
          <div className="flex gap-2 sm:col-span-2"><button className={btnPrimary} disabled={pending}>{pending ? "Saving…" : form.id ? "Update address" : "Save address"}</button><button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      {initial.length === 0 && !form ? <Empty title="No saved addresses" text="Save an address to check out faster next time." /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {initial.map((a) => (
            <li key={a.id} className="rounded-2xl border border-[#e7dbd3] bg-white p-4 font-fancy text-sm text-[#3f342c]">
              <div className="mb-1 flex items-center gap-2"><span className="rounded-full bg-[#ecdfd6] px-2 py-0.5 text-xs">{a.type === "WORK" ? "Office" : a.type === "HOME" ? "Home" : "Other"}</span>{a.isDefault && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Default</span>}</div>
              <p className="font-semibold">{a.fullName}</p><p>{[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}</p><p>{a.city}, {a.state} {a.postalCode}</p><p>{a.phone}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={btnGhost} onClick={() => edit(a)}>Edit</button>
                {!a.isDefault && <button className={btnGhost} disabled={pending} onClick={() => start(async () => { const r = await setDefaultAddressAction(a.id); toast(r.ok ? "ok" : "err", r.ok ? r.message ?? "Done" : r.error); router.refresh(); })}>Set default</button>}
                <button className={`${btnGhost} text-red-700`} disabled={pending} onClick={() => { if (confirm("Delete this address?")) start(async () => { const r = await deleteAddressAction(a.id); toast(r.ok ? "ok" : "err", r.ok ? r.message ?? "Removed" : r.error); router.refresh(); }); }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
