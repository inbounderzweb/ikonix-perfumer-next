import "server-only";
import { normalizeTrackingNumber } from "../../../lib/shipment-tracking";
import { parseEventTime } from "./dates";
import { statusForEvent, type NormalizedEvent } from "./events";
import { TrackingError } from "./errors";
import { callIndiaPost } from "./http";
import type { TrackingConfig } from "./config";

// CEPT publishes only the URL of the Article Tracking API ("Input and output are in JSON"). Nothing about the request
// or response is assumed here: both come from the configuration, filled in from the document CEPT gives your account.

const at = (obj: unknown, path: string): unknown => (path ? path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj) : obj);
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

export function buildArticleRequest(c: TrackingConfig, trackingNumber: string): { url: URL; method: "GET" | "POST"; body?: string; contentType?: string } {
  if (!/^[A-Z0-9]{8,20}$/.test(trackingNumber)) throw new TrackingError("DATA", "The consignment number has unexpected characters.");
  const fill = (s: string, enc: (v: string) => string) => s.replaceAll("{{trackingNumber}}", enc(trackingNumber)).replaceAll("{{customerId}}", enc(c.customerId));
  let url: URL;
  try { url = new URL(c.articleUrl); } catch { throw new TrackingError("CONFIG", "The article tracking URL is not valid."); }
  if (c.articleMethod === "GET") {
    for (const [k, v] of new URLSearchParams(c.articleRequestTemplate.replace(/^\?/, ""))) url.searchParams.set(k, fill(v, (x) => x));
    return { url, method: "GET" };
  }
  const body = fill(c.articleRequestTemplate, (x) => JSON.stringify(x).slice(1, -1));
  try { JSON.parse(body); } catch { throw new TrackingError("CONFIG", "The request format is not valid JSON."); }
  return { url, method: "POST", body, contentType: "application/json" };
}

export function parseArticleResponse(c: TrackingConfig, trackingNumber: string, body: string): { events: NormalizedEvent[]; records: number; invalid: string[] } {
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new TrackingError("DATA", "India Post did not return JSON."); }
  const m = c.articleResponse;
  const list = at(json, m.eventsPath);
  if (!Array.isArray(list)) throw new TrackingError("DATA", "No event list at the configured response path.");
  const events: NormalizedEvent[] = [];
  const invalid: string[] = [];
  list.slice(0, 500).forEach((r, i) => {
    const number = m.numberField ? normalizeTrackingNumber(str(at(r, m.numberField))) : trackingNumber;
    if (number !== trackingNumber) return; // never attach another article's events to this shipment
    const eventCode = str(at(r, m.codeField)).toUpperCase();
    const when = parseEventTime(str(at(r, m.dateField)), m.timeField ? str(at(r, m.timeField)) : "", m.dateFormat);
    if (!eventCode || !when) { invalid.push(`Event ${i + 1}: missing or unreadable ${!eventCode ? "event code" : "event date/time"}`); return; }
    const eventOffice = m.officeField ? str(at(r, m.officeField)).slice(0, 120) : "";
    const eventDescription = m.descriptionField ? str(at(r, m.descriptionField)).slice(0, 200) : "";
    events.push({
      trackingNumber, eventCode, eventDescription, trackingStatus: statusForEvent(eventCode), eventAt: when.at, eventDate: when.day, eventTime: when.time,
      eventOffice, officeId: "", nonDeliveryReason: "",
      raw: Object.fromEntries(Object.entries({ eventCode, eventDescription, date: str(at(r, m.dateField)), time: m.timeField ? str(at(r, m.timeField)) : "", office: eventOffice }).filter(([, v]) => v)),
    });
  });
  if (!events.length && invalid.length) throw new TrackingError("DATA", `None of the events could be read. ${invalid[0]}`);
  return { events, records: events.length + invalid.length, invalid };
}

export async function fetchArticleEvents(c: TrackingConfig, trackingNumber: string) {
  const req = buildArticleRequest(c, trackingNumber);
  const res = await callIndiaPost(c, req.url, req, "DATA");
  return res.status === 204 ? { events: [] as NormalizedEvent[], records: 0, invalid: [] as string[] } : parseArticleResponse(c, trackingNumber, res.body);
}
