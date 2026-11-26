// India has no daylight saving: IST is always UTC+05:30. Calendar days are handled as "YYYY-MM-DD" strings.
const IST_MS = 330 * 60_000;
export const DAY_MS = 86_400_000;

export const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const dayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export const formatDay = (day: string, format: "DDMMYYYY" | "DD/MM/YYYY") => {
  const [y, m, d] = day.split("-");
  return format === "DDMMYYYY" ? `${d}${m}${y}` : `${d}/${m}/${y}`;
};

const validDay = (y: string, m: string, d: string) => {
  const day = `${y}-${m}-${d}`;
  const t = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === day ? day : null;
};

/** Reads a courier date/time as India time. Returns null for anything that is not a real date. */
export function parseEventTime(date: string, time: string, format: "DDMMYYYY" | "DD/MM/YYYY" | "DD-MM-YYYY" | "YYYY-MM-DD" | "ISO"): { at: Date; day: string; time: string | null } | null {
  const raw = date.trim();
  if (format === "ISO") {
    // An ISO value without a zone is India time.
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/);
    if (!m) return null;
    const at = new Date(`${m[1]}T${m[2] ?? "00:00"}${m[3] ?? "+05:30"}`);
    if (Number.isNaN(at.getTime()) || !validDay(m[1].slice(0, 4), m[1].slice(5, 7), m[1].slice(8))) return null;
    const local = new Date(at.getTime() + IST_MS).toISOString();
    return { at, day: local.slice(0, 10), time: m[2] ? local.slice(11, 19) : null };
  }
  let parts: RegExpMatchArray | null;
  let day: string | null = null;
  if (format === "DDMMYYYY") { parts = raw.padStart(8, "0").match(/^(\d{2})(\d{2})(\d{4})$/); if (parts) day = validDay(parts[3], parts[2], parts[1]); }
  else if (format === "YYYY-MM-DD") { parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (parts) day = validDay(parts[1], parts[2], parts[3]); }
  else { parts = raw.match(format === "DD/MM/YYYY" ? /^(\d{2})\/(\d{2})\/(\d{4})$/ : /^(\d{2})-(\d{2})-(\d{4})$/); if (parts) day = validDay(parts[3], parts[2], parts[1]); }
  if (!day) return null;
  const t = time.trim().replace(/:/g, "");
  if (!t) return { at: dayStart(day), day, time: null };
  const digits = (t.length <= 4 && time.includes(":") ? `${t.padStart(4, "0")}00` : t.padStart(6, "0")).match(/^([01]\d|2[0-3])([0-5]\d)([0-5]\d)$/);
  if (!digits) return null;
  const hms = `${digits[1]}:${digits[2]}:${digits[3]}`;
  return { at: new Date(`${day}T${hms}+05:30`), day, time: hms };
}
