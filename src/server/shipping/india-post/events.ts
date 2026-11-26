import type { TrackingStatus } from "../../../lib/shipment-tracking";

/**
 * India Post event code (v9 "Expected event Details") → application status.
 * Codes that are not listed here are kept in the history but never change a status.
 */
export const EVENT_STATUS: Readonly<Record<string, TrackingStatus>> = {
  ITEM_BOOK: "BOOKED", ITEM_PICKUP: "BOOKED",
  BAG_CLOSE: "IN_TRANSIT", BAG_DISPATCH: "IN_TRANSIT", BAG_OPEN: "IN_TRANSIT", ITEM_BAGGING: "IN_TRANSIT",
  ITEM_DISPATCH: "IN_TRANSIT", ITEM_RECEIVE: "IN_TRANSIT", TMO_RECEIVE: "IN_TRANSIT", ITEM_MISSENT: "IN_TRANSIT",
  ITEM_REDIRECT: "IN_TRANSIT", CUSTOMS_IN: "IN_TRANSIT", CUSTOM_RECEIVE: "IN_TRANSIT", CLEAR_CUSTOMS: "IN_TRANSIT",
  // "Beat Dispatch": handed to the delivery beat. Confirm this reading with CEPT during onboarding.
  BEAT_DISPATCH: "OUT_FOR_DELIVERY",
  ITEM_ONHOLD: "ON_HOLD", CUSTOM_HOLD: "ON_HOLD", CUSTOM_RETURN: "ON_HOLD",
  ITEM_NONDELIVER: "DELIVERY_ATTEMPT_FAILED",
  // BEAT_DELIVERY is deliberately absent: the spec says ITEM_DELIVERY is the delivery confirmation.
  ITEM_DELIVERY: "DELIVERED",
  ITEM_RETURN: "RETURNED",
  ITEM_CANCEL: "CANCELLED",
};
export const statusForEvent = (code: string): TrackingStatus | null => EVENT_STATUS[code.trim().toUpperCase()] ?? null;

export type NormalizedEvent = {
  trackingNumber: string; eventCode: string; eventDescription: string; trackingStatus: TrackingStatus | null;
  eventAt: Date; eventDate: string; eventTime: string | null; eventOffice: string; officeId: string;
  nonDeliveryReason: string; raw: Record<string, string>;
};
