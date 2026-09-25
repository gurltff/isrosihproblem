import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorBox, Loading, LotPicker, PageHead, STATUS_COLOR, StatusBadge, useLot } from "../components/ui";
import { api, type Component, type Status, type Timeline } from "../lib/api";
import { useAsync, useData } from "../lib/data";
import { fmt } from "../lib/format";

const SOCKET_RE = /^([A-Za-z])\s*(\d+)$/;
const REPLAY_SECONDS = 24; // a full 168 h run plays in this many seconds

/** Arrange parts on a board: by their socket label when present, otherwise in order. */
function layout(comps: Component[]) {
  const parsed = comps.map((c) => {
    const m = SOCKET_RE.exec(c.socket.trim());
    return m ? { c, r: m[1].toUpperCase().charCodeAt(0) - 65, col: parseInt(m[2], 10) - 1 } : null;
  });
  if (parsed.every(Boolean)) {
    const cells = parsed as { c: Component; r: number; col: number }[];
    return {
      rows: Math.max(...cells.map((x) => x.r)) + 1,
      cols: Math.max(...cells.map((x) => x.col)) + 1,
      cells,
    };
  }
  const cols = Math.ceil(Math.sqrt(comps.length));
  return {
    rows: Math.ceil(comps.length / cols),
    cols,
    cells: comps.map((c, i) => ({ c, r: Math.floor(i / cols), col: i % cols })),
  };
}

type SocketState = Status | "WAIT" | "PULLED";

/** What the chamber looked like at hour t, from the read points taken so far. */
function stateAt(tl: Timeline | null, t: number, end: number) {
  const status = new Map<string, SocketState>();
  const events: { hour: number; cid: string; status: Status; early: boolean; reason: string }[] = [];
  let freed = 0;
  if (!tl) return { status, events, freed };
  const step = [...tl.steps].reverse().find((s) => s.hour <= t);
  for (const [cid, f] of Object.entries(tl.first_flag)) {
    if (f.hour <= t) events.push({ hour: f.hour, cid, status: f.status, early: f.early_reject, reason: f.reason });
  }
  events.sort((a, b) => b.hour - a.hour || a.cid.localeCompare(b.cid));
  if (step) {
    for (const [cid, s] of Object.entries(step.status)) status.set(cid, s);
  }
  // A part rejected before the end of the run is pulled from its socket.
  for (const e of events) {
    if (e.status === "REJECT" && e.hour < end) {
      if (t > e.hour) status.set(e.cid, "PULLED");
      freed += Math.max(Math.min(t, 168) - e.hour, 0);
    }
  }
  return { status, events, freed };
}

export default function Chamber() {
  const [lot, setLot] = useLot();
  const nav = useNavigate();
  const { param } = useData();
  const [sel, setSel] = useState<Component | null>(null);
  const { data, error, loading } = useAsync(() => (lot ? api.batch(lot) : Promise.resolve(null)), [lot]);
  const tl = useAsync(() => (lot ? api.timeline(lot) : Promise.resolve(null)), [lot]);
  const board = useMemo(() => (data ? layout(data.components) : null), [data]);

  const end = data?.latest_hour ?? 0;
  const [t, setT] = useState<number | null>(null); // null = show the latest state
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    setT(null);
    setPlaying(false);
    setSel(null);
  }, [lot]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((prev) => {
        const next = (prev ?? 0) + (dt * 168) / REPLAY_SECONDS;
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, end]);

  const now = t ?? end;
  const replay = useMemo(() => stateAt(tl.data, now, end), [tl.data, now, end]);
  const counts = { PASS: 0, REVIEW: 0, REJECT: 0, PULLED: 0, WAIT: 0 };
  data?.components.forEach((c) => counts[replay.status.get(c.component_id) ?? (now < 24 ? "WAIT" : c.status)]++);

  return (
    <>
      <PageHead
        title="Chamber"
        lede="The burn-in board socket by socket. Press play to watch the run: read points arrive, parts are flagged, and rejects are pulled early to free their sockets."
        actions={<LotPicker value={lot} onChange={setLot} />}
      />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading height={520} />}
      {data && board && (
        <div className="grid grid-main">
          <section className="card chamber">
            <div className="spread" style={{ marginBottom: 14 }}>
              <div>
                <div className="small mono" style={{ color: "rgba(200,217,230,.7)" }}>
                  BOARD 1 / {data.batch_id}
                </div>
                <div className="chamber-clock">
                  <span className="mono">{String(Math.floor(now)).padStart(3, "0")}</span> h
                  <small> of 168 h</small>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn light"
                  onClick={() => {
                    if (playing) setPlaying(false);
                    else {
                      if (t === null || t >= end) setT(0);
                      setPlaying(true);
                    }
                  }}
                  disabled={!tl.data}
                >
                  {playing ? "Pause" : t !== null && t < end ? "Resume" : "▶ Replay run"}
                </button>
              </div>
            </div>

            <input
              className="scrubber"
              type="range"
              min={0}
              max={168}
              step={1}
              value={now}
              onChange={(e) => {
                setPlaying(false);
                setT(Math.min(Number(e.target.value), end));
              }}
              aria-label="Hours into burn-in"
              style={{ ["--fill" as string]: `${(now / 168) * 100}%`, ["--end" as string]: `${(end / 168) * 100}%` }}
            />
            <div className="scrub-ticks mono">
              {[0, 24, 96, 168].map((h) => (
                <span key={h} style={{ left: `${(h / 168) * 100}%` }}>
                  {h}
                </span>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `20px repeat(${board.cols}, minmax(0, 1fr))`,
                gap: "clamp(4px, 1vw, 10px)",
                alignItems: "center",
                marginTop: 26,
              }}
            >
              <span />
              {Array.from({ length: board.cols }, (_, i) => (
                <span key={i} className="socket-label">
                  {i + 1}
                </span>
              ))}
              {Array.from({ length: board.rows }, (_, r) => (
                <Row
                  key={r}
                  r={r}
                  board={board}
                  sel={sel}
                  setSel={setSel}
                  stateOf={(c) => replay.status.get(c.component_id) ?? (now < 24 ? "WAIT" : c.status)}
                />
              ))}
            </div>

            <div className="legend" style={{ marginTop: 20, color: "rgba(200,217,230,.85)" }}>
              <span><i className="swatch" style={{ background: "var(--sky)", borderRadius: 6 }} /> Pass {counts.PASS}</span>
              <span><i className="swatch" style={{ background: "var(--teal)", borderRadius: 6 }} /> Review {counts.REVIEW}</span>
              <span><i className="swatch" style={{ background: "var(--brick)", borderRadius: 6 }} /> Reject {counts.REJECT}</span>
              <span><i className="swatch" style={{ border: "1.5px dashed var(--sky)", borderRadius: 6 }} /> Pulled {counts.PULLED}</span>
              <span style={{ marginLeft: "auto" }}>Numbers are part IDs</span>
            </div>
          </section>

          <section className="card" style={{ alignSelf: "start" }}>
            {sel ? (
              <div className="stack fade" style={{ gap: 14 }} key={sel.component_id}>
                <div className="spread">
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
                <div className="row">
                  <button className="btn primary" onClick={() => nav(`/passport/${lot}/${sel.component_id}`)}>
                    Open passport
                  </button>
                  <button className="btn ghost" onClick={() => setSel(null)}>
                    Back to run log
                  </button>
                </div>
              </div>
            ) : (
              <div className="stack" style={{ gap: 14 }}>
                <div className="ledger" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div className="tile dark">
                    <div className="eyebrow">Socket-hours freed</div>
                    <div className="tile-value" style={{ fontSize: 30 }}>{Math.round(replay.freed).toLocaleString()}</div>
                  </div>
                  <div className="tile">
                    <div className="eyebrow">Parts pulled early</div>
                    <div className="tile-value" style={{ fontSize: 30 }}>{counts.PULLED}</div>
                  </div>
                </div>
                <h2>Run log</h2>
                {replay.events.length === 0 ? (
                  <p className="small muted">
                    {now < 24 ? "Waiting for the 24 h read point…" : "No part flagged so far."}
                  </p>
                ) : (
                  <ol className="events">
                    {replay.events.map((e) => (
                      <li key={e.cid} className="fade">
                        <span className="mono small faint">{e.hour} h</span>
                        <span className="small">
                          <b className="mono" style={{ color: STATUS_COLOR[e.status] }}>{e.cid}</b>{" "}
                          {e.status === "REJECT" ? (e.hour < end ? "rejected and pulled" : "rejected") : "put on hold"}
                          {e.early ? " (drift projection)" : ""}
                          <span className="muted" style={{ display: "block" }}>{e.reason}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
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
  stateOf,
}: {
  r: number;
  board: ReturnType<typeof layout>;
  sel: Component | null;
  setSel: (c: Component) => void;
  stateOf: (c: Component) => SocketState;
}) {
  return (
    <>
      <span className="socket-label">{String.fromCharCode(65 + r)}</span>
      {Array.from({ length: board.cols }, (_, col) => {
        const cell = board.cells.find((x) => x.r === r && x.col === col);
        if (!cell) return <span key={col} className="socket empty" />;
        const c = cell.c;
        const s = stateOf(c);
        return (
          <button
            key={col}
            onClick={() => setSel(c)}
            aria-label={`Socket ${c.socket}: ${c.component_id}, ${s}`}
            title={`${c.socket} · ${c.component_id} · ${s}`}
            className={`socket s-${s}${sel?.component_id === c.component_id ? " on" : ""}`}
          >
            <span className="hide-sm">{c.component_id.replace(/^C-0*/, "")}</span>
          </button>
        );
      })}
    </>
  );
}
