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
    "attempt_index",
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
            keys = set(row.keys()) if hasattr(row, "keys") else set()
            vals = []
            for c in columns:
                if c in keys:
                    vals.append(row[c])
                elif c == "attempt_index":
                    # Fallback chỉ cho phép với attempt_index cho dữ liệu legacy
                    vals.append(1)
                else:
                    raise KeyError(
                        f"Thiếu cột bắt buộc '{c}' trong bản ghi SQLite để xuất CSV"
                    )
            writer.writerow(vals)
    return len(rows)


def export_run(
    conn: sqlite3.Connection, run_id: int, out_dir: Path, meta_extra: dict | None = None
) -> dict[str, int]:
    """Xuất một run ra CSV + meta.json. Trả số dòng mỗi file. Thuần theo `conn` (test với :memory:).

    Quy định giao thức (TK-S6 P2b-3):
      - Kiểm tra run tồn tại trong cơ sở dữ liệu trước khi thực hiện chiếm thư mục.
      - Chiếm thư mục bằng thao tác tạo độc quyền (exclusive mkdir).
      - Nếu thư mục đã tồn tại trước đó, từ chối và ném FileExistsError trước khi thực hiện ghi.
      - Ghi attempt_index vào experiment_run.csv và meta.json.
    """
    conn.row_factory = sqlite3.Row

    run_rows = conn.execute(
        "SELECT * FROM experiment_run WHERE id = ?", (run_id,)
    ).fetchall()
    if not run_rows:
        raise ValueError(f"experiment_run id={run_id} không tồn tại")

    if out_dir.exists():
        raise FileExistsError(
            f"Thư mục kết quả '{out_dir}' đã tồn tại. Quy định giao thức cấm ghi đè artifact của attempt đã tồn tại."
        )

    out_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        out_dir.mkdir(parents=False, exist_ok=False)
    except FileExistsError as err:
        raise FileExistsError(
            f"Thư mục kết quả '{out_dir}' đã được chiếm bởi tiến trình khác. Quy định giao thức cấm ghi đè artifact."
        ) from err
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

    first_run = run_rows[0]
    keys = first_run.keys() if hasattr(first_run, "keys") else []
    attempt_index = first_run["attempt_index"] if "attempt_index" in keys else 1

    PROTECTED_META_KEYS = {
        "run_id",
        "scenario",
        "repeat_index",
        "attempt_index",
        "status",
    }

    meta = {
        "run_id": run_id,
        "scenario": first_run["scenario"],
        "repeat_index": first_run["repeat_index"],
        "attempt_index": attempt_index,
        "protocol_version": DEFAULT_PROTOCOL_VERSION,
        "status": first_run["status"],
        "clock_offset_ms": first_run["clock_offset_ms"],
        "detection_grace_s": first_run["detection_grace_s"],
        "counts": counts,
    }
    if meta_extra:
        # Ngăn meta_extra ghi đè các trường định danh/trạng thái lấy từ DB (TK-S6 P2b-3)
        for k, v in meta_extra.items():
            if k not in PROTECTED_META_KEYS:
                meta[k] = v
    (out_dir / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return counts


def run_dir_for(
    results_root: Path, scenario: str, repeat_index: int, attempt_index: int = 1
) -> Path:
    """Thư mục chuẩn docs/07 mục 8: results/run_<scenario>_<repeat>_att<attempt_index>/."""
    return results_root / f"run_{scenario}_{repeat_index}_att{attempt_index}"
