"use server";

import { z } from "zod";
import { INDIAN_STATES } from "@/lib/india";
import { rateLimit } from "@/server/auth/rate-limit";
import { clientMeta } from "@/server/auth/request";

export type PinInfo = { ok: true; city: string; state: string; areas: string[] } | { ok: false; error: string };
export type GeoInfo = { ok: true; postalCode: string; city: string; state: string; line1: string; area: string } | { ok: false; error: string };

const ALIAS: Record<string, string> = {
  "orissa": "Odisha", "pondicherry": "Puducherry", "nct of delhi": "Delhi", "delhi ncr": "Delhi", "uttaranchal": "Uttarakhand",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu", "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "andaman and nicobar": "Andaman and Nicobar Islands",
};
/** Maps a provider's state spelling onto our list (e.g. "Jammu & Kashmir" -> "Jammu and Kashmir"); "" when unknown. */
function toState(raw: string): string {
  const k = raw.replace(/&/g, "and").replace(/\s+/g, " ").trim().toLowerCase();
  return (INDIAN_STATES as readonly string[]).find((s) => s.toLowerCase() === k) ?? ALIAS[k] ?? "";
}

/** PIN -> city/state/localities via the India Post directory. A failure just means the customer types the address. */
export async function lookupPincode(pin: string): Promise<PinInfo> {
  if (!/^[1-9]\d{5}$/.test(pin)) return { ok: false, error: "Enter a 6-digit PIN code." };
  const { ip } = await clientMeta();
  if (!(await rateLimit(`pin:${ip}`, 60, 600))) return { ok: false, error: "Too many lookups. Please fill the address manually." };
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } });
    const j = (await res.json()) as { Status?: string; PostOffice?: { Name: string; District: string; State: string }[] }[];
    const offices = j?.[0]?.Status === "Success" ? (j[0].PostOffice ?? []) : [];
    if (!offices.length) return { ok: false, error: "We couldn't find this PIN code. Please check it or fill the address manually." };
    const state = toState(offices[0].State);
    if (!state) return { ok: false, error: "Please choose your state manually." };
    return { ok: true, city: offices[0].District, state, areas: [...new Set(offices.map((o) => o.Name))].slice(0, 15) };
  } catch { return { ok: false, error: "PIN lookup is unavailable right now. Please fill the address manually." }; }
}

/** Coordinates -> address (OpenStreetMap Nominatim). Called only after the customer taps "Use my current location"; nothing is stored. */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoInfo> {
  const p = z.object({ lat: z.number().min(6).max(38), lng: z.number().min(68).max(98) }).safeParse({ lat, lng }); // roughly India's bounding box
  if (!p.success) return { ok: false, error: "Your location looks to be outside India, so we can't fill the address." };
  const { ip } = await clientMeta();
  if (!(await rateLimit(`geo:${ip}`, 10, 600))) return { ok: false, error: "Too many attempts. Please fill the address manually." };
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${p.data.lat}&lon=${p.data.lng}`, {
      headers: { "User-Agent": "ikonix-storefront/1.0", "Accept-Language": "en" }, signal: AbortSignal.timeout(7000), cache: "no-store",
    });
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    const postalCode = (a.postcode ?? "").replace(/\s/g, "");
    const state = toState(a.state ?? "");
    if (!/^[1-9]\d{5}$/.test(postalCode) || !state) return { ok: false, error: "We couldn't read an address for this spot. Please fill it manually." };
    const line1 = [a.house_number, a.road ?? a.pedestrian ?? a.neighbourhood].filter(Boolean).join(", ");
    return { ok: true, postalCode, state, city: a.city ?? a.town ?? a.city_district ?? a.state_district ?? a.county ?? a.village ?? "", line1, area: a.suburb ?? a.neighbourhood ?? a.quarter ?? "" };
  } catch { return { ok: false, error: "Location lookup is unavailable right now. Please fill the address manually." }; }
}
