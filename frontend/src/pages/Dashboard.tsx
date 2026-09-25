import { Link, useNavigate } from "react-router-dom";
import { BarChart } from "../components/Charts";
import { ErrorBox, Loading, LotPicker, PageHead, StatusBadge, Tile, useLot } from "../components/ui";
import { api, type BatchMeta, type Status } from "../lib/api";
import { stripId } from "./Detector";
import { useAsync, useData } from "../lib/data";
import { dateText, hours } from "../lib/format";

export function riskColor(v: number) {
  return v >= 50 ? "var(--brick)" : v >= 30 ? "var(--teal)" : "var(--navy)";
}

function Distribution({ b }: { b: BatchMeta }) {
  const parts: [Status, number][] = [
    ["PASS", b.counts.PASS],
    ["REVIEW", b.counts.REVIEW],
    ["REJECT", b.counts.REJECT],
  ];
  return (
    <div className="bar-track" style={{ height: 10, minWidth: 120 }} title={parts.map(([s, n]) => `${s} ${n}`).join(" · ")}>
      {parts.map(([s, n]) =>
        n ? <span key={s} style={{ width: `${(n / b.n) * 100}%`, background: `var(--${s.toLowerCase()})` }} /> : null
      )}
    </div>
  );
}

export default function Dashboard() {
  const { batches, model, loading, error, param } = useData();
  const [lot, setLot] = useLot();
  const nav = useNavigate();
  const detail = useAsync(() => (lot ? api.batch(lot) : Promise.resolve(null)), [lot]);

  if (loading) return <Loading height={480} />;
  if (error) return <ErrorBox error={error} />;
  const b = batches.find((x) => x.batch_id === lot);
  if (!b) return <div className="empty">No lots loaded yet. Upload burn-in data to begin.</div>;

  const flagMax = Math.max(1, ...Object.values(b.flags_by_param));
  const top = detail.data?.components
    .filter((c) => c.status !== "PASS")
    .sort((a, c) => c.risk - a.risk)
    .slice(0, 5);
  const totalParts = batches.reduce((s, x) => s + x.n, 0);
  const bt = model?.backtest;

  return (
    <>
      <PageHead
        title="Batch health"
        lede={
          <>
            {batches.length} lots, {totalParts.toLocaleString()} parts. {b.batch_id}{" "}
            {b.in_progress ? `is in the chamber, ${b.latest_hour} h into a 168 h run.` : "finished its 168 h run."} Parts
            are compared with their own lot, not only with the datasheet.
          </>
        }
        actions={<LotPicker value={lot} onChange={setLot} />}
      />

      <div className="stack stagger">
        <div className="ledger">
          <Tile
            dark
            label="Lot risk index"
            value={b.risk_index}
            unit="/ 100"
            note={b.risk_index >= 50 ? "High; escalate to the lot level" : b.risk_index >= 30 ? "Elevated; keep an eye on it" : "Normal for this product"}
          />
          <Tile label="Screening yield" value={b.yield_pct} unit="%" note={`${b.counts.PASS} of ${b.n} parts pass`} />
          <Tile
            label="Rejected · on hold"
            value={
              <span className="row" style={{ gap: 14 }}>
                <span style={{ color: "var(--brick)" }}>{b.counts.REJECT}</span>
                <span className="faint" style={{ fontSize: 22 }}>/</span>
                <span style={{ color: "var(--teal)" }}>{b.counts.REVIEW}</span>
              </span>
            }
            note="Parts needing a decision"
          />
          <Tile
            label={b.in_progress ? "Socket time saved" : "Read point"}
            value={b.in_progress ? b.socket_hours_saved.toLocaleString() : b.latest_hour}
            unit="h"
            note={
              b.in_progress
                ? `${b.early_rejects} early reject${b.early_rejects === 1 ? "" : "s"} at ${b.latest_hour} h`
                : "Burn-in complete"
            }
          />
        </div>

        <div className="grid grid-main">
          <section className="card">
            <div className="card-head">
              <h2>Risk index by lot</h2>
              <span className="small faint">Select a bar to switch lot</span>
            </div>
            <BarChart
              bars={batches.map((x) => ({
                key: x.batch_id,
                label: x.batch_id.replace(/^LOT-/, ""),
                value: x.risk_index,
                color: riskColor(x.risk_index),
                tip: (
                  <>
                    <b>{x.batch_id}</b> · {dateText(x.date)}
                    <div>
                      Risk {x.risk_index} · yield {x.yield_pct}% · {x.counts.REJECT} reject
                    </div>
                  </>
                ),
              }))}
              max={100}
              selected={lot}
              onSelect={setLot}
            />
            <div className="legend" style={{ marginTop: 12 }}>
              <span><i className="swatch" style={{ background: "var(--navy)" }} /> Healthy (&lt; 30)</span>
              <span><i className="swatch" style={{ background: "var(--teal)" }} /> Elevated (30–49)</span>
              <span><i className="swatch" style={{ background: "var(--brick)" }} /> Concern (≥ 50)</span>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Why parts were flagged</h2>
              <span className="small faint">{b.batch_id}</span>
            </div>
            <div className="stack" style={{ gap: 14 }}>
              {Object.entries(b.flags_by_param)
                .sort((a, c) => c[1] - a[1])
                .map(([k, n]) => {
                  const p = param(k);
                  return (
                    <div key={k}>
                      <div className="spread small" style={{ marginBottom: 6 }}>
                        <span>
                          <b>{p ? p.label : "Multivariate pattern"}</b>{" "}
                          <span className="faint">{p ? p.short : "Isolation Forest"}</span>
                        </span>
                        <span className="num" style={{ fontWeight: 700 }}>{n}</span>
                      </div>
                      <div className="bar-track">
                        <span
                          style={{
                            width: `${(n / flagMax) * 100}%`,
                            background: k === b.top_param ? "var(--navy)" : "var(--sky)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              <p className="note" style={{ marginTop: 0 }}>
                Each flagged part is counted once, under its main finding.
                {b.top_param && (
                  <>
                    {" "}
                    <b>{param(b.top_param)?.label ?? "Multivariate pattern"}</b> is the leading cause in this lot.
                  </>
                )}
              </p>
            </div>
          </section>
        </div>

        <div className="grid grid-main">
          <section className="card">
            <div className="card-head">
              <h2>Parts to look at first</h2>
              <Link to={`/detector?lot=${b.batch_id}`} className="btn small ghost">
                All {b.n} parts
              </Link>
            </div>
            {detail.loading && <Loading height={200} />}
            {top && top.length === 0 && <div className="empty">No flagged parts in this lot.</div>}
            <div className="stack" style={{ gap: 0 }}>
              {top?.map((c) => (
                <Link
                  key={c.component_id}
                  to={`/passport/${b.batch_id}/${c.component_id}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 14,
                    padding: "14px 0",
                    borderBottom: "1px solid var(--rule)",
                    textDecoration: "none",
                    color: "inherit",
                    alignItems: "start",
                  }}
                >
                  <span className="mono" style={{ color: "var(--navy)", fontWeight: 500, paddingTop: 1 }}>
                    {c.component_id}
                  </span>
                  <span className="small" style={{ lineHeight: 1.5 }}>
                    <StatusBadge status={c.status} />
                    <span className="muted" style={{ display: "block", marginTop: 2 }}>
                      {stripId(c.headline, c.component_id).replace(/^(rejected|flagged for review) — /, "")}
                    </span>
                  </span>
                  <span className="num mono" style={{ fontWeight: 500 }}>
                    {c.risk}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>How well the drift model predicts</h2>
            </div>
            {bt ? (
              <div className="stack" style={{ gap: 16 }}>
                <p className="small muted">
                  Each completed part was projected to 168 h from only its 0 h and 24 h readings, and the projection was then
                  checked against its real 168 h reading.
                </p>
                <dl className="kv">
                  <dt>Parts back-tested</dt>
                  <dd>{bt.parts}</dd>
                  <dt>Correct early rejects</dt>
                  <dd>{bt.true_early_rejects}</dd>
                  <dt>Good parts pulled early</dt>
                  <dd>{bt.false_early_rejects}</dd>
                  <dt>Missed until 168 h</dt>
                  <dd>{bt.missed}</dd>
                  <dt>Precision · recall</dt>
                  <dd>
                    {bt.precision !== null ? Math.round(bt.precision * 100) : "—"}% ·{" "}
                    {bt.recall !== null ? Math.round(bt.recall * 100) : "—"}%
                  </dd>
                  <dt>Socket time freed</dt>
                  <dd>{hours(bt.socket_hours_saved)}</dd>
                </dl>
                <Link to={`/drift?lot=${b.batch_id}`} className="btn small">
                  Open drift predictor
                </Link>
              </div>
            ) : (
              <div className="empty">Needs at least one lot with 168 h data.</div>
            )}
          </section>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>All lots</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th className="hide-sm">Started</th>
                  <th>Status</th>
                  <th>Pass · review · reject</th>
                  <th className="num">Yield</th>
                  <th className="num">Risk</th>
                  <th className="hide-sm">Leading cause</th>
                </tr>
              </thead>
              <tbody>
                {[...batches].reverse().map((x) => (
                  <tr
                    key={x.batch_id}
                    className="clickable"
                    onClick={() => nav(`/detector?lot=${x.batch_id}`)}
                    style={x.batch_id === lot ? { background: "#fbf8f6" } : undefined}
                  >
                    <td>
                      <span className="strong mono">{x.batch_id}</span>
                      {x.source === "upload" && <span className="pill" style={{ marginLeft: 8 }}>uploaded</span>}
                    </td>
                    <td className="hide-sm muted">{dateText(x.date)}</td>
                    <td>
                      {x.in_progress ? (
                        <span className="pill live">In chamber, {x.latest_hour} h</span>
                      ) : (
                        <span className="pill">Complete</span>
                      )}
                    </td>
                    <td>
                      <Distribution b={x} />
                      <div className="small faint num" style={{ marginTop: 4 }}>
                        {x.counts.PASS} · {x.counts.REVIEW} · {x.counts.REJECT}
                      </div>
                    </td>
                    <td className="num">{x.yield_pct}%</td>
                    <td className="num" style={{ fontWeight: 700, color: riskColor(x.risk_index) }}>
                      {x.risk_index}
                    </td>
                    <td className="hide-sm muted">
                      {x.top_param ? param(x.top_param)?.short ?? "Multivariate" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
