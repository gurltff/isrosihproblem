import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorBox, Loading, LotPicker, PageHead, STATUS_COLOR, StatusBadge, useLot } from "../components/ui";
import { api, type Component } from "../lib/api";
import { useAsync, useData } from "../lib/data";
import { fmt } from "../lib/format";

const SOCKET_RE = /^([A-Za-z])\s*(\d+)$/;

/** Arrange parts on a board: by their socket label when present, otherwise in order. */
function layout(comps: Component[]) {
  const parsed = comps.map((c) => {
    const m = SOCKET_RE.exec(c.socket.trim());
    return m ? { c, r: m[1].toUpperCase().charCodeAt(0) - 65, col: parseInt(m[2], 10) - 1 } : null;
  });
  if (parsed.every(Boolean)) {
    const cells = parsed as { c: Component; r: number; col: number }[];
    const rows = Math.max(...cells.map((x) => x.r)) + 1;
    const cols = Math.max(...cells.map((x) => x.col)) + 1;
    return { rows, cols, cells };
  }
  const cols = Math.ceil(Math.sqrt(comps.length));
  return {
    rows: Math.ceil(comps.length / cols),
    cols,
    cells: comps.map((c, i) => ({ c, r: Math.floor(i / cols), col: i % cols })),
  };
}

export default function Chamber() {
  const [lot, setLot] = useLot();
  const nav = useNavigate();
  const { param } = useData();
  const [sel, setSel] = useState<Component | null>(null);
  const { data, error, loading } = useAsync(() => (lot ? api.batch(lot) : Promise.resolve(null)), [lot]);
  const board = useMemo(() => (data ? layout(data.components) : null), [data]);

  const progress = data ? Math.min(data.latest_hour / 168, 1) : 0;

  return (
    <>
      <PageHead
        title="Chamber view"
        lede="Board 1 as it sits in the oven, laid out socket by socket. Pick a socket to see the part in it."
        actions={<LotPicker value={lot} onChange={setLot} />}
      />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading height={520} />}
      {data && board && (
        <div className="grid grid-main">
          <section
            className="card"
            style={{ background: "var(--navy)", color: "var(--sky)", padding: "clamp(16px, 3vw, 28px)" }}
          >
            <div className="spread" style={{ marginBottom: 18 }}>
              <div>
                <div className="small mono" style={{ color: "rgba(200,217,230,.7)" }}>
                  BOARD 1 / {data.batch_id}
                </div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 26, color: "var(--white)", fontWeight: 700 }}>
                  {data.in_progress ? `${data.latest_hour} h of 168 h` : "Burn-in complete"}
                </div>
              </div>
              <span className="small mono" style={{ color: "rgba(200,217,230,.8)" }}>
                {data.in_progress ? `last read at ${data.latest_hour} h` : "run complete"}
              </span>
            </div>
            <div
              style={{ height: 3, background: "rgba(200,217,230,.15)", marginBottom: 22, overflow: "hidden" }}
              aria-label={`Burn-in progress ${Math.round(progress * 100)}%`}
            >
              <div style={{ width: `${progress * 100}%`, height: "100%", background: "var(--sky)" }} />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `20px repeat(${board.cols}, minmax(0, 1fr))`,
                gap: "clamp(4px, 1vw, 10px)",
                alignItems: "center",
              }}
            >
              <span />
              {Array.from({ length: board.cols }, (_, i) => (
                <span key={i} style={{ textAlign: "center", fontSize: 11, color: "rgba(200,217,230,.6)" }}>
                  {i + 1}
                </span>
              ))}
              {Array.from({ length: board.rows }, (_, r) => (
                <Row key={r} r={r} board={board} sel={sel} setSel={setSel} />
              ))}
            </div>

            <div className="legend" style={{ marginTop: 20, color: "rgba(200,217,230,.85)" }}>
              <span><i className="swatch" style={{ background: "var(--sky)", borderRadius: 6 }} /> Pass</span>
              <span><i className="swatch" style={{ background: "var(--teal)", borderRadius: 6 }} /> Review</span>
              <span><i className="swatch" style={{ background: "var(--brick)", borderRadius: 6 }} /> Reject</span>
              <span style={{ marginLeft: "auto" }}>Numbers are part IDs</span>
            </div>
          </section>

          <section className="card">
            {sel ? (
              <div className="stack" style={{ gap: 16 }}>
                <div className="spread fade" key={sel.component_id}>
                  <div>
                    <div className="small muted">Socket {sel.socket}</div>
                    <h2 className="mono" style={{ marginTop: 4, fontFamily: "var(--mono)", fontWeight: 500 }}>{sel.component_id}</h2>
                  </div>
                  <StatusBadge status={sel.status} />
                </div>
                <p className="small">{sel.headline}</p>
                <dl className="kv">
                  {Object.entries(sel.latest).map(([k, v]) => (
                    <FragmentKV key={k} label={param(k)?.short ?? k} value={fmt(param(k), v)} />
                  ))}
                  <FragmentKV label="Risk score" value={`${sel.risk} / 100`} />
                </dl>
                <button className="btn primary" onClick={() => nav(`/passport/${lot}/${sel.component_id}`)}>
                  Open passport
                </button>
              </div>
            ) : (
              <div className="stack" style={{ gap: 14 }}>
                <h2>Board summary</h2>
                <dl className="kv">
                  <FragmentKV label="Seated parts" value={String(data.n)} />
                  <FragmentKV label="Pass" value={String(data.counts.PASS)} />
                  <FragmentKV label="Review" value={String(data.counts.REVIEW)} />
                  <FragmentKV label="Reject" value={String(data.counts.REJECT)} />
                  {data.in_progress && <FragmentKV label="Pull now (early reject)" value={String(data.early_rejects)} />}
                </dl>
                <p className="small muted">Select a socket to see the part seated there.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function FragmentKV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function Row({
  r,
  board,
  sel,
  setSel,
}: {
  r: number;
  board: ReturnType<typeof layout>;
  sel: Component | null;
  setSel: (c: Component) => void;
}) {
  return (
    <>
      <span style={{ fontSize: 11, color: "rgba(200,217,230,.6)", textAlign: "center" }}>{String.fromCharCode(65 + r)}</span>
      {Array.from({ length: board.cols }, (_, col) => {
        const cell = board.cells.find((x) => x.r === r && x.col === col);
        if (!cell) return <span key={col} style={{ aspectRatio: "1", borderRadius: "50%", border: "1px dashed rgba(200,217,230,.2)" }} />;
        const c = cell.c;
        const active = sel?.component_id === c.component_id;
        const fill = c.status === "PASS" ? "var(--sky)" : STATUS_COLOR[c.status];
        return (
          <button
            key={col}
            onClick={() => setSel(c)}
            aria-label={`Socket ${c.socket}: ${c.component_id}, ${c.status}`}
            title={`${c.socket} · ${c.component_id} · ${c.status}`}
            style={{
              aspectRatio: "1",
              borderRadius: "50%",
              border: active ? "3px solid var(--white)" : "3px solid rgba(255,255,255,.08)",
              background: fill,
              cursor: "pointer",
              padding: 0,
              boxShadow: c.status === "REJECT" ? "0 0 0 4px rgba(165,67,47,.28)" : undefined,
              color: c.status === "PASS" ? "var(--navy)" : "var(--white)",
              fontSize: "clamp(8px, 1.2vw, 11px)",
              fontFamily: "var(--mono)",
              transition: "transform .15s, border-color .15s",
            }}
          >
            <span className="hide-sm">{c.component_id.replace(/^C-0*/, "")}</span>
          </button>
        );
      })}
    </>
  );
}
