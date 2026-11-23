// Mobile numbers are stored in E.164 (+<country><number>). India is the default; other countries plug in by extending COUNTRIES.
export const COUNTRIES: Record<string, { name: string; dial: string; national: RegExp; postal: RegExp; postalHint: string }> = {
  IN: { name: "India", dial: "+91", national: /^[6-9]\d{9}$/, postal: /^[1-9]\d{5}$/, postalHint: "6-digit PIN code" },
};

/** Returns an E.164 number or null. Accepts "9876543210", "+91 98765 43210", "09876543210", "91-9876543210". */
export function normalizeMobile(input: string, country = "IN"): string | null {
  const raw = input.trim().replace(/[\s().-]/g, "");
  if (raw.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : null;
  const c = COUNTRIES[country];
  if (!c) return null;
  const dialDigits = c.dial.slice(1);
  let n = raw.replace(/^0+/, "");
  if (n.startsWith(dialDigits) && n.length === dialDigits.length + 10) n = n.slice(dialDigits.length);
  return c.national.test(n) ? `${c.dial}${n}` : null;
}

export const maskMobile = (e164: string) => `${e164.slice(0, 3)}${"•".repeat(Math.max(0, e164.length - 7))}${e164.slice(-4)}`;

/** Only same-site relative paths are allowed as post-login destinations (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  if (!next || next.length > 200 || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}
