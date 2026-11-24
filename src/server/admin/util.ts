export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const pageParam = (v: string | string[] | undefined) => Math.max(1, Math.min(10_000, parseInt(one(v), 10) || 1));
export const objectIdRe = /^[a-f0-9]{24}$/;

// ── List-page helpers (filter / sort / pagination) ──
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;
/** Rows per page from ?size=, restricted to PAGE_SIZES so a URL can never ask for an unbounded page. */
export const sizeParam = (v: string | string[] | undefined, def: number = DEFAULT_PAGE_SIZE) => {
  const n = parseInt(one(v), 10);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : def;
};
/**
 * Sort from ?sort=&dir=. `fields` maps an allowed sort key to its database field: anything else falls back to the default,
 * so user input never reaches the query. `_id` is added as a tiebreaker so pages never overlap or skip rows.
 */
export function sortParam<K extends string>(sp: { sort?: string | string[]; dir?: string | string[] }, fields: Record<K, string>, def: K, defDir: "asc" | "desc" = "desc") {
  const raw = one(sp.sort);
  const key = (Object.hasOwn(fields, raw) ? raw : def) as K;
  const d = one(sp.dir);
  const dir: "asc" | "desc" = d === "asc" || d === "desc" ? d : key === def ? defDir : "asc";
  const n = dir === "asc" ? 1 : -1;
  return { key, dir, mongo: { [fields[key]]: n, _id: n } as Record<string, 1 | -1> };
}
/** Query string without empty values. */
export const qs = (o: Record<string, string | number | boolean | null | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false).map(([k, v]) => [k, String(v)])).toString();
/** YYYY-MM-DD (India time) bounds; `to` is inclusive. Invalid input is ignored. */
export function dateRange(from: string, to: string): { $gte?: Date; $lt?: Date } | undefined {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00+05:30`).getTime());
  const r: { $gte?: Date; $lt?: Date } = {};
  if (ok(from)) r.$gte = new Date(`${from}T00:00:00+05:30`);
  if (ok(to)) r.$lt = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000);
  return r.$gte || r.$lt ? r : undefined;
}
