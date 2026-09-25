"""Validation on real hardware: NASA's MOSFET thermal-overstress ageing data.

The NASA PCoE runs aged IRF520-class MOSFETs by thermal cycling until they
failed. Their precursor of choice is the rise in on-state resistance, which is
exactly the kind of drift our predictor projects. For every device this module:

1. builds a ΔR_DS(on) % curve against cumulative stress time,
2. scores the devices against each other at a common early point (the same
   lot-relative idea as the burn-in detector),
3. back-tests the drift model: fit a·tⁿ on the first 25 / 50 / 75 % of each
   device's run, with n learned from the *other* devices, and predict where it
   ends up,
4. separates gradual drifters from devices that fail abruptly (a step change
   in resistance with little warning), because no drift model can see the
   latter coming and the numbers should say so.

Input is backend/data/nasa_mosfet_aging.csv, produced by
scripts/import_nasa_mosfet.py. If the file is missing, the API reports that.
"""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data" / "nasa_mosfet_aging.csv"
EARLY_MIN = 60  # common early read point for the lot-relative comparison
CHECKPOINTS = (0.25, 0.5, 0.75)  # share of each device's run the predictor may see
ABRUPT_STEP_PP = 15.0  # a jump this large within ~10 min marks an abrupt failure
MAX_POINTS = 160


def _robust_z(x: np.ndarray) -> np.ndarray:
    med = np.nanmedian(x)
    mad = np.nanmedian(np.abs(x - med)) * 1.4826
    if not np.isfinite(mad) or mad < 1e-9:
        mad = np.nanstd(x) or 1.0
    return (x - med) / mad


def _fit_power(t: np.ndarray, y: np.ndarray) -> tuple[float, float] | None:
    """Least-squares fit of y = a·tⁿ on points with y > 0 (log-log)."""
    m = (t > 0) & (y > 0.05)
    if m.sum() < 5:
        return None
    n, loga = np.polyfit(np.log(t[m]), np.log(y[m]), 1)
    return float(math.exp(loga)), float(n)


def _fit_a(t: np.ndarray, y: np.ndarray, n: float) -> float:
    d = np.power(np.maximum(t, 1e-9), n)
    denom = float(np.sum(d * d))
    return float(np.sum(d * y) / denom) if denom else 0.0


def _curves(df: pd.DataFrame) -> dict[int, pd.DataFrame]:
    out = {}
    for test, g in df.groupby("test"):
        g = g[g["rds_ohm"].notna() & (g["samples"] >= 3)].sort_values("stress_min")
        if len(g) < 60:
            continue
        r = g["rds_ohm"].rolling(9, center=True, min_periods=3).median()
        base = float(r.iloc[:15].median())
        if not np.isfinite(base) or base <= 0:
            continue
        c = pd.DataFrame(
            {
                "t": g["stress_min"].to_numpy(float),
                "rds": r.to_numpy(float),
                "dr": (r.to_numpy(float) / base - 1) * 100,
                "temp": g["package_temp_C"].to_numpy(float),
                "run": g["run"].to_numpy(int),
            }
        )
        c.attrs["base"] = base
        out[int(test)] = c
    return out


def _window(c: pd.DataFrame, t: float, width: float = 10) -> float:
    w = c[(c["t"] >= t - width) & (c["t"] <= t)]
    return float(w["dr"].median()) if len(w) else float("nan")


@lru_cache(maxsize=1)
def analysis() -> dict:
    if not DATA.exists():
        return {"available": False}
    df = pd.read_csv(DATA)
    curves = _curves(df)
    if not curves:
        return {"available": False}

    # Per-device full-run exponents, used leave-one-out for the back-test.
    full_fit = {k: _fit_power(c["t"].to_numpy(), c["dr"].to_numpy()) for k, c in curves.items()}

    devices = []
    for k, c in curves.items():
        t = c["t"].to_numpy()
        total = float(t.max())
        final = float(c["dr"].iloc[-15:].median())
        early = _window(c, EARLY_MIN) if total > EARLY_MIN * 1.5 else float("nan")

        others = [f[1] for j, f in full_fit.items() if j != k and f and 0.1 < f[1] < 2.5]
        n = float(np.median(others)) if others else 0.5
        floor = float(np.nanmin(c["dr"]))
        preds = {}
        for frac in CHECKPOINTS:
            seen = c[c["t"] <= total * frac]
            if len(seen) < 10:
                continue
            a_k = _fit_a(seen["t"].to_numpy(), seen["dr"].to_numpy(), n)
            preds[frac] = max(a_k * total**n, floor)
        a = _fit_a(c[c["t"] <= total * 0.5]["t"].to_numpy(), c[c["t"] <= total * 0.5]["dr"].to_numpy(), n)
        predicted = preds.get(0.5, float("nan"))
        steps = c.set_index("t")["dr"].rolling(10, min_periods=5).median().diff(10).abs()
        max_step = float(np.nanmax(steps.to_numpy())) if steps.notna().any() else 0.0
        kind = "abrupt" if max_step > ABRUPT_STEP_PP else "gradual"

        step = max(1, len(c) // MAX_POINTS)
        pts = c.iloc[::step]
        devices.append(
            {
                "test": k,
                "runs": int(c["run"].nunique()),
                "stress_min": round(total, 1),
                "base_rds_ohm": round(c.attrs["base"], 4),
                "plateau_temp_C": round(float(np.nanmedian(c["temp"])), 1),
                "dr_early_pct": None if math.isnan(early) else round(early, 2),
                "dr_final_pct": round(final, 2),
                "predicted_final_pct": None if math.isnan(predicted) else round(predicted, 2),
                "predictions": {f"{int(f * 100)}": round(v, 2) for f, v in preds.items()},
                "kind": kind,
                "max_step_pp": round(max_step, 1),
                "exponent": round(n, 3),
                "curve": [
                    {"t": round(float(r.t), 1), "dr": round(float(r.dr), 3)}
                    for r in pts.itertuples()
                    if np.isfinite(r.dr)
                ],
                "fit": [
                    {"t": round(float(x), 1), "dr": round(max(a * float(x) ** n, floor), 3)}
                    for x in np.linspace(0, total, 40)
                ],
            }
        )

    # Lot-relative view at the common early point.
    early = np.array([d["dr_early_pct"] if d["dr_early_pct"] is not None else np.nan for d in devices])
    z = _robust_z(early)
    for d, zz in zip(devices, z):
        d["z_early"] = None if not np.isfinite(zz) else round(float(zz), 2)
        d["flag"] = bool(np.isfinite(zz) and zz >= 3.5)

    finals = np.array([d["dr_final_pct"] for d in devices])
    ok = np.isfinite(early)
    rho = (
        float(pd.Series(early[ok]).corr(pd.Series(finals[ok]), method="spearman"))
        if ok.sum() >= 5
        else None
    )

    def err_table(kind: str | None) -> dict:
        out = {}
        for f in CHECKPOINTS:
            key = f"{int(f * 100)}"
            e = [
                abs(d["predictions"][key] - d["dr_final_pct"])
                for d in devices
                if key in d["predictions"] and (kind is None or d["kind"] == kind)
            ]
            out[key] = {"median_abs_error_pp": round(float(np.median(e)), 1) if e else None, "n": len(e)}
        return out

    devices.sort(key=lambda d: d["test"])
    return {
        "available": True,
        "source": "NASA Prognostics Center of Excellence, MOSFET Thermal Overstress Aging (data set 13)",
        "devices": devices,
        "summary": {
            "devices": len(devices),
            "runs": int(df.groupby(["test", "run"]).ngroups),
            "stress_hours": round(float(sum(d["stress_min"] for d in devices)) / 60, 1),
            "early_min": EARLY_MIN,
            "gradual": sum(d["kind"] == "gradual" for d in devices),
            "abrupt": sum(d["kind"] == "abrupt" for d in devices),
            "error_all": err_table(None),
            "error_gradual": err_table("gradual"),
            "error_abrupt": err_table("abrupt"),
            "spearman_early_vs_final": None if rho is None else round(rho, 3),
            "flagged_early": int(sum(d["flag"] for d in devices)),
        },
    }
