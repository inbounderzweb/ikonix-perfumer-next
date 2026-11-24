// Dependency-free SVG charts for the admin dashboard. Rendered on the server; hovering a point or bar shows its value.
export type Point = { label: string; value: number };

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)); const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/** Area/line or bar trend over time. `format` renders a value for axis and tooltips. */
export function TrendChart({ data, kind = "area", format = (n) => String(n), label }: { data: Point[]; kind?: "area" | "bar"; format?: (n: number) => string; label: string }) {
  const W = 640, H = 220, L = 52, R = 12, T = 12, B = 28;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const iw = W - L - R, ih = H - T - B, n = data.length;
  const x = (i: number) => L + (kind === "bar" ? (i + 0.5) * (iw / n) : n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => T + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / 7));
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const bw = Math.max(2, (iw / n) * 0.7);
  const empty = data.every((d) => d.value === 0);
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full text-a-accent">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-a-border" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-a-muted" fontSize={10}>{format(Math.round(t))}</text>
          </g>
        ))}
        {kind === "area" ? (
          <>
            <path d={`${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`} fill="currentColor" opacity={0.12} />
            <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={n > 40 ? 2 : 3} fill="currentColor"><title>{`${d.label}: ${format(d.value)}`}</title></circle>)}
          </>
        ) : data.map((d, i) => <rect key={i} x={x(i) - bw / 2} y={y(d.value)} width={bw} height={Math.max(0, y(0) - y(d.value))} rx={2} fill="currentColor"><title>{`${d.label}: ${format(d.value)}`}</title></rect>)}
        {data.map((d, i) => i % every === 0 && <text key={`x${i}`} x={x(i)} y={H - 8} textAnchor="middle" className="fill-a-muted" fontSize={10}>{d.label}</text>)}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-a-muted" fontSize={13}>No data in this period</text>}
      </svg>
    </figure>
  );
}

/** Horizontal bars with a label and value, widest = 100%. */
export function BarList({ rows, format = (n) => String(n) }: { rows: { label: string; value: number; note?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-a-muted">Nothing to show yet.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm"><span className="truncate">{r.label}</span><span className="shrink-0 font-medium">{format(r.value)}{r.note && <span className="ml-1 text-xs font-normal text-a-muted">{r.note}</span>}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-a-raised"><div className="h-full rounded-full bg-a-accent" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
