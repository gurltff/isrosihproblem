"""Lot-level decisions: the timeline of a burn-in run, lot acceptance against
the PDA, and how early failures become visible (the case for shorter runs).

PDA (percent defective allowable) is the MIL-PRF-19500 / ESCC rule that
rejects a whole lot when too many of its parts fail screening. JANTX-level
lots commonly use 10 %; it is a parameter here.
"""

from __future__ import annotations

import pandas as pd

from . import detector
from .params import FINAL_HOUR

PDA = 0.10


def timeline(lot: pd.DataFrame, model) -> dict:
    """Dispositions as each read point came in, as the chamber would have seen them."""
    hours = sorted(int(h) for h in lot["hour"].unique())
    steps = []
    first_flag: dict[str, dict] = {}
    for h in hours:
        if h == 0:
            continue
        a = detector.analyze_batch(lot[lot["hour"] <= h], model)
        for c in a["components"]:
            if c["status"] != "PASS" and c["component_id"] not in first_flag:
                first_flag[c["component_id"]] = {
                    "hour": h,
                    "status": c["status"],
                    "early_reject": c["early_reject"],
                    "reason": c["reasons"][0]["text"] if c["reasons"] else "",
                }
        steps.append(
            {
                "hour": h,
                "status": {c["component_id"]: c["status"] for c in a["components"]},
                "early": [c["component_id"] for c in a["components"] if c["early_reject"]],
                "counts": a["summary"]["counts"],
            }
        )
    return {"hours": hours, "steps": steps, "first_flag": first_flag}


def lot_verdict(summary: dict, latest_hour: int) -> dict:
    n = max(summary["n"], 1)
    rejects = summary["counts"]["REJECT"]
    frac = rejects / n
    allowed = int(PDA * n)
    if frac > PDA:
        verdict = "REJECT LOT"
    elif latest_hour < FINAL_HOUR and rejects >= 0.7 * allowed:
        verdict = "AT RISK"
    else:
        verdict = "ACCEPT" if latest_hour >= FINAL_HOUR else "ON TRACK"
    return {
        "pda": PDA,
        "rejects": rejects,
        "allowed": allowed,
        "defective_pct": round(frac * 100, 1),
        "verdict": verdict,
    }


def detection_curve(store) -> dict:
    """Across completed lots: when was each final reject first caught?"""
    rows = []
    for b in store.batch_ids():
        a = store.analyses[b]
        if a["latest_hour"] < FINAL_HOUR:
            continue
        tl = timeline(store.lot(b), store.model)
        final_rejects = [c["component_id"] for c in a["components"] if c["status"] == "REJECT"]
        caught = {h: 0 for h in tl["hours"] if h > 0}
        for cid in final_rejects:
            f = tl["first_flag"].get(cid)
            for h in caught:
                if f and f["hour"] <= h:
                    caught[h] += 1
        rows.append({"batch_id": b, "rejects": len(final_rejects), "caught_by": caught})
    total = sum(r["rejects"] for r in rows)
    by_hour: dict[int, int] = {}
    for r in rows:
        for h, n in r["caught_by"].items():
            by_hour[h] = by_hour.get(h, 0) + n
    curve = [
        {"hour": h, "caught": n, "share": round(n / total, 3) if total else None}
        for h, n in sorted(by_hour.items())
    ]
    # Shortest read point that already catches every failure seen at 168 h.
    enough = next((c["hour"] for c in curve if total and c["caught"] >= total), FINAL_HOUR)
    return {"lots": rows, "total_rejects": total, "curve": curve, "sufficient_hour": enough}
