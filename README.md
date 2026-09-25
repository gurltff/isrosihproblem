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
| **NASA ageing data** | Checks the drift predictor against 26 real MOSFETs from NASA's thermal-overstress ageing runs |
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

## Hosted demo (GitHub Pages)

**https://gurltff.github.io/isrosihproblem/** runs the app entirely in the browser. Every analysis result is
pre-rendered to JSON by `backend/scripts/export_static.py`, and camera scans use an in-browser copy of the offline
check. Uploading lots and Claude vision need the Python server below. To refresh the hosted copy after changes,
run `./build-pages.sh` and commit `app/`.

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

Copy `backend/.env.example` to `backend/.env` and put your key after `ANTHROPIC_API_KEY=`, or set the environment
variable on your host. `backend/.env` is git-ignored: never commit a key. The key stays on the server and never
reaches the browser. Without it, the camera page falls back to an offline colour/texture screen. That screen
only points at regions that look different from the rest of the board; it cannot name defects reliably. The UI always
shows which engine produced a result. The model can be overridden with `SENTINEL_VISION_MODEL`.

## Data

`backend/data/seed_burnin.csv` holds six lots of 64 parts (IRF520-class power MOSFETs: I_DSS, V_GS(th), R_DS(on) and
I_GSS at 0/24/96/168 h). **The data is synthetic.** `backend/scripts/generate_seed.py` generates it from a physically
shaped drift model with injected latent defects. LOT-2605 is a weak lot, and LOT-2606 is "in the chamber" at 24 h.
Replace it with real station data through **Upload lot data**; a template CSV is provided there. Headers are matched
loosely (`idss`, `vth`, `rdson` …).

Screening limits and delta criteria are in `backend/app/params.py`.

### Real data: NASA MOSFET thermal-overstress ageing

`backend/data/nasa_mosfet_aging.csv` (1 MB) summarises NASA PCoE data set 13, which is 42 devices and a 7.3 GB
archive of MATLAB files. `backend/scripts/import_nasa_mosfet.py` rebuilds it: it streams the archive once, keeps
per-minute steady-state readings and never writes the raw files to disk (about 7 minutes).

R_DS(on) is taken as V_DS / I_D while the device conducts at its stress temperature. Of the 42 devices, 26 have enough
data. The *NASA ageing data* page back-tests the drift model on them, using the first 25 %, 50 % and 75 % of each run:

| Share of run seen | Gradual drifters (13) | Abrupt failures (13) |
|---|---|---|
| 25 % | 13.6 pp | 34.7 pp |
| 50 % | 6.9 pp | 43.3 pp |
| 75 % | 4.7 pp | 31.9 pp |

(Median absolute error in the final ΔR_DS(on).) Gradual wear-out is predictable early; sudden die-attach failures are
not. That is why the app combines drift prediction with lot-relative screening and surface inspection.

## Tests

```bash
cd backend && pip install -r requirements-dev.txt && python -m pytest -q
cd frontend && npm run typecheck
```
