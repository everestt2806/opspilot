"""Sinh chuỗi metric giả đúng contract metric-format.md để test ML không cần VPS.

Dùng:
  .venv/Scripts/python.exe scripts/gen_fake_series.py \\
    --scenario memory_leak --out state/fake/metrics.jsonl

Kịch bản:
  normal       - baseline nhiễu nhẹ, không anomaly
  gradual      - mem_mb tăng tuyến tính dần (dạng suy giảm từ từ)
  memory_leak  - như gradual, mem lên tới ~1000/1024 MB
  sudden       - latency + error rate nhảy vọt ở 70% chuỗi
  noise        - nhiễu mạnh mọi metric, không xu hướng
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import COLLECT_INTERVAL_S  # noqa: E402

MEM_LIMIT_MB = 1024.0
COLLECTOR_VERSION = "1.0.0"
SCENARIOS = ("normal", "gradual", "memory_leak", "sudden", "noise")


def _iso(ts_start: datetime, index: int, interval_s: int) -> str:
    moment = ts_start + timedelta(seconds=index * interval_s)
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def make_series(
    scenario: str,
    n: int = 450,
    interval_s: int = COLLECT_INTERVAL_S,
    start_ts: str | None = None,
    with_db: bool = True,
    seed: int = 42,
) -> list[dict[str, Any]]:
    if scenario not in SCENARIOS:
        raise ValueError(f"scenario khong hop le: {scenario}")
    rng = np.random.default_rng(seed)
    start = (
        datetime.fromisoformat(start_ts.replace("Z", "+00:00")) if start_ts else datetime.now(UTC)
    )
    idx = np.arange(n, dtype=float)

    cpu = 12.0 + 4.0 * np.sin(idx / 30.0) + rng.normal(0, 1.5, n)
    mem = 280.0 + rng.normal(0, 8.0, n)
    latency = 45.0 + rng.normal(0, 6.0, n)
    errors = np.clip(0.01 + rng.normal(0, 0.01, n), 0.0, 1.0)
    db = 4.0 + rng.normal(0, 1.0, n)

    if scenario in ("gradual", "memory_leak"):
        ramp = np.clip((idx - 0.35 * n) / (0.65 * n), 0.0, 1.0)
        mem = 300.0 + ramp * (MEM_LIMIT_MB - 90.0) + rng.normal(0, 6.0, n)
        cpu = cpu + ramp * 25.0
        latency = latency + ramp * 300.0
    elif scenario == "sudden":
        fault = idx >= 0.7 * n
        latency = np.where(fault, 2500.0 + rng.normal(0, 400.0, n), latency)
        errors = np.where(fault, np.clip(0.5 + rng.normal(0, 0.15, n), 0.2, 1.0), errors)
        cpu = np.where(fault, cpu + 35.0, cpu)
    elif scenario == "noise":
        cpu = 15.0 + rng.normal(0, 10.0, n)
        mem = 300.0 + rng.normal(0, 40.0, n)
        latency = 60.0 + rng.normal(0, 35.0, n)
        errors = np.clip(0.05 + rng.normal(0, 0.06, n), 0.0, 1.0)

    mem = np.clip(mem, 50.0, MEM_LIMIT_MB)
    cpu = np.clip(cpu, 0.0, 100.0)
    latency = np.clip(latency, 0.0, None)
    latency_rounded = np.maximum(latency, 0.5)

    rows: list[dict[str, Any]] = []
    for i in range(n):
        rows.append(
            {
                "seq": i + 1,
                "ts": _iso(start, i, interval_s),
                "cpu_pct": round(float(cpu[i]), 2),
                "mem_mb": round(float(mem[i]), 2),
                "mem_pct": round(float(mem[i]) / MEM_LIMIT_MB * 100.0, 2),
                "mem_limit_mb": MEM_LIMIT_MB,
                "latency_ms": round(float(latency_rounded[i]), 2),
                "http_error_rate": round(float(errors[i]), 4),
                "db_response_ms": round(float(db[i]), 2) if with_db else None,
                "container_up": 1,
                "host_cpu_pct": round(float(np.clip(20.0 + rng.normal(0, 2.0), 0, 100)), 2),
                "host_mem_pct": round(float(np.clip(45.0 + rng.normal(0, 3.0), 0, 100)), 2),
                "collector_version": COLLECTOR_VERSION,
            }
        )
    return rows


def write_series(rows: list[dict[str, Any]], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sinh metrics.jsonl gia cho ML service")
    parser.add_argument("--scenario", choices=SCENARIOS, default="normal")
    parser.add_argument("--n", type=int, default=450)
    parser.add_argument("--interval", type=int, default=COLLECT_INTERVAL_S)
    parser.add_argument("--start", default=None, help="ISO-8601 UTC, mac dinh la bay gio")
    parser.add_argument("--no-db", action="store_true", help="db_response_ms luon null")
    parser.add_argument("--out", default="state/fake/metrics.jsonl")
    args = parser.parse_args()

    rows = make_series(
        scenario=args.scenario,
        n=args.n,
        interval_s=args.interval,
        start_ts=args.start,
        with_db=not args.no_db,
    )
    out_path = Path(args.out)
    write_series(rows, out_path)
    print(f"Da ghi {len(rows)} dong -> {out_path}")


if __name__ == "__main__":
    main()
