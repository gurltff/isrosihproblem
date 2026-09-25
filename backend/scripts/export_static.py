"""Pre-render every API answer the frontend reads to JSON files, so the app
can run on a static host (GitHub Pages) with no Python server.

Usage:  python backend/scripts/export_static.py <out_dir>
Writes <out_dir>/api/... mirroring the API paths (``?as_of=N`` becomes ``_N``).
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main(out: Path) -> None:
    written = 0

    def save(path: str, client: TestClient, url: str | None = None) -> dict:
        nonlocal written
        r = client.get(url or path)
        r.raise_for_status()
        target = out / f"{path.lstrip('/')}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        data = r.json()
        target.write_text(json.dumps(data, separators=(",", ":")))
        written += 1
        return data

    with TestClient(app) as c:
        health = c.get("/api/health").json()
        health["claude_vision"] = False  # no server, so no key, on a static host
        (out / "api").mkdir(parents=True, exist_ok=True)
        (out / "api/health.json").write_text(json.dumps(health))
        (out / "api/template.csv").write_bytes(c.get("/api/template.csv").content)
        save("/api/params", c)
        save("/api/nasa", c)
        save("/api/burnin-length", c)
        lots = save("/api/batches", c)["batches"]
        for lot in lots:
            b = lot["batch_id"]
            batch = save(f"/api/batches/{b}", c)
            save(f"/api/batches/{b}/timeline", c)
            as_of = [h for h in lot["hours"] if 0 < h < 168] or [lot["latest_hour"]]
            for h in as_of:
                save(f"/api/batches/{b}/drift_{h}", c, f"/api/batches/{b}/drift?as_of={h}")
            for comp in batch["components"]:
                cid = comp["component_id"]
                save(f"/api/batches/{b}/components/{cid}", c)
                for h in as_of:
                    save(
                        f"/api/batches/{b}/components/{cid}/drift_{h}",
                        c,
                        f"/api/batches/{b}/components/{cid}/drift?as_of={h}",
                    )
    print(f"wrote {written} JSON files under {out / 'api'}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "site"))
