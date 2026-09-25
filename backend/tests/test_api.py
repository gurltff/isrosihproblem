from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).parent


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_seed_lots_loaded(client):
    lots = client.get("/api/batches").json()["batches"]
    assert len(lots) == 6
    live = [b for b in lots if b["in_progress"]]
    assert [b["batch_id"] for b in live] == ["LOT-2606"]
    assert live[0]["early_rejects"] > 0


def test_statistical_outlier_inside_limits_is_flagged(client):
    lot = client.get("/api/batches/LOT-2605").json()
    flagged = [c for c in lot["components"] if c["status"] != "PASS"]
    assert any("still inside the datasheet limit" in c["headline"] for c in flagged)


def test_backtest_is_useful(client):
    bt = client.get("/api/batches").json()["drift_model"]["backtest"]
    assert bt["precision"] >= 0.8
    assert bt["recall"] >= 0.7


def test_passport_and_drift(client):
    p = client.get("/api/batches/LOT-2606/components/C-013").json()
    assert p["status"] == "REJECT"
    assert p["projection"]["params"]["leakage_nA"]["early_reject"] is True
    d = client.get("/api/batches/LOT-2604/drift", params={"as_of": 24}).json()
    assert d["components"][0]["worst_ratio"] >= d["components"][-1]["worst_ratio"]


def test_upload_roundtrip_and_validation(client):
    template = client.get("/api/template.csv").content
    r = client.post("/api/upload", files={"file": ("lot.csv", template, "text/csv")})
    assert r.status_code == 200
    assert r.json()["batches"][0]["batch_id"] == "LOT-2701"
    bad = client.post("/api/upload", files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")})
    assert bad.status_code == 422


def test_vision_offline_screen(client, tmp_path):
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (640, 480), (28, 92, 58))
    d = ImageDraw.Draw(img)
    for x in range(40, 600, 40):
        d.line([(x, 20), (x, 460)], fill=(200, 170, 80), width=3)
    d.ellipse([420, 300, 500, 360], fill=(160, 80, 30))
    path = tmp_path / "board.jpg"
    img.save(path)
    r = client.post("/api/vision/inspect", files={"image": ("b.jpg", path.read_bytes(), "image/jpeg")},
                    data={"engine": "local"})
    body = r.json()
    assert body["engine"] == "local"
    assert any(f["type"] == "corrosion" for f in body["findings"])
