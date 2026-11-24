"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryOrderNotification } from "@/app/actions/admin/orders";
import { Badge, Card, formatDate } from "./ui";

export type NotificationRow = { id: string; channel: string; event: string; from: string | null; to: string; recipient: string; status: string; at: string; error: string | null; attempts: number };
const label = (s: string) => s.toLowerCase().replace(/_/g, " ");
const tone = (s: string) => (s === "SENT" ? "ok" : s === "FAILED" ? "danger" : "warn") as "ok" | "danger" | "warn";

export function NotificationHistory({ rows, canRetry }: { rows: NotificationRow[]; canRetry: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Notifications">
      {msg && <p className="mb-2 text-xs text-a-muted" role="status">{msg}</p>}
      {rows.length === 0 ? <p className="text-sm text-a-muted">No notifications for this order yet.</p> : (
        <ul className="divide-y divide-a-border text-sm">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{r.channel === "SMS" ? "SMS" : "Email"} · {label(r.event)}</span>
                <Badge tone={tone(r.status)}>{r.status === "SENT" ? "accepted by provider" : label(r.status)}</Badge>
              </div>
              <p className="text-xs text-a-muted">{r.from ? `${label(r.from)} → ` : ""}{label(r.to)} · to {r.recipient} · {formatDate(r.at)}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}</p>
              {r.error && <p className="text-xs text-a-danger">{r.error}</p>}
              {canRetry && r.status === "FAILED" && (
                <button type="button" disabled={pending} className="text-xs text-a-accent underline disabled:opacity-50"
                  onClick={() => start(async () => { const x = await retryOrderNotification(r.id); setMsg(x.ok ? "Sent." : x.error); router.refresh(); })}>Retry</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-a-muted">&ldquo;Accepted&rdquo; means the provider took the message; it does not confirm the inbox or phone received it.</p>
    </Card>
  );
}
