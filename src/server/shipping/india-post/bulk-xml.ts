import "server-only";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeTrackingNumber } from "../../../lib/shipment-tracking";
import { parseEventTime, formatDay } from "./dates";
import { statusForEvent, type NormalizedEvent } from "./events";
import { TrackingError } from "./errors";
import { callIndiaPost } from "./http";
import type { TrackingConfig } from "./config";

export const EVENT_CODE_LE = "LE";

/** Kept for audit. Recipient name, invoice and amounts are intentionally dropped. */
const RAW_KEEP = ["ArticleNumber", "ArticleType", "BookingDate", "BookingTime", "BookingOfficeName", "BookingPIN", "DestinationOfficeName", "DestinationPIN", "EventCode", "EventDescription", "EventOfficeFaciltyID", "EventOfficeFacilityID", "EventOfficeName", "EventDate", "EventTime", "NonDelReason"];

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Parses a Latest Event file (`<LatestEventDetails><ArticleDetails>…`). Bad records are counted, not fatal. */
export function parseLatestEventXml(xml: string): { events: NormalizedEvent[]; records: number; invalid: string[] } {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new TrackingError("DATA", "The XML file declares a DTD, which is not accepted.");
  if (XMLValidator.validate(xml) !== true) throw new TrackingError("DATA", "The file is not well-formed XML.");
  const doc = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, ignoreDeclaration: true, isArray: (name) => name === "ArticleDetails" }).parse(xml) as Record<string, unknown>;
  if (!("LatestEventDetails" in doc)) throw new TrackingError("DATA", "Expected a <LatestEventDetails> file.");
  const root = doc.LatestEventDetails as { ArticleDetails?: Record<string, unknown>[] } | string;
  const rows = typeof root === "string" ? [] : (root.ArticleDetails ?? []);
  const events: NormalizedEvent[] = [];
  const invalid: string[] = [];
  rows.forEach((r, i) => {
    const trackingNumber = normalizeTrackingNumber(text(r.ArticleNumber));
    const eventCode = text(r.EventCode).toUpperCase();
    const when = parseEventTime(text(r.EventDate), text(r.EventTime), "DDMMYYYY");
    if (!trackingNumber || !eventCode || !when) { invalid.push(`Record ${i + 1}: missing or unreadable ${!trackingNumber ? "ArticleNumber" : !eventCode ? "EventCode" : "EventDate/EventTime"}`); return; }
    events.push({
      trackingNumber, eventCode, eventDescription: text(r.EventDescription).slice(0, 200), trackingStatus: statusForEvent(eventCode),
      eventAt: when.at, eventDate: when.day, eventTime: when.time, eventOffice: text(r.EventOfficeName).slice(0, 120),
      officeId: text(r.EventOfficeFaciltyID) || text(r.EventOfficeFacilityID), // the spec spells it "Facilty"
      nonDeliveryReason: text(r.NonDelReason).slice(0, 120),
      raw: Object.fromEntries(RAW_KEEP.filter((k) => text(r[k])).map((k) => [k, text(r[k]).slice(0, 200)])),
    });
  });
  return { events, records: rows.length, invalid };
}

/** GET …/BulkCustomer/download?Cust_Id&Event_Code&Event_Date. Returns null when there is no file for that day. */
export async function downloadBulkFile(c: TrackingConfig, day: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(c.bulkUrl); } catch { throw new TrackingError("CONFIG", "The bulk download URL is not valid."); }
  url.searchParams.set("Cust_Id", c.customerId);
  url.searchParams.set("Event_Code", EVENT_CODE_LE);
  url.searchParams.set("Event_Date", formatDay(day, c.eventDateFormat));
  const res = await callIndiaPost(c, url, { method: "GET" }, "CONFIG");
  if (res.status === 204) return null;
  const body = res.body.trim();
  if (!body || (!body.startsWith("<") && /no\s*file\s*found/i.test(body))) return null;
  if (!body.startsWith("<")) throw new TrackingError("DATA", "India Post answered with something other than an XML file.");
  return body;
}
