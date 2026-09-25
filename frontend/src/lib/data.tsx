import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type BatchMeta, type DriftModelInfo, type Known, type Param } from "./api";

interface DataState {
  params: Param[];
  batches: BatchMeta[];
  model: DriftModelInfo | null;
  claudeVision: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  param: (key: string | null | undefined) => Param | undefined;
}

const Ctx = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  // In the static build these answers are compiled in, so the first render
  // already has them; on the server build they arrive a moment later.
  const [init] = useState(() => ({
    p: (api.params() as Known<Param[]>).value,
    b: (api.batches() as Known<{ batches: BatchMeta[]; drift_model: DriftModelInfo }>).value,
    h: (api.health() as Known<{ claude_vision: boolean }>).value,
  }));
  const [params, setParams] = useState<Param[]>(init.p ?? []);
  const [batches, setBatches] = useState<BatchMeta[]>(init.b?.batches ?? []);
  const [model, setModel] = useState<DriftModelInfo | null>(init.b?.drift_model ?? null);
  const [claudeVision, setClaudeVision] = useState(init.h?.claude_vision ?? false);
  const [loading, setLoading] = useState(!(init.p && init.b && init.h));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, b, h] = await Promise.all([api.params(), api.batches(), api.health()]);
      setParams(p);
      setBatches(b.batches);
      setModel(b.drift_model);
      setClaudeVision(h.claude_vision);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const param = useCallback((key: string | null | undefined) => params.find((p) => p.key === key), [params]);

  return (
    <Ctx.Provider value={{ params, batches, model, claudeVision, loading, error, refresh, param }}>
      {children}
    </Ctx.Provider>
  );
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData outside DataProvider");
  return v;
}

/**
 * Load something async, re-running when deps change. If the answer is
 * already known (compiled-in or fetched before) it is returned on the very
 * first render, so a page never flashes empty. While a new answer loads, the
 * previous one stays on screen.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const promise = useMemo(fn, deps) as Known<T>;
  const [res, setRes] = useState<{ p: Promise<T>; data: T | null; error: string | null } | null>(null);
  const known = "value" in promise;
  useEffect(() => {
    if (known) return;
    let live = true;
    promise.then(
      (data) => live && setRes({ p: promise, data, error: null }),
      (e) => live && setRes({ p: promise, data: null, error: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      live = false;
    };
  }, [promise, known]);
  if (known) return { data: promise.value as T, error: null, loading: false };
  if (res && res.p === promise) return { data: res.data, error: res.error, loading: false };
  return { data: res?.data ?? null, error: null, loading: true };
}

const LOT_KEY = "sentinel.lot";

export function rememberLot(id: string) {
  try {
    localStorage.setItem(LOT_KEY, id);
  } catch {
    /* storage may be unavailable */
  }
}

export function defaultLot(batches: BatchMeta[]): string | undefined {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LOT_KEY);
  } catch {
    /* ignore */
  }
  if (saved && batches.some((b) => b.batch_id === saved)) return saved;
  return batches[batches.length - 1]?.batch_id;
}
