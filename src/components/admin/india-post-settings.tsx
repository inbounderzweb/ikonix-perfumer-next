"use client";

import { useState } from "react";
import { detectOutboundIp, saveTrackingConfig, testTrackingConnection } from "@/app/actions/admin/tracking";
import type { TrackingConfig } from "@/server/shipping/india-post/config";
import { useTrackingAction } from "./tracking-actions";
import { Badge, Card, Field, Notice, button, inputCls } from "./ui";

type Form = Omit<TrackingConfig, "verifiedFingerprint" | "verifiedAt">;
type Status = {
  verified: boolean; verifiedAt: string | null; problems: string[]; secrets: { secret: boolean; username: boolean }; outboundIp: string | null; outboundIpAt: string | null;
  health: string; healthMessage: string; healthAt: string | null; accessRejected: boolean; lastSuccess: string | null; lastResult: string | null;
};
type NumberKey = { [K in keyof Form]: Form[K] extends number ? K : never }[keyof Form];

const NUMBERS: { key: NumberKey; label: string; hint?: string; only?: Form["mode"] }[] = [
  { key: "syncIntervalMinutes", label: "Synchronize every (minutes)", hint: "15–1440" },
  { key: "initialDelayMinutes", label: "First check after shipping (minutes)" },
  { key: "inTransitIntervalMinutes", label: "In transit: check every (minutes)", only: "ARTICLE_API" },
  { key: "outForDeliveryIntervalMinutes", label: "Out for delivery: every (minutes)", only: "ARTICLE_API" },
  { key: "attentionIntervalMinutes", label: "On hold / failed attempt: every (minutes)", only: "ARTICLE_API" },
  { key: "requestsPerMinute", label: "Requests per minute", hint: "Use the limit CEPT gives you", only: "ARTICLE_API" },
  { key: "batchSize", label: "Batch size", hint: "Shipments handled per batch" },
  { key: "maxRetries", label: "Maximum retry attempts" },
  { key: "retryBaseMinutes", label: "First retry delay (minutes)", hint: "Doubles after each failure" },
  { key: "timeoutSeconds", label: "Request timeout (seconds)" },
  { key: "backfillDays", label: "Read days before the shipping date", only: "BULK_XML" },
  { key: "settleHours", label: "Hours before a day's file is final", only: "BULK_XML" },
  { key: "maxTrackingDays", label: "Give up after (days)" },
];
const RESPONSE_FIELDS = [["eventsPath", "Path to the event list"], ["codeField", "Event code field"], ["dateField", "Event date field"], ["timeField", "Event time field"], ["descriptionField", "Description field"], ["officeField", "Office field"], ["numberField", "Article number field"]] as const;

export function IndiaPostSettings({ initial, status }: { initial: Form; status: Status }) {
  const [f, setF] = useState(initial);
  const [sample, setSample] = useState("");
  const { pending, run, res, notice } = useTrackingAction();
  const errors = res && !res.ok ? res.fields ?? {} : {};
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const bulk = f.mode === "BULK_XML";
  const text = (k: "bulkUrl" | "articleUrl" | "customerId" | "authHeaderName" | "expectedOutboundIp", label: string, hint?: string) => (
    <Field label={label} htmlFor={k} hint={hint} error={errors[k]}><input id={k} className={inputCls} value={f[k]} onChange={(e) => set(k, e.target.value)} autoComplete="off" /></Field>
  );
  const select = <K extends "mode" | "authType" | "whitelistStatus" | "eventDateFormat" | "articleMethod">(k: K, label: string, options: [Form[K], string][], hint?: string) => (
    <Field label={label} htmlFor={k} hint={hint}><select id={k} className={inputCls} value={f[k]} onChange={(e) => set(k, e.target.value as Form[K])}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
  );
  const check = (k: "enabled" | "autoUpdateOrders", label: string, hint: string) => (
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" role="switch" className="mt-0.5 h-5 w-5 accent-[var(--a-accent,#8C7367)]" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /><span><b className="font-medium">{label}</b><span className="block text-xs text-a-muted">{hint}</span></span></label>
  );
  const ipMismatch = !!(status.outboundIp && initial.expectedOutboundIp && status.outboundIp !== initial.expectedOutboundIp);

  return (
    <div className="space-y-5">
      <Card title="Status" actions={<Badge tone={status.health === "HEALTHY" ? "ok" : status.health === "DOWN" ? "danger" : "warn"}>API {status.health.toLowerCase()}</Badge>}>
        <div className="space-y-3 text-sm">
          <p>{status.healthMessage}{status.healthAt && <span className="text-a-muted"> ({status.healthAt})</span>}</p>
          <p><span className="text-a-muted">Connection test: </span>{status.verified ? <>passed {status.verifiedAt}</> : "not passed for the saved settings"}</p>
          <p><span className="text-a-muted">Last successful sync: </span>{status.lastSuccess ?? "never"}{status.lastResult && <span className="text-a-muted"> · last result: {status.lastResult}</span>}</p>
          <p><span className="text-a-muted">Public outbound IP: </span><span className="font-mono">{status.outboundIp ?? "not looked up"}</span>{status.outboundIpAt && <span className="text-a-muted"> ({status.outboundIpAt})</span>}</p>
          {ipMismatch && <Notice tone="danger">This differs from the whitelisted address ({initial.expectedOutboundIp}). India Post will refuse requests from it.</Notice>}
          {status.accessRejected && <Notice tone="danger">India Post refused the last request: the outbound IP is probably not whitelisted, or the credentials are wrong.</Notice>}
          <p className="text-xs text-a-muted">India Post only accepts a whitelisted, static address. Cloud hosting does not guarantee one: confirm it with your host. The lookup shows this web server; if the worker runs elsewhere, check that machine too.</p>
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" className={button("secondary")} disabled={pending} onClick={() => run(detectOutboundIp)}>Look up outbound IP</button>
            {initial.mode === "ARTICLE_API" && <input aria-label="Consignment number to test with" placeholder="Consignment number to test with" className={`${inputCls} !w-64`} value={sample} onChange={(e) => setSample(e.target.value)} />}
            <button type="button" className={button("secondary")} disabled={pending || dirty} onClick={() => run(() => testTrackingConnection(sample))}>Test connection</button>
            {dirty && <span className="text-xs text-a-muted">Save your changes before testing.</span>}
          </div>
          {status.problems.length > 0 && <ul className="list-disc pl-5 text-xs text-a-muted">{status.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      </Card>

      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await saveTrackingConfig(f); if (!r.ok && !r.fields) setF((p) => ({ ...p, enabled: false })); return r; }); }}>
        <Card title="Connection">
          <div className="space-y-4">
            {check("enabled", "Enable India Post tracking", "Can be switched on after a successful connection test of the saved settings.")}
            <div className="grid gap-4 md:grid-cols-2">
              {select("mode", "Integration mode", [["BULK_XML", "Official Bulk XML (Latest Event file)"], ["ARTICLE_API", "Individual Article Tracking API"]])}
              {text("customerId", "Customer ID", bulk ? "10 digits assigned by India Post for integration. A receipt may show a different number." : "Only needed if CEPT's request format uses it")}
              {bulk ? text("bulkUrl", "Bulk download URL (GET)", "The documented address uses http. Ask CEPT whether https is available.") : text("articleUrl", "Article tracking URL")}
              {bulk ? select("eventDateFormat", "Event_Date format", [["DDMMYYYY", "DDMMYYYY (CEPT's test value)"], ["DD/MM/YYYY", "DD/MM/YYYY"]], "The specification shows both; confirm during testing") : select("articleMethod", "HTTP method", [["POST", "POST (JSON body)"], ["GET", "GET (query string)"]])}
            </div>
            {!bulk && (
              <div className="space-y-4 rounded-lg border border-a-border p-3">
                <Notice tone="warn">CEPT publishes only the address of this API. Copy the request and response format from the document issued for your account. Never paste passwords or keys here.</Notice>
                <Field label={f.articleMethod === "POST" ? "Request body (JSON)" : "Query string"} htmlFor="tpl" hint="Use {{trackingNumber}} and, if needed, {{customerId}}" error={errors.articleRequestTemplate}><textarea id="tpl" rows={4} className={`${inputCls} font-mono`} value={f.articleRequestTemplate} onChange={(e) => set("articleRequestTemplate", e.target.value)} /></Field>
                <div className="grid gap-3 md:grid-cols-4">
                  {RESPONSE_FIELDS.map(([k, label]) => <Field key={k} label={label} htmlFor={k} error={errors[`articleResponse.${k}`]}><input id={k} className={inputCls} value={f.articleResponse[k]} onChange={(e) => set("articleResponse", { ...f.articleResponse, [k]: e.target.value })} /></Field>)}
                  <Field label="Date format" htmlFor="rdf"><select id="rdf" className={inputCls} value={f.articleResponse.dateFormat} onChange={(e) => set("articleResponse", { ...f.articleResponse, dateFormat: e.target.value as Form["articleResponse"]["dateFormat"] })}>{["DDMMYYYY", "DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "ISO"].map((v) => <option key={v}>{v}</option>)}</select></Field>
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card title="Authentication and network">
          <div className="grid gap-4 md:grid-cols-2">
            {select("authType", "Authentication", [["NONE", "IP whitelisting only"], ["API_KEY_HEADER", "API key header"], ["BEARER", "Bearer token"], ["BASIC", "Basic (user name and password)"]], "Choose what CEPT issued. Their published specification mentions only IP whitelisting.")}
            {f.authType === "API_KEY_HEADER" && text("authHeaderName", "Header name", "As given by CEPT")}
            {f.authType !== "NONE" && <div className="text-sm"><p className="font-medium">Secrets (server environment)</p><p>INDIA_POST_AUTH_SECRET: <Badge tone={status.secrets.secret ? "ok" : "warn"}>{status.secrets.secret ? "set" : "missing"}</Badge></p>{f.authType === "BASIC" && <p>INDIA_POST_AUTH_USERNAME: <Badge tone={status.secrets.username ? "ok" : "warn"}>{status.secrets.username ? "set" : "missing"}</Badge></p>}<p className="text-xs text-a-muted">Values are never shown or stored here.</p></div>}
            {text("expectedOutboundIp", "Static IP given to India Post")}
            {select("whitelistStatus", "IP whitelisting status", [["NOT_REQUESTED", "Not requested"], ["REQUESTED", "Requested"], ["CONFIRMED", "Confirmed by CEPT"]], "Your own record; the connection test shows whether it works")}
          </div>
        </Card>
        <Card title="Synchronization">
          <div className="space-y-4">
            {check("autoUpdateOrders", "Update order status automatically", "Out for delivery, delivery failed, delivered and returned move the order and notify the customer.")}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {NUMBERS.filter((n) => !n.only || n.only === f.mode).map((n) => <Field key={n.key} label={n.label} htmlFor={n.key} hint={n.hint} error={errors[n.key]}><input id={n.key} type="number" min={0} step={1} required className={inputCls} value={f[n.key]} onChange={(e) => set(n.key, e.target.value === "" ? ("" as never) : Number(e.target.value))} /></Field>)}
            </div>
          </div>
        </Card>
        {notice}
        <button className={button("primary")} disabled={pending}>{pending ? "Working…" : "Save settings"}</button>
      </form>
    </div>
  );
}
