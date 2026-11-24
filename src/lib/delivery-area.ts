import { INDIAN_STATES } from "./india";

/**
 * Where the store delivers. Stored as one admin setting; used by the admin form, the checkout screen and the server.
 *  ALL_INDIA       every state and PIN
 *  STATES          only the chosen states
 *  EXCLUDE_STATES  all of India except the chosen states
 *  PINCODES        only the listed PIN codes; an entry of 3-5 digits is a prefix (e.g. 560 = all of Bengaluru)
 */
export const AREA_MODES = ["ALL_INDIA", "STATES", "EXCLUDE_STATES", "PINCODES"] as const;
export type DeliveryArea = { mode: (typeof AREA_MODES)[number]; states: string[]; pincodes: string[]; message: string };
export const DEFAULT_AREA: DeliveryArea = { mode: "ALL_INDIA", states: [], pincodes: [], message: "" };

export const parsePincodes = (raw: string): string[] => [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^\d{3,6}$/.test(s)))];
export const validStates = (s: string[]) => s.filter((x) => (INDIAN_STATES as readonly string[]).includes(x));

export function serviceable(a: DeliveryArea, state: string, pin: string): boolean {
  switch (a.mode) {
    case "ALL_INDIA": return true;
    case "STATES": return !state || a.states.includes(state);
    case "EXCLUDE_STATES": return !state || !a.states.includes(state);
    case "PINCODES": return pin.length < 6 ? true : a.pincodes.some((p) => pin.startsWith(p)); // an incomplete PIN is judged once it has 6 digits
  }
}

export function areaSummary(a: DeliveryArea): string {
  if (a.mode === "ALL_INDIA") return "We deliver all over India.";
  if (a.mode === "STATES") return `We deliver to: ${a.states.join(", ") || "no states yet"}.`;
  if (a.mode === "EXCLUDE_STATES") return `We deliver all over India except: ${a.states.join(", ") || "nowhere"}.`;
  return "We deliver to selected PIN codes only.";
}

export const notServiceableMessage = (a: DeliveryArea) => a.message || "Sorry, we don't deliver to this location yet.";
