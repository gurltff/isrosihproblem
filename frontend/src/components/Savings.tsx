import { useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/data";

const inr = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} crore` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} lakh` : `₹${Math.round(v).toLocaleString("en-IN")}`;

function Field({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="calc-field">
      <span className="small muted">{label}</span>
      <input
        className="input mono"
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}

/** When do failures show up, and what would a shorter run save? */
export default function Savings({ partsPerLot }: { partsPerLot: number }) {
  const { data } = useAsync(() => api.burninLength(), []);
  const [lots, setLots] = useState(40);
  const [parts, setParts] = useState(partsPerLot || 64);
  const [cost, setCost] = useState(18);
  if (!data || !data.total_rejects) return null;

  const cut = data.sufficient_hour;
  const saved = Math.max(168 - cut, 0);
  const hoursYear = lots * parts * saved;
  const capacity = cut > 0 ? 168 / cut - 1 : 0;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Is 168 hours needed?</h2>
        <span className="small faint">
          {data.total_rejects} failures across {data.lots.length} completed lots
        </span>
      </div>
      <div className="grid grid-2" style={{ gap: 32 }}>
        <div>
          <p className="small muted" style={{ marginBottom: 14 }}>
            For every part that ended up rejected, the first read point at which Sentinel had already flagged it:
          </p>
          <div className="stack" style={{ gap: 12 }}>
            {data.curve.map((c) => (
              <div key={c.hour}>
                <div className="spread small" style={{ marginBottom: 5 }}>
                  <span>
                    Caught by <b className="mono">{c.hour} h</b>
                  </span>
                  <span className="mono">
                    {c.caught} / {data.total_rejects} ({Math.round((c.share ?? 0) * 100)}%)
                  </span>
                </div>
                <div className="bar-track" style={{ height: 8 }}>
                  <span style={{ width: `${(c.share ?? 0) * 100}%`, background: c.hour <= cut ? "var(--navy)" : "var(--sky)" }} />
                </div>
              </div>
            ))}
          </div>
          <p className="small" style={{ marginTop: 16, lineHeight: 1.6 }}>
            {cut < 168 ? (
              <>
                Every failure was already visible by <b>{cut} h</b>. The last {saved} h of each run found nothing new. A
                shorter run, with the full 168 h kept for lots that look risky at {cut} h, would free that time.
              </>
            ) : (
              <>Some failures only showed at 168 h, so the full run is still earning its keep.</>
            )}
          </p>
        </div>

        <div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            What stopping at {cut} h would mean in a year. Change the numbers to match your facility; the cost per socket-hour
            is an assumption (power, chamber depreciation, operator time).
          </p>
          <div className="calc">
            <Field label="Lots per year" value={lots} onChange={setLots} />
            <Field label="Parts per lot" value={parts} onChange={setParts} />
            <Field label="₹ per socket-hour" value={cost} onChange={setCost} />
          </div>
          <div className="ledger" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", marginTop: 14 }}>
            <div className="tile dark">
              <div className="eyebrow">Saved per year</div>
              <div className="tile-value" style={{ fontSize: 26 }}>{inr(hoursYear * cost)}</div>
            </div>
            <div className="tile">
              <div className="eyebrow">Socket-hours</div>
              <div className="tile-value" style={{ fontSize: 26 }}>{hoursYear.toLocaleString("en-IN")}</div>
            </div>
            <div className="tile">
              <div className="eyebrow">More lots, same chambers</div>
              <div className="tile-value" style={{ fontSize: 26 }}>+{Math.round(capacity * 100)}%</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
