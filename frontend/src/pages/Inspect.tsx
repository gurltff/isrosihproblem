import { useCallback, useEffect, useRef, useState } from "react";
import { IconCamera, IconSwitch, IconUpload } from "../components/Icons";
import { PageHead } from "../components/ui";
import { api, STATIC, type Finding, type Inspection } from "../lib/api";
import { useData } from "../lib/data";
import { savedKey, saveKey } from "../lib/vision";

type Phase = "off" | "calibrating" | "waiting" | "settling" | "scanning" | "done";

interface ScanRecord {
  id: string;
  at: number;
  thumb: string;
  image: string;
  expected: string;
  inspection: Inspection;
}

const SEV: { [k in Finding["severity"]]: string } = { high: "#A5432F", medium: "#C07A3A", low: "#567C8D" };
const VERDICT = {
  NOMINAL: { label: "Accept", color: "var(--navy)", bg: "var(--sky-soft)" },
  REVIEW: { label: "Hold for review", color: "#44697a", bg: "#e3edf1" },
  REJECT: { label: "Reject", color: "var(--brick)", bg: "var(--brick-soft)" },
};
const LOG_KEY = "sentinel.inspections";
const STABLE_MS = 1200;

// ------------------------------------------------------------ frame maths

function signature(ctx: CanvasRenderingContext2D, src: CanvasImageSource) {
  ctx.drawImage(src, 0, 0, 32, 24);
  const px = ctx.getImageData(0, 0, 32, 24).data;
  const out = new Float32Array(32 * 24 * 3);
  for (let i = 0; i < 32 * 24; i++) {
    out[i * 3] = px[i * 4] / 255;
    out[i * 3 + 1] = px[i * 4 + 1] / 255;
    out[i * 3 + 2] = px[i * 4 + 2] / 255;
  }
  return out;
}
function diff(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function snapshot(v: CanvasImageSource, w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
  return c;
}

function loadLog(): ScanRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function storeLog(log: ScanRecord[]) {
  try {
    // Keep the log small: full images only for the latest few.
    const slim = log.slice(0, 24).map((r, i) => (i < 6 ? r : { ...r, image: r.thumb }));
    localStorage.setItem(LOG_KEY, JSON.stringify(slim));
  } catch {
    /* quota or private mode: the log just won't persist */
  }
}

// ------------------------------------------------------------------- page

export default function Inspect() {
  const { claudeVision } = useData();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loop = useRef({
    bg: null as Float32Array | null,
    prev: null as Float32Array | null,
    stableSince: 0,
    placed: false,
    scannedThisPlacement: false,
    busy: false,
    calib: [] as Float32Array[],
    sig: document.createElement("canvas").getContext("2d", { willReadFrequently: true })!,
  });

  const [phase, setPhase] = useState<Phase>("off");
  const [camError, setCamError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">(
    window.matchMedia("(pointer: coarse)").matches ? "environment" : "user"
  );
  const [expected, setExpected] = useState("IRF520N N-channel power MOSFET, TO-220");
  const [current, setCurrent] = useState<ScanRecord | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [log, setLog] = useState<ScanRecord[]>(loadLog);
  const [key, setKey] = useState(savedKey);
  const [keyOpen, setKeyOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  const engineLabel = STATIC
    ? key
      ? "Claude vision (your key, this browser only)"
      : "Offline check (connect Claude for full inspection)"
    : claudeVision
      ? "Claude vision"
      : "Offline check (no API key on the server)";

  // ------------------------------------------------------------ analysis
  const analyse = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setPhase("scanning");
      setScanError(null);
      const image = canvas.toDataURL("image/jpeg", 0.86);
      const thumb = snapshot(canvas, canvas.width, canvas.height, 180).toDataURL("image/jpeg", 0.7);
      setCurrent({ id: "pending", at: Date.now(), thumb, image, expected, inspection: null as unknown as Inspection });
      try {
        const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.88));
        const inspection = await api.inspect(blob, expected.trim() || undefined);
        const rec: ScanRecord = { id: crypto.randomUUID?.() ?? String(Date.now()), at: Date.now(), thumb, image, expected, inspection };
        setCurrent(rec);
        setLog((l) => {
          const next = [rec, ...l];
          storeLog(next);
          return next;
        });
      } catch (e) {
        setScanError(e instanceof Error ? e.message : String(e));
        setCurrent(null);
      } finally {
        setPhase(streamRef.current ? "done" : "off");
        loop.current.busy = false;
      }
    },
    [expected]
  );

  const scanNow = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || loop.current.busy) return;
    loop.current.busy = true;
    loop.current.scannedThisPlacement = true;
    analyse(snapshot(v, v.videoWidth, v.videoHeight, 1280));
  }, [analyse]);

  // -------------------------------------------------------------- camera
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPhase((p) => (p === "scanning" ? p : "off"));
  }, []);

  const recalibrate = () => {
    Object.assign(loop.current, { bg: null, calib: [], placed: false, scannedThisPlacement: false });
    setCurrent(null);
    setPhase("calibrating");
  };

  const start = useCallback(async () => {
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(
        window.isSecureContext
          ? "This browser does not give access to a camera."
          : "The camera only works over https:// (or on localhost)."
      );
      return;
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      Object.assign(loop.current, { bg: null, calib: [], prev: null, placed: false, scannedThisPlacement: false });
      setCurrent(null);
      setPhase("calibrating");
    } catch (e) {
      const n = e instanceof Error ? e.name : "";
      setCamError(
        n === "NotAllowedError"
          ? "Camera permission was refused. Allow it in the address bar, then try again."
          : n === "NotFoundError"
            ? "No camera found. You can still upload a photo."
            : `Could not start the camera: ${e instanceof Error ? e.message : e}`
      );
    }
  }, [facing]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (streamRef.current) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  // Watch the scene: learn the empty background, notice a part, wait for it
  // to sit still, then scan once per placement.
  useEffect(() => {
    if (phase === "off") return;
    const L = loop.current;
    L.sig.canvas.width = 32;
    L.sig.canvas.height = 24;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || !streamRef.current) return;
      const s = signature(L.sig, v);
      const moving = L.prev ? diff(s, L.prev) > 0.012 : true;
      L.prev = s;

      if (!L.bg) {
        if (moving) L.calib = [];
        else L.calib.push(s);
        setProgress(Math.min(L.calib.length / 4, 1));
        if (L.calib.length >= 4) {
          L.bg = s;
          setPhase("waiting");
        }
        return;
      }
      const present = diff(s, L.bg) > 0.045;
      if (!present) {
        if (L.placed) {
          L.placed = false;
          L.scannedThisPlacement = false;
          setPhase((p) => (p === "scanning" ? p : "waiting"));
        }
        setProgress(0);
        return;
      }
      if (!L.placed) {
        L.placed = true;
        L.stableSince = performance.now();
      }
      if (moving) L.stableSince = performance.now();
      if (L.scannedThisPlacement || L.busy) return;
      const held = performance.now() - L.stableSince;
      setProgress(Math.min(held / STABLE_MS, 1));
      setPhase("settling");
      if (held >= STABLE_MS) scanNow();
    }, 200);
    return () => window.clearInterval(id);
  }, [phase === "off", scanNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPhoto = async (file?: File) => {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    if (fileRef.current) fileRef.current.value = "";
    loop.current.busy = true;
    analyse(snapshot(bmp, bmp.width, bmp.height, 1600));
  };

  const live = phase !== "off" && !(current && (phase === "done" || phase === "scanning"));
  const showStill = !!current && (phase === "done" || phase === "scanning" || phase === "off");
  const ins = current?.inspection;

  const status: { [k in Phase]: string } = {
    off: "Camera off",
    calibrating: "Learning the empty background. Keep the area clear…",
    waiting: "Ready. Place a part in front of the camera.",
    settling: "Part detected. Hold it still…",
    scanning: "Inspecting…",
    done: "Done. Remove the part to inspect the next one.",
  };

  return (
    <>
      <PageHead
        title="Inspection station"
        lede="Put a part in front of the camera. The station notices it, waits until it is still, then identifies it, reads its markings, runs the visual checklist and gives a verdict. Every scan is logged."
        actions={
          <button className="btn small" onClick={() => setKeyOpen(true)} title="Inspection engine">
            <span className={`dot ${STATIC && !key && !claudeVision ? "REVIEW" : "PASS"}`} /> {engineLabel}
          </button>
        }
      />

      <div className="grid grid-main">
        <section className="card" style={{ padding: 0, overflow: "hidden", alignSelf: "start" }}>
          <div className="station">
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                display: live ? "block" : "none",
                transform: facing === "user" ? "scaleX(-1)" : undefined,
              }}
            />
            {showStill && current && (
              <div className="still">
                <img src={current.image} alt="Captured part" />
                {ins?.findings?.map((f, i) => (
                  <div
                    key={i}
                    className="box"
                    style={{
                      left: `${f.box.x * 100}%`,
                      top: `${f.box.y * 100}%`,
                      width: `${f.box.w * 100}%`,
                      height: `${f.box.h * 100}%`,
                      borderColor: SEV[f.severity],
                    }}
                  >
                    <span style={{ background: SEV[f.severity] }}>{i + 1}</span>
                  </div>
                ))}
                {phase === "scanning" && <div className="scanline" />}
              </div>
            )}
            {phase === "off" && !current && (
              <div className="station-empty">
                <IconCamera size={36} />
                <div className="station-title">Camera is off</div>
                <p>Point the camera at an empty, evenly lit surface, start it, then place parts one at a time.</p>
                <div className="row" style={{ justifyContent: "center" }}>
                  <button className="btn primary light" onClick={start}>
                    <IconCamera size={16} /> Start camera
                  </button>
                  <button className="btn ghost light-ghost" onClick={() => fileRef.current?.click()}>
                    <IconUpload size={16} /> Inspect a photo
                  </button>
                </div>
                {camError && <div className="notice warn" style={{ maxWidth: 420, textAlign: "left" }}>{camError}</div>}
              </div>
            )}
            {phase !== "off" && (
              <div className="station-status">
                <span>{status[phase]}</span>
                {(phase === "calibrating" || phase === "settling") && (
                  <i style={{ width: `${progress * 100}%` }} />
                )}
              </div>
            )}
          </div>

          <div className="row" style={{ padding: 12, justifyContent: "space-between" }}>
            <div className="row" style={{ gap: 8 }}>
              {phase !== "off" && (
                <button className="btn primary" onClick={scanNow} disabled={phase === "scanning" || phase === "calibrating"}>
                  Scan now
                </button>
              )}
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <IconUpload size={16} /> <span className="hide-sm">Photo</span>
              </button>
              {phase !== "off" && (
                <>
                  <button className="btn" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} title="Switch camera">
                    <IconSwitch size={16} />
                  </button>
                  <button className="btn ghost small" onClick={recalibrate}>
                    Re-learn background
                  </button>
                </>
              )}
            </div>
            {phase !== "off" ? (
              <button className="btn ghost small" onClick={stop}>
                Stop camera
              </button>
            ) : (
              current && (
                <button className="btn small" onClick={start}>
                  Start camera
                </button>
              )
            )}
          </div>
          <label className="row small" style={{ padding: "0 12px 14px", gap: 8 }}>
            <span className="muted" style={{ whiteSpace: "nowrap" }}>Expected part</span>
            <input className="input" style={{ flex: 1, minHeight: 32 }} value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        </section>

        <section className="card" style={{ alignSelf: "start" }}>
          <Report current={current} phase={phase} error={scanError} />
        </section>
      </div>

      {log.length > 0 && (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Inspection log</h2>
            <span className="row small" style={{ gap: 12 }}>
              <span className="muted">
                {log.length} scanned · {log.filter((r) => r.inspection.overall === "REJECT").length} rejected
              </span>
              <button
                className="btn link"
                onClick={() => {
                  setLog([]);
                  storeLog([]);
                }}
              >
                Clear
              </button>
            </span>
          </div>
          <div className="log">
            {log.map((r) => {
              const v = r.inspection.equipment_detected
                ? VERDICT[r.inspection.overall]
                : { label: "No part found", color: "var(--ink-3)" };
              return (
                <button key={r.id} className={`log-item${current?.id === r.id ? " on" : ""}`} onClick={() => setCurrent(r)}>
                  <img src={r.thumb} alt="" />
                  <span className="small" style={{ color: v.color, fontWeight: 600 }}>{v.label}</span>
                  <span className="small muted">{r.inspection.part_identity || r.inspection.equipment_type || "Unidentified"}</span>
                  <span className="small faint mono">{new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {keyOpen && (
        <EngineDialog
          value={key}
          onClose={() => setKeyOpen(false)}
          onSave={(k) => {
            saveKey(k);
            setKey(k);
            setKeyOpen(false);
          }}
        />
      )}
    </>
  );
}

function Report({ current, phase, error }: { current: ScanRecord | null; phase: Phase; error: string | null }) {
  if (error) return <div className="notice warn">The scan failed: {error}</div>;
  if (!current)
    return (
      <div className="stack" style={{ gap: 10 }}>
        <h2>Result</h2>
        <p className="muted small">
          Nothing inspected yet. Results show here: what the part is, what its markings say, a six-point visual checklist,
          any defects marked on the photo, and a verdict.
        </p>
      </div>
    );
  const ins = current.inspection;
  if (!ins || phase === "scanning")
    return (
      <div className="stack" style={{ gap: 10 }}>
        <h2>Inspecting…</h2>
        <p className="muted small">Identifying the part, reading markings and checking the surface.</p>
        <div className="skeleton" style={{ height: 180 }} />
      </div>
    );
  if (!ins.equipment_detected)
    return (
      <div className="stack fade" style={{ gap: 12 }} key={current.id}>
        <div style={{ background: "var(--beige)", borderLeft: "4px solid var(--ink-3)", padding: "12px 14px" }}>
          <div className="small muted">Verdict</div>
          <div style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, color: "var(--ink-2)" }}>No part found</div>
          <p className="small" style={{ marginTop: 6 }}>{ins.summary}</p>
        </div>
        {ins.notice && <p className="note">{ins.notice}</p>}
      </div>
    );
  const v = VERDICT[ins.overall];
  return (
    <div className="stack fade" style={{ gap: 16 }} key={current.id}>
      <div style={{ background: v.bg, borderLeft: `4px solid ${v.color}`, padding: "12px 14px" }}>
        <div className="small muted">Verdict</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700, color: v.color, lineHeight: 1.1 }}>{v.label}</div>
        <p className="small" style={{ marginTop: 6 }}>{ins.summary}</p>
      </div>

      <dl className="kv" style={{ gridTemplateColumns: "auto 1fr" }}>
        <dt>Part</dt>
        <dd style={{ textAlign: "left", fontWeight: 500 }}>{ins.part_identity || ins.equipment_type || "—"}</dd>
        {ins.markings !== undefined && (
          <>
            <dt>Markings</dt>
            <dd className="mono" style={{ textAlign: "left", fontWeight: 400 }}>{ins.markings || "—"}</dd>
          </>
        )}
        {ins.marking_check && ins.marking_check !== "no expected part" && (
          <>
            <dt>Expected part</dt>
            <dd
              style={{
                textAlign: "left",
                color: ins.marking_check === "mismatch" ? "var(--brick)" : ins.marking_check === "match" ? "var(--navy)" : "var(--ink-2)",
              }}
            >
              {ins.marking_check === "match" ? "Matches" : ins.marking_check === "mismatch" ? "Does not match" : "Cannot tell"}
              {ins.marking_note && <span className="small muted" style={{ display: "block", fontWeight: 400 }}>{ins.marking_note}</span>}
            </dd>
          </>
        )}
      </dl>

      {ins.checklist && ins.checklist.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Visual checklist</h3>
          <ul className="checklist">
            {ins.checklist.map((c, i) => (
              <li key={i} className={c.result.replace("/", "")}>
                <span className="mark">{c.result === "pass" ? "✓" : c.result === "fail" ? "✕" : "–"}</span>
                <span>
                  {c.item}
                  {c.note && <span className="small muted" style={{ display: "block" }}>{c.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ins.findings.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Defects</h3>
          <ol className="defects">
            {ins.findings.map((f, i) => (
              <li key={i}>
                <span className="n" style={{ background: SEV[f.severity] }}>{i + 1}</span>
                <span className="small">
                  <b>{f.type[0].toUpperCase() + f.type.slice(1).replace(/_/g, " ")}</b>{" "}
                  <span className="faint">({f.severity}, {Math.round(f.confidence * 100)}% sure)</span>
                  <span style={{ display: "block" }}>{f.description}</span>
                  <span className="faint">{f.location}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="note">
        {ins.engine === "claude" ? `Claude vision (${ins.model})` : "Offline colour and texture check only"} ·{" "}
        {new Date(current.at).toLocaleString()}
        {ins.notice ? ` · ${ins.notice}` : ""}
      </p>
    </div>
  );
}

function EngineDialog({ value, onSave, onClose }: { value: string; onSave: (k: string) => void; onClose: () => void }) {
  const [k, setK] = useState(value);
  return (
    <div className="sheet-backdrop center" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Inspection engine</h2>
        {STATIC ? (
          <>
            <p className="small muted" style={{ margin: "10px 0 14px" }}>
              This hosted demo has no server. To use Claude vision, paste an Anthropic API key. It is kept only in this
              browser on this device and sent only to Anthropic. Use a key with a low spending limit, and remove it after the
              demo. Without a key, scans use the offline colour and texture check.
            </p>
            <input
              className="input"
              style={{ width: "100%" }}
              type="password"
              placeholder="sk-ant-…"
              value={k}
              onChange={(e) => setK(e.target.value.trim())}
              autoComplete="off"
            />
            <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
              {value && (
                <button className="btn ghost" onClick={() => onSave("")}>
                  Remove key
                </button>
              )}
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => onSave(k)} disabled={!k}>
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: "10px 0 14px" }}>
              On the full version the key lives on the server, in <code>backend/.env</code> (<code>ANTHROPIC_API_KEY=…</code>).
              Restart the server after adding it.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
