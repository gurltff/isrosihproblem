import type { Param, Status } from "./api";

export function fmt(p: Param | undefined, v: number | null | undefined, withUnit = true): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  let s: string;
  if (p?.key === "vth_V") s = v.toFixed(3);
  else if (Math.abs(v) >= 100) s = v.toFixed(0);
  else if (Math.abs(v) >= 10) s = v.toFixed(1);
  else s = v.toFixed(2);
  return withUnit && p ? `${s} ${p.unit}` : s;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function limitText(p: Param): string {
  if (p.limit_low !== null && p.limit_high !== null) return `${p.limit_low}–${p.limit_high} ${p.unit}`;
  if (p.limit_high !== null) return `≤ ${p.limit_high} ${p.unit}`;
  if (p.limit_low !== null) return `≥ ${p.limit_low} ${p.unit}`;
  return "—";
}

export function deltaText(p: Param): string {
  return `±${Math.round(p.delta_rel * 100)}% (min ${p.delta_abs} ${p.unit})`;
}

export const STATUS_LABEL: Record<Status, string> = {
  PASS: "Pass",
  REVIEW: "Review",
  REJECT: "Reject",
};

export function hours(n: number): string {
  return `${n.toLocaleString()} h`;
}

export function dateText(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
