import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type BatchMeta, type DriftModelInfo, type Param } from "./api";

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
  const [params, setParams] = useState<Param[]>([]);
  const [batches, setBatches] = useState<BatchMeta[]>([]);
  const [model, setModel] = useState<DriftModelInfo | null>(null);
  const [claudeVision, setClaudeVision] = useState(false);
  const [loading, setLoading] = useState(true);
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
    refresh();
  }, [refresh]);

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

/** Load something async, re-running when deps change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e) => live && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false })
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
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
