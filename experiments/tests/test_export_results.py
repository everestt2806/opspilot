from __future__ import annotations

import csv
import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from export_results import export_run, run_dir_for

# Schema tối thiểu đủ cho export (các bảng export_run đụng tới). Cột khớp docs/contracts/schema.sql.
_SCHEMA = """
CREATE TABLE experiment_run (
  id INTEGER PRIMARY KEY, scenario TEXT, repeat_index INTEGER, attempt_index INTEGER DEFAULT 1,
  deployment_id INTEGER, vps_id INTEGER, baseline_start_ts TEXT, train_at_ts TEXT,
  fault_start_ts TEXT, fault_end_ts TEXT, run_end_ts TEXT, clock_offset_ms INTEGER,
  detection_grace_s INTEGER, train_sample_count INTEGER, fault_params_json TEXT,
  status TEXT, abort_reason TEXT
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


def test_missing_run_raises_and_does_not_create_directory(tmp_path):
    """Xác nhận nếu run không tồn tại thì ném lỗi và KHÔNG tạo thư mục rác trên đĩa."""
    conn = sqlite3.connect(":memory:")
    _seed(conn)
    target = tmp_path / "never_created_dir"
    with pytest.raises(ValueError, match="không tồn tại"):
        export_run(conn, run_id=999, out_dir=target)
    assert not target.exists()


def test_write_csv_strictness_and_legacy_attempt_fallback(tmp_path):
    """_write_csv chỉ cho phép fallback attempt_index=1 cho legacy; thiếu cột khác phải ném KeyError."""
    from export_results import _write_csv

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE legacy_run (id INT, scenario TEXT, status TEXT)")
    conn.execute("INSERT INTO legacy_run VALUES (1, 'cpu_spike', 'completed')")
    rows = conn.execute("SELECT * FROM legacy_run").fetchall()

    csv_path = tmp_path / "legacy.csv"
    # Fallback cho attempt_index = 1 thành công với dữ liệu legacy
    count = _write_csv(csv_path, ["id", "scenario", "status", "attempt_index"], rows)
    assert count == 1
    with csv_path.open(encoding="utf-8") as f:
        reader = list(csv.DictReader(f))
    assert reader[0]["attempt_index"] == "1"

    # Thiếu cột khác ngoài attempt_index phải ném KeyError
    with pytest.raises(KeyError, match="Thiếu cột bắt buộc 'notes'"):
        _write_csv(tmp_path / "fail.csv", ["id", "scenario", "notes"], rows)


def test_export_distinct_attempt_directories(tmp_path):
    """Xác nhận hai attempt khác nhau xuất ra hai thư mục độc lập (_att1 và _att2)."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA)
    conn.execute(
        "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index, deployment_id, vps_id, "
        "fault_start_ts, fault_end_ts, train_at_ts, clock_offset_ms, detection_grace_s, status, abort_reason) "
        "VALUES (1, 'cpu_spike', 1, 1, 42, 1, '2000.0', '3200.0', '1000.0', 120, 60, 'aborted', 'vps_reboot')"
    )
    conn.execute(
        "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index, deployment_id, vps_id, "
        "fault_start_ts, fault_end_ts, train_at_ts, clock_offset_ms, detection_grace_s, status) "
        "VALUES (2, 'cpu_spike', 1, 2, 42, 1, '2000.0', '3200.0', '1000.0', 120, 60, 'completed')"
    )
    conn.commit()

    out_att1 = run_dir_for(tmp_path, "cpu_spike", 1, attempt_index=1)
    out_att2 = run_dir_for(tmp_path, "cpu_spike", 1, attempt_index=2)

    assert out_att1.name == "run_cpu_spike_1_att1"
    assert out_att2.name == "run_cpu_spike_1_att2"

    export_run(conn, run_id=1, out_dir=out_att1)
    export_run(conn, run_id=2, out_dir=out_att2)

    assert out_att1.exists()
    assert out_att2.exists()
    assert out_att1 != out_att2

    meta1 = json.loads((out_att1 / "meta.json").read_text(encoding="utf-8"))
    meta2 = json.loads((out_att2 / "meta.json").read_text(encoding="utf-8"))
    assert meta1["attempt_index"] == 1
    assert meta1["status"] == "aborted"
    assert meta2["attempt_index"] == 2
    assert meta2["status"] == "completed"

    with (out_att1 / "experiment_run.csv").open(newline="", encoding="utf-8") as stream:
        rows1 = list(csv.DictReader(stream))
    assert rows1[0]["attempt_index"] == "1"
    assert rows1[0]["status"] == "aborted"

    with (out_att2 / "experiment_run.csv").open(newline="", encoding="utf-8") as stream:
        rows2 = list(csv.DictReader(stream))
    assert rows2[0]["attempt_index"] == "2"
    assert rows2[0]["status"] == "completed"


def test_export_refuses_when_directory_already_exists(tmp_path):
    """Xác nhận export_run từ chối ghi đè khi thư mục đã tồn tại trước đó."""
    conn = sqlite3.connect(":memory:")
    _seed(conn)
    out = run_dir_for(tmp_path, "memory_leak", 1, attempt_index=1)
    export_run(conn, run_id=7, out_dir=out)

    # 1. Thư mục đã xuất rồi, xuất lại lần 2 phải từ chối FileExistsError
    with pytest.raises(FileExistsError, match="Quy định giao thức cấm ghi đè"):
        export_run(conn, run_id=7, out_dir=out)

    # 2. Thư mục đã tồn tại trước (dù rỗng), cũng bị từ chối
    pre_existing = tmp_path / "run_pre_existing"
    pre_existing.mkdir()
    with pytest.raises(FileExistsError, match="đã tồn tại"):
        export_run(conn, run_id=7, out_dir=pre_existing)


def test_export_meta_extra_cannot_overwrite_db_fields(tmp_path):
    """Xác nhận meta_extra không thể ghi đè các trường định danh/trạng thái lấy từ DB,

    và dữ liệu trong experiment_run.csv cùng meta.json luôn khớp nhau.
    """
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA)
    conn.execute(
        "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index, deployment_id, vps_id, "
        "fault_start_ts, fault_end_ts, train_at_ts, clock_offset_ms, detection_grace_s, status, abort_reason) "
        "VALUES (10, 'error_burst', 2, 1, 42, 1, '2000.0', '3200.0', '1000.0', 120, 60, 'aborted', 'oom_kill')"
    )
    conn.commit()

    out_dir = run_dir_for(tmp_path, "error_burst", 2, attempt_index=1)
    malicious_extra = {
        "run_id": 9999,
        "scenario": "latency_creep",
        "repeat_index": 99,
        "attempt_index": 3,
        "status": "completed",
        "git_commit": "abc1234",
    }
    export_run(conn, run_id=10, out_dir=out_dir, meta_extra=malicious_extra)

    meta = json.loads((out_dir / "meta.json").read_text(encoding="utf-8"))
    with (out_dir / "experiment_run.csv").open(newline="", encoding="utf-8") as stream:
        csv_rows = list(csv.DictReader(stream))
    assert len(csv_rows) == 1
    csv_row = csv_rows[0]

    # Các trường bảo vệ trong meta.json PHẢI giữ nguyên giá trị từ DB
    assert meta["run_id"] == 10
    assert meta["scenario"] == "error_burst"
    assert meta["repeat_index"] == 2
    assert meta["attempt_index"] == 1
    assert meta["status"] == "aborted"
    # Trường không nằm trong danh sách bảo vệ được cập nhật bình thường
    assert meta["git_commit"] == "abc1234"

    # CSV và meta.json luôn luôn khớp nhau
    assert str(meta["run_id"]) == csv_row["id"]
    assert meta["scenario"] == csv_row["scenario"]
    assert str(meta["repeat_index"]) == csv_row["repeat_index"]
    assert str(meta["attempt_index"]) == csv_row["attempt_index"]
    assert meta["status"] == csv_row["status"]
