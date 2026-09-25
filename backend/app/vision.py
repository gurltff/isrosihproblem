"""Surface inspection of PCBs / components from a photo or camera frame.

Two engines:

* ``claude``  - Claude vision with a structured JSON answer. Needs
  ANTHROPIC_API_KEY (or another credential the Anthropic SDK can resolve) and
  internet access. This is the engine that understands what a burn mark,
  cracked solder joint or corroded lead actually looks like.
* ``local``   - an offline colour/texture outlier screen. It cannot name a
  defect with any authority; it only points at regions that look unlike the
  rest of the board so an inspector knows where to look.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
from pathlib import Path

import anthropic
import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

MODEL = os.environ.get("SENTINEL_VISION_MODEL", "claude-opus-5")
MAX_SIDE = 1280

# The inspection brief is shared with the browser build (shared/vision_brief.json).
BRIEF_FILE = Path(__file__).resolve().parents[2] / "shared" / "vision_brief.json"
_BRIEF = json.loads(BRIEF_FILE.read_text())
SYSTEM: str = _BRIEF["system"]
SCHEMA: dict = _BRIEF["schema"]
CHECKLIST: list[str] = _BRIEF["checklist"]


def user_text(expected: str | None) -> str:
    items = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(CHECKLIST))
    tail = f"Expected part for this lot: {expected}." if expected else "No expected part was given."
    return f"Inspect this part. Checklist items, in this order:\n{items}\n{tail}"


def claude_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _prepare(raw: bytes) -> tuple[Image.Image, bytes]:
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return img, buf.getvalue()


def inspect(raw: bytes, engine: str = "auto", expected: str | None = None) -> dict:
    img, jpeg = _prepare(raw)
    if engine in ("auto", "claude") and claude_available():
        try:
            return _inspect_claude(jpeg, expected) | {"engine": "claude", "model": MODEL}
        except Exception as e:  # noqa: BLE001 - fall back and tell the user why
            log.exception("Claude vision failed")
            result = _inspect_local(img)
            result["engine"] = "local"
            result["notice"] = f"Claude vision unavailable ({type(e).__name__}); used the offline screen."
            return result
    result = _inspect_local(img)
    result["engine"] = "local"
    if engine == "claude" or not claude_available():
        result["notice"] = (
            "Offline screen only. Set ANTHROPIC_API_KEY on the server to enable "
            "Claude vision defect recognition."
        )
    return result


def _inspect_claude(jpeg: bytes, expected: str | None = None) -> dict:
    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": base64.standard_b64encode(jpeg).decode(),
                        },
                    },
                    {"type": "text", "text": user_text(expected)},
                ],
            }
        ],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("request declined")
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    for f in data.get("findings", []):
        f["confidence"] = float(np.clip(f.get("confidence", 0.5), 0, 1))
        b = f["box"]
        for k in ("x", "y", "w", "h"):
            b[k] = float(np.clip(b[k], 0, 1))
        b["w"] = min(b["w"], 1 - b["x"])
        b["h"] = min(b["h"], 1 - b["y"])
    return data


# --------------------------------------------------------------------- offline


def _rgb_to_hsv(a: np.ndarray) -> np.ndarray:
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    d = mx - mn + 1e-9
    h = np.where(
        mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)
    )
    h = h * 60
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-9), 0)
    return np.stack([h, s, mx], -1)


def _inspect_local(img: Image.Image) -> dict:
    small = img.copy()
    small.thumbnail((320, 320))
    a = np.asarray(small, dtype=np.float32) / 255.0
    H, W, _ = a.shape
    hsv = _rgb_to_hsv(a)
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    gy, gx = np.gradient(lum)
    edge = np.hypot(gx, gy)

    equipment = float(edge.mean()) > 0.018 and float(lum.std()) > 0.06
    findings: list[dict] = []

    # Corrosion / oxidation: rust-orange to brown hues, clustered.
    rust = (
        (hsv[..., 0] >= 8)
        & (hsv[..., 0] <= 38)
        & (hsv[..., 1] > 0.45)
        & (hsv[..., 2] > 0.18)
        & (hsv[..., 2] < 0.75)
    )
    frac = float(rust.mean())
    if 0.002 < frac < 0.12:
        box = _bbox(rust)
        if box:
            findings.append(
                {
                    "type": "corrosion",
                    "description": "Rust-coloured region that stands out from the board "
                    "finish; possible oxidation or corrosion.",
                    "location": _where(box),
                    "severity": "medium",
                    "confidence": round(min(0.35 + frac * 4, 0.6), 2),
                    "box": box,
                }
            )

    # Block-level texture/colour outliers (possible scorch, residue, damage).
    bs = 16
    rows, cols = H // bs, W // bs
    if rows >= 4 and cols >= 4:
        feats = []
        for r in range(rows):
            for c in range(cols):
                sl = (slice(r * bs, (r + 1) * bs), slice(c * bs, (c + 1) * bs))
                feats.append(
                    [
                        lum[sl].mean(),
                        hsv[..., 1][sl].mean(),
                        edge[sl].mean(),
                        lum[sl].std(),
                    ]
                )
        F = np.array(feats)
        med = np.median(F, 0)
        mad = np.median(np.abs(F - med), 0) * 1.4826 + 1e-6
        Z = (F - med) / mad
        # Dark, low-saturation, low-texture blocks darker than the board: scorch-like.
        score = np.maximum(-Z[:, 0], 0) * 0.6 + np.maximum(-Z[:, 1], 0) * 0.4
        mask = (score > 4.5).reshape(rows, cols)
        if 0 < mask.mean() < 0.15:
            full = np.kron(mask, np.ones((bs, bs), dtype=bool))
            full = np.pad(full, ((0, H - full.shape[0]), (0, W - full.shape[1])))
            box = _bbox(full)
            if box:
                findings.append(
                    {
                        "type": "thermal_discoloration",
                        "description": "Dark, desaturated patch unlike the surrounding "
                        "surface; could be a scorch mark or shadow — confirm visually.",
                        "location": _where(box),
                        "severity": "low",
                        "confidence": 0.3,
                        "box": box,
                    }
                )

    overall = "REVIEW" if findings else "NOMINAL"
    if not equipment:
        summary = "No structured hardware detected in frame — move closer or improve lighting."
        findings = []
        overall = "NOMINAL"
    elif findings:
        summary = f"{len(findings)} region(s) look unlike the rest of the surface. Offline screen: verify by eye."
    else:
        summary = "No colour or texture outliers found on the visible surface."
    return {
        "equipment_detected": equipment,
        "equipment_type": "electronic hardware (unclassified)" if equipment else "",
        "overall": overall,
        "summary": summary,
        "findings": findings,
    }


def _bbox(mask: np.ndarray) -> dict | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    H, W = mask.shape
    x0, x1 = np.percentile(xs, [2, 98])
    y0, y1 = np.percentile(ys, [2, 98])
    pad = 0.02
    x = max(x0 / W - pad, 0)
    y = max(y0 / H - pad, 0)
    return {
        "x": round(float(x), 3),
        "y": round(float(y), 3),
        "w": round(float(min(x1 / W + pad, 1) - x), 3),
        "h": round(float(min(y1 / H + pad, 1) - y), 3),
    }


def _where(b: dict) -> str:
    cx, cy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
    v = "upper" if cy < 0.33 else "lower" if cy > 0.66 else "middle"
    h = "left" if cx < 0.33 else "right" if cx > 0.66 else "centre"
    return f"{v} {h} of frame" if (v, h) != ("middle", "centre") else "centre of frame"
