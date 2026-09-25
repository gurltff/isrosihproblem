"""Import NASA's MOSFET Thermal Overstress Aging dataset (PCoE #13).

The public archive is a 7.3 GB ZIP that holds a second, deflated ZIP of
MATLAB files (one per test run). The inner archive cannot be seeked, so this
script streams it once with an HTTP request, inflates on the fly, parses each
inner .mat as soon as it is complete, and keeps only per-minute summaries of
the steady-state channels. Nothing large touches the disk.

Output: backend/data/nasa_mosfet_aging.csv with one row per device-minute:

    test, run, start (ISO), minute, stress_min, rds_ohm, package_temp_C,
    flange_temp_C, drain_current_A, drain_source_V, samples

``rds_ohm`` is the on-state resistance proxy Vds / Id, taken only while the
device is conducting and the package is at its stress plateau (so the
temperature dependence of R_DS(on) does not masquerade as ageing). ΔR_DS(on)
is the ageing precursor used in NASA's own prognostics work on this data.

Run:  python backend/scripts/import_nasa_mosfet.py   (~4-10 min)
"""

from __future__ import annotations

import argparse
import io
import re
import struct
import sys
import time
import urllib.request
import zlib
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

URL = "https://phm-datasets.s3.amazonaws.com/NASA/13.+MOSFET+Thermal+Overstress+Aging.zip"
OUT = Path(__file__).resolve().parents[1] / "data" / "nasa_mosfet_aging.csv"
NAME_RE = re.compile(r"Test_(\d+)_run_(\d+)\.mat$", re.I)


def http_range(start: int, end: int) -> bytes:
    req = urllib.request.Request(
        URL, headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def inner_zip_span() -> tuple[int, int]:
    """Locate the compressed bytes of the nested ZIP inside the outer archive."""
    req = urllib.request.Request(URL, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        size = int(r.headers["Content-Length"])
    tail = http_range(size - 65536, size - 1)
    pos = tail.rfind(b"PK\x05\x06")
    cd_size, cd_offset = struct.unpack_from("<LL", tail, pos + 12)
    if cd_offset == 0xFFFFFFFF:  # ZIP64
        loc = tail[pos - 20 : pos]
        z64 = struct.unpack_from("<Q", loc, 8)[0]
        rec = http_range(z64, z64 + 55)
        cd_size, cd_offset = struct.unpack_from("<QQ", rec, 40)
    cd = http_range(cd_offset, cd_offset + cd_size - 1)
    p = 0
    while cd[p : p + 4] == b"PK\x01\x02":
        (comp, _unc, nlen, xlen, clen) = struct.unpack_from("<LL3H", cd, p + 20)
        local = struct.unpack_from("<L", cd, p + 42)[0]
        name = cd[p + 46 : p + 46 + nlen].decode("cp437")
        extra = cd[p + 46 + nlen : p + 46 + nlen + xlen]
        if name.lower().endswith(".zip"):
            q = 0
            while q + 4 <= len(extra):
                tag, sz = struct.unpack_from("<HH", extra, q)
                body = extra[q + 4 : q + 4 + sz]
                if tag == 1:
                    vals = list(struct.unpack_from(f"<{len(body) // 8}Q", body))
                    if _unc == 0xFFFFFFFF:
                        vals.pop(0)
                    if comp == 0xFFFFFFFF:
                        comp = vals.pop(0)
                    if local == 0xFFFFFFFF:
                        local = vals.pop(0)
                q += 4 + sz
            hdr = http_range(local, local + 29)
            nl, xl = struct.unpack_from("<HH", hdr, 26)
            return local + 30 + nl + xl, comp
        p += 46 + nlen + xlen + clen
    raise RuntimeError("nested ZIP not found in archive")


def parse_date(s: str) -> datetime:
    return datetime.strptime(s.strip(), "%m/%d/%Y %H:%M:%S.%f")


def summarise_run(raw: bytes, test: int, run: int) -> pd.DataFrame:
    from scipy.io import loadmat

    m = loadmat(io.BytesIO(raw), squeeze_me=True, struct_as_record=False)["measurement"]
    ss = np.atleast_1d(m.steadyState)
    if ss.size == 0:
        return pd.DataFrame()
    ts = [parse_date(s.date) for s in ss]
    td = [s.timeDomain for s in ss]
    df = pd.DataFrame(
        {
            "t": ts,
            "vds": [float(x.drainSourceVoltage) for x in td],
            "id": [float(x.drainCurrent) for x in td],
            "pkg": [float(x.packageTemperature) for x in td],
            "flange": [float(x.flangeTemperature) for x in td],
        }
    )
    plateau = df["pkg"].quantile(0.9)
    on = (df["id"] > 1.0) & (df["pkg"] > plateau - 8)
    df["rds"] = np.where(on, df["vds"] / df["id"], np.nan)
    start = df["t"].min()
    df["minute"] = ((df["t"] - start).dt.total_seconds() // 60).astype(int)
    g = df.groupby("minute")
    out = pd.DataFrame(
        {
            "rds_ohm": g["rds"].median(),
            "package_temp_C": g["pkg"].median(),
            "flange_temp_C": g["flange"].median(),
            "drain_current_A": g["id"].median(),
            "drain_source_V": g["vds"].median(),
            "samples": g["rds"].count(),
        }
    ).reset_index()
    out.insert(0, "start", start.isoformat())
    out.insert(0, "run", run)
    out.insert(0, "test", test)
    return out


def stream(limit_mb: int | None) -> pd.DataFrame:
    start, comp = inner_zip_span()
    end = start + comp - 1 if not limit_mb else min(start + comp - 1, start + limit_mb * 2**20)
    print(f"streaming {(end - start + 1) / 2**30:.2f} GiB of nested archive…", flush=True)
    req = urllib.request.Request(
        URL, headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"}
    )
    outer = zlib.decompressobj(-15)
    buf = bytearray()
    frames: list[pd.DataFrame] = []
    got = 0
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=300) as r:
        while True:
            chunk = r.read(4 << 20)
            if not chunk:
                break
            got += len(chunk)
            buf += outer.decompress(chunk)
            # Consume every complete inner entry currently in the buffer.
            while len(buf) >= 30 and buf[:4] == b"PK\x03\x04":
                _, _, flags, method, _, _, _, csize, _, nl, xl = struct.unpack_from(
                    "<4s5H3L2H", buf, 0
                )
                if flags & 8:
                    raise RuntimeError("entries with data descriptors are not supported")
                total = 30 + nl + xl + csize
                if len(buf) < total:
                    break
                name = bytes(buf[30 : 30 + nl]).decode("cp437")
                data = bytes(buf[30 + nl + xl : total])
                del buf[:total]
                mt = NAME_RE.search(name)
                if not mt or csize == 0:
                    continue
                raw = zlib.decompress(data, -15) if method == 8 else data
                try:
                    df = summarise_run(raw, int(mt[1]), int(mt[2]))
                    frames.append(df)
                    print(
                        f"  {name.split('/')[-1]:<24} {len(df):>4} min   "
                        f"{got / 2**30:5.2f} GiB  {time.time() - t0:5.0f}s",
                        flush=True,
                    )
                except Exception as e:  # noqa: BLE001 - keep going past one bad file
                    print(f"  skipped {name}: {e}", file=sys.stderr, flush=True)
            if buf[:4] not in (b"PK\x03\x04", b"") and len(buf) >= 4:
                break  # reached the inner central directory
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def add_stress_time(df: pd.DataFrame) -> pd.DataFrame:
    """Cumulative minutes under stress per device, across its runs in date order."""
    parts = []
    for _, g in df.groupby("test"):
        offset = 0.0
        for _, rg in sorted(g.groupby("run"), key=lambda kv: kv[1]["start"].iloc[0]):
            rg = rg.copy()
            rg["stress_min"] = offset + rg["minute"]
            offset += rg["minute"].max() + 1
            parts.append(rg)
    return pd.concat(parts, ignore_index=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--limit-mb", type=int, help="stop after this many MB (for a quick look)")
    args = ap.parse_args()
    df = stream(args.limit_mb)
    if df.empty:
        sys.exit("no runs parsed")
    df = add_stress_time(df)
    df = df[
        [
            "test",
            "run",
            "start",
            "minute",
            "stress_min",
            "rds_ohm",
            "package_temp_C",
            "flange_temp_C",
            "drain_current_A",
            "drain_source_V",
            "samples",
        ]
    ].sort_values(["test", "stress_min"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.round(5).to_csv(OUT, index=False)
    print(f"wrote {len(df)} rows for {df['test'].nunique()} devices -> {OUT}")


if __name__ == "__main__":
    main()
