export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const pageParam = (v: string | string[] | undefined) => Math.max(1, Math.min(10_000, parseInt(one(v), 10) || 1));
export const objectIdRe = /^[a-f0-9]{24}$/;
