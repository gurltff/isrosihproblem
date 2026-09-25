"""Electrical parameters tracked during burn-in, with screening limits.

The device model is an N-channel power MOSFET (the same class of part used in
NASA's MOSFET thermal-overstress ageing dataset). Two kinds of limit apply:

* ``limit_*``  - absolute screening limits (datasheet / procurement spec).
* ``delta_*``  - allowed shift from the 0 h reading by end of burn-in, in the
  style of MIL-PRF-19500 post-burn-in delta criteria.
"""

from dataclasses import dataclass, field

HOURS = (0, 24, 96, 168)
FINAL_HOUR = 168


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    short: str
    unit: str
    limit_low: float | None
    limit_high: float | None
    # Allowed relative shift from 0 h (fraction, e.g. 0.10 = 10 %).
    delta_rel: float
    # Absolute floor for the allowed shift, so tiny baselines are not over-penalised.
    delta_abs: float
    # Leakage-type parameters drift multiplicatively and are modelled in log space.
    log_scale: bool = False
    aliases: tuple[str, ...] = field(default_factory=tuple)

    def allowed_shift(self, v0: float) -> float:
        return max(abs(v0) * self.delta_rel, self.delta_abs)


PARAMS: tuple[Param, ...] = (
    Param(
        key="leakage_nA",
        label="Drain leakage current",
        short="I_DSS",
        unit="nA",
        limit_low=None,
        limit_high=1000.0,
        delta_rel=1.00,
        delta_abs=40.0,
        log_scale=True,
        aliases=("idss", "idss_na", "leakage", "leakage_current", "drain_leakage"),
    ),
    Param(
        key="vth_V",
        label="Gate threshold voltage",
        short="V_GS(th)",
        unit="V",
        limit_low=2.0,
        limit_high=4.0,
        delta_rel=0.10,
        delta_abs=0.15,
        aliases=("vth", "vgs_th", "vgsth", "threshold_voltage"),
    ),
    Param(
        key="rds_on_mOhm",
        label="On-state resistance",
        short="R_DS(on)",
        unit="mΩ",
        limit_low=None,
        limit_high=270.0,
        delta_rel=0.15,
        delta_abs=10.0,
        aliases=("rds_on", "rdson", "rds_on_mohm", "on_resistance"),
    ),
    Param(
        key="gate_leak_nA",
        label="Gate leakage current",
        short="I_GSS",
        unit="nA",
        limit_low=None,
        limit_high=100.0,
        delta_rel=1.00,
        delta_abs=5.0,
        log_scale=True,
        aliases=("igss", "igss_na", "gate_leakage"),
    ),
)

PARAM_KEYS = tuple(p.key for p in PARAMS)
BY_KEY = {p.key: p for p in PARAMS}


def resolve_column(name: str) -> str | None:
    """Map a user-supplied CSV header onto a canonical parameter key."""
    n = name.strip().lower().replace(" ", "_").replace("(", "").replace(")", "")
    for p in PARAMS:
        if n == p.key.lower() or n in p.aliases:
            return p.key
    return None
