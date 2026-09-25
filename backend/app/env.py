"""Tiny .env loader so the API key can live in backend/.env (git-ignored)."""

import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def load_env(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        # Real environment variables win over the file.
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))
