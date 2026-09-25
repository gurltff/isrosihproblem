import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorBox, Loading, LotPicker, PageHead, STATUS_COLOR, useLot } from "../components/ui";
import { api, type Component } from "../lib/api";
import { useAsync, useData } from "../lib/data";
import { STATUS_LABEL } from "../lib/format";

function zColor(z: number) {
  if (z >= 6) return "var(--brick)";
  if (z >= 3.5) return "var(--teal)";
  if (z >= 2) return "var(--sky)";
  return "var(--sky-soft)";
}

export default function Heatmap() {
  const [lot, setLot] = useLot();
  const nav = useNavigate();
  const { params } = useData();
  const [mode, setMode] = useState<"grid" | "matrix">("grid");
  const [sort, setSort] = useState<"id" | "risk">("id");
  const [hover, setHover] = useState<Component | null>(null);
  const { data, error, loading } = useAsync(() => (lot ? api.batch(lot) : Promise.resolve(null)), [lot]);

  const comps = useMemo(() => {
    if (!data) return [];
    const c = [...data.components];
    if (sort === "risk" || mode === "matrix") c.sort((a, b) => b.risk - a.risk);
    return c;
  }, [data, sort, mode]);

  const cols = comps.length > 64 ? 12 : 8;

  return (
    <>
      <PageHead
        title="Risk heatmap"
        lede="The whole lot on one screen. Navy parts are in family with the lot, teal ones are on hold, and red ones are rejected."
        actions={<LotPicker value={lot} onChange={setLot} />}
      />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading height={480} />}
      {data && (
        <section className="card">
          <div className="spread" style={{ marginBottom: 20, alignItems: "flex-end" }}>
            <div className="seg">
              <button className={mode === "grid" ? "on" : ""} onClick={() => setMode("grid")}>
                Risk grid
              </button>
              <button className={mode === "matrix" ? "on" : ""} onClick={() => setMode("matrix")}>
                Parameter matrix
              </button>
            </div>
            {mode === "grid" && (
              <div className="seg">
                <button className={sort === "id" ? "on" : ""} onClick={() => setSort("id")}>
                  By part
                </button>
                <button className={sort === "risk" ? "on" : ""} onClick={() => setSort("risk")}>
                  By risk
                </button>
              </div>
            )}
          </div>

          {mode === "grid" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: 6,
                  maxWidth: 720,
                }}
              >
                {comps.map((c) => (
                  <button
                    key={c.component_id}
                    onClick={() => nav(`/passport/${lot}/${c.component_id}`)}
                    onPointerEnter={() => setHover(c)}
                    onFocus={() => setHover(c)}
                    aria-label={`${c.component_id} ${STATUS_LABEL[c.status]} risk ${c.risk}`}
                    style={{
                      aspectRatio: "1",
                      border: 0,
                      borderRadius: 2,
                      transition: "transform .15s, opacity .2s",
                      cursor: "pointer",
                      background: STATUS_COLOR[c.status],
                      opacity: c.status === "PASS" ? 0.35 + (c.risk / 40) * 0.65 : 1,
                      color: "var(--white)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      padding: "6px 7px",
                      fontSize: 10,
                      fontFamily: "var(--mono)",
                      outline: hover?.component_id === c.component_id ? "2px solid var(--navy)" : undefined,
                      outlineOffset: 2,
                    }}
                  >
                    <span style={{ opacity: 0.85 }}>{c.component_id.replace(/^C-/, "")}</span>
                    <span style={{ fontSize: 13, alignSelf: "flex-end" }} className="hide-sm">
                      {c.risk}
                    </span>
                  </button>
                ))}
              </div>
              <div className="legend" style={{ marginTop: 18 }}>
                <span><i className="swatch" style={{ background: "var(--navy)" }} /> Pass (shade = risk)</span>
                <span><i className="swatch" style={{ background: "var(--teal)" }} /> Review</span>
                <span><i className="swatch" style={{ background: "var(--brick)" }} /> Reject</span>
              </div>
              <div className="notice" style={{ marginTop: 18, minHeight: 64 }}>
                {hover ? (
                  <>
                    <b>{hover.component_id}</b> · socket {hover.socket} · risk {hover.risk} — {hover.headline.replace(hover.component_id, "").replace(/^\s*/, "")}
                  </>
                ) : (
                  <span className="muted">Hover over or tap a square to see the finding. Click it to open the part's passport.</span>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="small muted" style={{ marginBottom: 14 }}>
                Each cell is the part's largest deviation from the lot median for that parameter (|robust z|, level or shift),
                sorted by risk.
              </p>
              <div className="table-wrap">
                <table style={{ borderCollapse: "separate", borderSpacing: 3, width: "auto", minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={{ border: 0 }}>Part</th>
                      {params.map((p) => (
                        <th key={p.key} style={{ border: 0, textAlign: "center" }}>
                          {p.short}
                        </th>
                      ))}
                      <th style={{ border: 0 }} className="num">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c) => (
                      <tr key={c.component_id} className="clickable" onClick={() => nav(`/passport/${lot}/${c.component_id}`)}>
                        <td style={{ border: 0, padding: "4px 12px 4px 0", fontWeight: 600, whiteSpace: "nowrap" }}>
                          <span className={`dot ${c.status}`} style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 8 }} />
                          {c.component_id}
                        </td>
                        {params.map((p) => {
                          const z = c.z[p.key] ?? 0;
                          return (
                            <td
                              key={p.key}
                              title={`${c.component_id} · ${p.short} |z| = ${z.toFixed(1)}`}
                              style={{
                                border: 0,
                                width: 76,
                                height: 26,
                                padding: 0,
                                borderRadius: 5,
                                background: zColor(z),
                                color: z >= 3.5 ? "var(--white)" : "var(--navy)",
                                textAlign: "center",
                                fontSize: 12,
                                fontWeight: 600,
                                verticalAlign: "middle",
                              }}
                              className="num"
                            >
                              {z.toFixed(1)}
                            </td>
                          );
                        })}
                        <td className="num" style={{ border: 0, padding: "4px 0 4px 12px", fontWeight: 700 }}>
                          {c.risk}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="legend" style={{ marginTop: 16 }}>
                <span><i className="swatch" style={{ background: "var(--sky-soft)" }} /> |z| &lt; 2</span>
                <span><i className="swatch" style={{ background: "var(--sky)" }} /> 2–3.5</span>
                <span><i className="swatch" style={{ background: "var(--teal)" }} /> 3.5–6 review</span>
                <span><i className="swatch" style={{ background: "var(--brick)" }} /> ≥ 6 reject</span>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
