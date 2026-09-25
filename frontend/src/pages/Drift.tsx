import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, type Band, type RefLine, type Series } from "../components/Charts";
import { ErrorBox, Loading, LotPicker, PageHead, Tile, useLot } from "../components/ui";
import { api, type DriftRow } from "../lib/api";
import { useAsync, useData } from "../lib/data";
import { fmt, hours, pct } from "../lib/format";

export default function Drift() {
  const [lot, setLot] = useLot();
  const { batches, param, params } = useData();
  const meta = batches.find((b) => b.batch_id === lot);
  const asOfOptions = (meta?.hours ?? [0, 24]).filter((h) => h > 0 && h < 168);
  const [asOf, setAsOf] = useState(24);
  useEffect(() => {
    if (asOfOptions.length && !asOfOptions.includes(asOf)) setAsOf(asOfOptions[0]);
  }, [lot]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useAsync(() => (lot ? api.drift(lot, asOf) : Promise.resolve(null)), [lot, asOf]);
  const [sel, setSel] = useState<string | null>(null);
  const [pk, setPk] = useState<string | null>(null);
  useEffect(() => {
    const first = view.data?.components[0];
    setSel(first?.component_id ?? null);
    setPk(first?.worst_param ?? null);
  }, [view.data]);

  const detail = useAsync(
    () => (lot && sel ? api.componentDrift(lot, sel, asOf) : Promise.resolve(null)),
    [lot, sel, asOf]
  );

  const shown = useMemo(() => view.data?.components.slice(0, 10) ?? [], [view.data]);
  const complete = meta && !meta.in_progress;
  const p = param(pk) ?? params[0];

  const chart = useMemo(() => {
    const d = detail.data;
    if (!d || !p) return null;
    const pr = d.projection.params[p.key];
    if (!pr) return null;
    const pts = d.series[p.key] ?? [];
    const series: Series[] = [
      {
        id: "proj",
        label: "Projected",
        color: pr.early_reject ? "var(--brick)" : "var(--teal)",
        dashed: true,
        points: pr.curve,
      },
      {
        id: "measured",
        label: `Measured ≤ ${asOf} h`,
        color: "var(--navy)",
        markers: true,
        width: 2.5,
        points: pts.filter((x) => x.hour <= asOf),
      },
    ];
    const later = pts.filter((x) => x.hour > asOf);
    if (later.length)
      series.push({
        id: "actual",
        label: "Actual (held out)",
        color: "var(--ink-3)",
        markers: true,
        hollow: true,
        width: 1,
        points: pts.filter((x) => x.hour >= asOf),
      });
    const bands: Band[] = [
      {
        id: "env",
        label: "Safe drift envelope",
        color: "var(--sky)",
        opacity: 0.5,
        points: pr.envelope.map((e) => ({ hour: e.hour, low: e.low, high: e.high })),
      },
    ];
    const refs: RefLine[] = [];
    const top = Math.max(...pr.envelope.map((e) => e.high), pr.predicted_168);
    if (p.limit_high !== null && p.limit_high < top * 1.5) refs.push({ y: p.limit_high, label: `limit ${p.limit_high} ${p.unit}` });
    if (p.limit_low !== null && p.limit_low > pr.v0 * 0.7) refs.push({ y: p.limit_low, label: `limit ${p.limit_low} ${p.unit}` });
    return { series, bands, refs, pr };
  }, [detail.data, p, asOf]);

  const m = view.data?.model;
  return (
    <>
      <PageHead
        eyebrow="Module B"
        title="Drift predictor"
        lede={
          <>
            Projects each part's 168 h reading from its early read points using a sub-linear drift law learned from completed
            lots. If the projected shift already breaks the delta criterion, the part is pulled now, which frees its socket for
            the remaining {168 - asOf} h.
          </>
        }
        actions={
          <>
            <LotPicker value={lot} onChange={setLot} />
            {asOfOptions.length > 1 && (
              <div className="seg" aria-label="Predict from">
                {asOfOptions.map((h) => (
                  <button key={h} className={h === asOf ? "on" : ""} onClick={() => setAsOf(h)}>
                    From {h} h
                  </button>
                ))}
              </div>
            )}
          </>
        }
      />
      {view.error && <ErrorBox error={view.error} />}
      {view.loading && !view.data && <Loading height={480} />}
      {view.data && (
        <div className="stack">
          <div className="grid grid-4">
            <Tile dark label="Early rejects" value={view.data.early_rejects} note={`Decided at ${asOf} h`} />
            <Tile label="Socket time freed" value={view.data.socket_hours_saved.toLocaleString()} unit="h" note={`${168 - asOf} h per pulled part`} />
            <Tile
              label="Back-test precision"
              value={m?.backtest.precision != null ? Math.round(m.backtest.precision * 100) : "—"}
              unit="%"
              note={`${m?.backtest.true_early_rejects ?? 0} of ${(m?.backtest.true_early_rejects ?? 0) + (m?.backtest.false_early_rejects ?? 0)} early rejects failed at 168 h`}
            />
            <Tile
              label="Back-test recall"
              value={m?.backtest.recall != null ? Math.round(m.backtest.recall * 100) : "—"}
              unit="%"
              note={`of 168 h failures caught at 24 h (${m?.backtest.parts ?? 0} parts)`}
            />
          </div>

          <div className="grid grid-main">
            <section className="card">
              <div className="card-head">
                <h2>{sel ?? "—"}</h2>
                <div className="seg">
                  {params.map((x) => (
                    <button key={x.key} className={x.key === p?.key ? "on" : ""} onClick={() => setPk(x.key)}>
                      {x.short}
                    </button>
                  ))}
                </div>
              </div>
              {detail.loading && !chart && <Loading height={300} />}
              {chart && p && (
                <>
                  <LineChart
                    series={chart.series}
                    bands={chart.bands}
                    refs={chart.refs}
                    format={(v) => fmt(p, v, false)}
                    vline={{ x: asOf, label: `decide at ${asOf} h` }}
                    height={300}
                    xTicks={[0, 24, 48, 96, 168]}
                  />
                  <div className="legend" style={{ marginTop: 14 }}>
                    <span><i className="swatch line" style={{ background: "var(--navy)", height: 3 }} /> Measured</span>
                    <span style={{ color: chart.pr.early_reject ? "var(--brick)" : "var(--teal)" }}>
                      <i className="swatch dash" /> <span className="muted">Projection</span>
                    </span>
                    <span><i className="swatch" style={{ background: "var(--sky)" }} /> Safe envelope (allowed drift)</span>
                    {chart.series.some((s) => s.id === "actual") && (
                      <span><i className="swatch" style={{ border: "2px solid var(--ink-3)", borderRadius: 6, background: "var(--white)" }} /> Actual, not used</span>
                    )}
                  </div>
                  <div className={`notice${chart.pr.early_reject ? " warn" : ""}`} style={{ marginTop: 16 }}>
                    {p.label} projected to <b>{fmt(p, chart.pr.predicted_168)}</b> at 168 h ({pct(chart.pr.predicted_shift_pct)}{" "}
                    from 0 h; allowed ±{fmt(p, chart.pr.allowed_shift)}).{" "}
                    {chart.pr.early_reject
                      ? `Outside the envelope: reject at ${asOf} h.`
                      : chart.pr.watch
                        ? "Inside, but using more than 70% of the allowance: watch."
                        : "Comfortably inside the envelope."}
                    {chart.pr.actual_168 !== null && (
                      <>
                        {" "}
                        Actual 168 h reading: <b>{fmt(p, chart.pr.actual_168)}</b>.
                      </>
                    )}
                  </div>
                </>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Steepest drifters</h2>
                <span className="small faint">share of allowed drift</span>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                {shown.map((r) => (
                  <DriftItem
                    key={r.component_id}
                    r={r}
                    active={r.component_id === sel}
                    label={param(r.worst_param)?.short ?? r.worst_param}
                    complete={!!complete}
                    onClick={() => {
                      setSel(r.component_id);
                      setPk(r.worst_param);
                    }}
                  />
                ))}
              </div>
              {sel && (
                <Link to={`/passport/${lot}/${sel}`} className="btn small" style={{ marginTop: 16 }}>
                  Open {sel} passport
                </Link>
              )}
            </section>
          </div>

          {m && (
            <section className="card">
              <div className="card-head">
                <h2>How the model works</h2>
              </div>
              <div className="grid grid-2" style={{ gap: 28 }}>
                <p className="small muted" style={{ lineHeight: 1.7 }}>
                  Each parameter follows <b>f(v(t)) = f(v₀) + a·(t / 24)ⁿ</b>. Leakage currents are modelled in log space
                  because they drift multiplicatively. The exponent <b>n</b> is learned from every completed lot; the rate{" "}
                  <b>a</b> is fitted per part from its own read points. The safe envelope is the steepest path that still ends
                  inside the MIL-PRF-19500-style delta limit at 168 h. Back-testing on {m.backtest.parts} completed parts freed{" "}
                  {hours(m.backtest.socket_hours_saved)} of socket time.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th className="num">Learned n</th>
                        <th className="num">Median error @168 h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params.map((x) => (
                        <tr key={x.key}>
                          <td>{x.short}</td>
                          <td className="num">{m.exponents[x.key]?.toFixed(2)}</td>
                          <td className="num">{m.backtest.median_abs_pct_error[x.key]?.toFixed(1) ?? "—"}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function DriftItem({
  r,
  active,
  label,
  complete,
  onClick,
}: {
  r: DriftRow;
  active: boolean;
  label: string;
  complete: boolean;
  onClick: () => void;
}) {
  const ratio = Math.min(r.worst_ratio, 2);
  const color = r.early_reject ? "var(--brick)" : r.watch ? "var(--teal)" : "var(--navy)";
  return (
    <button
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "64px 1fr 52px",
        alignItems: "center",
        gap: 12,
        padding: "8px 10px",
        border: 0,
        borderRadius: 10,
        background: active ? "var(--beige)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span>
        <b style={{ color: "var(--navy)", fontSize: 14 }}>{r.component_id}</b>
        <div className="small faint">{label}</div>
      </span>
      <span style={{ position: "relative", height: 8, background: "var(--beige-deep)", borderRadius: 4 }}>
        <span style={{ position: "absolute", inset: 0, width: `${(ratio / 2) * 100}%`, background: color, borderRadius: 4 }} />
        <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 2, background: "var(--ink)" }} title="100% of allowance" />
      </span>
      <span className="num small" style={{ textAlign: "right", fontWeight: 700, color }}>
        {Math.round(r.worst_ratio * 100)}%
        {complete && r.actual_fail !== null && (
          <div className="faint" style={{ fontWeight: 500, fontSize: 11 }}>{r.actual_fail ? "failed" : "held"}</div>
        )}
      </span>
    </button>
  );
}
