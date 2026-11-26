import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { Setting } from "@/server/models";
import { sha256 } from "@/server/auth/crypto";

// Non-secret configuration lives in the `settings` collection. Secrets stay in environment variables, like every
// other credential in this project, and are never stored in the database or sent to a browser.
export const CONFIG_KEY = "tracking.indiapost";
export const STATE_KEY = "tracking.indiapost.state";

/** Endpoints published by CEPT ("DoP Integration with Bulk Customers", v9). */
export const DOCUMENTED_BULK_URL = "http://data.cept.gov.in/customer/api/BulkCustomer/download";
export const DOCUMENTED_ARTICLE_URL = "https://api.cept.gov.in/tracking/api/values/articletracking";

export const MODES = ["BULK_XML", "ARTICLE_API"] as const;
export const AUTH_TYPES = ["NONE", "API_KEY_HEADER", "BEARER", "BASIC"] as const;
export const DATE_FORMATS = ["DDMMYYYY", "DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "ISO"] as const;
export const WHITELIST_STATUS = ["NOT_REQUESTED", "REQUESTED", "CONFIRMED"] as const;

const intIn = (min: number, max: number, def: number) => z.coerce.number().int().min(min).max(max).default(def);
const path = z.string().trim().max(120).regex(/^[A-Za-z0-9_ .\-/]*$/, "Letters, digits, spaces, dots, - _ / only").default("");

/** Extra hosts allowed besides India Post's own (e.g. a CEPT test host, or a local stub in tests). */
const extraHosts = () => (process.env.INDIA_POST_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

/** Credentials are only ever sent to these hosts, so editing the URL cannot leak them elsewhere. */
export function urlProblem(raw: string, authType: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "Enter a full URL."; }
  if (!["http:", "https:"].includes(u.protocol)) return "Use http or https.";
  if (u.username || u.password || u.hash) return "The URL must not contain credentials or a fragment.";
  const extra = extraHosts().includes(u.host.toLowerCase()) || extraHosts().includes(u.hostname.toLowerCase());
  const official = ["cept.gov.in", "indiapost.gov.in"].some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  if (!official && !extra) return "Only *.cept.gov.in and *.indiapost.gov.in are allowed (see INDIA_POST_ALLOWED_HOSTS).";
  if (authType !== "NONE" && u.protocol !== "https:" && !extra) return "Credentials can only be sent over https.";
  return null;
}

export const configSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(MODES).default("BULK_XML"),
  bulkUrl: z.string().trim().max(300).default(DOCUMENTED_BULK_URL),
  eventDateFormat: z.enum(["DDMMYYYY", "DD/MM/YYYY"]).default("DDMMYYYY"),
  articleUrl: z.string().trim().max(300).default(DOCUMENTED_ARTICLE_URL),
  articleMethod: z.enum(["GET", "POST"]).default("POST"),
  /** Exactly what CEPT documents for your account; `{{trackingNumber}}` and `{{customerId}}` are substituted. */
  articleRequestTemplate: z.string().trim().max(2000).default(""),
  articleResponse: z.object({
    eventsPath: path, numberField: path, codeField: path, descriptionField: path, dateField: path, timeField: path, officeField: path,
    dateFormat: z.enum(DATE_FORMATS).default("DDMMYYYY"),
  }).prefault({}),
  customerId: z.string().trim().max(20).default(""),
  authType: z.enum(AUTH_TYPES).default("NONE"),
  authHeaderName: z.string().trim().max(60).regex(/^[A-Za-z0-9-]*$/, "Not a valid header name").default(""),
  expectedOutboundIp: z.string().trim().max(45).default(""),
  whitelistStatus: z.enum(WHITELIST_STATUS).default("NOT_REQUESTED"),
  syncIntervalMinutes: intIn(15, 1440, 120),
  initialDelayMinutes: intIn(0, 1440, 60),
  inTransitIntervalMinutes: intIn(15, 2880, 240),
  outForDeliveryIntervalMinutes: intIn(15, 1440, 60),
  attentionIntervalMinutes: intIn(15, 2880, 180),
  batchSize: intIn(1, 1000, 100),
  requestsPerMinute: intIn(1, 600, 30),
  maxRetries: intIn(1, 10, 5),
  retryBaseMinutes: intIn(1, 120, 5),
  timeoutSeconds: intIn(5, 120, 30),
  backfillDays: intIn(0, 15, 3),
  settleHours: intIn(0, 48, 12),
  maxTrackingDays: intIn(7, 365, 60),
  autoUpdateOrders: z.boolean().default(true),
  /** Fingerprint of the connection settings that last passed a live test. */
  verifiedFingerprint: z.string().default(""),
  verifiedAt: z.coerce.date().nullable().default(null),
});
export type TrackingConfig = z.infer<typeof configSchema>;

/** Everything that changes what is sent to CEPT or how the answer is read. */
export function connectionFingerprint(c: TrackingConfig): string {
  const part = c.mode === "BULK_XML" ? [c.bulkUrl, c.eventDateFormat] : [c.articleUrl, c.articleMethod, c.articleRequestTemplate, c.articleResponse];
  return sha256(JSON.stringify([c.mode, c.customerId, c.authType, c.authHeaderName, part]));
}

export function secretsStatus() {
  return { secret: !!process.env.INDIA_POST_AUTH_SECRET, username: !!process.env.INDIA_POST_AUTH_USERNAME };
}

/** Reasons the saved settings cannot be used yet (empty = ready to test). */
export function configProblems(c: TrackingConfig): string[] {
  const out: string[] = [];
  const url = urlProblem(c.mode === "BULK_XML" ? c.bulkUrl : c.articleUrl, c.authType);
  if (url) out.push(url);
  if (c.mode === "BULK_XML" && !/^(?!0{10})\d{10}$/.test(c.customerId)) out.push("Bulk XML needs the 10-digit Customer ID that India Post assigned for integration.");
  if (c.mode === "ARTICLE_API") {
    if (!c.articleRequestTemplate.includes("{{trackingNumber}}")) out.push("Enter the request format from CEPT, with {{trackingNumber}} where the article number goes.");
    if (c.articleRequestTemplate.includes("{{customerId}}") && !/^\d{1,20}$/.test(c.customerId)) out.push("The request format uses {{customerId}}: enter the Customer ID.");
    const m = c.articleResponse;
    if (!m.codeField || !m.dateField) out.push("Map at least the event code and event date fields of the response.");
  }
  if (c.authType === "API_KEY_HEADER" && !c.authHeaderName) out.push("Enter the API key header name.");
  if (c.authType !== "NONE" && !process.env.INDIA_POST_AUTH_SECRET) out.push("Set INDIA_POST_AUTH_SECRET in the server environment.");
  if (c.authType === "BASIC" && !process.env.INDIA_POST_AUTH_USERNAME) out.push("Set INDIA_POST_AUTH_USERNAME in the server environment.");
  return out;
}

export async function getConfig(): Promise<TrackingConfig> {
  await db();
  const row = (await Setting.findById(CONFIG_KEY).lean()) as unknown as { value?: unknown } | null;
  const parsed = configSchema.safeParse(row?.value ?? {});
  if (parsed.success) return parsed.data;
  console.error("[tracking] stored configuration is invalid; tracking is off until it is saved again");
  return configSchema.parse({});
}

export async function writeConfig(c: TrackingConfig, userId: string | null) {
  await db();
  await Setting.updateOne({ _id: CONFIG_KEY }, { $set: { value: c, updatedById: userId } }, { upsert: true });
}

export type Health = { status: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "DOWN"; message: string; checkedAt: Date | null; accessRejected: boolean };
export type TrackingState = {
  nextRunAt?: Date; backoffUntil?: Date | null; consecutiveFailures?: number; lastRunAt?: Date; lastSuccessAt?: Date;
  lastResult?: { status: string; message: string; processed: number; updated: number; failed: number; at: Date };
  health?: Health; outboundIp?: string; outboundIpAt?: Date; workerSeenAt?: Date;
};

export async function getState(): Promise<TrackingState> {
  await db();
  return ((await Setting.findById(STATE_KEY).lean()) as unknown as { value?: TrackingState } | null)?.value ?? {};
}

export async function patchState(patch: Partial<TrackingState>) {
  await db();
  const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`value.${k}`, v]));
  await Setting.updateOne({ _id: STATE_KEY }, { $set: set }, { upsert: true });
}
