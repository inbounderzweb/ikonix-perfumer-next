"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeOwnPassword, createStaff, resetStaffPassword, setCustomerStatus, setStaffRoles, setStaffStatus, type PeopleResult } from "@/app/actions/admin/people";
import { Badge, Card, Field, Notice, button, inputCls } from "./ui";
import { ROLES, ROLE_KEYS } from "@/server/auth/permissions";

function Result({ r }: { r: PeopleResult | null }) {
  if (!r) return null;
  if (!r.ok) return <Notice tone="danger">{r.error}</Notice>;
  return (
    <Notice tone="ok">
      {r.message ?? "Done."}
      {r.password && <span className="mt-2 flex items-center gap-2"><code className="select-all rounded bg-a-raised px-2 py-1 font-mono text-xs">{r.password}</code><button type="button" className="underline" onClick={() => navigator.clipboard?.writeText(r.password!)}>Copy</button><span className="text-xs">Shown once.</span></span>}
    </Notice>
  );
}

export function CustomerActions({ id, status, canWrite }: { id: string; status: string; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<PeopleResult | null>(null);
  if (!canWrite || status === "DELETED") return null;
  const suspended = status === "SUSPENDED";
  return (
    <div className="space-y-1">
      <button className={button(suspended ? "secondary" : "danger", "!py-1")} disabled={pending}
        onClick={() => { if (!suspended && !confirm("Suspend this customer? They will be signed out everywhere.")) return; start(async () => { const r = await setCustomerStatus(id, suspended ? "ACTIVE" : "SUSPENDED"); setRes(r); if (r.ok) router.refresh(); }); }}>
        {suspended ? "Reactivate" : "Suspend"}
      </button>
      {res && !res.ok && <p role="alert" className="text-xs text-a-danger">{res.error}</p>}
    </div>
  );
}

export type StaffRow = { id: string; name: string; email: string; roles: string[]; status: string; lastLoginAt: string | null; isOwner: boolean; isSelf: boolean };

export function StaffManager({ staff }: { staff: StaffRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<PeopleResult | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "SUPPORT_STAFF" });
  const run = (fn: () => Promise<PeopleResult>) => start(async () => { const r = await fn(); setRes(r); if (r.ok) router.refresh(); });

  return (
    <div className="space-y-5">
      <Result r={res} />
      <Card title="Add staff member">
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await createStaff(form); if (r.ok) setForm({ name: "", email: "", role: "SUPPORT_STAFF" }); return r; }); }}>
          <Field label="Name"><input className={inputCls} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" className={inputCls} required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role"><select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLE_KEYS.map((k) => <option key={k} value={k}>{ROLES[k].name}</option>)}</select></Field>
          <div className="flex items-end"><button className={button("primary", "w-full")} disabled={pending}>Create account</button></div>
        </form>
        <p className="mt-2 text-xs text-a-muted">A strong one-time password is generated and shown once. Google sign-in never grants admin access.</p>
      </Card>

      <div className="space-y-3">
        {staff.map((s) => (
          <Card key={s.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-medium">{s.name} {s.isOwner && <Badge tone="ok">owner · .env</Badge>} {s.isSelf && <Badge>you</Badge>}</p><p className="text-sm text-a-muted">{s.email}{s.lastLoginAt && ` · last sign-in ${new Date(s.lastLoginAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`}</p></div>
              <Badge tone={s.status === "ACTIVE" ? "ok" : "danger"}>{s.status.toLowerCase()}</Badge>
            </div>
            {!s.isOwner && (
              <div className="mt-3 space-y-3">
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1" disabled={pending || s.isSelf}>
                  <legend className="sr-only">Roles</legend>
                  {ROLE_KEYS.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm" title={ROLES[k].description}>
                      <input type="checkbox" defaultChecked={s.roles.includes(k)} onChange={(e) => { const next = e.target.checked ? [...s.roles, k] : s.roles.filter((r) => r !== k); run(() => setStaffRoles(s.id, next)); }} />{ROLES[k].name}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <button className={button("secondary", "!py-1")} disabled={pending} onClick={() => { if (confirm("Generate a new password for this person? They will be signed out.")) run(() => resetStaffPassword(s.id)); }}>Reset password</button>
                  {!s.isSelf && <button className={button(s.status === "ACTIVE" ? "danger" : "secondary", "!py-1")} disabled={pending} onClick={() => run(() => setStaffStatus(s.id, s.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"))}>{s.status === "ACTIVE" ? "Suspend" : "Reactivate"}</button>}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

export function PasswordForm({ managedInEnv }: { managedInEnv: boolean }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<PeopleResult | null>(null);
  const [v, setV] = useState({ current: "", next: "" });
  if (managedInEnv) return <Notice>This is the owner account. Its password is set in <code>.env</code> (<code>ADMIN_PASSWORD</code> or <code>ADMIN_PASSWORD_HASH</code>); change it there and restart the server.</Notice>;
  return (
    <form className="max-w-sm space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await changeOwnPassword(v); setRes(r); if (r.ok) setV({ current: "", next: "" }); }); }}>
      <Result r={res} />
      <Field label="Current password" htmlFor="cur"><input id="cur" type="password" autoComplete="current-password" className={inputCls} value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} required /></Field>
      <Field label="New password" htmlFor="new" hint="At least 12 characters"><input id="new" type="password" autoComplete="new-password" minLength={12} className={inputCls} value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} required /></Field>
      <button className={button("primary")} disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
    </form>
  );
}
