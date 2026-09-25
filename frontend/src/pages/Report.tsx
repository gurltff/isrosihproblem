import { ErrorBox, Loading, LotPicker, StatusBadge, useLot } from "../components/ui";
import { IconPrint } from "../components/Icons";
import { api } from "../lib/api";
import { useAsync, useData } from "../lib/data";
import { dateText, deltaText, limitText } from "../lib/format";

const cell = { border: "1px solid var(--rule-strong)", padding: "8px 10px", verticalAlign: "top" } as const;
const scroll = { overflowX: "auto", marginBottom: 24 } as const;
const head = { ...cell, background: "var(--beige)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-2)", fontWeight: 700 } as const;

export default function Report() {
  const [lot, setLot] = useLot();
  const { params, model } = useData();
  const { data, error, loading } = useAsync(() => (lot ? api.batch(lot) : Promise.resolve(null)), [lot]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="spread no-print" style={{ marginBottom: 24 }}>
        <div>
          <div className="eyebrow">Export</div>
          <h1>QA report</h1>
        </div>
        <div className="row">
          <LotPicker value={lot} onChange={setLot} />
          <button className="btn primary" onClick={() => window.print()} disabled={!data}>
            <IconPrint size={16} /> Save as PDF
          </button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading height={600} />}
      {data && (
        <article
          className="card report"
          style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(20px, 5vw, 56px)", fontSize: 13, lineHeight: 1.55 }}
        >
          <header style={{ borderBottom: "2px solid var(--navy)", paddingBottom: 16, marginBottom: 20 }}>
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="eyebrow">Burn-in screening report</div>
                <h1 style={{ fontSize: 30, marginTop: 6 }}>Lot {data.batch_id}</h1>
              </div>
              <table style={{ width: "auto", fontSize: 12 }}>
                <tbody>
                  {[
                    ["Document", `QA-BI-${data.batch_id}-R0`],
                    ["Issued", today],
                    ["Lot start", dateText(data.date)],
                    ["Read point", `${data.latest_hour} h of 168 h`],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ padding: "2px 12px 2px 0", border: 0, color: "var(--ink-3)" }}>{k}</td>
                      <td style={{ padding: "2px 0", border: 0, fontWeight: 700, textAlign: "right" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </header>

          <h3 style={{ margin: "0 0 8px" }}>1. Summary</h3>
          <div style={scroll}><table style={{ minWidth: 520 }}>
            <tbody>
              <tr>
                <td style={head}>Parts screened</td>
                <td style={head}>Pass</td>
                <td style={head}>Review</td>
                <td style={head}>Reject</td>
                <td style={head}>Yield</td>
                <td style={head}>Lot risk index</td>
              </tr>
              <tr>
                <td style={cell}>{data.n}</td>
                <td style={cell}>{data.counts.PASS}</td>
                <td style={cell}>{data.counts.REVIEW}</td>
                <td style={cell}>{data.counts.REJECT}</td>
                <td style={cell}>{data.yield_pct}%</td>
                <td style={cell}>{data.risk_index} / 100</td>
              </tr>
            </tbody>
          </table></div>
          <p style={{ marginBottom: 24 }}>
            {data.counts.REJECT} part(s) are recommended for rejection and {data.counts.REVIEW} held for engineering review.
            {data.in_progress && data.early_rejects > 0 && (
              <>
                {" "}
                {data.early_rejects} rejection(s) are early rejects from the drift projection at {data.latest_hour} h, freeing{" "}
                {data.socket_hours_saved} socket-hours.
              </>
            )}
          </p>

          <h3 style={{ margin: "0 0 8px" }}>2. Dispositions requiring action</h3>
          {data.components.filter((c) => c.status !== "PASS").length === 0 ? (
            <p style={{ marginBottom: 24 }}>None. All parts are in family with the lot.</p>
          ) : (
            <div style={scroll}><table style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={head}>Part</th>
                  <th style={head}>Socket</th>
                  <th style={head}>Disposition</th>
                  <th style={head}>Finding</th>
                  <th style={head}>Risk</th>
                </tr>
              </thead>
              <tbody>
                {data.components
                  .filter((c) => c.status !== "PASS")
                  .sort((a, b) => b.risk - a.risk)
                  .map((c) => (
                    <tr key={c.component_id} style={{ breakInside: "avoid" }}>
                      <td style={{ ...cell, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {c.component_id}
                        <div style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: 11 }}>{c.serial}</div>
                      </td>
                      <td style={cell}>{c.socket}</td>
                      <td style={cell}>
                        <StatusBadge status={c.status} />
                      </td>
                      <td style={cell}>
                        {c.reasons.map((r, i) => (
                          <div key={i} style={{ marginBottom: 4 }}>
                            {r.text}
                          </div>
                        ))}
                        <div style={{ color: "var(--ink-2)", marginTop: 4, fontStyle: "italic" }}>{c.recommendation}</div>
                      </td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{c.risk}</td>
                    </tr>
                  ))}
              </tbody>
            </table></div>
          )}

          <h3 style={{ margin: "0 0 8px" }}>3. Screening criteria</h3>
          <div style={scroll}><table style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th style={head}>Parameter</th>
                <th style={head}>Screening limit</th>
                <th style={head}>Allowed shift over burn-in</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.key}>
                  <td style={cell}>
                    {p.label} ({p.short})
                  </td>
                  <td style={cell}>{limitText(p)}</td>
                  <td style={cell}>{deltaText(p)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>

          <h3 style={{ margin: "0 0 8px" }}>4. Method</h3>
          <p style={{ marginBottom: 8 }}>
            Parts are compared with their own lot using robust z-scores (median and MAD) on each parameter's level and its shift
            since 0 h; |z| ≥ 3.5 triggers review and |z| ≥ 6 rejection. An Isolation Forest over all features flags parts
            that are moderately unusual in several parameters at once. Hard screening limits and delta criteria apply on top.
          </p>
          <p style={{ marginBottom: 28 }}>
            End-of-test values are projected with a power-law drift model (exponents{" "}
            {params.map((p) => `${p.short} n=${model?.exponents[p.key]?.toFixed(2) ?? "–"}`).join(", ")}), learned from
            completed lots. Statistical flags are decision support; final disposition rests with the signatories below.
          </p>

          <div className="grid grid-2" style={{ gap: 32, breakInside: "avoid" }}>
            {["Prepared by (QA inspector)", "Approved by (Mission assurance)"].map((r) => (
              <div key={r}>
                <div style={{ borderBottom: "1px solid var(--navy)", height: 44 }} />
                <div className="small" style={{ marginTop: 6 }}>
                  {r}
                </div>
                <div className="small faint">Name · Signature · Date</div>
              </div>
            ))}
          </div>
          <footer className="small faint" style={{ marginTop: 28, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
            Generated by Sentinel automated screening · {today} · QA-BI-{data.batch_id}-R0
          </footer>
        </article>
      )}
    </>
  );
}
