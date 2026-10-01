from __future__ import annotations

import csv
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from export_results import export_run, run_dir_for

# Schema tối thiểu đủ cho export (các bảng export_run đụng tới). Cột khớp docs/contracts/schema.sql.
_SCHEMA = """
CREATE TABLE experiment_run (
  id INTEGER PRIMARY KEY, scenario TEXT, repeat_index INTEGER, deployment_id INTEGER,
  vps_id INTEGER, baseline_start_ts TEXT, train_at_ts TEXT, fault_start_ts TEXT,
  fault_end_ts TEXT, run_end_ts TEXT, clock_offset_ms INTEGER, detection_grace_s INTEGER,
  train_sample_count INTEGER, fault_params_json TEXT, status TEXT, abort_reason TEXT
);
CREATE TABLE metric_sample (
  id INTEGER PRIMARY KEY, deployment_id INTEGER, seq INTEGER, ts_vps TEXT, ts_local TEXT,
  cpu_pct REAL, mem_mb REAL, mem_pct REAL, mem_limit_mb REAL, latency_ms REAL,
  http_error_rate REAL, db_response_ms REAL, container_up INTEGER, host_cpu_pct REAL,
  host_mem_pct REAL
);
CREATE TABLE score_sample (
  id INTEGER PRIMARY KEY, metric_sample_id INTEGER, deployment_id INTEGER, ts_vps TEXT,
  method TEXT, score REAL, above_threshold INTEGER, detail_json TEXT
);
CREATE TABLE alert (
  id INTEGER PRIMARY KEY, deployment_id INTEGER, metric_sample_id INTEGER, method TEXT,
  ts_vps TEXT, ts_resolved TEXT, peak_score REAL, label TEXT, acted TEXT, experiment_run_id INTEGER
);
CREATE TABLE vps (id INTEGER PRIMARY KEY, encrypted_secret BLOB);
"""


def _seed(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA)
    # 1 VPS có secret — export KHÔNG được đụng bảng này.
    conn.execute("INSERT INTO vps (id, encrypted_secret) VALUES (1, X'DEADBEEF')")
    conn.execute(
        "INSERT INTO experiment_run (id, scenario, repeat_index, deployment_id, vps_id, "
        "fault_start_ts, fault_end_ts, train_at_ts, clock_offset_ms, detection_grace_s, status) "
        "VALUES (7, 'memory_leak', 1, 42, 1, '2000.0', '3200.0', '1000.0', 120, 60, 'completed')"
    )
    for seq in range(3):
        conn.execute(
            "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local, mem_mb, container_up) "
            "VALUES (42, ?, ?, ?, ?, 1)",
            (seq, str(2000.0 + seq * 10), "local", 100.0 + seq),
        )
    for method in ("rule", "ensemble"):
        conn.execute(
            "INSERT INTO score_sample (metric_sample_id, deployment_id, ts_vps, method, score, "
            "above_threshold) VALUES (1, 42, '2000.0', ?, 0.9, 1)",
            (method,),
        )
    conn.execute(
        "INSERT INTO alert (deployment_id, method, ts_vps, peak_score, acted, experiment_run_id) "
        "VALUES (42, 'ensemble', '2100.0', 0.95, 'none', 7)"
    )
    conn.commit()


def test_export_writes_five_artifacts(tmp_path):
    conn = sqlite3.connect(":memory:")
    _seed(conn)
    out = run_dir_for(tmp_path, "memory_leak", 1)
    counts = export_run(conn, run_id=7, out_dir=out)

    assert counts == {
        "metric_sample": 3,
        "score_sample": 2,
        "alert": 1,
        "experiment_run": 1,
    }
    for name in (
        "metric_sample.csv",
        "score_sample.csv",
        "alert.csv",
        "experiment_run.csv",
        "meta.json",
    ):
        assert (out / name).exists()


def test_metric_csv_content(tmp_path):
    conn = sqlite3.connect(":memory:")
    _seed(conn)
    out = run_dir_for(tmp_path, "memory_leak", 1)
    export_run(conn, run_id=7, out_dir=out)

    with (out / "metric_sample.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == 3
    assert rows[0]["ts_vps"] == "2000.0"
    assert float(rows[2]["mem_mb"]) == 102.0


def test_meta_json_records_run(tmp_path):
    conn = sqlite3.connect(":memory:")
    _seed(conn)
    out = run_dir_for(tmp_path, "memory_leak", 1)
    export_run(
        conn,
        run_id=7,
        out_dir=out,
        meta_extra={"git_commit": "abc123", "feature_version": "1"},
    )
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert meta["scenario"] == "memory_leak"
    assert meta["git_commit"] == "abc123"
    assert meta["clock_offset_ms"] == 120
    assert meta["protocol_version"] == "1.0"


def test_export_run_custom_protocol_version(tmp_path):
    conn = sqlite3.connect(":memory:")
    _seed(conn)
    out = run_dir_for(tmp_path, "memory_leak", 2)
    export_run(conn, run_id=7, out_dir=out, meta_extra={"protocol_version": "2.0"})
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert meta["protocol_version"] == "2.0"


def test_export_never_touches_vps_table(tmp_path):
    # Bảo chứng docs/07 mục 8: không có file nào chứa nội dung bảng vps / secret.
    conn = sqlite3.connect(":memory:")
    _seed(conn)
    out = run_dir_for(tmp_path, "memory_leak", 1)
    export_run(conn, run_id=7, out_dir=out)
    for path in out.iterdir():
        blob = path.read_text(encoding="utf-8").lower()
        assert "deadbeef" not in blob
        assert "encrypted_secret" not in blob


def test_missing_run_raises(tmp_path):
    import pytest

    conn = sqlite3.connect(":memory:")
    _seed(conn)
    with pytest.raises(ValueError):
        export_run(conn, run_id=999, out_dir=tmp_path / "x")
