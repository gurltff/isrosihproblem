import { useCallback, useEffect, useRef, useState } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { IconCamera, IconFist, IconHand, IconPoint, IconSwitch, IconUpload, IconVictory } from "../components/Icons";

const GESTURE_ICON = { fist: IconFist, palm: IconHand, point: IconPoint, victory: IconVictory };
import { PageHead } from "../components/ui";
import { api, type Finding, type Inspection } from "../lib/api";
import { useData } from "../lib/data";
import { GESTURES, GestureTracker, HAND_CONNECTIONS, classify, type Gesture } from "../lib/gestures";

type Filter = "normal" | "edges" | "contrast" | "falsecolor";
const FILTERS: Filter[] = ["normal", "edges", "contrast", "falsecolor"];
const FILTER_LABEL: Record<Filter, string> = {
  normal: "Normal",
  edges: "Edge map",
  contrast: "High contrast",
  falsecolor: "False colour (luminance, not thermal)",
};

const SEV_COLOR: Record<Finding["severity"], string> = {
  high: "#A5432F",
  medium: "#567C8D",
  low: "#8FB0C7",
};

const AUTO_COOLDOWN_MS = 7000;
const STABLE_MS = 1300;

interface Result {
  inspection: Inspection;
  source: "freeze" | "auto" | "photo";
  at: number;
}

// Luminance false-colour ramp in the app palette: navy → teal → sky → beige → brick.
const LUT = (() => {
  const stops = [
    [0, [47, 65, 86]],
    [0.35, [86, 124, 141]],
    [0.6, [200, 217, 230]],
    [0.8, [245, 239, 235]],
    [1, [165, 67, 47]],
  ] as const;
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0);
    for (let j = 0; j < 3; j++) out[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return out;
})();

function signature(ctx: CanvasRenderingContext2D, src: CanvasImageSource): Float32Array {
  ctx.drawImage(src, 0, 0, 32, 24);
  const px = ctx.getImageData(0, 0, 32, 24).data;
  const out = new Float32Array(32 * 24);
  for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  return out;
}

function sigDiff(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function sigStd(a: Float32Array) {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / a.length);
}

export default function Inspect() {
  const { claudeVision } = useData();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">(
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? "environment" : "user"
  );
  const [handsOn, setHandsOn] = useState(true);
  const [handState, setHandState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gesture, setGesture] = useState<Gesture>("none");
  const [filter, setFilter] = useState<Filter>("normal");
  const [autoScan, setAutoScan] = useState(true);
  const [loupe, setLoupe] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Mutable loop state (kept out of React to avoid re-rendering at 30 fps).
  const s = useRef({
    stream: null as MediaStream | null,
    landmarker: null as HandLandmarker | null,
    tracker: new GestureTracker(),
    raf: 0,
    lastVideoTime: -1,
    hand: null as NormalizedLandmark[] | null,
    progress: 0,
    gesture: "none" as Gesture,
    frozenImage: null as HTMLCanvasElement | null,
    filter: "normal" as Filter,
    frozen: false,
    scanning: false,
    autoScan: true,
    loupe: false,
    manualLoupe: null as { x: number; y: number } | null,
    result: null as Result | null,
    work: document.createElement("canvas"),
    sigCanvas: document.createElement("canvas"),
    lastSig: null as Float32Array | null,
    stableSince: 0,
    lastSigAt: 0,
    scanSig: null as Float32Array | null,
    lastAutoAt: 0,
    mirror: false,
  });
  s.current.filter = filter;
  s.current.frozen = frozen;
  s.current.scanning = scanning;
  s.current.autoScan = autoScan;
  s.current.loupe = loupe;
  s.current.result = result;
  s.current.mirror = facing === "user";

  const note = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((m) => (m === msg ? null : m)), 1600);
  }, []);

  // ------------------------------------------------------------- scanning
  const scanBlob = useCallback(async (blob: Blob, source: Result["source"]) => {
    setScanning(true);
    setScanError(null);
    try {
      const inspection = await api.inspect(blob);
      setResult({ inspection, source, at: Date.now() });
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c;
  }, []);

  const freezeAndScan = useCallback(() => {
    if (s.current.scanning) return;
    const c = captureFrame();
    if (!c) return;
    s.current.frozenImage = c;
    setFrozen(true);
    setResult(null);
    c.toBlob((b) => b && scanBlob(b, "freeze"), "image/jpeg", 0.88);
  }, [captureFrame, scanBlob]);

  const resume = useCallback(() => {
    s.current.frozenImage = null;
    s.current.scanSig = null;
    setFrozen(false);
    setResult(null);
    setScanError(null);
  }, []);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    s.current.frozenImage = c;
    setFrozen(true);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
    c.toBlob((b) => b && scanBlob(b, "photo"), "image/jpeg", 0.9);
  };

  // ------------------------------------------------------------- camera
  const stopCamera = useCallback(() => {
    s.current.stream?.getTracks().forEach((t) => t.stop());
    s.current.stream = null;
    setCamOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(
        window.isSecureContext
          ? "This browser does not expose a camera."
          : "Camera needs HTTPS (or localhost). Open the app over https:// to use it on a phone."
      );
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      s.current.stream = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCamOn(true);
      resume();
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      setCamError(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow it in the browser's site settings and try again."
          : name === "NotFoundError"
            ? "No camera found. You can still upload a photo."
            : `Could not start the camera (${e instanceof Error ? e.message : e}).`
      );
    }
  }, [facing, resume, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => {
    if (camOn) startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  // --------------------------------------------------------- hand model
  useEffect(() => {
    if (!camOn || !handsOn || s.current.landmarker) return;
    let cancelled = false;
    setHandState("loading");
    (async () => {
      try {
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const make = (delegate: "GPU" | "CPU") =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minTrackingConfidence: 0.5,
          });
        let lm: HandLandmarker;
        try {
          lm = await make("GPU");
        } catch {
          lm = await make("CPU");
        }
        if (cancelled) return lm.close();
        s.current.landmarker = lm;
        setHandState("ready");
      } catch (e) {
        console.error(e);
        if (!cancelled) setHandState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [camOn, handsOn]);

  // ---------------------------------------------------------- render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
    const st = s.current;
    const workCtx = st.work.getContext("2d", { willReadFrequently: true })!;
    st.sigCanvas.width = 32;
    st.sigCanvas.height = 24;
    const sigCtx = st.sigCanvas.getContext("2d", { willReadFrequently: true })!;

    const drawFiltered = (src: CanvasImageSource, w: number, h: number, mirror: boolean) => {
      ctx.save();
      if (mirror) ctx.setTransform(-1, 0, 0, 1, w, 0);
      if (st.filter === "contrast") ctx.filter = "contrast(1.8) saturate(1.5) brightness(1.05)";
      if (st.filter === "edges" || st.filter === "falsecolor") {
        const sw = Math.max(160, Math.round(w / 3));
        const sh = Math.round((sw * h) / w);
        st.work.width = sw;
        st.work.height = sh;
        workCtx.drawImage(src, 0, 0, sw, sh);
        const img = workCtx.getImageData(0, 0, sw, sh);
        const p = img.data;
        const L = new Float32Array(sw * sh);
        for (let i = 0; i < L.length; i++) L[i] = p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114;
        if (st.filter === "falsecolor") {
          for (let i = 0; i < L.length; i++) {
            const k = Math.min(255, L[i] | 0) * 3;
            p[i * 4] = LUT[k];
            p[i * 4 + 1] = LUT[k + 1];
            p[i * 4 + 2] = LUT[k + 2];
          }
        } else {
          for (let y = 0; y < sh; y++)
            for (let x = 0; x < sw; x++) {
              const i = y * sw + x;
              let g = 0;
              if (x > 0 && y > 0 && x < sw - 1 && y < sh - 1) {
                const gx = -L[i - sw - 1] - 2 * L[i - 1] - L[i + sw - 1] + L[i - sw + 1] + 2 * L[i + 1] + L[i + sw + 1];
                const gy = -L[i - sw - 1] - 2 * L[i - sw] - L[i - sw + 1] + L[i + sw - 1] + 2 * L[i + sw] + L[i + sw + 1];
                g = Math.min(1, Math.hypot(gx, gy) / 260);
              }
              p[i * 4] = 47 + (200 - 47) * g;
              p[i * 4 + 1] = 65 + (217 - 65) * g;
              p[i * 4 + 2] = 86 + (230 - 86) * g;
            }
        }
        workCtx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(st.work, 0, 0, w, h);
      } else {
        ctx.drawImage(src, 0, 0, w, h);
      }
      ctx.restore();
    };

    const drawBoxes = (findings: Finding[], w: number, h: number, mirror: boolean, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      const lw = Math.max(2, w / 360);
      ctx.font = `700 ${Math.max(12, w / 60)}px Manrope, system-ui, sans-serif`;
      findings.forEach((f, i) => {
        const bx = (mirror ? 1 - f.box.x - f.box.w : f.box.x) * w;
        const by = f.box.y * h;
        const bw = f.box.w * w;
        const bh = f.box.h * h;
        const col = SEV_COLOR[f.severity];
        ctx.lineWidth = lw + 3;
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.strokeRect(bx, by, bw, bh);
        ctx.lineWidth = lw;
        ctx.strokeStyle = col;
        ctx.strokeRect(bx, by, bw, bh);
        const label = `${i + 1} · ${f.type.replace(/_/g, " ")}`;
        const tw = ctx.measureText(label).width + 14;
        const th = Math.max(20, w / 40);
        const ly = by - th - 2 < 0 ? by + 2 : by - th - 2;
        ctx.fillStyle = col;
        ctx.fillRect(bx - lw / 2, ly, tw, th);
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, bx + 7, ly + th / 2);
      });
      ctx.restore();
    };

    const drawHand = (lm: NormalizedLandmark[], w: number, h: number, mirror: boolean) => {
      const X = (p: NormalizedLandmark) => (mirror ? 1 - p.x : p.x) * w;
      const Y = (p: NormalizedLandmark) => p.y * h;
      ctx.save();
      ctx.lineWidth = Math.max(2, w / 400);
      ctx.strokeStyle = "rgba(200,217,230,.9)";
      ctx.fillStyle = "#F5EFEB";
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(X(lm[a]), Y(lm[a]));
        ctx.lineTo(X(lm[b]), Y(lm[b]));
        ctx.stroke();
      }
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(X(p), Y(p), Math.max(2.5, w / 320), 0, Math.PI * 2);
        ctx.fill();
      }
      // Hold-to-trigger ring around the palm centre.
      if (st.progress > 0 && st.gesture !== "none" && st.gesture !== "point") {
        const cx = X(lm[9]);
        const cy = Y(lm[9]);
        const r = Math.max(28, w / 22);
        ctx.lineWidth = Math.max(4, w / 180);
        ctx.strokeStyle = "rgba(47,65,86,.35)";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = st.gesture === "fist" ? "#A5432F" : "#F5EFEB";
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.progress);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawLoupe = (cx: number, cy: number, w: number) => {
      const r = Math.max(70, w / 9);
      const zoom = 2.5;
      const sw = (r * 2) / zoom;
      st.work.width = Math.ceil(sw);
      st.work.height = Math.ceil(sw);
      workCtx.drawImage(canvas, cx - sw / 2, cy - sw / 2, sw, sw, 0, 0, sw, sw);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(st.work, 0, 0, sw, sw, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.save();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#F5EFEB";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(47,65,86,.6)";
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy);
      ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();
      ctx.restore();
    };

    const tick = () => {
      st.raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      const now = performance.now();

      if (st.frozen && st.frozenImage) {
        const img = st.frozenImage;
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
      } else if (v && v.videoWidth) {
        const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * scale);
        const h = Math.round(v.videoHeight * scale);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      } else {
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      const mirror = st.mirror && !st.frozen;

      // Hand tracking runs on the live video even while a frame is frozen,
      // so an open palm can unfreeze it.
      let lm: NormalizedLandmark[] | null = null;
      if (st.landmarker && v && v.readyState >= 2 && v.currentTime !== st.lastVideoTime) {
        st.lastVideoTime = v.currentTime;
        try {
          const res = st.landmarker.detectForVideo(v, now);
          lm = res.landmarks[0] ?? null;
          st.hand = lm;
        } catch {
          st.hand = null;
        }
        const g = lm ? classify(lm) : "none";
        const t = st.tracker.update(g, now);
        st.progress = t.progress;
        if (t.gesture !== st.gesture) {
          st.gesture = t.gesture;
          setGesture(t.gesture);
        }
        if (t.fire === "fist" && !st.frozen) {
          freezeAndScan();
          note(GESTURES.fist.toast);
        } else if (t.fire === "palm") {
          if (st.frozen) {
            resume();
            note(GESTURES.palm.toast);
          } else if (st.result) {
            setResult(null);
            note("Results cleared");
          }
        } else if (t.fire === "victory") {
          const next = FILTERS[(FILTERS.indexOf(st.filter) + 1) % FILTERS.length];
          setFilter(next);
          note(FILTER_LABEL[next]);
        }
      }
      lm = st.hand;

      if (st.frozen && st.frozenImage) drawFiltered(st.frozenImage, w, h, false);
      else if (v) drawFiltered(v, w, h, mirror);

      // Auto-scan: when the camera settles on something new, check it.
      if (!st.frozen && v && now - st.lastSigAt > 350) {
        st.lastSigAt = now;
        const sig = signature(sigCtx, v);
        const moving = st.lastSig ? sigDiff(sig, st.lastSig) > 0.018 : true;
        st.lastSig = sig;
        if (moving) st.stableSince = now;
        const res = st.result;
        if (res && res.source === "auto" && st.scanSig && sigDiff(sig, st.scanSig) > 0.07) {
          setResult(null); // scene changed; old boxes no longer apply
        }
        const novel = !st.scanSig || sigDiff(sig, st.scanSig) > 0.06;
        if (
          st.autoScan &&
          !st.scanning &&
          !lm &&
          novel &&
          now - st.stableSince > STABLE_MS &&
          now - st.lastAutoAt > AUTO_COOLDOWN_MS &&
          sigStd(sig) > 0.045
        ) {
          st.lastAutoAt = now;
          st.scanSig = sig;
          const c = captureFrame();
          c?.toBlob((b) => b && scanBlob(b, "auto"), "image/jpeg", 0.85);
        }
      }

      const r = st.result;
      if (r && r.inspection.findings.length) {
        const age = r.source === "auto" ? Math.max(0.35, 1 - (Date.now() - r.at) / 20000) : 1;
        drawBoxes(r.inspection.findings, w, h, mirror, age);
      }

      if (lm) drawHand(lm, w, h, mirror);

      const tip = lm && st.gesture === "point" ? lm[8] : null;
      if (tip) drawLoupe((mirror ? 1 - tip.x : tip.x) * w, tip.y * h, w);
      else if (st.loupe && st.manualLoupe) drawLoupe(st.manualLoupe.x * w, st.manualLoupe.y * h, w);
    };
    st.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(st.raf);
  }, [captureFrame, freezeAndScan, note, resume, scanBlob]);

  useEffect(
    () => () => {
      s.current.landmarker?.close();
      s.current.landmarker = null;
    },
    []
  );

  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loupe) return;
    const rect = e.currentTarget.getBoundingClientRect();
    s.current.manualLoupe = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const ins = result?.inspection;
  const showStage = camOn || frozen;

  return (
    <>
      <PageHead
        title="Surface inspection"
        lede="Hold a board or part up to the camera. When the picture stays still it scans by itself. You can also use your hand: make a fist to freeze and scan, open your palm to go back to live."
        actions={
          <span className={`pill${claudeVision ? " live" : ""}`}>
            {claudeVision ? "Claude vision connected" : "Offline check only (no API key on server)"}
          </span>
        }
      />

      <div className="grid grid-main">
        <section className="card" style={{ padding: 0, overflow: "hidden", alignSelf: "start" }}>
          <div style={{ position: "relative", minHeight: showStage ? undefined : 360, background: "#1f2d3d" }}>
            <video ref={videoRef} playsInline muted style={{ display: "none" }} />
            <canvas
              ref={canvasRef}
              onPointerDown={onCanvasPointer}
              onPointerMove={(e) => e.buttons && onCanvasPointer(e)}
              style={{ width: "100%", height: "auto", display: showStage ? "block" : "none", touchAction: loupe ? "none" : "auto" }}
            />
            {!showStage && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 16,
                  padding: 24,
                  textAlign: "center",
                  color: "var(--sky)",
                }}
              >
                <IconCamera size={40} />
                <div style={{ fontFamily: "var(--serif)", fontSize: 24, color: "var(--white)" }}>Camera is off</div>
                <p className="small" style={{ maxWidth: 360, color: "rgba(200,217,230,.8)" }}>
                  Hand tracking runs on this device. A picture only leaves it when a scan runs.
                </p>
                <div className="row" style={{ justifyContent: "center" }}>
                  <button className="btn primary" style={{ background: "var(--beige)", color: "var(--navy)" }} onClick={startCamera}>
                    <IconCamera size={16} /> Start camera
                  </button>
                  <button className="btn ghost" style={{ color: "var(--sky)", borderColor: "rgba(200,217,230,.4)" }} onClick={() => fileRef.current?.click()}>
                    <IconUpload size={16} /> Upload photo
                  </button>
                </div>
                {camError && <div className="notice warn" style={{ maxWidth: 420 }}>{camError}</div>}
              </div>
            )}

            {showStage && (
              <>
                <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {frozen ? <span className="pill">Frozen frame</span> : <span className="pill live">Live</span>}
                  {filter !== "normal" && <span className="pill">{FILTER_LABEL[filter]}</span>}
                  {scanning && <span className="pill live">Scanning…</span>}
                </div>
                {handsOn && camOn && (
                  <div style={{ position: "absolute", top: 12, right: 12 }}>
                    <span className="pill" title="Hand tracking">
                      <IconHand size={14} />
                      {handState === "loading"
                        ? "Loading hand tracking…"
                        : handState === "error"
                          ? "Hand tracking unavailable"
                          : gesture !== "none"
                            ? GESTURES[gesture].name
                            : "Show a hand"}
                    </span>
                  </div>
                )}
                {flash && (
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      bottom: 18,
                      transform: "translateX(-50%)",
                      background: "rgba(47,65,86,.92)",
                      color: "var(--white)",
                      padding: "8px 14px",
                      borderRadius: 2,
                      fontWeight: 600,
                      fontSize: 14,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {flash}
                  </div>
                )}
              </>
            )}
          </div>

          {showStage && (
            <div className="row" style={{ padding: 14, background: "var(--white)", justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 8 }}>
                {frozen ? (
                  <button className="btn primary" onClick={resume}>
                    Resume live
                  </button>
                ) : (
                  <button className="btn primary" onClick={freezeAndScan} disabled={!camOn || scanning}>
                    Freeze &amp; scan
                  </button>
                )}
                <button className="btn" onClick={() => fileRef.current?.click()} title="Upload photo">
                  <IconUpload size={16} />
                  <span className="hide-sm">Photo</span>
                </button>
                {camOn && (
                  <button
                    className="btn"
                    onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                    title="Switch camera"
                  >
                    <IconSwitch size={16} />
                  </button>
                )}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn small"
                  onClick={() => setFilter(FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length])}
                >
                  View: {FILTER_LABEL[filter].split(" (")[0]}
                </button>
                {camOn ? (
                  <button className="btn small ghost" onClick={stopCamera}>
                    Stop camera
                  </button>
                ) : (
                  <button className="btn small ghost" onClick={startCamera}>
                    Start camera
                  </button>
                )}
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Result</h2>
              {ins && (
                <span className={`badge ${ins.overall === "NOMINAL" ? "PASS" : ins.overall}`}>
                  <span className={`dot ${ins.overall === "NOMINAL" ? "PASS" : ins.overall}`} />
                  {ins.overall === "NOMINAL" ? "Nominal" : ins.overall === "REVIEW" ? "Review" : "Reject"}
                </span>
              )}
            </div>
            {scanError && <div className="notice warn">Scan failed: {scanError}</div>}
            {!ins && !scanError && (
              <p className="muted small">
                {scanning
                  ? "Checking for burn marks, corrosion, solder faults and cracks…"
                  : "Nothing scanned yet. Hold the camera still on a board, make a fist, or upload a photo."}
              </p>
            )}
            {ins && (
              <div className="stack" style={{ gap: 14 }}>
                <p style={{ color: "var(--navy)" }}>{ins.summary}</p>
                {ins.equipment_detected && ins.equipment_type && (
                  <div className="small muted">
                    Seen: <b>{ins.equipment_type}</b>
                  </div>
                )}
                {ins.findings.length > 0 && (
                  <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
                    {ins.findings.map((f, i) => (
                      <li key={i} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 10 }}>
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 2,
                            background: SEV_COLOR[f.severity],
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 12,
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          {i + 1}
                        </span>
                        <span className="small">
                          <b>{f.type[0].toUpperCase() + f.type.slice(1).replace(/_/g, " ")}</b>{" "}
                          <span className="faint">
                            ({f.severity}, {Math.round(f.confidence * 100)}% sure)
                          </span>
                          <div>{f.description}</div>
                          <div className="faint">{f.location}</div>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="small faint">
                  {ins.engine === "claude" ? `Claude vision (${ins.model})` : "Offline colour/texture screen"} ·{" "}
                  {result?.source === "auto" ? "auto-scan" : result?.source === "photo" ? "uploaded photo" : "frozen frame"}
                </div>
                {ins.notice && <div className="notice small">{ins.notice}</div>}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Hand controls</h2>
              <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={handsOn} onChange={(e) => setHandsOn(e.target.checked)} />
                Enabled
              </label>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {(Object.keys(GESTURES) as (keyof typeof GESTURES)[]).map((k) => (
                <li
                  key={k}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px 1fr",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 10px",
                    borderRadius: 2,
                    background: gesture === k ? "var(--sky-soft)" : "transparent",
                    transition: "background .15s",
                  }}
                >
                  {(() => {
                    const Icon = GESTURE_ICON[k];
                    return <Icon size={28} style={{ justifySelf: "center", color: gesture === k ? "var(--navy)" : "var(--ink-2)" }} />;
                  })()}
                  <span className="small">
                    <b>{GESTURES[k].name}</b>
                    {k !== "point" && <span className="faint">, hold for half a second</span>}
                    <div className="muted">{GESTURES[k].action}</div>
                  </span>
                </li>
              ))}
            </ul>
            <div className="stack" style={{ gap: 10, marginTop: 16 }}>
              <label className="small check">
                <input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />
                Scan automatically when the picture settles
              </label>
              <label className="small check">
                <input type="checkbox" checked={loupe} onChange={(e) => setLoupe(e.target.checked)} />
                Magnifier on touch (tap or drag on the picture)
              </label>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
