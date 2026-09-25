import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { Status } from "../lib/api";
import { defaultLot, rememberLot, useData } from "../lib/data";
import { STATUS_LABEL, dateText } from "../lib/format";

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <span className={`dot ${status}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export const STATUS_COLOR: Record<Status, string> = {
  PASS: "var(--pass)",
  REVIEW: "var(--review)",
  REJECT: "var(--reject)",
};

export function RiskMeter({ value, status }: { value: number; status: Status }) {
  return (
    <div className="risk-meter" title={`Risk score ${value} / 100`}>
      <div className="bar-track">
        <span style={{ width: `${value}%`, background: STATUS_COLOR[status] }} />
      </div>
      <span className="num mono small" style={{ width: 26, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Tile({
  label,
  value,
  unit,
  note,
  dark,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  dark?: boolean;
}) {
  return (
    <div className={`tile${dark ? " dark" : ""}`}>
      <div className="eyebrow">{label}</div>
      <div className="tile-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {note && <div className="tile-note">{note}</div>}
    </div>
  );
}

/** Selected lot, kept in the URL (?lot=) so views are shareable. */
export function useLot(): [string | undefined, (id: string) => void] {
  const { batches } = useData();
  const [sp, setSp] = useSearchParams();
  const fromUrl = sp.get("lot");
  const lot = fromUrl && batches.some((b) => b.batch_id === fromUrl) ? fromUrl : defaultLot(batches);
  const set = (id: string) => {
    rememberLot(id);
    const next = new URLSearchParams(sp);
    next.set("lot", id);
    setSp(next, { replace: true });
  };
  return [lot, set];
}

export function LotPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const { batches } = useData();
  return (
    <label className="row" style={{ gap: 8 }}>
      <span className="small muted hide-sm">Lot</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Select lot">
        {[...batches].reverse().map((b) => (
          <option key={b.batch_id} value={b.batch_id}>
            {b.batch_id} — {dateText(b.date)}
            {b.in_progress ? ` (in chamber, ${b.latest_hour} h)` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Loading({ height = 240 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-busy="true" aria-label="Loading" />;
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="notice warn">Could not load: {error}</div>;
}
