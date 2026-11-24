import "server-only";
import type { SmsProvider } from "./sms-provider";

/**
 * Generic HTTP SMS gateway (used for TheSMSBuddy and any similar Indian bulk-SMS panel).
 * Everything provider-specific lives in environment variables, so no code change is needed when you read the
 * exact request format off the provider's API page. Secrets are referenced as {{ENV_NAME}} and never logged.
 *
 *   SMS_HTTP_URL            endpoint, e.g. https://<host>/api/send   (placeholders allowed)
 *   SMS_HTTP_METHOD         GET | POST                               (default GET)
 *   SMS_HTTP_BODY_FORMAT    query | form | json                      (default query; for GET it is always query)
 *   SMS_HTTP_PARAMS         key=value pairs joined by "&", e.g.
 *                           username={{SMS_USERNAME}}&password={{SMS_PASSWORD}}&sender={{SMS_SENDER_ID}}&to={mobile10}&message={message}&templateid={{SMS_TEMPLATE_ID}}&peid={{SMS_ENTITY_ID}}
 *   SMS_HTTP_HEADERS       optional JSON object, e.g. {"Authorization":"Bearer {{SMS_API_KEY}}"}
 *   SMS_HTTP_SUCCESS_REGEX optional regex the response text must match to count as sent (default: HTTP 2xx and no "error|fail|invalid|denied" in the body)
 *   SMS_HTTP_MESSAGE_ID_REGEX optional regex whose first group captures the provider message id from the response
 *
 * Built-in placeholders: {mobile} (+919876543210), {mobile91} (919876543210), {mobile10} (9876543210), {message}, {code}, {template_id} (per-message DLT id, falls back to SMS_TEMPLATE_ID).
 */
const env = (n: string) => process.env[n]?.trim() ?? "";

function fill(template: string, vars: Record<string, string>, encode: boolean): string {
  return template
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, n: string) => (encode ? encodeURIComponent(env(n)) : env(n)))
    .replace(/\{(mobile|mobile91|mobile10|message|code|template_id)\}/g, (_, n: string) => (encode ? encodeURIComponent(vars[n]) : vars[n]));
}

export class HttpSmsProvider implements SmsProvider {
  readonly name = "http";
  readonly isMock = false;

  constructor() {
    if (!env("SMS_HTTP_URL")) throw new Error("SMS_HTTP_URL is not set (OTP_PROVIDER=http)");
    if (!env("SMS_HTTP_PARAMS") && !env("SMS_HTTP_HEADERS")) throw new Error("SMS_HTTP_PARAMS is not set (OTP_PROVIDER=http)");
  }

  async send(to: string, message: string, opts?: { templateId?: string }): Promise<{ messageId?: string }> {
    const digits = to.replace(/\D/g, "");
    const vars = { template_id: opts?.templateId || env("SMS_TEMPLATE_ID"), mobile: to, mobile91: digits.startsWith("91") ? digits : `91${digits}`, mobile10: digits.slice(-10), message, code: (message.match(/\b\d{4,8}\b/) ?? [""])[0] };
    const method = (env("SMS_HTTP_METHOD") || "GET").toUpperCase() === "POST" ? "POST" : "GET";
    const format = method === "GET" ? "query" : (env("SMS_HTTP_BODY_FORMAT") || "query").toLowerCase();
    const base = fill(env("SMS_HTTP_URL"), vars, true);
    const headers: Record<string, string> = {};
    if (env("SMS_HTTP_HEADERS")) {
      try { for (const [k, v] of Object.entries(JSON.parse(env("SMS_HTTP_HEADERS")) as Record<string, string>)) headers[k] = fill(String(v), vars, false); }
      catch { throw new Error("SMS_HTTP_HEADERS must be a JSON object"); }
    }

    let url = base; let body: string | undefined;
    const pairs = env("SMS_HTTP_PARAMS").split("&").filter(Boolean);
    if (format === "json") {
      body = JSON.stringify(Object.fromEntries(pairs.map((p) => { const i = p.indexOf("="); return [p.slice(0, i), fill(p.slice(i + 1), vars, false)]; })));
      headers["Content-Type"] ??= "application/json";
    } else {
      const qs = pairs.map((p) => { const i = p.indexOf("="); return `${p.slice(0, i)}=${fill(p.slice(i + 1), vars, true)}`; }).join("&");
      if (method === "GET") url += (url.includes("?") ? "&" : "?") + qs;
      else { body = qs; headers["Content-Type"] ??= "application/x-www-form-urlencoded"; }
    }

    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const text = (await res.text()).slice(0, 2000);
    const okRe = env("SMS_HTTP_SUCCESS_REGEX");
    const ok = res.ok && (okRe ? new RegExp(okRe, "i").test(text) : !/error|fail|invalid|denied|insufficient/i.test(text));
    // Never log the URL (it can carry credentials) or the message (it carries the code): status and a short response only.
    if (!ok) throw new Error(`SMS gateway rejected the request (HTTP ${res.status}): ${text.slice(0, 160).replace(/\s+/g, " ")}`);
    const idRe = env("SMS_HTTP_MESSAGE_ID_REGEX");
    return { messageId: idRe ? new RegExp(idRe).exec(text)?.[1] : undefined };
  }
}
