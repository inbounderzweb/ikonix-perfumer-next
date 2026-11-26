import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, Table, button, formatDate } from "@/components/admin/ui";
import { IndiaPostSettings } from "@/components/admin/india-post-settings";
import { requireAdminPage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { AuditLog, TrackingSyncFile, TrackingSyncLog } from "@/server/models";
import { configProblems, connectionFingerprint, getConfig, getState, secretsStatus } from "@/server/shipping/india-post/config";

export const metadata: Metadata = { title: "India Post tracking" };

export default async function IndiaPostSettingsPage() {
  await requireAdminPage("tracking.configure");
  const [config, state] = await Promise.all([getConfig(), getState()]);
  await db();
  type L = { _id: unknown; integrationMode: string; trigger: string; syncStartedAt: Date; syncStatus: string; recordsProcessed: number; recordsUpdated: number; failedRecords: number; errorMessage?: string; details: string[] };
  const [logs, files, activity] = await Promise.all([
    TrackingSyncLog.find({}).sort({ syncStartedAt: -1 }).limit(30).lean() as unknown as Promise<L[]>,
    TrackingSyncFile.find({ status: { $in: ["FAILED", "RETRY"] } }).sort({ eventDate: -1 }).limit(31).lean() as unknown as Promise<{ _id: string; eventDate: string; status: string; attempts: number; lastError?: string }[]>,
    AuditLog.find({ action: { $regex: "^tracking\\." } }).sort({ createdAt: -1 }).limit(15).lean() as unknown as Promise<{ _id: unknown; action: string; createdAt: Date }[]>,
  ]);
  const { verifiedFingerprint, verifiedAt, ...form } = config;
  const verified = verifiedFingerprint === connectionFingerprint(config);
  return (
    <>
      <PageHeader title="India Post tracking" subtitle="Settings › Shipping & Delivery › India Post tracking" actions={<Link href="/admin/tracking" className={button("secondary")}>Tracking dashboard</Link>} />
      <div className="space-y-5">
        <IndiaPostSettings
          initial={form}
          status={{
            verified, verifiedAt: verified && verifiedAt ? formatDate(verifiedAt) : null, problems: configProblems(config), secrets: secretsStatus(),
            outboundIp: state.outboundIp ?? null, outboundIpAt: state.outboundIpAt ? formatDate(state.outboundIpAt) : null,
            health: state.health?.status ?? "UNKNOWN", healthMessage: state.health?.message ?? "Not checked yet.", healthAt: state.health?.checkedAt ? formatDate(state.health.checkedAt) : null, accessRejected: !!state.health?.accessRejected,
            lastSuccess: state.lastSuccessAt ? formatDate(state.lastSuccessAt) : null, lastResult: state.lastResult ? `${state.lastResult.status.toLowerCase()} · ${state.lastResult.message}` : null,
          }}
        />
        <Card title="Synchronization history">
          <Table head={["Started", "Mode", "Trigger", "Result", "Read", "Updated", "Failed", "Errors"]} empty={logs.length ? undefined : "Nothing has run yet."}>
            {logs.map((l) => (
              <tr key={String(l._id)}>
                <td className="whitespace-nowrap">{formatDate(l.syncStartedAt)}</td><td className="text-xs">{l.integrationMode === "BULK_XML" ? "Bulk XML" : "Article API"}</td><td className="text-xs">{l.trigger.toLowerCase()}</td>
                <td><Badge tone={l.syncStatus === "SUCCESS" ? "ok" : l.syncStatus === "FAILED" || l.syncStatus === "ABORTED" ? "danger" : "warn"}>{l.syncStatus.toLowerCase()}</Badge></td>
                <td>{l.recordsProcessed}</td><td>{l.recordsUpdated}</td><td>{l.failedRecords}</td>
                <td className="max-w-md text-xs text-a-muted">{l.details.length ? <details><summary className="cursor-pointer">{l.errorMessage ?? `${l.details.length} note(s)`}</summary><ul className="mt-1 space-y-0.5">{l.details.map((m, i) => <li key={i}>{m}</li>)}</ul></details> : l.errorMessage ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </Card>
        {files.length > 0 && <Card title="Days that could not be read"><ul className="space-y-1 text-sm">{files.map((f) => <li key={f._id}><b className="font-medium">{f.eventDate}</b> <Badge tone={f.status === "FAILED" ? "danger" : "warn"}>{f.status === "FAILED" ? "stopped" : "will retry"}</Badge> <span className="text-a-muted">{f.attempts} attempt(s) · {f.lastError}</span></li>)}</ul></Card>}
        <Card title="Staff activity"><ul className="space-y-1 text-sm">{activity.map((a) => <li key={String(a._id)} className="flex justify-between gap-3"><span>{a.action.replace("tracking.", "").replace(/\./g, " ")}</span><span className="text-a-muted">{formatDate(a.createdAt)}</span></li>)}{!activity.length && <li className="text-a-muted">No activity yet.</li>}</ul></Card>
      </div>
    </>
  );
}
