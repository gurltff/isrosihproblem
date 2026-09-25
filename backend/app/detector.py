"""Dynamic anomaly detector.

Every part is judged against its own lot, not against a fixed datasheet
number. Two complementary detectors run per lot:

* Robust z-scores (median / MAD) on each parameter's level and on its shift
  since 0 h. These produce the human-readable explanations.
* An Isolation Forest over all features together, which catches parts that are
  slightly off in several parameters at once - a pattern no single-parameter
  check would flag.

The results are merged with hard limit checks and the drift projection into a
PASS / REVIEW / REJECT disposition and a 0-100 risk score.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from .drift import DriftModel, arrays, fwd, project_component
from .params import BY_KEY, FINAL_HOUR, PARAMS, Param

Z_REVIEW = 3.5
Z_REJECT = 6.0
MIN_LOT_FOR_IFOREST = 12

RECOMMENDATION = {
    "REJECT": "Remove from the flight lot and quarantine. Tag for failure analysis "
    "(electrical re-test, then decap / SEM if the signature is confirmed).",
    "REVIEW": "Hold for QA engineer review. Re-measure at the next read point and "
    "compare against the lot trend before disposition.",
    "PASS": "Nominal for this lot. Continue burn-in.",
}


def robust_z(x: np.ndarray) -> tuple[np.ndarray, float, float]:
    med = float(np.nanmedian(x))
    mad = float(np.nanmedian(np.abs(x - med))) * 1.4826
    if not np.isfinite(mad) or mad < 1e-12:
        sd = float(np.nanstd(x))
        mad = sd if sd > 1e-12 else 1.0
    return (x - med) / mad, med, mad


def _fmt(p: Param, v: float) -> str:
    if p.key == "vth_V":
        return f"{v:.3f} {p.unit}"
    if abs(v) >= 100:
        return f"{v:.0f} {p.unit}"
    return f"{v:.1f} {p.unit}"


def _limit_text(p: Param) -> str:
    if p.limit_low is not None and p.limit_high is not None:
        return f"{p.limit_low:g}–{p.limit_high:g} {p.unit}"
    if p.limit_high is not None:
        return f"≤ {p.limit_high:g} {p.unit}"
    return f"≥ {p.limit_low:g} {p.unit}"


def _within_limits(p: Param, v: float) -> bool:
    if p.limit_high is not None and v > p.limit_high:
        return False
    if p.limit_low is not None and v < p.limit_low:
        return False
    return True


def analyze_batch(lot: pd.DataFrame, model: DriftModel) -> dict:
    lot = lot.sort_values(["component_id", "hour"])
    hours = sorted(int(h) for h in lot["hour"].unique())
    latest = hours[-1]
    ids = sorted(lot["component_id"].unique())
    wide = {h: lot[lot["hour"] == h].set_index("component_id").reindex(ids) for h in hours}
    first = wide[hours[0]]
    last = wide[latest]

    # ---- features -------------------------------------------------------
    feats: dict[str, np.ndarray] = {}
    meta: dict[str, tuple[Param, str]] = {}
    medians: dict[str, float] = {}
    for p in PARAMS:
        lvl = fwd(p, last[p.key].to_numpy(float))
        feats[f"{p.key}|level"] = lvl
        meta[f"{p.key}|level"] = (p, "level")
        if latest > hours[0]:
            d = fwd(p, last[p.key].to_numpy(float)) - fwd(p, first[p.key].to_numpy(float))
            feats[f"{p.key}|shift"] = d
            meta[f"{p.key}|shift"] = (p, "shift")

    zmat = {}
    for k, x in feats.items():
        z, med, _ = robust_z(x)
        z = np.nan_to_num(z)
        # Falling leakage is benign; only rising leakage counts against a part.
        if meta[k][0].log_scale:
            z = np.maximum(z, 0)
        zmat[k] = z
        medians[k] = med

    # ---- isolation forest ----------------------------------------------
    X = np.column_stack([np.clip(z, -12, 12) for z in zmat.values()])
    if len(ids) >= MIN_LOT_FOR_IFOREST:
        forest = IsolationForest(n_estimators=150, contamination="auto", random_state=0)
        forest.fit(X)
        raw = -forest.score_samples(X)  # higher = more anomalous, ~0.35..0.8
        if_outlier = forest.predict(X) == -1
    else:
        raw = np.full(len(ids), 0.4)
        if_outlier = np.zeros(len(ids), dtype=bool)
    if_norm = np.clip((raw - 0.45) / 0.25, 0, 1)

    # ---- per component ---------------------------------------------------
    groups = {cid: arrays(g) for cid, g in lot.groupby("component_id")}
    first_np = {p.key: first[p.key].to_numpy(float) for p in PARAMS}
    last_np = {p.key: last[p.key].to_numpy(float) for p in PARAMS}
    wide_np = {h: {p.key: wide[h][p.key].to_numpy(float) for p in PARAMS} for h in hours}
    serials = first["serial"].fillna("").astype(str).tolist()
    sockets = first["socket"].fillna("").astype(str).tolist()
    components = []
    for i, cid in enumerate(ids):
        g = groups[cid]
        reasons: list[dict] = []
        zs = {k: float(zmat[k][i]) for k in zmat}
        max_key = max(zs, key=lambda k: abs(zs[k]))
        max_z = abs(zs[max_key])

        # Hard limit breaches at any read point.
        limit_breach = False
        for h in hours:
            for p in PARAMS:
                v = float(wide_np[h][p.key][i])
                if not math.isnan(v) and not _within_limits(p, v):
                    limit_breach = True
                    reasons.append(
                        {
                            "kind": "limit",
                            "param": p.key,
                            "severity": "REJECT",
                            "text": f"{p.label} {_fmt(p, v)} at {h} h is outside the "
                            f"screening limit ({_limit_text(p)}).",
                        }
                    )

        # Statistical outliers vs the lot.
        for k in sorted(zs, key=lambda k: -abs(zs[k])):
            z = zs[k]
            if abs(z) < Z_REVIEW:
                break
            p, kind = meta[k]
            reasons.append(_z_reason(p, kind, z, i, first_np, last_np, latest, medians[k]))

        # Drift projection (only meaningful before the final read point).
        projection = project_component(model, g, latest)
        early = latest < FINAL_HOUR and projection["early_reject"]
        final_delta_fail = False
        if latest >= FINAL_HOUR:
            for p in PARAMS:
                v0 = float(first_np[p.key][i])
                vf = float(last_np[p.key][i])
                if abs(vf - v0) > p.allowed_shift(v0):
                    final_delta_fail = True
                    reasons.append(
                        {
                            "kind": "delta",
                            "param": p.key,
                            "severity": "REJECT",
                            "text": f"{p.label} shifted {_fmt(p, vf - v0)} over burn-in "
                            f"({(vf - v0) / abs(v0) * 100:+.1f}%), beyond the allowed "
                            f"±{_fmt(p, p.allowed_shift(v0))}.",
                        }
                    )
        else:
            for key, pr in projection["params"].items():
                p = BY_KEY[key]
                if pr["early_reject"] or pr["watch"]:
                    verb = "early reject" if pr["early_reject"] else "watch"
                    reasons.append(
                        {
                            "kind": "drift",
                            "param": key,
                            "severity": "REJECT" if pr["early_reject"] else "REVIEW",
                            "text": f"Projected {p.short} at 168 h: {_fmt(p, pr['predicted_168'])} "
                            f"(shift {pr['predicted_shift_pct']:+.1f}%, allowed "
                            f"±{_fmt(p, pr['allowed_shift'])}) — {verb}"
                            + (
                                f"; pulling it now frees {FINAL_HOUR - latest} h of socket time."
                                if pr["early_reject"]
                                else "."
                            ),
                        }
                    )

        # The forest alone is noisy on 64 parts; require it to agree with at
        # least two moderately elevated features before calling a part unusual.
        multivariate = bool(if_outlier[i]) and sum(abs(z) >= 2 for z in zs.values()) >= 2
        if multivariate and max_z < Z_REVIEW:
            reasons.append(
                {
                    "kind": "multivariate",
                    "param": None,
                    "severity": "REVIEW",
                    "text": "Combined signature is unusual for this lot (Isolation Forest "
                    f"score {if_norm[i]:.2f}): "
                    + ", ".join(
                        f"{meta[k][0].short} {'shift' if meta[k][1] == 'shift' else 'level'} "
                        f"z {zs[k]:+.1f}"
                        for k in sorted(zs, key=lambda k: -abs(zs[k]))[:3]
                    )
                    + " — no single parameter is extreme on its own.",
                }
            )

        if limit_breach or final_delta_fail or early or max_z >= Z_REJECT:
            status = "REJECT"
        elif max_z >= Z_REVIEW or projection["watch"] or multivariate:
            status = "REVIEW"
        else:
            status = "PASS"

        risk = 100 / (1 + math.exp(-(max_z - Z_REVIEW) * 1.1)) * 0.85 + 15 * float(if_norm[i])
        if status == "REJECT":
            risk = max(risk, 85)
        elif status == "REVIEW":
            risk = min(max(risk, 45), 84)
        else:
            risk = min(risk, 40)

        reasons.sort(key=lambda r: {"REJECT": 0, "REVIEW": 1}.get(r["severity"], 2))
        primary = reasons[0] if reasons else None
        components.append(
            {
                "component_id": cid,
                "serial": serials[i],
                "socket": sockets[i],
                "status": status,
                "risk": round(risk),
                "max_z": round(max_z, 2),
                "if_score": round(float(if_norm[i]), 3),
                "early_reject": bool(early),
                "headline": _headline(cid, status, primary),
                "primary_param": primary["param"] if primary else None,
                "reasons": reasons,
                "recommendation": RECOMMENDATION[status],
                "z": {
                    p.key: round(
                        max(
                            abs(zs.get(f"{p.key}|level", 0.0)),
                            abs(zs.get(f"{p.key}|shift", 0.0)),
                        ),
                        2,
                    )
                    for p in PARAMS
                },
                "latest": {p.key: _num(last_np[p.key][i]) for p in PARAMS},
            }
        )

    return {
        "hours": hours,
        "latest_hour": latest,
        "components": components,
        "summary": _summary(components, latest),
    }


def _num(v) -> float | None:
    v = float(v)
    return None if math.isnan(v) else round(v, 4)


def _z_reason(p, kind, z, i, first, last, latest, med) -> dict:
    sev = "REJECT" if abs(z) >= Z_REJECT else "REVIEW"
    v = float(last[p.key][i])
    within = _within_limits(p, v)
    tail = f" — still inside the datasheet limit ({_limit_text(p)})." if within else "."
    if kind == "level":
        if p.log_scale:
            ratio = v / math.exp(med)
            rel = f"{ratio:.1f}× the lot median" if ratio >= 1 else f"{1 / ratio:.1f}× below the lot median"
            text = f"{p.label} {_fmt(p, v)} at {latest} h is {rel} (robust z = {z:+.1f}){tail}"
        else:
            text = (
                f"{p.label} {_fmt(p, v)} at {latest} h vs lot median {_fmt(p, med)} "
                f"(robust z = {z:+.1f}){tail}"
            )
    else:
        v0 = float(first[p.key][i])
        if p.log_scale:
            growth = (v / v0 - 1) * 100
            lot_growth = (math.exp(med) - 1) * 100
            text = (
                f"{p.label} changed {growth:+.0f}% since 0 h while the lot moved "
                f"{lot_growth:+.0f}% (robust z = {z:+.1f}){tail}"
            )
        else:
            text = (
                f"{p.label} shifted {_fmt(p, v - v0)} since 0 h vs a lot median shift of "
                f"{_fmt(p, med)} (robust z = {z:+.1f}){tail}"
            )
    return {"kind": "zscore", "param": p.key, "severity": sev, "z": round(z, 2), "text": text}


def _headline(cid: str, status: str, primary: dict | None) -> str:
    if status == "PASS" or primary is None:
        return f"{cid} nominal — in family with its lot on every parameter."
    verb = "rejected" if status == "REJECT" else "flagged for review"
    text = primary["text"]
    return f"{cid} {verb} — {text[0].lower() + text[1:]}"


def _summary(components: list[dict], latest: int) -> dict:
    n = len(components)
    counts = {s: sum(c["status"] == s for c in components) for s in ("PASS", "REVIEW", "REJECT")}
    by_param: dict[str, int] = {p.key: 0 for p in PARAMS}
    by_param["multivariate"] = 0
    for c in components:
        if c["status"] != "PASS":
            by_param[c["primary_param"] or "multivariate"] += 1
    top = max(by_param, key=by_param.get) if any(by_param.values()) else None
    risk = min(100.0, 100 * (counts["REJECT"] + 0.35 * counts["REVIEW"]) / max(n, 1) * 4)
    early = sum(c["early_reject"] for c in components)
    return {
        "n": n,
        "counts": counts,
        "yield_pct": round(counts["PASS"] / max(n, 1) * 100, 1),
        "risk_index": round(risk),
        "flags_by_param": by_param,
        "top_param": top,
        "early_rejects": early,
        "socket_hours_saved": early * (FINAL_HOUR - latest) if latest < FINAL_HOUR else 0,
    }
