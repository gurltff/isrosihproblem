"""Sentinel API - burn-in screening intelligence."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .env import load_env

load_env()

from . import nasa, vision  # noqa: E402 - vision reads the environment at import time
from .drift import breaches, project_component
from .params import BY_KEY, FINAL_HOUR, PARAMS
from .store import CSVError, store

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.load_seed()
    yield


app = FastAPI(title="Sentinel · Burn-in Intelligence", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

MAX_UPLOAD = 15 * 1024 * 1024


def _batch_or_404(batch_id: str) -> dict:
    if batch_id not in store.analyses:
        raise HTTPException(404, f"Unknown lot '{batch_id}'")
    return store.analyses[batch_id]


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "claude_vision": vision.claude_available(), "model": vision.MODEL}


@app.get("/api/nasa")
def nasa_validation() -> dict:
    """Drift-model validation on NASA's real MOSFET ageing runs."""
    return nasa.analysis()


@app.get("/api/params")
def params() -> list[dict]:
    return [
        {
            "key": p.key,
            "label": p.label,
            "short": p.short,
            "unit": p.unit,
            "limit_low": p.limit_low,
            "limit_high": p.limit_high,
            "delta_rel": p.delta_rel,
            "delta_abs": p.delta_abs,
            "log_scale": p.log_scale,
        }
        for p in PARAMS
    ]


@app.get("/api/batches")
def batches() -> dict:
    lots = [store.batch_meta(b) for b in store.batch_ids()]
    return {"batches": lots, "drift_model": _model_info()}


def _model_info() -> dict:
    m = store.model
    return {"exponents": m.exponents, "backtest": m.backtest} if m else {}


@app.get("/api/batches/{batch_id}")
def batch(batch_id: str) -> dict:
    a = _batch_or_404(batch_id)
    return {**store.batch_meta(batch_id), "components": a["components"]}


def _series(g) -> dict:
    return {
        p.key: [
            {"hour": int(h), "value": float(v)} for h, v in zip(g["hour"], g[p.key]) if v == v
        ]
        for p in PARAMS
    }


@app.get("/api/batches/{batch_id}/components/{component_id}")
def component(batch_id: str, component_id: str) -> dict:
    a = _batch_or_404(batch_id)
    comp = next((c for c in a["components"] if c["component_id"] == component_id), None)
    if comp is None:
        raise HTTPException(404, f"Unknown component '{component_id}' in {batch_id}")
    g = store.component_frame(batch_id, component_id)
    return {
        **comp,
        "batch_id": batch_id,
        "series": _series(g),
        "lot_bands": store.lot_bands(batch_id),
        "projection": project_component(store.model, g, min(24, a["latest_hour"])),
    }


def _ratio(v: dict) -> float:
    return abs(v["predicted_shift"]) / max(v["allowed_shift"], 1e-9)


DRIFT_FIELDS = (
    "v0",
    "predicted_168",
    "predicted_shift_pct",
    "allowed_shift",
    "actual_168",
    "slope_per_24h",
    "early_reject",
    "watch",
)


@app.get("/api/batches/{batch_id}/drift")
def drift_view(batch_id: str, as_of: int = 24) -> dict:
    """Project every part in the lot to 168 h from read points up to ``as_of``."""
    _batch_or_404(batch_id)
    lot = store.lot(batch_id)
    rows = []
    for cid, g in lot.groupby("component_id"):
        pr = project_component(store.model, g, as_of)
        worst = max(pr["params"].items(), key=lambda kv: _ratio(kv[1]))
        has_final = FINAL_HOUR in set(g["hour"])
        actual_fail = (
            any(
                breaches(BY_KEY[k], v["v0"], v["actual_168"])
                for k, v in pr["params"].items()
                if v["actual_168"] is not None
            )
            if has_final
            else None
        )
        rows.append(
            {
                "component_id": cid,
                "socket": str(g["socket"].iloc[0]),
                "early_reject": pr["early_reject"],
                "watch": pr["watch"],
                "worst_param": worst[0],
                "worst_ratio": _ratio(worst[1]),
                "actual_fail": actual_fail,
                "params": {k: {f: v[f] for f in DRIFT_FIELDS} for k, v in pr["params"].items()},
            }
        )
    rows.sort(key=lambda r: -r["worst_ratio"])
    early = sum(r["early_reject"] for r in rows)
    return {
        "batch_id": batch_id,
        "as_of": as_of,
        "components": rows,
        "early_rejects": early,
        "socket_hours_saved": early * max(FINAL_HOUR - as_of, 0),
        "model": _model_info(),
    }


@app.get("/api/batches/{batch_id}/components/{component_id}/drift")
def component_drift(batch_id: str, component_id: str, as_of: int = 24) -> dict:
    _batch_or_404(batch_id)
    g = store.component_frame(batch_id, component_id)
    if g.empty:
        raise HTTPException(404, "Unknown component")
    return {
        "component_id": component_id,
        "series": _series(g),
        "projection": project_component(store.model, g, as_of),
    }


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (15 MB max)")
    try:
        lots = await run_in_threadpool(store.add_csv, raw, file.filename or "upload.csv")
    except CSVError as e:
        raise HTTPException(422, str(e)) from e
    return {"batches": [store.batch_meta(b) for b in lots]}


TEMPLATE = (
    "batch_id,batch_date,component_id,serial,socket,hour,leakage_nA,vth_V,rds_on_mOhm,gate_leak_nA\n"
    "LOT-2701,2026-10-01,C-001,SN270100001,A1,0,44.1,3.012,204.6,2.41\n"
    "LOT-2701,2026-10-01,C-001,SN270100001,A1,24,46.0,3.004,205.9,2.52\n"
    "LOT-2701,2026-10-01,C-002,SN270100002,A2,0,51.7,2.968,209.3,2.77\n"
    "LOT-2701,2026-10-01,C-002,SN270100002,A2,24,53.2,2.957,210.1,2.85\n"
)


@app.get("/api/template.csv", response_class=PlainTextResponse)
def template() -> PlainTextResponse:
    return PlainTextResponse(
        TEMPLATE,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=burnin_template.csv"},
    )


@app.post("/api/vision/inspect")
async def inspect(image: UploadFile = File(...), engine: str = Form("auto")) -> dict:
    raw = await image.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (15 MB max)")
    if engine not in ("auto", "claude", "local"):
        raise HTTPException(422, "engine must be auto, claude or local")
    try:
        return await run_in_threadpool(vision.inspect, raw, engine)
    except OSError as e:
        raise HTTPException(422, f"Not a readable image: {e}") from e


# ------------------------------------------------------------------ frontend
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
