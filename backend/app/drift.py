"""Drift predictor: project a part's 168 h reading from its early read points.

Burn-in drift of MOSFET parameters is sub-linear in time, so each parameter is
modelled as

    f(v(t)) = f(v0) + a * (t / 24) ** n

where ``f`` is ``log`` for leakage-type parameters and the identity otherwise.
The exponent ``n`` is learned per parameter from lots that already completed
168 h; ``a`` is fitted per part from whatever read points it has so far. With
only 0 h and 24 h this is a direct extrapolation - which is the point: a part
whose projected end-of-test shift already breaks the delta criterion can be
pulled at 24 h instead of occupying a socket for another 144 h.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .params import BY_KEY, FINAL_HOUR, PARAMS, Param

DEFAULT_EXPONENT = 0.5
CURVE_HOURS = (0, 12, 24, 48, 72, 96, 120, 144, 168)


def fwd(p: Param, v):
    return np.log(np.maximum(v, 1e-9)) if p.log_scale else v


def inv(p: Param, v):
    return np.exp(v) if p.log_scale else v


@dataclass
class DriftModel:
    exponents: dict[str, float]
    # 90th percentile absolute error in model space from back-testing.
    band: dict[str, float]
    backtest: dict


def _fit_a(p: Param, hours: np.ndarray, values: np.ndarray, n: float) -> float:
    base = fwd(p, values[0])
    d = (hours[1:] / 24.0) ** n
    y = fwd(p, values[1:]) - base
    denom = float(np.sum(d * d))
    return float(np.sum(d * y) / denom) if denom > 0 else 0.0


def predict_value(p: Param, hours, values, n: float, t: float) -> float:
    hours = np.asarray(hours, dtype=float)
    values = np.asarray(values, dtype=float)
    if len(hours) < 2:
        return float(values[0])
    a = _fit_a(p, hours, values, n)
    return float(inv(p, fwd(p, values[0]) + a * (t / 24.0) ** n))


def arrays(df: pd.DataFrame) -> dict[str, np.ndarray]:
    """One part's read points as sorted numpy arrays (hour + each parameter)."""
    df = df.sort_values("hour")
    out = {"hour": df["hour"].to_numpy(float)}
    for p in PARAMS:
        out[p.key] = df[p.key].to_numpy(float)
    return out


def _series(a: dict[str, np.ndarray], key: str, max_hour: int):
    m = (a["hour"] <= max_hour) & ~np.isnan(a[key])
    return a["hour"][m], a[key][m]


def _at(a: dict[str, np.ndarray], key: str, hour: int) -> float | None:
    m = a["hour"] == hour
    if not m.any() or np.isnan(a[key][m][0]):
        return None
    return float(a[key][m][0])


def learn(history: pd.DataFrame) -> DriftModel:
    """Learn drift exponents from lots with complete 0/24/168 h records."""
    parts = [(k[0], arrays(g)) for k, g in history.groupby(["batch_id", "component_id"])]
    exponents: dict[str, float] = {}
    for p in PARAMS:
        estimates = []
        for _, a in parts:
            vals = [_at(a, p.key, h) for h in (0, 24, FINAL_HOUR)]
            if None in vals:
                continue
            v0, v24, v168 = vals
            d24 = fwd(p, v24) - fwd(p, v0)
            d168 = fwd(p, v168) - fwd(p, v0)
            # Only parts whose early drift clearly exceeds measurement noise
            # carry information about the exponent.
            noise = 0.05 if p.log_scale else p.allowed_shift(v0) * 0.15
            if abs(d24) < noise or d24 * d168 <= 0:
                continue
            estimates.append(math.log(d168 / d24) / math.log(FINAL_HOUR / 24))
        n = float(np.median(estimates)) if len(estimates) >= 5 else DEFAULT_EXPONENT
        exponents[p.key] = float(np.clip(n, 0.25, 1.0))

    band, backtest = _backtest(parts, exponents)
    return DriftModel(exponents=exponents, band=band, backtest=backtest)


def _backtest(parts: list[tuple[str, dict]], exponents: dict[str, float]):
    """Predict 168 h from 0 h + 24 h for every completed part and score it."""
    errors: dict[str, list[float]] = {p.key: [] for p in PARAMS}
    pct_err: dict[str, list[float]] = {p.key: [] for p in PARAMS}
    tp = fp = fn = tn = 0
    per_lot: dict[str, dict] = {}
    for lot, g in parts:
        if FINAL_HOUR not in g["hour"]:
            continue
        predicted_fail = actual_fail = False
        for p in PARAMS:
            h, v = _series(g, p.key, 24)
            if len(h) < 2:
                continue
            pred = predict_value(p, h, v, exponents[p.key], FINAL_HOUR)
            actual = _at(g, p.key, FINAL_HOUR)
            if actual is None:
                continue
            errors[p.key].append(abs(fwd(p, pred) - fwd(p, actual)))
            pct_err[p.key].append(abs(pred - actual) / max(abs(actual), 1e-9) * 100)
            predicted_fail |= breaches(p, v[0], pred)
            actual_fail |= breaches(p, v[0], actual)
        lot_stats = per_lot.setdefault(lot, {"tp": 0, "fp": 0, "fn": 0, "tn": 0})
        key = ("tp" if actual_fail else "fp") if predicted_fail else ("fn" if actual_fail else "tn")
        lot_stats[key] += 1
        tp, fp, fn, tn = (
            tp + (key == "tp"),
            fp + (key == "fp"),
            fn + (key == "fn"),
            tn + (key == "tn"),
        )

    band = {
        k: float(np.percentile(e, 90)) if e else (0.2 if BY_KEY[k].log_scale else 0.0)
        for k, e in errors.items()
    }
    backtest = {
        "parts": tp + fp + fn + tn,
        "true_early_rejects": tp,
        "false_early_rejects": fp,
        "missed": fn,
        "correct_pass": tn,
        "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        "recall": round(tp / (tp + fn), 3) if tp + fn else None,
        "socket_hours_saved": (tp + fp) * (FINAL_HOUR - 24),
        "median_abs_pct_error": {
            k: round(float(np.median(v)), 2) if v else None for k, v in pct_err.items()
        },
        "per_lot": per_lot,
    }
    return band, backtest


def breaches(p: Param, v0: float, v: float) -> bool:
    if p.limit_high is not None and v > p.limit_high:
        return True
    if p.limit_low is not None and v < p.limit_low:
        return True
    return abs(v - v0) > p.allowed_shift(v0)


def project_component(model: DriftModel, g: pd.DataFrame | dict, as_of: int) -> dict:
    """Projection for one part using read points up to ``as_of`` hours."""
    if isinstance(g, pd.DataFrame):
        g = arrays(g)
    out: dict = {"as_of": as_of, "params": {}, "early_reject": False, "watch": False}
    for p in PARAMS:
        h, v = _series(g, p.key, as_of)
        if len(h) == 0:
            continue
        n = model.exponents[p.key]
        v0 = float(v[0])
        allowed = p.allowed_shift(v0)
        if len(h) >= 2:
            a = _fit_a(p, h, v, n)
        else:
            a = 0.0
        base = fwd(p, v0)

        def at(t: float, a=a, base=base, n=n):
            return float(inv(p, base + a * (t / 24.0) ** n))

        pred = at(FINAL_HOUR)
        band = model.band[p.key]
        lo = float(inv(p, fwd(p, pred) - band))
        hi = float(inv(p, fwd(p, pred) + band))
        shift = pred - v0
        fail = len(h) >= 2 and breaches(p, v0, pred)
        watch = len(h) >= 2 and not fail and abs(shift) > 0.7 * allowed
        actual = _at(g, p.key, FINAL_HOUR)
        out["params"][p.key] = {
            "v0": v0,
            "predicted_168": pred,
            "band_low": min(lo, hi),
            "band_high": max(lo, hi),
            "predicted_shift": shift,
            "predicted_shift_pct": shift / abs(v0) * 100 if v0 else None,
            "allowed_shift": allowed,
            "slope_per_24h": (at(48) - at(24)) if len(h) >= 2 else 0.0,
            "exponent": n,
            "early_reject": fail,
            "watch": watch,
            "actual_168": actual,
            "curve": [{"hour": t, "value": at(t)} for t in CURVE_HOURS],
            "envelope": [
                {
                    "hour": t,
                    "high": v0 + allowed * (t / FINAL_HOUR) ** n,
                    "low": max(v0 - allowed * (t / FINAL_HOUR) ** n, 0.0)
                    if p.log_scale
                    else v0 - allowed * (t / FINAL_HOUR) ** n,
                }
                for t in CURVE_HOURS
            ],
        }
        out["early_reject"] |= fail
        out["watch"] |= watch
    return out
