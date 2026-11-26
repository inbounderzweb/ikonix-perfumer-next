// Client-safe shipment tracking constants (no server imports): used by models, server code and UI.

export const INDIA_POST = "INDIA_POST";
export const INDIA_POST_SITE = "https://www.indiapost.gov.in/";

/** Normalised statuses written by courier tracking. */
export const TRACKING_STATUS = [
  "PENDING_TRACKING", "BOOKED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "ON_HOLD",
  "DELIVERY_ATTEMPT_FAILED", "DELIVERED", "RETURNED", "CANCELLED",
] as const;
export type TrackingStatus = (typeof TRACKING_STATUS)[number];

/** Everything `Order.shipments[].status` may hold: the tracking statuses plus the older manual ones. */
export const SHIPMENT_STATUS = ["PENDING", "SHIPPED", "RETURNED_TO_ORIGIN", ...TRACKING_STATUS] as const;

export const SHIPMENT_STATUS_LABEL: Record<(typeof SHIPMENT_STATUS)[number], string> = {
  PENDING: "Pending", SHIPPED: "Shipped", RETURNED_TO_ORIGIN: "Returned to sender", PENDING_TRACKING: "Awaiting courier update",
  BOOKED: "Booked", IN_TRANSIT: "In transit", OUT_FOR_DELIVERY: "Out for delivery", ON_HOLD: "On hold",
  DELIVERY_ATTEMPT_FAILED: "Delivery attempt failed", DELIVERED: "Delivered", RETURNED: "Returned to sender", CANCELLED: "Cancelled",
};
export const shipmentStatusLabel = (s: string) => (SHIPMENT_STATUS_LABEL as Record<string, string>)[s] ?? s;

/** No further automatic tracking once a shipment reaches one of these. */
export const TERMINAL_TRACKING: readonly string[] = ["DELIVERED", "RETURNED", "CANCELLED"];
/** Order statuses during which a shipment is still on its way. */
export const IN_FLIGHT_ORDER = ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"] as const;

const ALIASES = new Set(["indiapost", "indianpost", "indiapostalservice", "indianpostalservice", "speedpost", "indiapostspeedpost", "speedpostindiapost", "registeredpost", "indiapostregisteredpost"]);
export const isIndiaPostCarrier = (carrier: string | null | undefined) => !!carrier && ALIASES.has(carrier.toLowerCase().replace(/[^a-z]/g, ""));
export const carrierLabel = (carrier: string) => (carrier === INDIA_POST ? "India Post" : carrier);

export const normalizeTrackingNumber = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();

/** Universal Postal Union S10 check digit (used by India Post's 13-character article numbers). */
function s10CheckDigit(serial: string): number {
  const sum = [8, 6, 4, 2, 3, 5, 9, 7].reduce((a, w, i) => a + w * Number(serial[i]), 0);
  const c = 11 - (sum % 11);
  return c === 10 ? 0 : c === 11 ? 5 : c;
}

export type ConsignmentCheck = { ok: true; value: string; warning?: string } | { ok: false; error: string };

/** Format is enforced; a check-digit mismatch is only a warning so a genuine receipt is never refused. */
export function checkConsignment(raw: string): ConsignmentCheck {
  const value = normalizeTrackingNumber(raw);
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value)) return { ok: false, error: "An India Post consignment number is 13 characters: 2 letters, 9 digits, 2 letters (for example EE123456785IN)." };
  const good = s10CheckDigit(value.slice(2, 10)) === Number(value[10]);
  return { ok: true, value, ...(good ? {} : { warning: `Please re-check ${value}: its check digit doesn't match.` }) };
}
