"""Tests cho PollerAdapter và giao thức Headless Poller CLI (TK-S6 P2d-2)."""

from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

import pytest

from experiments.adapters.poller_adapter import (
    PollerAdapter,
    PollerProtocolError,
    PollerStartupError,
    PollerTimeoutError,
    get_default_poller_cli_cmd,
)


@pytest.fixture
def file_db(tmp_path: Path) -> tuple[sqlite3.Connection, Path]:
    """Tạo file SQLite DB thật trên đĩa với đầy đủ schema (không dùng :memory:)."""
    db_file = tmp_path / "opspilot_test.db"
    conn = sqlite3.connect(str(db_file), autocommit=False)
    conn.execute("PRAGMA foreign_keys = ON")

    schema = """
    CREATE TABLE vps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      encrypted_secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vps_id INTEGER NOT NULL REFERENCES vps(id),
      name TEXT NOT NULL UNIQUE,
      framework TEXT NOT NULL,
      host_port INTEGER NOT NULL,
      container_port INTEGER NOT NULL,
      current_deployment_id INTEGER,
      metrics_offset INTEGER NOT NULL DEFAULT 1,
      metrics_stream_generation TEXT NOT NULL DEFAULT 'legacy',
      metrics_stream_device INTEGER,
      metrics_stream_inode INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE deployment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES app(id),
      version INTEGER NOT NULL,
      image_tag TEXT NOT NULL,
      status TEXT NOT NULL,
      is_rollback_of INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE deployment_activation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES app(id),
      deployment_id INTEGER NOT NULL REFERENCES deployment(id),
      stream_generation TEXT NOT NULL,
      start_offset INTEGER NOT NULL CHECK (start_offset >= 1),
      end_offset INTEGER,
      reason TEXT NOT NULL,
      state TEXT NOT NULL,
      prepared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activated_at TEXT,
      closed_at TEXT
    );
    CREATE TABLE monitor_setting (
      app_id INTEGER PRIMARY KEY REFERENCES app(id),
      collector_interval_s INTEGER NOT NULL DEFAULT 10,
      poll_interval_s INTEGER NOT NULL DEFAULT 10,
      rule_cpu_pct REAL NOT NULL DEFAULT 80.0,
      rule_mem_pct REAL NOT NULL DEFAULT 85.0,
      rule_latency_ms REAL NOT NULL DEFAULT 2000.0,
      rule_error_rate REAL NOT NULL DEFAULT 0.05,
      rule_consecutive INTEGER NOT NULL DEFAULT 2,
      ml_score_threshold REAL NOT NULL DEFAULT 0.5,
      ml_consecutive INTEGER NOT NULL DEFAULT 2,
      auto_rollback INTEGER NOT NULL DEFAULT 0,
      trusted_method TEXT NOT NULL DEFAULT 'rule',
      rollback_consecutive INTEGER NOT NULL DEFAULT 3,
      cooldown_minutes INTEGER NOT NULL DEFAULT 10,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE metric_sample (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id INTEGER NOT NULL REFERENCES deployment(id),
      seq INTEGER NOT NULL,
      ts_vps TEXT NOT NULL,
      ts_local TEXT NOT NULL,
      cpu_pct REAL,
      mem_mb REAL,
      mem_pct REAL,
      mem_limit_mb REAL,
      latency_ms REAL,
      http_error_rate REAL,
      db_response_ms REAL,
      container_up INTEGER NOT NULL DEFAULT 1,
      host_cpu_pct REAL,
      host_mem_pct REAL,
      raw_json TEXT,
      UNIQUE (deployment_id, seq)
    );
    CREATE TABLE score_sample (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_sample_id INTEGER NOT NULL REFERENCES metric_sample(id),
      deployment_id INTEGER NOT NULL REFERENCES deployment(id),
      ts_vps TEXT NOT NULL,
      method TEXT NOT NULL,
      score REAL,
      above_threshold INTEGER NOT NULL DEFAULT 0,
      detail_json TEXT,
      UNIQUE (metric_sample_id, method)
    );
    CREATE TABLE alert (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
      metric_sample_id INTEGER REFERENCES metric_sample(id) ON DELETE SET NULL,
      method TEXT NOT NULL CHECK (method IN ('rule','zscore_ewma','iforest','ocsvm','ensemble')),
      ts_vps TEXT NOT NULL,
      ts_resolved TEXT,
      peak_score REAL NOT NULL,
      detail_json TEXT,
      label TEXT CHECK (label IN ('true_positive','false_positive')),
      labeled_at TEXT,
      acted TEXT NOT NULL DEFAULT 'none' CHECK (acted IN ('none','rollback_auto','rollback_suppressed_cooldown')),
      experiment_run_id INTEGER REFERENCES experiment_run(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE experiment_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario TEXT NOT NULL,
      repeat_index INTEGER NOT NULL,
      attempt_index INTEGER NOT NULL DEFAULT 1,
      deployment_id INTEGER REFERENCES deployment(id),
      vps_id INTEGER REFERENCES vps(id),
      baseline_start_ts TEXT,
      train_at_ts TEXT,
      holdout_start_ts TEXT,
      fault_start_ts TEXT,
      fault_end_ts TEXT,
      run_end_ts TEXT,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted')),
      abort_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (scenario, repeat_index, attempt_index)
    );
    CREATE TABLE action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      app_id INTEGER,
      deployment_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """
    conn.executescript(schema)

    # Seed dữ liệu ban đầu
    conn.execute(
        "INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret) "
        "VALUES (1, 'demo-vps', '127.0.0.1', 'root', 'password', 'enc_sec')"
    )
    conn.execute(
        "INSERT INTO app (id, vps_id, name, framework, host_port, container_port, current_deployment_id, metrics_stream_generation) "
        "VALUES (1, 1, 'demo-app', 'express', 3000, 3000, 1, '1:1')"
    )
    conn.execute(
        "INSERT INTO deployment (id, app_id, version, image_tag, status) "
        "VALUES (1, 1, 1, 'demo-app:v1', 'running')"
    )
    conn.execute(
        "INSERT INTO deployment_activation (app_id, deployment_id, state, stream_generation, start_offset, reason) "
        "VALUES (1, 1, 'active', '1:1', 1, 'deploy')"
    )
    conn.execute(
        "INSERT INTO monitor_setting (app_id, rule_cpu_pct, rule_consecutive, ml_score_threshold, ml_consecutive) "
        "VALUES (1, 80.0, 2, 0.5, 2)"
    )
    conn.commit()

    yield conn, db_file
    conn.close()


def _make_metric_line(seq: int, cpu_pct: float, ts_iso: str | None = None) -> str:
    ts = ts_iso or f"2026-08-30T00:00:{seq:02d}Z"
    data = {
        "seq": seq,
        "ts": ts,
        "cpu_pct": cpu_pct,
        "mem_mb": 128.0,
        "mem_pct": 30.0,
        "mem_limit_mb": 512.0,
        "latency_ms": 20.0,
        "http_error_rate": 0.0,
        "db_response_ms": None,
        "container_up": 1,
        "host_cpu_pct": None,
        "host_mem_pct": None,
        "collector_version": "1.0.0",
    }
    return json.dumps(data)


def test_poller_adapter_non_blocking_start_and_drain_integration(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    """Kiểm thử tích hợp: PollerAdapter chạy CLI thật với Electron non-blocking, nạp metric, gán alert và drain."""
    conn, db_file = file_db

    # Tạo experiment_run đang chạy
    conn.execute(
        "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index, deployment_id, baseline_start_ts, status) "
        "VALUES (50, 'cpu_spike', 1, 1, 1, '2026-08-30T00:00:00Z', 'running')"
    )
    conn.commit()

    # Chuẩn bị file metric mock
    metrics_file = tmp_path / "metrics.jsonl"
    line1 = _make_metric_line(1, 90.0)
    line2 = _make_metric_line(2, 95.0)
    metrics_file.write_text(f"{line1}\n{line2}\n", encoding="utf-8")

    # Kiểm tra lệnh Electron mặc định
    cli_cmd = get_default_poller_cli_cmd()
    assert len(cli_cmd) == 2

    adapter = PollerAdapter(default_cli_cmd=cli_cmd, default_drain_timeout_s=15.0)

    # 1. Khởi chạy không chặn (non-blocking start)
    handle = adapter.start(
        conn=conn,
        db_path=db_file,
        interval_ms=500,
        mock_metrics_file=metrics_file,
        startup_timeout_s=15.0,
    )

    assert handle.is_alive is True
    assert handle.is_drained is False

    # Thêm metric 3 trong khi poller đang chạy
    time.sleep(0.6)
    line3 = _make_metric_line(3, 92.0)
    with metrics_file.open("a", encoding="utf-8") as f:
        f.write(f"{line3}\n")

    # 2. Gửi drain và chờ hoàn tất
    drain_res = handle.drain(timeout_s=15.0)

    assert drain_res.status == "drained"
    assert drain_res.exit_code == 0
    assert handle.is_drained is True
    assert handle.is_alive is False

    # 3. Mở kết nối đọc kiểm tra dữ liệu trong SQLite file
    read_conn = sqlite3.connect(str(db_file))
    try:
        # Kiểm tra metric_sample đã được nạp đủ 3 mẫu (bao gồm mẫu vét line 3)
        sample_rows = read_conn.execute(
            "SELECT id, seq, cpu_pct FROM metric_sample WHERE deployment_id=1 ORDER BY seq"
        ).fetchall()
        assert len(sample_rows) == 3
        assert [r[1] for r in sample_rows] == [1, 2, 3]

        # Kiểm tra score_sample đã được tính toán (rule score)
        score_rows = read_conn.execute(
            "SELECT method, score, above_threshold FROM score_sample WHERE deployment_id=1"
        ).fetchall()
        assert len(score_rows) > 0
        rule_scores = [r for r in score_rows if r[0] == "rule"]
        assert len(rule_scores) == 3
        assert all(r[1] == 1.0 and r[2] == 1 for r in rule_scores)

        # Kiểm tra alert đã được kích hoạt và gán đúng experiment_run_id = 50
        alert_rows = read_conn.execute(
            "SELECT id, deployment_id, experiment_run_id, method FROM alert WHERE deployment_id=1"
        ).fetchall()
        assert len(alert_rows) > 0
        assert alert_rows[0][2] == 50
    finally:
        read_conn.close()


def test_poller_adapter_drain_timeout(file_db: tuple[sqlite3.Connection, Path]) -> None:
    """Kiểm thử timeout: nếu tiến trình poller không drain kịp thì ném PollerTimeoutError và huỷ process tree."""
    conn, db_file = file_db

    # Tạo mock script Python giả lập poller không chịu drain (bỏ qua stdin và sleep)
    mock_script = (
        "import sys, time, json\n"
        "print(json.dumps({'status': 'ready'}), flush=True)\n"
        "while True:\n"
        "    time.sleep(1)\n"
    )

    adapter = PollerAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_drain_timeout_s=0.5,
    )

    handle = adapter.start(conn=conn, db_path=db_file, startup_timeout_s=5.0)
    assert handle.is_alive is True

    with pytest.raises(PollerTimeoutError) as exc_info:
        handle.drain(timeout_s=0.5)

    assert "Headless Poller không hoàn thành drain" in str(exc_info.value)
    # Cây tiến trình phải bị dừng hoàn toàn
    assert handle.is_alive is False


def test_poller_adapter_cleanup_on_error_context_manager(
    file_db: tuple[sqlite3.Connection, Path],
) -> None:
    """Kiểm thử context manager: khi có lỗi ngoại lệ trong runner, handle tự động stop() dọn sạch tiến trình."""
    conn, db_file = file_db

    mock_script = (
        "import sys, time, json\n"
        "print(json.dumps({'status': 'ready'}), flush=True)\n"
        "while True:\n"
        "    time.sleep(1)\n"
    )

    adapter = PollerAdapter(default_cli_cmd=[sys.executable, "-c", mock_script])

    saved_handle = None
    with (
        pytest.raises(RuntimeError, match="Simulated experiment failure"),
        adapter.start(conn=conn, db_path=db_file, startup_timeout_s=5.0) as handle,
    ):
        saved_handle = handle
        assert handle.is_alive is True
        raise RuntimeError("Simulated experiment failure")

    assert saved_handle is not None
    # Tiến trình phải bị dừng sạch sau khối with
    assert saved_handle.is_alive is False


def test_poller_adapter_drain_protocol_error(
    file_db: tuple[sqlite3.Connection, Path],
) -> None:
    """Kiểm thử: CLI thoát mã lỗi khác 0 khi drain hoặc không phát event drained thì ném PollerProtocolError."""
    conn, db_file = file_db

    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'status': 'ready'}), flush=True)\n"
        "line = sys.stdin.readline()\n"
        "sys.exit(3)\n"
    )

    adapter = PollerAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_drain_timeout_s=5.0,
    )

    handle = adapter.start(conn=conn, db_path=db_file, startup_timeout_s=5.0)
    with pytest.raises(PollerProtocolError, match="mã lỗi 3"):
        handle.drain(timeout_s=5.0)


def test_poller_adapter_rejects_ram_db(tmp_path: Path) -> None:
    """Kiểm thử: từ chối kết nối SQLite in-memory (:memory:) vì không thể chia sẻ DB qua tiến trình khác."""
    ram_conn = sqlite3.connect(":memory:")
    adapter = PollerAdapter(default_cli_cmd=[sys.executable, "-c", ""])

    with pytest.raises(ValueError, match="database trong RAM"):
        adapter.start(conn=ram_conn)

    ram_conn.close()


def test_poller_adapter_rejects_db_path_mismatch(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    """Kiểm thử: từ chối db_path nếu không khớp với file main của SQLite connection."""
    conn, _ = file_db
    other_db = tmp_path / "other.db"
    adapter = PollerAdapter(default_cli_cmd=[sys.executable, "-c", ""])

    with pytest.raises(ValueError, match="không khớp với file database chính"):
        adapter.start(conn=conn, db_path=other_db)


def test_poller_adapter_startup_crash_error(
    file_db: tuple[sqlite3.Connection, Path],
) -> None:
    """Kiểm thử: CLI thoát đột ngột trước khi ready thì ném PollerStartupError và dọn dẹp tiến trình."""
    conn, db_file = file_db

    mock_crash_script = (
        "import sys, json\n"
        "print(json.dumps({'status': 'error', 'error': 'Cannot open port'}), flush=True)\n"
        "sys.exit(1)\n"
    )

    adapter = PollerAdapter(default_cli_cmd=[sys.executable, "-c", mock_crash_script])

    with pytest.raises(PollerStartupError) as exc_info:
        adapter.start(conn=conn, db_path=db_file, startup_timeout_s=5.0)

    assert "Cannot open port" in str(exc_info.value) or "Mã thoát 1" in str(
        exc_info.value
    )


def test_poller_adapter_inherited_env_vars_cleared(
    file_db: tuple[sqlite3.Connection, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Kiểm thử: 3 biến kế thừa (OPSPILOT_APP_ENV_JSON, OPSPILOT_SSH_SECRET, OPSPILOT_DEPLOY_SECRET) bị xoá."""
    conn, db_file = file_db

    monkeypatch.setenv("OPSPILOT_APP_ENV_JSON", '{"STALE": "1"}')
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "stale_ssh")
    monkeypatch.setenv("OPSPILOT_DEPLOY_SECRET", "stale_deploy")

    mock_script = (
        "import sys, os, json\n"
        "assert 'OPSPILOT_APP_ENV_JSON' not in os.environ, 'OPSPILOT_APP_ENV_JSON leaked'\n"
        "assert 'OPSPILOT_SSH_SECRET' not in os.environ, 'OPSPILOT_SSH_SECRET leaked'\n"
        "assert 'OPSPILOT_DEPLOY_SECRET' not in os.environ, 'OPSPILOT_DEPLOY_SECRET leaked'\n"
        "print(json.dumps({'status': 'ready'}), flush=True)\n"
        "line = sys.stdin.readline()\n"
        "if line.strip() == 'drain':\n"
        "    print(json.dumps({'status': 'drained'}), flush=True)\n"
        "    sys.exit(0)\n"
        "sys.exit(2)\n"
    )

    adapter = PollerAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_drain_timeout_s=5.0,
    )

    handle = adapter.start(conn=conn, db_path=db_file, startup_timeout_s=5.0)
    assert handle.is_alive is True

    res = handle.drain(timeout_s=5.0)
    assert res.status == "drained"
    assert res.exit_code == 0
