from __future__ import annotations

import sqlite3
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run_store import (
    ActiveRunExistsError,
    InvalidRunStateError,
    RunNotFoundError,
    RunStoreError,
    abort_run,
    complete_run,
    count_phase_a_samples,
    get_active_run,
    get_run,
    normalize_ts,
    start_run,
    to_epoch_seconds,
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


def test_normalize_ts_and_to_epoch_seconds() -> None:
    # 1. Epoch float với và không có phần thập phân (bảo tồn microseconds)
    assert normalize_ts(1790762400.0) == "2026-09-30T10:00:00Z"
    assert normalize_ts(1790762400.123456) == "2026-09-30T10:00:00.123456Z"
    assert to_epoch_seconds(1790762400.123456) == 1790762400.123456

    # 2. Epoch int
    assert normalize_ts(1790762400) == "2026-09-30T10:00:00Z"
    assert to_epoch_seconds(1790762400) == 1790762400.0

    # 3. Epoch numeric string
    assert normalize_ts("1790762400.0") == "2026-09-30T10:00:00Z"
    assert normalize_ts("1790762400.25") == "2026-09-30T10:00:00.250000Z"
    assert to_epoch_seconds("1790762400.25") == 1790762400.25

    # 4. ISO string ending in Z
    assert normalize_ts("2026-10-01T10:00:00Z") == "2026-10-01T10:00:00Z"
    assert normalize_ts("2026-10-01T10:00:00.123456Z") == "2026-10-01T10:00:00.123456Z"

    # 5. ISO string with timezone offset (+07:00)
    assert normalize_ts("2026-10-01T17:00:00+07:00") == "2026-10-01T10:00:00Z"

    # 6. Datetime object
    dt = datetime(2026, 10, 1, 10, 0, 0, tzinfo=timezone.utc)
    assert normalize_ts(dt) == "2026-10-01T10:00:00Z"

    # Lỗi
    with pytest.raises(ValueError):
        normalize_ts("   ")
    with pytest.raises(ValueError):
        normalize_ts("not-a-valid-timestamp")


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


def test_start_run_with_epoch_input_normalizes_to_iso(conn: sqlite3.Connection) -> None:
    """Runner thường dùng time.time() hoặc vps_epoch_ms (float giây). Đảm bảo chuẩn hoá về ISO UTC."""
    epoch_sec = 1790762400.0  # 2026-09-30T10:00:00Z
    run_id = start_run(
        conn,
        scenario="memory_leak",
        repeat_index=1,
        deployment_id=42,
        baseline_start_ts=epoch_sec,
    )
    run = get_run(conn, run_id)
    assert run is not None
    assert run["baseline_start_ts"] == "2026-09-30T10:00:00Z"


def test_start_run_rejects_when_in_active_transaction(conn: sqlite3.Connection) -> None:
    """Từ chối gọi start_run khi connection đã có transaction chưa commit (in_transaction=True)."""
    conn.execute("INSERT INTO deployment (id) VALUES (999)")
    assert conn.in_transaction is True

    with pytest.raises(RunStoreError, match="in_transaction=True"):
        start_run(conn, scenario="memory_leak", repeat_index=1)

    conn.rollback()


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


def test_atomic_start_run_across_two_connections(tmp_path: Path) -> None:
    """Kiểm tra hai kết nối SQLite độc lập cùng khởi động run:

    1. Kết nối tuần tự: Conn 1 tạo run running -> Conn 2 bị từ chối ngay.
    2. Kết nối đồng thời: Hai thread cùng gọi start_run đồng thời -> đúng 1 thread thành công,
       thread còn lại ném ActiveRunExistsError do BEGIN IMMEDIATE + kiểm tra nguyên tử.
    """
    db_file = tmp_path / "shared_experiment.db"
    setup_conn = sqlite3.connect(db_file)
    setup_conn.executescript(_SCHEMA)
    setup_conn.commit()
    setup_conn.close()

    # 1. Tuần tự
    c1 = sqlite3.connect(db_file, timeout=5.0)
    c2 = sqlite3.connect(db_file, timeout=5.0)

    run_id_1 = start_run(c1, scenario="memory_leak", repeat_index=1)
    assert run_id_1 > 0

    with pytest.raises(ActiveRunExistsError, match="đang có run đang chạy"):
        start_run(c2, scenario="cpu_spike", repeat_index=1)

    complete_run(c1, run_id=run_id_1, run_end_ts="2026-10-01T12:00:00Z")
    c1.close()
    c2.close()

    # 2. Hai thread đồng thời cùng khởi động run
    results: list[tuple[str, str | int]] = []
    barrier = threading.Barrier(2)

    def worker(worker_id: str, scenario: str) -> None:
        c = sqlite3.connect(db_file, timeout=5.0)
        barrier.wait()  # Kích hoạt hai thread xuất phát tại cùng một tích tắc
        try:
            rid = start_run(c, scenario=scenario, repeat_index=2)
            results.append((worker_id, rid))
        except ActiveRunExistsError:
            results.append((worker_id, "REJECTED_ACTIVE_EXISTS"))
        except (sqlite3.Error, RunStoreError) as e:
            results.append((worker_id, f"ERROR_{type(e).__name__}"))
        finally:
            c.close()

    t1 = threading.Thread(target=worker, args=("W1", "slow_db"))
    t2 = threading.Thread(target=worker, args=("W2", "error_burst"))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # Đúng 1 thread thành công nhận ID số nguyên, thread còn lại bị từ chối
    statuses = [r[1] for r in results]
    assert "REJECTED_ACTIVE_EXISTS" in statuses
    successes = [s for s in statuses if isinstance(s, int)]
    assert len(successes) == 1


def test_update_phase_schedule(conn: sqlite3.Connection) -> None:
    run_id = start_run(conn, scenario="cpu_spike", repeat_index=1)

    # Đầu vào epoch float
    train_epoch = 1790764200.0  # 2026-09-30T10:30:00Z
    fault_epoch = 1790765100.0  # 2026-09-30T10:45:00Z

    update_phase_schedule(
        conn,
        run_id=run_id,
        train_at_ts=train_epoch,
        fault_start_ts=fault_epoch,
        fault_end_ts="2026-09-30T11:05:00Z",
        train_sample_count=185,
    )

    run = get_run(conn, run_id)
    assert run is not None
    assert run["train_at_ts"] == "2026-09-30T10:30:00Z"
    assert run["fault_start_ts"] == "2026-09-30T10:45:00Z"
    assert run["fault_end_ts"] == "2026-09-30T11:05:00Z"
    assert run["train_sample_count"] == 185

    with pytest.raises(RunNotFoundError):
        update_phase_schedule(conn, run_id=9999, train_at_ts="2026-10-01T10:30:00Z")


def test_update_phase_schedule_rejects_when_not_running(conn: sqlite3.Connection) -> None:
    """Từ chối cập nhật mốc pha khi run đã completed hoặc aborted."""
    # 1. Run đã completed
    r1 = start_run(conn, scenario="error_burst", repeat_index=1)
    complete_run(conn, run_id=r1, run_end_ts="2026-10-01T11:00:00Z")
    with pytest.raises(InvalidRunStateError, match="không thể cập nhật mốc pha"):
        update_phase_schedule(conn, run_id=r1, train_at_ts="2026-10-01T10:30:00Z")

    # 2. Run đã aborted
    r2 = start_run(conn, scenario="error_burst", repeat_index=2)
    abort_run(conn, run_id=r2, reason="Clock skew too high")
    with pytest.raises(InvalidRunStateError, match="không thể cập nhật mốc pha"):
        update_phase_schedule(conn, run_id=r2, train_at_ts="2026-10-01T10:30:00Z")


def test_transaction_ownership_when_caller_has_uncommitted_work(conn: sqlite3.Connection) -> None:
    """Xác nhận helper chỉ commit/rollback transaction do chính nó mở.

    Khi caller đã có transaction mở trước đó:
      - Thao tác thành công KHÔNG tự ý commit thay đổi của caller; caller có toàn quyền rollback/commit.
      - Thao tác thất bại KHÔNG huỷ (rollback) thay đổi chưa commit của caller; caller vẫn có thể commit.
    """
    run_id = start_run(conn, scenario="slow_db", repeat_index=1)

    # 1. Thao tác thành công + caller rollback
    conn.execute("INSERT INTO deployment (id) VALUES (777)")
    assert conn.in_transaction is True

    update_phase_schedule(conn, run_id=run_id, train_at_ts="2026-10-01T10:30:00Z")
    # Transaction của caller vẫn đang mở, chưa bị hàm tự ý commit!
    assert conn.in_transaction is True

    # Caller quyết định rollback: cả deployment 777 lẫn train_at_ts đều được rollback
    conn.rollback()
    assert conn.execute("SELECT COUNT(*) FROM deployment WHERE id = 777").fetchone()[0] == 0
    run_after_rb = get_run(conn, run_id)
    assert run_after_rb is not None
    assert run_after_rb["train_at_ts"] is None

    # 2. Thao tác thành công + caller commit
    conn.execute("INSERT INTO deployment (id) VALUES (777)")
    complete_run(conn, run_id=run_id, run_end_ts="2026-10-01T11:00:00Z")
    assert conn.in_transaction is True
    conn.commit()

    assert conn.execute("SELECT COUNT(*) FROM deployment WHERE id = 777").fetchone()[0] == 1
    run_after_cm = get_run(conn, run_id)
    assert run_after_cm is not None
    assert run_after_cm["status"] == "completed"

    # 3. Thao tác thất bại (RunNotFoundError) KHÔNG huỷ transaction có trước của caller
    conn.execute("INSERT INTO deployment (id) VALUES (888)")
    assert conn.in_transaction is True

    with pytest.raises(RunNotFoundError):
        complete_run(conn, run_id=9999, run_end_ts="2026-10-01T11:00:00Z")

    # Transaction của caller không bị huỷ!
    assert conn.in_transaction is True
    conn.commit()
    # Bản ghi 888 được lưu an toàn
    assert conn.execute("SELECT COUNT(*) FROM deployment WHERE id = 888").fetchone()[0] == 1

    # 4. Thao tác thất bại (InvalidRunStateError) trên abort/update_phase_schedule
    conn.execute("INSERT INTO deployment (id) VALUES (999)")
    with pytest.raises(InvalidRunStateError):
        # run_id đã completed ở bước 2, gọi abort phải ném InvalidRunStateError
        abort_run(conn, run_id=run_id, reason="Late abort attempt")

    assert conn.in_transaction is True
    conn.commit()
    assert conn.execute("SELECT COUNT(*) FROM deployment WHERE id = 999").fetchone()[0] == 1


def test_state_updates_atomic_with_status_running_condition(tmp_path: Path) -> None:
    """Đảm bảo cập nhật trạng thái bằng điều kiện SQL status='running' tránh sửa run vừa kết thúc ở kết nối khác."""
    db_file = tmp_path / "race_test.db"
    setup = sqlite3.connect(db_file)
    setup.executescript(_SCHEMA)
    setup.commit()
    setup.close()

    c1 = sqlite3.connect(db_file, timeout=5.0)
    c2 = sqlite3.connect(db_file, timeout=5.0)

    run_id = start_run(c1, scenario="slow_db", repeat_index=1)

    # C2 hoàn tất run trước
    complete_run(c2, run_id=run_id, run_end_ts="2026-10-01T11:00:00Z")

    # C1 cố tình abort hoặc complete hoặc update phase schedule trên run vừa bị C2 hoàn tất
    with pytest.raises(InvalidRunStateError, match="không thể abort"):
        abort_run(c1, run_id=run_id, reason="Late abort attempt")

    with pytest.raises(InvalidRunStateError, match="không thể hoàn tất"):
        complete_run(c1, run_id=run_id, run_end_ts="2026-10-01T11:05:00Z")

    with pytest.raises(InvalidRunStateError, match="không thể cập nhật mốc pha"):
        update_phase_schedule(c1, run_id=run_id, train_at_ts="2026-10-01T10:30:00Z")

    # Kiểm tra trạng thái vẫn là completed từ C2, không bị C1 đè
    final_run = get_run(c1, run_id)
    assert final_run is not None
    assert final_run["status"] == "completed"
    assert final_run["abort_reason"] is None

    c1.close()
    c2.close()


def test_complete_run(conn: sqlite3.Connection) -> None:
    run_id = start_run(conn, scenario="error_burst", repeat_index=1)

    complete_run(conn, run_id=run_id, run_end_ts=1790766900.0, notes="Xong em dep")

    run = get_run(conn, run_id)
    assert run is not None
    assert run["status"] == "completed"
    assert run["run_end_ts"] == "2026-09-30T11:15:00Z"
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
        run_end_ts=1790762700.0,
    )

    run = get_run(conn, run_id)
    assert run is not None
    assert run["status"] == "aborted"
    assert run["abort_reason"] == "Lệch đồng hồ vượt ngưỡng 2000ms: 2500ms"
    assert run["run_end_ts"] == "2026-09-30T10:05:00Z"

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


def test_count_phase_a_samples_fractional_boundary_precision(conn: sqlite3.Connection) -> None:
    """Kiểm tra độ chính xác đầy đủ khi ranh giới có phần thập phân:

    Cửa sổ là nửa mở [start, end) = [2026-09-30T10:00:00.500Z, 2026-09-30T10:30:00.500Z)
    Collector ghi ts_vps dạng giây nguyên:
      - 10:00:00Z (.000 < .500 -> trước start) -> KHÔNG ĐƯỢC ĐẾM
      - 10:00:01Z (trong khoảng) -> ĐƯỢC ĐẾM
      - 10:30:00Z (.000 < .500 -> trước end, nằm trong [start, end)) -> ĐƯỢC ĐẾM
      - 10:30:01Z (sau end) -> KHÔNG ĐƯỢC ĐẾM
    """
    dep_id = 42

    # 1. Mẫu tại đúng giây bắt đầu 10:00:00Z (nhưng trước 10:00:00.500Z)
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 1, '2026-09-30T10:00:00Z', 'local')",
        (dep_id,),
    )
    # 2. Mẫu hợp lệ tại 10:00:01Z
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 2, '2026-09-30T10:00:01Z', 'local')",
        (dep_id,),
    )
    # 3. Mẫu tại 10:15:00Z
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 3, '2026-09-30T10:15:00Z', 'local')",
        (dep_id,),
    )
    # 4. Mẫu tại đúng giây kết thúc 10:30:00Z (nhưng trước 10:30:00.500Z)
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 4, '2026-09-30T10:30:00Z', 'local')",
        (dep_id,),
    )
    # 5. Mẫu tại 10:30:01Z (sau 10:30:00.500Z)
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 5, '2026-09-30T10:30:01Z', 'local')",
        (dep_id,),
    )
    conn.commit()

    # Truy vấn với ranh giới epoch float có phần lẻ (.5)
    count = count_phase_a_samples(
        conn,
        deployment_id=dep_id,
        baseline_start_ts=1790762400.5,  # 10:00:00.500000Z
        train_at_ts=1790764200.5,        # 10:30:00.500000Z
    )
    # Kỳ vọng: mẫu 10:00:01, 10:15:00, 10:30:00 được đếm (= 3 mẫu).
    # Mẫu 10:00:00 và 10:30:01 bị loại trừ.
    assert count == 3

    # Truy vấn với ranh giới ISO có .500Z
    count_iso = count_phase_a_samples(
        conn,
        deployment_id=dep_id,
        baseline_start_ts="2026-09-30T10:00:00.500Z",
        train_at_ts="2026-09-30T10:30:00.500Z",
    )
    assert count_iso == 3

    # Thử nghiệm với ranh giới tròn giây [10:00:00Z, 10:30:00Z):
    # - 10:00:00Z là start (inclusive) -> ĐƯỢC ĐẾM
    # - 10:30:00Z là end (exclusive) -> KHÔNG ĐƯỢC ĐẾM
    count_exact_sec = count_phase_a_samples(
        conn,
        deployment_id=dep_id,
        baseline_start_ts="2026-09-30T10:00:00Z",
        train_at_ts="2026-09-30T10:30:00Z",
    )
    # Mẫu 10:00:00, 10:00:01, 10:15:00 được đếm (= 3 mẫu).
    # Mẫu 10:30:00 (bị loại vì < end) và 10:30:01 bị loại.
    assert count_exact_sec == 3


def test_microsecond_boundary_counting_from_saved_milestones(conn: sqlite3.Connection) -> None:
    """Kiểm tra đếm mẫu Pha A từ các mốc thời gian microsecond đã được lưu trong DB experiment_run:

    Start mốc: 1790762400.123456 -> 2026-09-30T10:00:00.123456Z
    End mốc:   1790764200.654321 -> 2026-09-30T10:30:00.654321Z
    """
    dep_id = 42

    start_float = 1790762400.123456
    end_float = 1790764200.654321

    run_id = start_run(conn, scenario="error_burst", repeat_index=1, deployment_id=dep_id, baseline_start_ts=start_float)
    update_phase_schedule(conn, run_id=run_id, train_at_ts=end_float)

    # Đọc mốc từ DB ra để xác nhận bảo tồn microsecond
    run = get_run(conn, run_id)
    assert run is not None
    saved_start = run["baseline_start_ts"]
    saved_end = run["train_at_ts"]
    assert saved_start == "2026-09-30T10:00:00.123456Z"
    assert saved_end == "2026-09-30T10:30:00.654321Z"

    # Nạp mẫu thử nghiệm
    # 1. 10:00:00Z (.000000 < .123456 -> trước start) -> KHÔNG ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 10, '2026-09-30T10:00:00Z', 'local')",
        (dep_id,),
    )
    # 2. Đúng mốc start 10:00:00.123456Z (start là inclusive) -> ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 11, '2026-09-30T10:00:00.123456Z', 'local')",
        (dep_id,),
    )
    # 3. Mẫu tại 10:15:00Z -> ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 12, '2026-09-30T10:15:00Z', 'local')",
        (dep_id,),
    )
    # 4. Mẫu tại 10:30:00Z (.000000 < .654321 -> trước end) -> ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 13, '2026-09-30T10:30:00Z', 'local')",
        (dep_id,),
    )
    # 5. Đúng mốc end 10:30:00.654321Z (end là exclusive) -> KHÔNG ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 14, '2026-09-30T10:30:00.654321Z', 'local')",
        (dep_id,),
    )
    # 6. Mẫu sau end 10:30:01Z -> KHÔNG ĐƯỢC ĐẾM
    conn.execute(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 15, '2026-09-30T10:30:01Z', 'local')",
        (dep_id,),
    )
    conn.commit()

    count = count_phase_a_samples(
        conn,
        deployment_id=dep_id,
        baseline_start_ts=saved_start,
        train_at_ts=saved_end,
    )
    # Mẫu 11, 12, 13 được đếm (= 3 mẫu)
    assert count == 3
