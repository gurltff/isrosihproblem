import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? mag * 10;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}

export interface Series {
  id: string;
  label: string;
  color: string;
  points: { hour: number; value: number }[];
  dashed?: boolean;
  markers?: boolean;
  hollow?: boolean;
  width?: number;
}

export interface Band {
  id: string;
  label: string;
  color: string;
  opacity?: number;
  points: { hour: number; low: number; high: number }[];
}

export interface RefLine {
  y: number;
  label: string;
  color?: string;
}

export function LineChart({
  series,
  bands = [],
  refs = [],
  height = 260,
  xTicks = [0, 24, 96, 168],
  xMax = 168,
  format = (v: number) => v.toFixed(2),
  xFormat = (h: number) => `${h} h`,
  vline,
}: {
  series: Series[];
  bands?: Band[];
  refs?: RefLine[];
  height?: number;
  xTicks?: number[];
  xMax?: number;
  format?: (v: number) => string;
  xFormat?: (h: number) => string;
  vline?: { x: number; label: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 12, r: 16, b: 28, l: 52 };
  const iw = Math.max(width - m.l - m.r, 10);
  const ih = height - m.t - m.b;

  const [y0, y1] = useMemo(() => {
    const vals: number[] = [];
    series.forEach((s) => s.points.forEach((p) => vals.push(p.value)));
    bands.forEach((b) => b.points.forEach((p) => vals.push(p.low, p.high)));
    refs.forEach((r) => vals.push(r.y));
    const finite = vals.filter(Number.isFinite);
    if (!finite.length) return [0, 1];
    let lo = Math.min(...finite);
    let hi = Math.max(...finite);
    if (hi === lo) {
      hi += Math.abs(hi) * 0.05 || 1;
      lo -= Math.abs(lo) * 0.05 || 1;
    }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }, [series, bands, refs]);

  const x = (h: number) => m.l + (h / xMax) * iw;
  const y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const yTicks = niceTicks(y0, y1, 4);

  const hours = useMemo(() => {
    const s = new Set<number>();
    series.forEach((se) => se.points.forEach((p) => s.add(p.hour)));
    return [...s].sort((a, b) => a - b);
  }, [series]);

  const path = (pts: { hour: number; value: number }[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.hour).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

  const bandPath = (pts: Band["points"]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.hour)},${y(p.high)}`).join("") +
    [...pts].reverse().map((p) => `L${x(p.hour)},${y(p.low)}`).join("") +
    "Z";

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const hx = ((e.clientX - rect.left - m.l) / iw) * xMax;
    let best = hours[0];
    for (const h of hours) if (Math.abs(h - hx) < Math.abs(best - hx)) best = h;
    setHover(best ?? null);
  };

  const hoverRows =
    hover === null
      ? []
      : series
          .map((s) => ({ s, p: s.points.find((p) => p.hour === hover) }))
          .filter((r): r is { s: Series; p: { hour: number; value: number } } => !!r.p);

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
              <text x={m.l - 8} y={y(t)} dy="0.35em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor="middle">
              {xFormat(t)}
            </text>
          ))}
          {bands.map((b) => (
            <path key={b.id} d={bandPath(b.points)} fill={b.color} opacity={b.opacity ?? 0.35} />
          ))}
          {refs.map((r) => (
            <g key={r.label}>
              <line
                x1={m.l}
                x2={m.l + iw}
                y1={y(r.y)}
                y2={y(r.y)}
                stroke={r.color ?? "var(--brick)"}
                strokeDasharray="4 4"
                strokeWidth={1.2}
              />
              <text x={m.l + iw} y={y(r.y) - 6} textAnchor="end" style={{ fill: r.color ?? "var(--brick)" }}>
                {r.label}
              </text>
            </g>
          ))}
          {vline && (
            <g>
              <line
                x1={x(vline.x)}
                x2={x(vline.x)}
                y1={m.t}
                y2={m.t + ih}
                stroke="var(--ink-3)"
                strokeDasharray="2 4"
              />
              <text x={x(vline.x) + 6} y={m.t + 10}>
                {vline.label}
              </text>
            </g>
          )}
          {series.map((s) => (
            <g key={s.id}>
              <path
                d={path(s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeDasharray={s.dashed ? "6 5" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {s.markers &&
                s.points.map((p) => (
                  <circle
                    key={p.hour}
                    cx={x(p.hour)}
                    cy={y(p.value)}
                    r={4.5}
                    fill={s.hollow ? "var(--white)" : s.color}
                    stroke={s.hollow ? s.color : "var(--white)"}
                    strokeWidth={2}
                  />
                ))}
            </g>
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--ink-3)" strokeWidth={1} />
          )}
          <rect
            x={m.l}
            y={m.t}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && hoverRows.length > 0 && (
        <div className="tooltip" style={{ left: x(hover), top: m.t + 8 }}>
          <b>{xFormat(hover)}</b>
          {hoverRows.map(({ s, p }) => (
            <div key={s.id} className="t-row">
              <span className="swatch" style={{ background: s.color, width: 8, height: 8 }} />
              {s.label}: <b>{format(p.value)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Bar {
  key: string;
  label: string;
  value: number;
  color: string;
  tip?: ReactNode;
}

export function BarChart({
  bars,
  height = 220,
  max,
  onSelect,
  selected,
}: {
  bars: Bar[];
  height?: number;
  max?: number;
  onSelect?: (key: string) => void;
  selected?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 20, r: 4, b: 28, l: 32 };
  const iw = Math.max(width - m.l - m.r, 10);
  const ih = height - m.t - m.b;
  const top = max ?? Math.max(1, ...bars.map((b) => b.value));
  const slot = iw / Math.max(bars.length, 1);
  const bw = Math.min(44, slot * 0.6);
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const ticks = niceTicks(0, top, 4);

  useEffect(() => setHover(null), [bars]);

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
              <text x={m.l - 8} y={y(t)} dy="0.35em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = m.l + slot * i + slot / 2;
            const h = Math.max(ih - (y(b.value) - m.t), 0);
            const r = Math.min(2, h / 2, bw / 2);
            const x0 = cx - bw / 2;
            const yt = y(b.value);
            const d = `M${x0},${m.t + ih}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + bw - r}Q${x0 + bw},${yt} ${x0 + bw},${yt + r}V${m.t + ih}Z`;
            const dim = selected && selected !== b.key;
            return (
              <g
                key={b.key}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onSelect?.(b.key)}
                style={{ cursor: onSelect ? "pointer" : undefined }}
              >
                <rect x={m.l + slot * i} y={m.t} width={slot} height={ih} fill="transparent" />
                <path d={d} fill={b.color} opacity={dim ? 0.4 : 1} style={{ transition: "opacity .2s" }} />
                <text
                  x={cx}
                  y={yt - 6}
                  textAnchor="middle"
                  style={{ fill: "var(--ink)", fontFamily: "var(--mono)", fontSize: 11 }}
                >
                  {b.value}
                </text>
                <text x={cx} y={height - 8} textAnchor="middle">
                  {b.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && bars[hover]?.tip && (
        <div className="tooltip" style={{ left: m.l + slot * hover + slot / 2, top: y(bars[hover].value) }}>
          {bars[hover].tip}
        </div>
      )}
    </div>
  );
}
