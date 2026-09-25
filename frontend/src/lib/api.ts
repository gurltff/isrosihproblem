export type Status = "PASS" | "REVIEW" | "REJECT";

export interface Param {
  key: string;
  label: string;
  short: string;
  unit: string;
  limit_low: number | null;
  limit_high: number | null;
  delta_rel: number;
  delta_abs: number;
  log_scale: boolean;
}

export interface Reason {
  kind: "limit" | "zscore" | "delta" | "drift" | "multivariate";
  param: string | null;
  severity: Status;
  text: string;
  z?: number;
}

export interface Component {
  component_id: string;
  serial: string;
  socket: string;
  status: Status;
  risk: number;
  max_z: number;
  if_score: number;
  early_reject: boolean;
  headline: string;
  primary_param: string | null;
  reasons: Reason[];
  recommendation: string;
  z: Record<string, number>;
  latest: Record<string, number | null>;
}

export interface BatchMeta {
  batch_id: string;
  date: string;
  source: "demo" | "upload";
  hours: number[];
  latest_hour: number;
  in_progress: boolean;
  n: number;
  counts: Record<Status, number>;
  yield_pct: number;
  risk_index: number;
  flags_by_param: Record<string, number>;
  top_param: string | null;
  early_rejects: number;
  socket_hours_saved: number;
}

export interface Backtest {
  parts: number;
  true_early_rejects: number;
  false_early_rejects: number;
  missed: number;
  correct_pass: number;
  precision: number | null;
  recall: number | null;
  socket_hours_saved: number;
  median_abs_pct_error: Record<string, number | null>;
}

export interface DriftModelInfo {
  exponents: Record<string, number>;
  backtest: Backtest;
}

export interface Batch extends BatchMeta {
  components: Component[];
}

export interface Point {
  hour: number;
  value: number;
}

export interface ParamProjection {
  v0: number;
  predicted_168: number;
  band_low: number;
  band_high: number;
  predicted_shift: number;
  predicted_shift_pct: number | null;
  allowed_shift: number;
  slope_per_24h: number;
  exponent: number;
  early_reject: boolean;
  watch: boolean;
  actual_168: number | null;
  curve: Point[];
  envelope: { hour: number; high: number; low: number }[];
}

export interface Projection {
  as_of: number;
  early_reject: boolean;
  watch: boolean;
  params: Record<string, ParamProjection>;
}

export interface Passport extends Component {
  batch_id: string;
  series: Record<string, Point[]>;
  lot_bands: Record<string, { hour: number; median: number; p10: number; p90: number }[]>;
  projection: Projection;
}

export interface DriftRow {
  component_id: string;
  socket: string;
  early_reject: boolean;
  watch: boolean;
  worst_param: string;
  worst_ratio: number;
  actual_fail: boolean | null;
  params: Record<
    string,
    Pick<
      ParamProjection,
      | "v0"
      | "predicted_168"
      | "predicted_shift_pct"
      | "allowed_shift"
      | "actual_168"
      | "slope_per_24h"
      | "early_reject"
      | "watch"
    >
  >;
}

export interface DriftView {
  batch_id: string;
  as_of: number;
  components: DriftRow[];
  early_rejects: number;
  socket_hours_saved: number;
  model: DriftModelInfo;
}

export interface Finding {
  type: string;
  description: string;
  location: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface Inspection {
  engine: "claude" | "local";
  model?: string;
  notice?: string;
  equipment_detected: boolean;
  equipment_type: string;
  overall: "NOMINAL" | "REVIEW" | "REJECT";
  summary: string;
  findings: Finding[];
}

/** True in the GitHub Pages build: no server, API answers are pre-rendered JSON. */
export const STATIC = import.meta.env.VITE_STATIC === "1";

/** Resolve a file in public/ against wherever the app is hosted. */
export const asset = (p: string) => import.meta.env.BASE_URL + p.replace(/^\//, "");

function staticPath(path: string) {
  const [p, q] = path.split("?");
  const asOf = new URLSearchParams(q ?? "").get("as_of");
  return asset(`${p}${asOf ? `_${asOf}` : ""}.json`);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(STATIC ? staticPath(path) : path, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep status text */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const api = {
  health: () => req<{ ok: boolean; claude_vision: boolean; model: string }>("/api/health"),
  params: () => req<Param[]>("/api/params"),
  batches: () => req<{ batches: BatchMeta[]; drift_model: DriftModelInfo }>("/api/batches"),
  batch: (id: string) => req<Batch>(`/api/batches/${enc(id)}`),
  passport: (id: string, cid: string) => req<Passport>(`/api/batches/${enc(id)}/components/${enc(cid)}`),
  drift: (id: string, asOf: number) => req<DriftView>(`/api/batches/${enc(id)}/drift?as_of=${asOf}`),
  componentDrift: (id: string, cid: string, asOf: number) =>
    req<{ component_id: string; series: Record<string, Point[]>; projection: Projection }>(
      `/api/batches/${enc(id)}/components/${enc(cid)}/drift?as_of=${asOf}`
    ),
  upload: (file: File) => {
    if (STATIC)
      return Promise.reject(
        new Error("This hosted demo is read-only. Uploading lot data needs the Python server; see the README to run it.")
      );
    const fd = new FormData();
    fd.append("file", file);
    return req<{ batches: BatchMeta[] }>("/api/upload", { method: "POST", body: fd });
  },
  inspect: (image: Blob, engine: "auto" | "claude" | "local" = "auto") => {
    if (STATIC) return import("./localInspect").then((m) => m.inspectInBrowser(image));
    const fd = new FormData();
    fd.append("image", image, "frame.jpg");
    fd.append("engine", engine);
    return req<Inspection>("/api/vision/inspect", { method: "POST", body: fd });
  },
};

export interface NasaDevice {
  test: number;
  runs: number;
  stress_min: number;
  base_rds_ohm: number;
  plateau_temp_C: number;
  dr_early_pct: number | null;
  dr_final_pct: number;
  predicted_final_pct: number | null;
  predictions: Record<string, number>;
  kind: "gradual" | "abrupt";
  max_step_pp: number;
  exponent: number;
  z_early: number | null;
  flag: boolean;
  curve: { t: number; dr: number }[];
  fit: { t: number; dr: number }[];
}

type ErrTable = Record<string, { median_abs_error_pp: number | null; n: number }>;

export interface NasaValidation {
  available: boolean;
  source?: string;
  devices: NasaDevice[];
  summary: {
    devices: number;
    runs: number;
    stress_hours: number;
    early_min: number;
    gradual: number;
    abrupt: number;
    error_all: ErrTable;
    error_gradual: ErrTable;
    error_abrupt: ErrTable;
    spearman_early_vs_final: number | null;
    flagged_early: number;
  };
}

export const templateUrl = STATIC ? asset("api/template.csv") : "/api/template.csv";

export const nasaApi = () => req<NasaValidation>("/api/nasa");
