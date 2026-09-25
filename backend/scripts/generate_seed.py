"""Generate the demo burn-in dataset that ships with the app.

The data is synthetic but follows how N-channel power MOSFETs (IRF520-class)
drift under high-temperature burn-in: most parts settle along a sub-linear
power law, and a handful carry latent defects that only become obvious late
in the 168 h run. Six lots of 64 parts (one 8x8 chamber board each):

* LOT-2601..2605 - complete 0/24/96/168 h records (history for back-testing)
* LOT-2605       - a weaker wafer lot with a higher defect rate
* LOT-2606       - currently in the chamber, only 0 h and 24 h taken so far

Run:  python backend/scripts/generate_seed.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "data" / "seed_burnin.csv"
HOURS = (0, 24, 96, 168)
ROWS = "ABCDEFGH"

LOTS = [
    ("LOT-2601", "2026-07-06", 0.06, HOURS),
    ("LOT-2602", "2026-07-20", 0.05, HOURS),
    ("LOT-2603", "2026-08-03", 0.08, HOURS),
    ("LOT-2604", "2026-08-17", 0.06, HOURS),
    ("LOT-2605", "2026-08-31", 0.16, HOURS),
    ("LOT-2606", "2026-09-21", 0.09, (0, 24)),
]

DEFECTS = [
    "leaky",
    "latent_vth",
    "rds_degrade",
    "gate_damage",
    "multivariate",
    "marginal_leak",
    "vth_edge",
]


def drift(t: float, n: float) -> float:
    return (t / 24.0) ** n if t > 0 else 0.0


def component(rng: np.random.Generator, defect: str | None):
    n = float(np.clip(rng.normal(0.55, 0.05), 0.4, 0.7))
    lot = {
        "leak0": float(rng.lognormal(np.log(45), 0.22)),
        "leak_a": float(rng.normal(0.06, 0.025)),
        "vth0": float(rng.normal(3.0, 0.07)),
        "vth_a": float(rng.normal(-0.010, 0.006)),
        "rds0": float(rng.normal(205, 4.5)),
        "rds_a": float(rng.normal(1.0, 0.5)),
        "gl0": float(rng.lognormal(np.log(2.5), 0.25)),
        "gl_a": float(rng.normal(0.05, 0.03)),
    }
    if defect == "leaky":
        lot["leak0"] *= rng.uniform(3.8, 5.5)
        lot["leak_a"] = rng.uniform(0.30, 0.45)
    elif defect == "latent_vth":
        lot["vth_a"] = -rng.uniform(0.11, 0.15)
    elif defect == "rds_degrade":
        lot["rds_a"] = rng.uniform(10.5, 14.0)
    elif defect == "gate_damage":
        lot["gl0"] *= rng.uniform(6, 9)
        lot["gl_a"] = rng.uniform(0.45, 0.6)
    elif defect == "multivariate":
        s = rng.choice([-1, 1])
        lot["leak0"] *= 1.55
        lot["vth0"] += s * 0.17
        lot["rds0"] += 11
        lot["gl0"] *= 1.6
    elif defect == "marginal_leak":
        lot["leak0"] *= rng.uniform(2.0, 2.4)
    elif defect == "vth_edge":
        lot["vth0"] = rng.uniform(3.84, 3.9)
        lot["vth_a"] = rng.uniform(0.035, 0.05)
    return n, lot


def measure(rng, n, c, t):
    d = drift(t, n)
    return {
        "leakage_nA": c["leak0"] * np.exp(c["leak_a"] * d) * rng.normal(1, 0.02),
        "vth_V": c["vth0"] + c["vth_a"] * d + rng.normal(0, 0.004),
        "rds_on_mOhm": c["rds0"] + c["rds_a"] * d + rng.normal(0, 0.4),
        "gate_leak_nA": c["gl0"] * np.exp(c["gl_a"] * d) * rng.normal(1, 0.03),
    }


def main() -> None:
    rng = np.random.default_rng(2604)
    rows = []
    serial = 0
    for lot_id, date, defect_rate, hours in LOTS:
        n_defects = max(2, int(round(64 * defect_rate)))
        defect_slots = set(rng.choice(64, n_defects, replace=False).tolist())
        for i in range(64):
            serial += 1
            socket = f"{ROWS[i // 8]}{i % 8 + 1}"
            defect = rng.choice(DEFECTS) if i in defect_slots else None
            n, c = component(rng, defect)
            for t in hours:
                m = measure(rng, n, c, t)
                rows.append(
                    {
                        "batch_id": lot_id,
                        "batch_date": date,
                        "component_id": f"C-{i + 1:03d}",
                        "serial": f"SN{lot_id[-4:]}{serial:05d}",
                        "socket": socket,
                        "hour": t,
                        "leakage_nA": round(m["leakage_nA"], 2),
                        "vth_V": round(m["vth_V"], 4),
                        "rds_on_mOhm": round(m["rds_on_mOhm"], 2),
                        "gate_leak_nA": round(m["gate_leak_nA"], 3),
                    }
                )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(OUT, index=False)
    print(f"wrote {len(rows)} rows -> {OUT}")


if __name__ == "__main__":
    main()
