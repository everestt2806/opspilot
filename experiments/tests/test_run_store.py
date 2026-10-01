from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run_store import (
    ActiveRunExistsError,
    InvalidRunStateError,
    RunNotFoundError,
    abort_run,
    complete_run,
    count_phase_a_samples,
    get_active_run,
    get_run,
    start_run,
    update_phase_schedule,
)

_SCHEMA = """
CREATE TABLE deployment (
  id INTEGER PRIMARY KEY
);
CREATE TABLE vps (
  id INTEGER PRIMARY KEY
);
CREATE TABLE experiment_run (
  id               INTEGER PRIMARY KEY,
  scenario         TEXT    NOT NULL CHECK (scenario IN
                     ('memory_leak','cpu_spike','error_burst','slow_db','latency_creep')),
  repeat_index     INTEGER NOT NULL,
  deployment_id    INTEGER REFERENCES deployment(id) ON DELETE SET NULL,
  vps_id           INTEGER REFERENCES vps(id),
  baseline_start_ts TEXT,
  train_at_ts       TEXT,
  fault_start_ts    TEXT,
  fault_end_ts      TEXT,
  run_end_ts        TEXT,
  clock_offset_ms   INTEGER NOT NULL DEFAULT 0,
  detection_grace_s INTEGER NOT NULL DEFAULT 60,
  train_sample_count INTEGER,
  fault_params_json TEXT,
  status            TEXT NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','completed','aborted')),
  abort_reason      TEXT,
  notes             TEXT,
  UNIQUE (scenario, repeat_index)
);
CREATE TABLE metric_sample (
  id              INTEGER PRIMARY KEY,
  deployment_id   INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  ts_vps          TEXT    NOT NULL,
  ts_local        TEXT    NOT NULL,
  cpu_pct         REAL,
  mem_mb          REAL,
  mem_pct         REAL,
  mem_limit_mb    REAL,
  latency_ms      REAL,
  http_error_rate REAL,
  db_response_ms  REAL,
  container_up    INTEGER NOT NULL DEFAULT 1 CHECK (container_up IN (0,1)),
  host_cpu_pct    REAL,
  host_mem_pct    REAL,
  raw_json        TEXT,
  UNIQUE (deployment_id, seq)
);
CREATE INDEX idx_metric_dep_ts ON metric_sample(deployment_id, ts_vps);
"""


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(_SCHEMA)
    c.execute("INSERT INTO deployment (id) VALUES (42)")
    c.execute("INSERT INTO deployment (id) VALUES (99)")
    c.execute("INSERT INTO vps (id) VALUES (1)")
    c.commit()
    return c


def test_start_run_and_query(conn: sqlite3.Connection) -> None:
    run_id = start_run(
        conn,
        scenario="memory_leak",
        repeat_index=1,
        deployment_id=42,
        vps_id=1,
        baseline_start_ts="2026-10-01T10:00:00Z",
        clock_offset_ms=45,
        detection_grace_s=60,
        fault_params_json='{"rate_mb_per_min": 5}',
        notes="Test initial run",
    )
    assert run_id > 0

    run = get_run(conn, run_id)
    assert run is not None
    assert run["scenario"] == "memory_leak"
    assert run["repeat_index"] == 1
    assert run["deployment_id"] == 42
    assert run["vps_id"] == 1
    assert run["status"] == "running"
    assert run["baseline_start_ts"] == "2026-10-01T10:00:00Z"
    assert run["clock_offset_ms"] == 45
    assert run["detection_grace_s"] == 60
    assert run["fault_params_json"] == '{"rate_mb_per_min": 5}'

    active = get_active_run(conn)
    assert active is not None
    assert active["id"] == run_id


def test_start_run_validation(conn: sqlite3.Connection) -> None:
    with pytest.raises(ValueError, match="không hợp lệ"):
        start_run(conn, scenario="invalid_scenario", repeat_index=1)

    with pytest.raises(ValueError, match="repeat_index"):
        start_run(conn, scenario="memory_leak", repeat_index=0)


def test_single_active_run_rule(conn: sqlite3.Connection) -> None:
    run_id = start_run(conn, scenario="memory_leak", repeat_index=1, deployment_id=42)
    assert run_id > 0

    # Cố gắng khởi tạo run thứ 2 khi run 1 vẫn đang running -> phải bị từ chối
    with pytest.raises(ActiveRunExistsError, match="đang có run đang chạy"):
        start_run(conn, scenario="cpu_spike", repeat_index=1, deployment_id=42)

    # Active run vẫn là run_id
    active = get_active_run(conn)
    assert active is not None
    assert active["id"] == run_id


def test_update_phase_schedule(conn: sqlite3.Connection) -> None:
    run_id = start_run(conn, scenario="cpu_spike", repeat_index=1)

    update_phase_schedule(
        conn,
        run_id=run_id,
        train_at_ts="2026-10-01T10:30:00Z",
        fault_start_ts="2026-10-01T10:45:00Z",
        fault_end_ts="2026-10-01T11:05:00Z",
        train_sample_count=185,
    )

    run = get_run(conn, run_id)
    assert run is not None
    assert run["train_at_ts"] == "2026-10-01T10:30:00Z"
    assert run["fault_start_ts"] == "2026-10-01T10:45:00Z"
    assert run["fault_end_ts"] == "2026-10-01T11:05:00Z"
    assert run["train_sample_count"] == 185

    with pytest.raises(RunNotFoundError):
        update_phase_schedule(conn, run_id=9999, train_at_ts="2026-10-01T10:30:00Z")


def test_complete_run(conn: sqlite3.Connection) -> None:
    run_id = start_run(conn, scenario="error_burst", repeat_index=1)

    complete_run(conn, run_id=run_id, run_end_ts="2026-10-01T11:15:00Z", notes="Xong em dep")

    run = get_run(conn, run_id)
    assert run is not None
    assert run["status"] == "completed"
    assert run["run_end_ts"] == "2026-10-01T11:15:00Z"
    assert run["notes"] == "Xong em dep"

    # Sau khi complete, không còn run nào running
    assert get_active_run(conn) is None

    # Không thể complete tiếp một run đã completed
    with pytest.raises(InvalidRunStateError, match="không thể hoàn tất"):
        complete_run(conn, run_id=run_id, run_end_ts="2026-10-01T11:20:00Z")

    with pytest.raises(RunNotFoundError):
        complete_run(conn, run_id=9999, run_end_ts="2026-10-01T11:20:00Z")


def test_abort_run(conn: sqlite3.Connection) -> None:
    run_id = start_run(conn, scenario="slow_db", repeat_index=1)

    # Abort thiếu lý do
    with pytest.raises(ValueError, match="bắt buộc"):
        abort_run(conn, run_id=run_id, reason="   ")

    abort_run(
        conn,
        run_id=run_id,
        reason="Lệch đồng hồ vượt ngưỡng 2000ms: 2500ms",
        run_end_ts="2026-10-01T10:05:00Z",
    )

    run = get_run(conn, run_id)
    assert run is not None
    assert run["status"] == "aborted"
    assert run["abort_reason"] == "Lệch đồng hồ vượt ngưỡng 2000ms: 2500ms"
    assert run["run_end_ts"] == "2026-10-01T10:05:00Z"

    assert get_active_run(conn) is None

    # Không thể abort một run đã aborted
    with pytest.raises(InvalidRunStateError, match="không thể abort"):
        abort_run(conn, run_id=run_id, reason="Abort lại")


def test_unique_scenario_repeat_constraint_after_abort(conn: sqlite3.Connection) -> None:
    """Xác nhận giới hạn schema hiện tại: UNIQUE(scenario, repeat_index) ngăn retry sau abort.

    Vì schema chưa có attempt_index, bản ghi aborted vẫn giữ khoá (scenario, repeat_index).
    Khi thử retry mà chưa sửa schema, SQLite sẽ ném IntegrityError.
    """
    run_id = start_run(conn, scenario="latency_creep", repeat_index=1)
    abort_run(conn, run_id=run_id, reason="Mất kết nối SSH tới VPS")

    assert get_active_run(conn) is None

    # Cố gắng retry cùng scenario và repeat_index -> SQLite IntegrityError
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint failed"):
        start_run(conn, scenario="latency_creep", repeat_index=1)

    # Nhưng scenario khác hoặc repeat_index khác thì thành công
    new_run_id = start_run(conn, scenario="latency_creep", repeat_index=2)
    assert new_run_id > 0


def test_count_phase_a_samples(conn: sqlite3.Connection) -> None:
    dep_id = 42
    other_dep_id = 99

    # Dữ liệu giả định:
    # Pha A diễn ra từ 2026-10-01T10:00:00Z đến 2026-10-01T10:30:00Z
    # 1. Mẫu rác cũ trước pha A (10:00:00) -> KHÔNG ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 1, '2026-10-01T09:59:50Z', 'local')",
        (dep_id,),
    )
    # 2. Các mẫu hợp lệ trong Pha A: 3 mẫu cho deployment 42
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 2, '2026-10-01T10:00:00Z', 'local')",
        (dep_id,),
    )
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 3, '2026-10-01T10:10:00Z', 'local')",
        (dep_id,),
    )
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 4, '2026-10-01T10:29:50Z', 'local')",
        (dep_id,),
    )
    # 3. Mẫu trong Pha A nhưng thuộc deployment khác -> KHÔNG ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 1, '2026-10-01T10:15:00Z', 'local')",
        (other_dep_id,),
    )
    # 4. Mẫu đúng mốc train_at_ts hoặc sau đó (Pha B trở đi) -> KHÔNG ĐƯỢC ĐẾM (cửa sổ nửa mở [start, end))
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 5, '2026-10-01T10:30:00Z', 'local')",
        (dep_id,),
    )
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 6, '2026-10-01T10:35:00Z', 'local')",
        (dep_id,),
    )
    conn.commit()

    count = count_phase_a_samples(
        conn,
        deployment_id=dep_id,
        baseline_start_ts="2026-10-01T10:00:00Z",
        train_at_ts="2026-10-01T10:30:00Z",
    )
    assert count == 3

    # Deployment 99 chỉ có 1 mẫu trong khoảng này
    count_other = count_phase_a_samples(
        conn,
        deployment_id=other_dep_id,
        baseline_start_ts="2026-10-01T10:00:00Z",
        train_at_ts="2026-10-01T10:30:00Z",
    )
    assert count_other == 1

    # Nếu khoảng thời gian không có mẫu nào
    count_empty = count_phase_a_samples(
        conn,
        deployment_id=dep_id,
        baseline_start_ts="2026-10-01T12:00:00Z",
        train_at_ts="2026-10-01T12:30:00Z",
    )
    assert count_empty == 0
