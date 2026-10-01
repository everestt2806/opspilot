"""Xuất CSV cho một run sau khi chạy xong (TK-S6, docs/07 mục 8).

Dùng `sqlite3` stdlib → test được với DB tạm trong RAM, KHÔNG cần app/VPS. Xuất đúng 5 file docs/07
mục 8 vào `experiments/results/run_<scenario>_<n>/`:
  metric_sample.csv · score_sample.csv · alert.csv · experiment_run.csv · meta.json

QUAN TRỌNG (docs/07 mục 8): **không bao giờ** đọc/ghi bảng `vps` (chứa credential SSH mã hoá) và
không copy file .db. Chỉ SELECT các bảng dữ liệu thí nghiệm. `analyze.py` chỉ đọc CSV này.
"""

from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path

try:
    from manifest import DEFAULT_PROTOCOL_VERSION
except ImportError:
    try:
        from experiments.manifest import DEFAULT_PROTOCOL_VERSION
    except ImportError:
        DEFAULT_PROTOCOL_VERSION = "1.0"

# Bảng xuất + cột (cố định để CSV ổn định giữa các run; analyze.py dựa vào cột này).
_METRIC_COLS = [
    "id",
    "deployment_id",
    "seq",
    "ts_vps",
    "ts_local",
    "cpu_pct",
    "mem_mb",
    "mem_pct",
    "mem_limit_mb",
    "latency_ms",
    "http_error_rate",
    "db_response_ms",
    "container_up",
    "host_cpu_pct",
    "host_mem_pct",
]
_SCORE_COLS = [
    "id",
    "metric_sample_id",
    "deployment_id",
    "ts_vps",
    "method",
    "score",
    "above_threshold",
    "detail_json",
]
_ALERT_COLS = [
    "id",
    "deployment_id",
    "metric_sample_id",
    "method",
    "ts_vps",
    "ts_resolved",
    "peak_score",
    "label",
    "acted",
    "experiment_run_id",
]
_RUN_COLS = [
    "id",
    "scenario",
    "repeat_index",
    "deployment_id",
    "vps_id",
    "baseline_start_ts",
    "train_at_ts",
    "fault_start_ts",
    "fault_end_ts",
    "run_end_ts",
    "clock_offset_ms",
    "detection_grace_s",
    "train_sample_count",
    "fault_params_json",
    "status",
    "abort_reason",
]


def _write_csv(path: Path, columns: list[str], rows: list[sqlite3.Row]) -> int:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(columns)
        for row in rows:
            writer.writerow([row[c] for c in columns])
    return len(rows)


def export_run(
    conn: sqlite3.Connection, run_id: int, out_dir: Path, meta_extra: dict | None = None
) -> dict[str, int]:
    """Xuất một run ra CSV + meta.json. Trả số dòng mỗi file. Thuần theo `conn` (test với :memory:)."""
    conn.row_factory = sqlite3.Row
    out_dir.mkdir(parents=True, exist_ok=True)

    run_rows = conn.execute(
        "SELECT * FROM experiment_run WHERE id = ?", (run_id,)
    ).fetchall()
    if not run_rows:
        raise ValueError(f"experiment_run id={run_id} không tồn tại")
    deployment_id = run_rows[0]["deployment_id"]

    metric_rows = conn.execute(
        "SELECT * FROM metric_sample WHERE deployment_id = ? ORDER BY seq",
        (deployment_id,),
    ).fetchall()
    score_rows = conn.execute(
        "SELECT * FROM score_sample WHERE deployment_id = ? ORDER BY ts_vps, method",
        (deployment_id,),
    ).fetchall()
    alert_rows = conn.execute(
        "SELECT * FROM alert WHERE experiment_run_id = ? ORDER BY ts_vps", (run_id,)
    ).fetchall()

    counts = {
        "metric_sample": _write_csv(
            out_dir / "metric_sample.csv", _METRIC_COLS, metric_rows
        ),
        "score_sample": _write_csv(
            out_dir / "score_sample.csv", _SCORE_COLS, score_rows
        ),
        "alert": _write_csv(out_dir / "alert.csv", _ALERT_COLS, alert_rows),
        "experiment_run": _write_csv(
            out_dir / "experiment_run.csv", _RUN_COLS, run_rows
        ),
    }

    meta = {
        "run_id": run_id,
        "scenario": run_rows[0]["scenario"],
        "repeat_index": run_rows[0]["repeat_index"],
        "protocol_version": DEFAULT_PROTOCOL_VERSION,
        "status": run_rows[0]["status"],
        "clock_offset_ms": run_rows[0]["clock_offset_ms"],
        "detection_grace_s": run_rows[0]["detection_grace_s"],
        "counts": counts,
    }
    if meta_extra:
        meta.update(
            meta_extra
        )  # git_commit, collector_version, protocol_version, feature_version, ngưỡng (docs/07)
    (out_dir / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return counts


def run_dir_for(results_root: Path, scenario: str, repeat_index: int) -> Path:
    """Thư mục chuẩn docs/07 mục 8: results/run_<scenario>_<n>/."""
    return results_root / f"run_{scenario}_{repeat_index}"
