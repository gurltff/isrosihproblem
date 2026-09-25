"""In-memory store of burn-in lots and their cached analyses."""

from __future__ import annotations

import io
import threading
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from . import detector, drift, lotstats
from .params import FINAL_HOUR, PARAM_KEYS, PARAMS, resolve_column

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SEED = DATA_DIR / "seed_burnin.csv"
ID_COLS = ("batch_id", "component_id", "hour")
OPTIONAL_COLS = ("batch_date", "serial", "socket")


class CSVError(ValueError):
    pass


def normalise(df: pd.DataFrame, default_batch: str | None = None) -> pd.DataFrame:
    rename = {}
    for c in df.columns:
        low = c.strip().lower().replace(" ", "_")
        if low in ID_COLS or low in OPTIONAL_COLS:
            rename[c] = low
        elif low in ("lot", "lot_id", "batch"):
            rename[c] = "batch_id"
        elif low in ("id", "part_id", "component", "part"):
            rename[c] = "component_id"
        elif low in ("hours", "time_h", "t_hours", "read_point"):
            rename[c] = "hour"
        elif (key := resolve_column(c)) is not None:
            rename[c] = key
    df = df.rename(columns=rename)
    if "batch_id" not in df and default_batch:
        df["batch_id"] = default_batch
    missing = [c for c in ID_COLS if c not in df]
    if missing:
        raise CSVError(f"Missing required column(s): {', '.join(missing)}")
    present = [k for k in PARAM_KEYS if k in df]
    if not present:
        raise CSVError(
            "No parameter columns recognised. Expected any of: " + ", ".join(PARAM_KEYS)
        )
    for k in PARAM_KEYS:
        if k not in df:
            df[k] = np.nan
    df["hour"] = pd.to_numeric(df["hour"], errors="coerce")
    if df["hour"].isna().any():
        raise CSVError("Column 'hour' must be numeric (0, 24, 96, 168 …).")
    df["hour"] = df["hour"].astype(int)
    for k in PARAM_KEYS:
        df[k] = pd.to_numeric(df[k], errors="coerce")
    for c in OPTIONAL_COLS:
        if c not in df:
            df[c] = ""
    df["batch_id"] = df["batch_id"].astype(str).str.strip()
    df["component_id"] = df["component_id"].astype(str).str.strip()
    if 0 not in set(df["hour"]):
        raise CSVError("Every lot needs a 0 h (pre burn-in) reading as its baseline.")
    return df[[*ID_COLS, *OPTIONAL_COLS, *PARAM_KEYS]]


class Store:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.df = pd.DataFrame()
        self.analyses: dict[str, dict] = {}
        self.model: drift.DriftModel | None = None
        self.sources: dict[str, str] = {}

    # ---------------------------------------------------------------- loading
    def load_seed(self) -> None:
        if not SEED.exists():
            import runpy

            runpy.run_path(
                str(DATA_DIR.parent / "scripts" / "generate_seed.py"), run_name="__main__"
            )
        df = normalise(pd.read_csv(SEED))
        with self._lock:
            self.df = df
            self.sources = {b: "demo" for b in df["batch_id"].unique()}
            self._rebuild()

    def add_csv(self, raw: bytes, filename: str) -> list[str]:
        try:
            df = pd.read_csv(io.BytesIO(raw))
        except Exception as e:  # noqa: BLE001 - surface parser errors verbatim
            raise CSVError(f"Could not parse CSV: {e}") from e
        default = Path(filename or "upload").stem.upper()[:24] or "UPLOAD"
        df = normalise(df, default_batch=default)
        if df["batch_date"].eq("").all():
            df["batch_date"] = date.today().isoformat()
        lots = sorted(df["batch_id"].unique())
        with self._lock:
            self.df = pd.concat([self.df[~self.df["batch_id"].isin(lots)], df], ignore_index=True)
            for b in lots:
                self.sources[b] = "upload"
            self._rebuild()
        return lots

    def _rebuild(self) -> None:
        complete = self.df.groupby(["batch_id", "component_id"])["hour"].transform("max")
        history = self.df[complete >= FINAL_HOUR]
        self.model = drift.learn(history)
        self.analyses = {
            b: detector.analyze_batch(g, self.model) for b, g in self.df.groupby("batch_id")
        }

    # ---------------------------------------------------------------- queries
    def batch_ids(self) -> list[str]:
        order = (
            self.df.groupby("batch_id")["batch_date"].first().sort_values(kind="stable").index
        )
        return list(order)

    def batch_meta(self, b: str) -> dict:
        g = self.df[self.df["batch_id"] == b]
        a = self.analyses[b]
        return {
            "batch_id": b,
            "date": str(g["batch_date"].iloc[0]),
            "source": self.sources.get(b, "upload"),
            "hours": a["hours"],
            "latest_hour": a["latest_hour"],
            "in_progress": a["latest_hour"] < FINAL_HOUR,
            "lot_verdict": lotstats.lot_verdict(a["summary"], a["latest_hour"]),
            **a["summary"],
        }

    def lot(self, b: str) -> pd.DataFrame:
        return self.df[self.df["batch_id"] == b]

    def component_frame(self, b: str, cid: str) -> pd.DataFrame:
        g = self.df[(self.df["batch_id"] == b) & (self.df["component_id"] == cid)]
        return g.sort_values("hour")

    def lot_bands(self, b: str) -> dict:
        g = self.lot(b)
        out = {}
        for p in PARAMS:
            rows = []
            for h, gh in g.groupby("hour"):
                v = gh[p.key].dropna()
                if v.empty:
                    continue
                rows.append(
                    {
                        "hour": int(h),
                        "median": float(v.median()),
                        "p10": float(v.quantile(0.10)),
                        "p90": float(v.quantile(0.90)),
                    }
                )
            out[p.key] = rows
        return out


store = Store()
