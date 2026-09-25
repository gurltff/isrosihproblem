# Sentinel · Burn-in Intelligence

Burn-in screening for high-reliability components. Every part is compared with **its own lot** instead of a fixed
datasheet line, so a part can be flagged while it is still inside its limits. Parts that are drifting too fast are
pulled at 24 h instead of spending another 144 h in the chamber.

Runs in any browser, on desktop and on phones. It installs as an app (PWA) from the browser menu.

| Module | What it does |
|---|---|
| **Batch health** | Lot risk index (0–100), yield, pass/review/reject counts, which parameter drives the flags, trend across lots |
| **Anomaly detector** | Robust z-scores (median/MAD) per parameter plus an Isolation Forest across all parameters. Each flag comes with a plain-English explanation and a PASS / REVIEW / REJECT disposition |
| **Drift predictor** | Projects 168 h values from 0 h and 24 h readings with a power-law drift model learned from completed lots. Back-tested against real 168 h outcomes |
| **Component passport** | One part's full 0/24/96/168 h journey against the lot median and its 10–90th percentile band, with findings and a recommendation |
| **Risk heatmap** | The whole lot as a colour grid (navy = in family, teal = review, brick = reject) or as a parameter × part matrix |
| **Chamber view** | The burn-in board socket map, colour-coded by status |
| **Surface inspection** | Live camera or photo upload. Finds burn marks, corrosion, solder defects and cracks. **Hand-gesture control** (below) |
| **QA report** | A printable report document. Use *Save as PDF* |

### Hand gestures (camera page)

Hand tracking runs entirely in the browser (MediaPipe Hand Landmarker, bundled locally, so it needs no CDN).

| Gesture | Action |
|---|---|
| ✊ Closed fist (hold ½ s) | Freeze the frame and scan it |
| ✋ Open palm (hold ½ s) | Resume the live view and clear results |
| ☝️ Point | A 2.5× inspection loupe follows your fingertip |
| ✌️ Two fingers (hold ½ s) | Cycle the view: normal → edge map → high contrast → false colour |

**Auto-scan:** when the camera settles on something new and no hand is in the frame, the page scans it by itself. Any
anomalies are boxed on the image.

## Run it

```bash
# backend (Python 3.10+)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend (Node 18+), in a second terminal
cd frontend
npm install
npm run dev            # http://localhost:5173
```

**Single server:** run `npm run build` in `frontend/`, then start uvicorn. It serves the built app at http://localhost:8000.

**Docker:** `docker build -t sentinel . && docker run -p 8000:8000 -e ANTHROPIC_API_KEY=... sentinel`.
This works as-is on Render, Railway or Fly (they set `PORT`).

### On a phone

Browsers only open the camera over **HTTPS** (or on localhost). Either:

* deploy it (Render, Railway and the others give you HTTPS), or
* on the same Wi-Fi, run `npm run dev:https` and open `https://<your-laptop-ip>:5173` on the phone, then accept the
  self-signed certificate warning.

Then use *Add to Home Screen* to install it as an app.

### Claude vision (optional)

Set `ANTHROPIC_API_KEY` on the **server** to turn on Claude vision for defect recognition. The key stays on the server
and never reaches the browser. Without it, the camera page falls back to an offline colour/texture screen. That screen
only points at regions that look different from the rest of the board; it cannot name defects reliably. The UI always
shows which engine produced a result. The model can be overridden with `SENTINEL_VISION_MODEL`.

## Data

`backend/data/seed_burnin.csv` holds six lots of 64 parts (IRF520-class power MOSFETs: I_DSS, V_GS(th), R_DS(on) and
I_GSS at 0/24/96/168 h). **The data is synthetic.** `backend/scripts/generate_seed.py` generates it from a physically
shaped drift model with injected latent defects. LOT-2605 is a weak lot, and LOT-2606 is "in the chamber" at 24 h.
Replace it with real station data through **Upload lot data**; a template CSV is provided there. Headers are matched
loosely (`idss`, `vth`, `rdson` …).

Screening limits and delta criteria are in `backend/app/params.py`.

## Tests

```bash
cd backend && pip install -r requirements-dev.txt && python -m pytest -q
cd frontend && npm run typecheck
```
