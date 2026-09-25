import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LineChart, type Band, type RefLine, type Series } from "../components/Charts";
import { IconBack } from "../components/Icons";
import { ErrorBox, Loading, STATUS_COLOR, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useAsync, useData } from "../lib/data";
import { fmt, limitText, pct } from "../lib/format";

export default function Passport() {
  const { lot = "", cid = "" } = useParams();
  const { params, param } = useData();
  const { data, error, loading } = useAsync(() => api.passport(lot, cid), [lot, cid]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (data) setActive(data.primary_param ?? params[0]?.key ?? null);
  }, [data, params]);

  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Loading height={520} />;

  const p = param(active) ?? params[0];
  const series: Series[] = [];
  const bands: Band[] = [];
  const refs: RefLine[] = [];
  let vline: { x: number; label: string } | undefined;
  if (p) {
    const lotBand = data.lot_bands[p.key] ?? [];
    bands.push({
      id: "band",
      label: "Lot 10–90th percentile",
      color: "var(--sky)",
      opacity: 0.55,
      points: lotBand.map((r) => ({ hour: r.hour, low: r.p10, high: r.p90 })),
    });
    series.push({
      id: "median",
      label: "Lot median",
      color: "var(--teal)",
      dashed: true,
      points: lotBand.map((r) => ({ hour: r.hour, value: r.median })),
    });
    const proj = data.projection.params[p.key];
    const last = data.series[p.key]?.at(-1)?.hour ?? 0;
    if (proj && last < 168 && data.projection.as_of > 0) {
      series.push({
        id: "proj",
        label: "Projected",
        color: proj.early_reject ? "var(--brick)" : "var(--ink-3)",
        dashed: true,
        points: proj.curve.filter((c) => c.hour >= data.projection.as_of),
      });
      vline = { x: last, label: "now" };
    }
    series.push({
      id: "part",
      label: data.component_id,
      color: "var(--navy)",
      markers: true,
      width: 2.5,
      points: data.series[p.key] ?? [],
    });
    if (p.limit_high !== null) refs.push({ y: p.limit_high, label: `limit ${p.limit_high} ${p.unit}` });
    if (p.limit_low !== null) refs.push({ y: p.limit_low, label: `limit ${p.limit_low} ${p.unit}` });
  }
  const showLimits = (() => {
    if (!p) return false;
    const vals = (data.series[p.key] ?? []).map((s) => s.value);
    const hi = Math.max(...vals);
    const lo = Math.min(...vals);
    return (p.limit_high !== null && hi > p.limit_high * 0.6) || (p.limit_low !== null && lo < p.limit_low * 1.4);
  })();

  return (
    <>
      <div className="no-print" style={{ marginBottom: 18 }}>
        <Link to={`/detector?lot=${lot}`} className="btn small ghost">
          <IconBack size={16} /> {lot}
        </Link>
      </div>

      <div className="stack stagger">
        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto",
              gap: 24,
              padding: "28px 28px 24px",
              borderTop: `3px solid ${STATUS_COLOR[data.status]}`,
            }}
          >
            <div>
              <div className="small muted">Part passport</div>
              <h1 style={{ marginTop: 6 }}>{data.component_id}</h1>
              <div className="row small muted" style={{ marginTop: 10, gap: 8 }}>
                <span className="mono">{lot}</span>
                <span className="faint">/</span>
                <span>socket <span className="mono">{data.socket || "—"}</span></span>
                {data.serial && (
                  <>
                    <span className="faint">/</span>
                    <span className="mono">{data.serial}</span>
                  </>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <StatusBadge status={data.status} />
              <div
                style={{ fontFamily: "var(--display)", fontSize: 56, fontWeight: 700, lineHeight: 1, marginTop: 10, color: STATUS_COLOR[data.status] }}
              >
                {data.risk}
              </div>
              <div className="small faint">risk score, out of 100</div>
            </div>
          </div>
          <div style={{ padding: "0 28px 28px", display: "grid", gap: 20 }}>
            <p style={{ fontSize: 17, lineHeight: 1.55, color: "var(--navy)", maxWidth: "75ch" }}>{data.headline}</p>
            {data.reasons.length > 1 && (
              <div>
                <h3 style={{ marginBottom: 10 }}>Findings</h3>
                <ul className="reason-list">
                  {data.reasons.map((r, i) => (
                    <li key={i}>
                      <span className={`dot ${r.severity}`} />
                      <span>{r.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="notice" style={{ background: data.status === "REJECT" ? "var(--brick-soft)" : undefined, color: data.status === "REJECT" ? "var(--brick)" : undefined }}>
              <b>Recommendation.</b> {data.recommendation}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Through burn-in</h2>
            <div className="seg" role="tablist">
              {params.map((x) => (
                <button key={x.key} className={x.key === p?.key ? "on" : ""} onClick={() => setActive(x.key)}>
                  {x.short}
                </button>
              ))}
            </div>
          </div>
          {p && (
            <>
              <p className="small muted" style={{ marginBottom: 12 }}>
                {p.label} of {data.component_id} against the rest of {lot}. Screening limit {limitText(p)}.
              </p>
              <LineChart
                series={series}
                bands={bands}
                refs={showLimits ? refs : []}
                vline={vline}
                format={(v) => fmt(p, v, false)}
                height={300}
              />
              <div className="legend" style={{ marginTop: 14 }}>
                <span><i className="swatch line" style={{ background: "var(--navy)", height: 3 }} /> {data.component_id}</span>
                <span style={{ color: "var(--teal)" }}><i className="swatch dash" /> <span className="muted">Lot median</span></span>
                <span><i className="swatch" style={{ background: "var(--sky)" }} /> Lot 10–90th pct</span>
                {series.some((s) => s.id === "proj") && (
                  <span style={{ color: "var(--ink-3)" }}><i className="swatch dash" /> <span className="muted">Projection to 168 h</span></span>
                )}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Parameters</h2>
            <span className="small faint">latest reading against the lot</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th className="num">0 h</th>
                  <th className="num">Latest</th>
                  <th className="num">Lot median</th>
                  <th className="num">|z|</th>
                  <th className="num hide-sm">Proj. 168 h</th>
                  <th className="hide-sm">Limit</th>
                </tr>
              </thead>
              <tbody>
                {params.map((x) => {
                  const s = data.series[x.key] ?? [];
                  const band = data.lot_bands[x.key] ?? [];
                  const pr = data.projection.params[x.key];
                  const z = data.z[x.key] ?? 0;
                  return (
                    <tr key={x.key} className="clickable" onClick={() => setActive(x.key)}>
                      <td>
                        <div className="strong">{x.short}</div>
                        <div className="small faint">{x.label}</div>
                      </td>
                      <td className="num">{fmt(x, s[0]?.value)}</td>
                      <td className="num">{fmt(x, s.at(-1)?.value)}</td>
                      <td className="num muted">{fmt(x, band.at(-1)?.median)}</td>
                      <td
                        className="num"
                        style={{ fontWeight: 700, color: z >= 6 ? "var(--brick)" : z >= 3.5 ? "var(--teal)" : "var(--ink-3)" }}
                      >
                        {z.toFixed(1)}
                      </td>
                      <td className="num hide-sm">
                        {pr ? (
                          <>
                            {fmt(x, pr.predicted_168)}
                            <div className="small faint">{pct(pr.predicted_shift_pct)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hide-sm small muted">{limitText(x)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
