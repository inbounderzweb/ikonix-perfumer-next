"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTestLogin, deleteTestLogin, resetTestLoginCode, setTestLoginActive, type TestLoginResult } from "@/app/actions/admin/test-logins";
import { ClientPagination, ClientSearch, useClientTable } from "./client-table";
import { Badge, Card, Field, Notice, Table, button, inputCls } from "./ui";

export type TestLoginRow = { id: string; name: string; mobile: string; code: string; active: boolean };

export function TestLoginManager({ rows, canWrite }: { rows: TestLoginRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<TestLoginResult | null>(null);
  const [form, setForm] = useState({ name: "", mobile: "", code: "" });
  const t = useClientTable(rows, { text: (r) => `${r.name} ${r.mobile}`, sorts: { name: (a, b) => a.name.localeCompare(b.name), mobile: (a, b) => a.mobile.localeCompare(b.mobile), status: (a, b) => Number(b.active) - Number(a.active) } });
  const run = (fn: () => Promise<TestLoginResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });
  return (
    <div className="space-y-6">
      {res && (res.ok ? <Notice tone="ok">{res.message ?? "Done."}</Notice> : <Notice tone="danger">{res.error}</Notice>)}
      {canWrite && (
        <Card title="Add a test user">
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(() => createTestLogin(form), () => setForm({ name: "", mobile: "", code: "" })); }}>
            <Field label="Name" htmlFor="tl-name"><input id="tl-name" required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Mobile" htmlFor="tl-mobile"><input id="tl-mobile" required inputMode="numeric" placeholder="10-digit number" className={inputCls} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
            <Field label="Fixed OTP" htmlFor="tl-code"><input id="tl-code" required inputMode="numeric" maxLength={6} placeholder="4 digits" className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} /></Field>
            <div className="flex items-end"><button className={button("primary")} disabled={pending}>Create</button></div>
          </form>
        </Card>
      )}
      <div>
      <ClientSearch t={t} placeholder="Search name or mobile" />
      <Table head={[{ label: "Name", sort: "name" }, { label: "Mobile", sort: "mobile" }, "OTP", { label: "Status", sort: "status" }, ""]} sort={t.sort} onSort={t.onSort} empty={t.view.length ? undefined : rows.length ? "No test users match." : "No test users yet."}>
        {t.view.map((r) => (
          <tr key={r.id}>
            <td className="font-medium">{r.name}</td><td>{r.mobile}</td><td><code className="font-mono text-xs">{r.code}</code></td>
            <td><Badge tone={r.active ? "ok" : "neutral"}>{r.active ? "active" : "disabled"}</Badge></td>
            <td className="space-x-2 whitespace-nowrap">{canWrite && <>
              <button className={button("secondary", "!py-1")} disabled={pending} onClick={() => { const c = prompt(`New 6-digit OTP for ${r.mobile}`, r.code); if (c !== null) run(() => resetTestLoginCode(r.id, c.trim())); }}>Change OTP</button>
              <button className={button("secondary", "!py-1")} disabled={pending} onClick={() => run(() => setTestLoginActive(r.id, !r.active))}>{r.active ? "Disable" : "Enable"}</button>
              <button className={button("danger", "!py-1")} disabled={pending} onClick={() => { if (confirm("Permanently delete this test user and ALL their data (orders, payments, addresses, cart, sessions)? This cannot be undone.")) run(() => deleteTestLogin(r.id)); }}>Delete</button>
            </>}</td>
          </tr>
        ))}
      </Table>
      <ClientPagination t={t} />
      </div>
    </div>
  );
}
