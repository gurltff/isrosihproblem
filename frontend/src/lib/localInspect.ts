import type { Finding, Inspection } from "./api";

/**
 * Browser copy of the server's offline surface screen (backend/app/vision.py,
 * _inspect_local), used by the static GitHub Pages build where there is no
 * server. It flags rust-coloured regions and dark, desaturated patches; it
 * cannot name defects the way Claude vision can.
 */
export async function inspectInBrowser(image: Blob): Promise<Inspection> {
  const bmp = await createImageBitmap(image);
  const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * scale));
  const H = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  const n = W * H;
  const lum = new Float32Array(n);
  const hue = new Float32Array(n);
  const sat = new Float32Array(n);
  const val = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4] / 255;
    const g = px[i * 4 + 1] / 255;
    const b = px[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn + 1e-9;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    hue[i] = h;
    sat[i] = mx > 0 ? (mx - mn) / (mx + 1e-9) : 0;
    val[i] = mx;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Edge strength and overall texture decide whether there is hardware in frame.
  let edgeSum = 0;
  const edge = new Float32Array(n);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (lum[i + 1] - lum[i - 1]) / 2;
      const gy = (lum[i + W] - lum[i - W]) / 2;
      edge[i] = Math.hypot(gx, gy);
      edgeSum += edge[i];
    }
  const mean = lum.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const equipment = edgeSum / n > 0.008 || std > 0.1;

  const findings: Finding[] = [];

  const rust = new Uint8Array(n);
  let rustCount = 0;
  for (let i = 0; i < n; i++) {
    if (hue[i] >= 8 && hue[i] <= 38 && sat[i] > 0.45 && val[i] > 0.18 && val[i] < 0.75) {
      rust[i] = 1;
      rustCount++;
    }
  }
  const frac = rustCount / n;
  if (frac > 0.002 && frac < 0.12) {
    const box = bbox(rust, W, H);
    if (box)
      findings.push({
        type: "corrosion",
        description: "Rust-coloured region that stands out from the board finish; possible oxidation or corrosion.",
        location: where(box),
        severity: "medium",
        confidence: +Math.min(0.35 + frac * 4, 0.6).toFixed(2),
        box,
      });
  }

  const bs = 16;
  const rows = Math.floor(H / bs);
  const cols = Math.floor(W / bs);
  if (rows >= 4 && cols >= 4) {
    const L: number[] = [];
    const S: number[] = [];
    for (let r = 0; r < rows; r++)
      for (let cc = 0; cc < cols; cc++) {
        let l = 0;
        let s = 0;
        for (let y = r * bs; y < (r + 1) * bs; y++)
          for (let x = cc * bs; x < (cc + 1) * bs; x++) {
            l += lum[y * W + x];
            s += sat[y * W + x];
          }
        L.push(l / (bs * bs));
        S.push(s / (bs * bs));
      }
    const zL = robustZ(L);
    const zS = robustZ(S);
    const mask = new Uint8Array(n);
    let flagged = 0;
    zL.forEach((z, k) => {
      const score = Math.max(-z, 0) * 0.6 + Math.max(-zS[k], 0) * 0.4;
      if (score > 4.5) {
        flagged++;
        const r = Math.floor(k / cols);
        const cc = k % cols;
        for (let y = r * bs; y < (r + 1) * bs; y++) for (let x = cc * bs; x < (cc + 1) * bs; x++) mask[y * W + x] = 1;
      }
    });
    const share = flagged / (rows * cols);
    if (share > 0 && share < 0.15) {
      const box = bbox(mask, W, H);
      if (box)
        findings.push({
          type: "thermal_discoloration",
          description: "Dark, desaturated patch unlike the surrounding surface; could be a scorch mark or a shadow. Check by eye.",
          location: where(box),
          severity: "low",
          confidence: 0.3,
          box,
        });
    }
  }

  if (!equipment)
    return {
      engine: "local",
      notice: "Checked in your browser. The hosted demo has no server, so Claude vision is off.",
      equipment_detected: false,
      equipment_type: "",
      overall: "NOMINAL",
      summary: "No hardware found in the picture. Move closer or add light.",
      findings: [],
    };
  return {
    engine: "local",
    notice: "Checked in your browser. The hosted demo has no server, so Claude vision is off.",
    equipment_detected: true,
    equipment_type: "electronic hardware (unclassified)",
    part_identity: "Not identified (offline check cannot read parts)",
    markings: "Not read (needs Claude vision)",
    marking_check: "cannot tell",
    marking_note: "",
    checklist: [
      { item: "No burn, scorch or heat discolouration", result: findings.some((f) => f.type === "thermal_discoloration") ? "fail" : "pass", note: "colour and texture outliers only" },
      { item: "Leads / terminations free of corrosion", result: findings.some((f) => f.type === "corrosion") ? "fail" : "pass", note: "rust-coloured regions only" },
    ],
    overall: findings.length ? "REVIEW" : "NOMINAL",
    summary: findings.length
      ? `${findings.length} region(s) look unlike the rest of the surface. Check them by eye.`
      : "No colour or texture outliers on the visible surface.",
    findings,
  };
}

function robustZ(a: number[]): number[] {
  const s = [...a].sort((x, y) => x - y);
  const med = s[Math.floor(s.length / 2)];
  const dev = a.map((v) => Math.abs(v - med)).sort((x, y) => x - y);
  const mad = dev[Math.floor(dev.length / 2)] * 1.4826 + 1e-6;
  return a.map((v) => (v - med) / mad);
}

function pct(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
}

function bbox(mask: Uint8Array, W: number, H: number): Finding["box"] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      xs.push(i % W);
      ys.push(Math.floor(i / W));
    }
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const pad = 0.02;
  const x = Math.max(pct(xs, 2) / W - pad, 0);
  const y = Math.max(pct(ys, 2) / H - pad, 0);
  return {
    x: +x.toFixed(3),
    y: +y.toFixed(3),
    w: +(Math.min(pct(xs, 98) / W + pad, 1) - x).toFixed(3),
    h: +(Math.min(pct(ys, 98) / H + pad, 1) - y).toFixed(3),
  };
}

function where(b: Finding["box"]) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const v = cy < 0.33 ? "upper" : cy > 0.66 ? "lower" : "middle";
  const h = cx < 0.33 ? "left" : cx > 0.66 ? "right" : "centre";
  return v === "middle" && h === "centre" ? "centre of frame" : `${v} ${h} of frame`;
}
