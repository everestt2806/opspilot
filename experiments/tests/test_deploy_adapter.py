"""Unit tests cho DeployAdapter (TK-S6 P2d-1b) kiểm thử hoàn toàn ngoại tuyến (Offline Mock)."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from experiments.adapters.deploy_adapter import (
    DeployAdapter,
    DeployFailedError,
    DeployPreIdError,
    DeployProtocolError,
    DeployTimeoutError,
    get_default_cli_cmd,
    resolve_db_path,
    sanitize_obj,
)
from experiments.run_store import get_run, start_run

_SCHEMA = """
CREATE TABLE vps (
  id INTEGER PRIMARY KEY
);
CREATE TABLE app (
  id INTEGER PRIMARY KEY,
  vps_id INTEGER NOT NULL REFERENCES vps(id)
);
CREATE TABLE deployment (
  id INTEGER PRIMARY KEY,
  app_id INTEGER REFERENCES app(id),
  status TEXT NOT NULL DEFAULT 'running'
);
CREATE TABLE experiment_run (
  id               INTEGER PRIMARY KEY,
  scenario         TEXT    NOT NULL CHECK (scenario IN
                     ('memory_leak','cpu_spike','error_burst','slow_db','latency_creep')),
  repeat_index     INTEGER NOT NULL,
  attempt_index    INTEGER NOT NULL DEFAULT 1 CHECK (attempt_index BETWEEN 1 AND 3),
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
  notes             TEXT,
  abort_reason      TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(scenario, repeat_index, attempt_index)
);
"""


@pytest.fixture
def file_db(tmp_path: Path) -> tuple[sqlite3.Connection, Path]:
    """Tạo database SQLite trên đĩa để có thể resolve_db_path tự động."""
    db_file = tmp_path / "test_opspilot.db"
    conn = sqlite3.connect(str(db_file), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    conn.execute("INSERT INTO vps (id) VALUES (1)")
    conn.execute("INSERT INTO app (id, vps_id) VALUES (1, 1)")
    conn.commit()
    yield conn, db_file
    conn.close()


def test_deploy_success(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (10, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    mock_script = (
        "import sys, time, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 10}), flush=True)\n"
        "print(json.dumps({'event': 'step_start', 'step': 'PRECHECK', 'deployment_id': 10}), flush=True)\n"
        "print(json.dumps({'event': 'step_done', 'step': 'PRECHECK', 'deployment_id': 10, 'duration_ms': 50}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 10, 'status': 'running', 'app_url': 'http://127.0.0.1:3000', 'total_duration_ms': 500}), flush=True)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    res = adapter.deploy(
        conn=conn,
        run_id=run_id,
        vps_id=1,
        app_name="demo-app",
        source_path=tmp_path,
        db_path=db_file,
    )

    assert res.deployment_id == 10
    assert res.status == "running"
    assert res.app_url == "http://127.0.0.1:3000"
    assert res.total_duration_ms == 500
    assert len(res.steps) == 2

    # Kiểm tra DB: run_id đã được gắn deployment_id=10 ngay lập tức và giữ running
    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "running"
    assert run_row["deployment_id"] == 10


def test_deploy_failure_aborts_run_and_preserves_failed_deployment(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    # DeployPipeline sẽ tạo bản ghi deployment status='failed' khi build lỗi
    conn.execute("INSERT INTO deployment (id, app_id, status) VALUES (11, 1, 'failed')")
    conn.commit()

    run_id = start_run(conn, "cpu_spike", 1, deployment_id=None, vps_id=1)

    mock_script = (
        "import sys, time, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 11}), flush=True)\n"
        "print(json.dumps({'event': 'step_failed', 'step': 'BUILD', 'deployment_id': 11, 'error': 'Docker build syntax error'}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 11, 'status': 'failed', 'error': 'Docker build syntax error'}), flush=True)\n"
        "sys.exit(1)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(
        DeployFailedError, match="Docker build syntax error"
    ) as exc_info:
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    assert exc_info.value.deployment_id == 11

    # Kiểm tra DB:
    # 1. Run bị abort và lưu abort_reason rõ ràng
    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert run_row["deployment_id"] == 11
    assert "deploy_failed" in (run_row["abort_reason"] or "")

    # 2. Bản ghi deployment 11 VẪN ĐƯỢC GIỮ NGUYÊN trong DB với status='failed' (audit trail)
    dep_row = conn.execute("SELECT id, status FROM deployment WHERE id = 11").fetchone()
    assert dep_row is not None
    assert dep_row["status"] == "failed"

    # 3. Attempt lifecycle: attempt tiếp theo được cấp index = 2
    r2 = start_run(conn, "cpu_spike", 1, deployment_id=None, vps_id=1)
    r2_row = get_run(conn, r2)
    assert r2_row is not None
    assert r2_row["attempt_index"] == 2


def test_deploy_error_before_id(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    run_id = start_run(conn, "slow_db", 1, deployment_id=None, vps_id=1)

    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'error', 'error': 'Thư mục source không tồn tại'}), flush=True)\n"
        "sys.exit(1)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(DeployPreIdError, match="Thư mục source không tồn tại"):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    # DB: run bị abort với deployment_id=None
    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert run_row["deployment_id"] is None
    assert "deploy_pre_id_error" in (run_row["abort_reason"] or "")


def test_deploy_timeout_after_assigned(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (12, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "latency_creep", 1, deployment_id=None, vps_id=1)

    # Script phát assigned rồi treo lâu hơn timeout (0.3s)
    mock_script = (
        "import sys, time, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 12}), flush=True)\n"
        "time.sleep(5.0)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=0.3,
    )

    with pytest.raises(DeployTimeoutError) as exc_info:
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    assert exc_info.value.deployment_id == 12

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert run_row["deployment_id"] == 12
    assert "deploy_timeout" in (run_row["abort_reason"] or "")


def test_deploy_timeout_before_assigned(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    run_id = start_run(conn, "latency_creep", 1, deployment_id=None, vps_id=1)

    # Script treo không phát ra thông điệp gì
    mock_script = "import time\ntime.sleep(5.0)\n"

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=0.3,
    )

    with pytest.raises(DeployTimeoutError) as exc_info:
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    assert exc_info.value.deployment_id is None

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert run_row["deployment_id"] is None
    assert "deploy_timeout" in (run_row["abort_reason"] or "")


def test_deploy_malformed_protocol(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (13, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "error_burst", 1, deployment_id=None, vps_id=1)

    # Script phát assigned nhưng thoát bất thường không có finished
    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 13}), flush=True)\n"
        "print('UNEXPECTED CRASH OUTPUT', file=sys.stderr, flush=True)\n"
        "sys.exit(2)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(DeployProtocolError) as exc_info:
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    assert exc_info.value.deployment_id == 13

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert run_row["deployment_id"] == 13
    assert "deploy_protocol_error" in (run_row["abort_reason"] or "")


def test_deploy_credential_security_not_leaked(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (14, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "error_burst", 1, deployment_id=None, vps_id=1)

    # Script kiểm tra:
    # 1. Secret được truyền qua biến môi trường OPSPILOT_SSH_SECRET
    # 2. Secret KHÔNG xuất hiện trong sys.argv
    mock_script = (
        "import sys, os, json\n"
        "secret = os.environ.get('OPSPILOT_SSH_SECRET')\n"
        "assert secret == 'super_sensitive_password_xyz'\n"
        "for arg in sys.argv:\n"
        "    assert 'super_sensitive_password_xyz' not in arg\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 14}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 14, 'status': 'running'}), flush=True)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    res = adapter.deploy(
        conn=conn,
        run_id=run_id,
        vps_id=1,
        app_name="demo-app",
        source_path=tmp_path,
        db_path=db_file,
        ssh_secret="super_sensitive_password_xyz",
    )

    assert res.deployment_id == 14
    assert res.status == "running"


def test_resolve_db_path_ram_and_mismatch(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db

    # 1. Connection in-memory không có file -> từ chối cả khi không truyền lẫn khi truyền explicit_path
    mem_conn = sqlite3.connect(":memory:")
    with pytest.raises(ValueError, match="database trong RAM"):
        resolve_db_path(mem_conn)

    with pytest.raises(ValueError, match="database trong RAM"):
        resolve_db_path(mem_conn, "custom/path.db")

    # 2. Connection file thật:
    # 2a. Tự động resolve từ connection -> khớp đúng db_file
    p_auto = resolve_db_path(conn)
    assert p_auto == db_file.resolve()

    # 2b. Truyền db_path trùng khớp -> thành công
    p_explicit = resolve_db_path(conn, db_file)
    assert p_explicit == db_file.resolve()

    # 2c. Truyền db_path khác -> ném ValueError từ chối
    other_db = tmp_path / "other.db"
    with pytest.raises(ValueError, match="không khớp với file database chính"):
        resolve_db_path(conn, other_db)


def test_deploy_assigned_more_than_once_rejected(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (10, 1, 'running')"
    )
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (11, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 10}), flush=True)\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 11}), flush=True)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(DeployProtocolError, match="nhiều hơn một lần"):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert "nhiều hơn một lần" in (run_row["abort_reason"] or "")


def test_deploy_finished_id_mismatch_rejected(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (10, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    # CLI phát assigned 10 nhưng finished với deployment_id 99
    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 10}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 99, 'status': 'running'}), flush=True)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(
        DeployProtocolError, match="không khớp với assigned deployment_id"
    ):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert "không khớp" in (run_row["abort_reason"] or "")


def test_deploy_success_requires_exit_code_zero(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (10, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    # CLI phát finished status='running' nhưng process exit code là 1
    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 10}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 10, 'status': 'running'}), flush=True)\n"
        "sys.exit(1)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(DeployProtocolError, match="thoát với mã lỗi 1"):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"


def test_deploy_success_requires_sqlite_deployment_running(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    # Trong DB, bản ghi deployment vẫn ở status 'failed' hoặc 'building'
    conn.execute("INSERT INTO deployment (id, app_id, status) VALUES (10, 1, 'failed')")
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 10}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 10, 'status': 'running'}), flush=True)\n"
        "sys.exit(0)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(
        DeployProtocolError, match="có status='failed', bắt buộc phải là 'running'"
    ):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"


def test_deploy_env_vars_passed_via_env_not_command_line(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (15, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    # CLI kiểm tra:
    # 1. OPSPILOT_APP_ENV_JSON chứa đúng JSON env_vars
    # 2. --env-json KHÔNG xuất hiện trong sys.argv
    # 3. Giá trị secret trong env KHÔNG nằm trong sys.argv
    mock_script = (
        "import sys, os, json\n"
        "raw_env = os.environ.get('OPSPILOT_APP_ENV_JSON')\n"
        "assert raw_env is not None\n"
        "env_data = json.loads(raw_env)\n"
        "assert env_data['DB_PASS'] == 'secret_db_pass_999'\n"
        "for arg in sys.argv:\n"
        "    assert '--env-json' not in arg\n"
        "    assert 'secret_db_pass_999' not in arg\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 15}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 15, 'status': 'running'}), flush=True)\n"
        "sys.exit(0)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    res = adapter.deploy(
        conn=conn,
        run_id=run_id,
        vps_id=1,
        app_name="demo-app",
        source_path=tmp_path,
        db_path=db_file,
        env_vars={"DB_USER": "postgres", "DB_PASS": "secret_db_pass_999"},
    )

    assert res.deployment_id == 15
    assert res.status == "running"


def test_deploy_secrets_redacted_from_abort_reason_and_exceptions(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute("INSERT INTO deployment (id, app_id, status) VALUES (16, 1, 'failed')")
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    # CLI cố tình in ra lỗi chứa cả ssh_secret và env secret
    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 16}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 16, 'status': 'failed', "
        "'error': 'Build failed with token super_secret_token_123 and pass env_secret_pass_456'}), flush=True)\n"
        "sys.exit(1)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(DeployFailedError) as exc_info:
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
            ssh_secret="super_secret_token_123",
            env_vars={"API_KEY": "env_secret_pass_456"},
        )

    err_str = str(exc_info.value)
    # Tuyệt đối không chứa secret bản rõ
    assert "super_secret_token_123" not in err_str
    assert "env_secret_pass_456" not in err_str
    assert "***REDACTED***" in err_str

    # Trong DB abort_reason cũng tuyệt đối không chứa secret bản rõ
    run_row = get_run(conn, run_id)
    assert run_row is not None
    abort_reason = run_row["abort_reason"] or ""
    assert "super_secret_token_123" not in abort_reason
    assert "env_secret_pass_456" not in abort_reason
    assert "***REDACTED***" in abort_reason


def test_sanitize_obj_nested() -> None:
    data = {
        "token": "my_secret_token",
        "nested": [
            {"sub": "my_secret_token", "num": 123},
            "plain_text",
        ],
        "safe": True,
    }
    cleaned = sanitize_obj(data, ["my_secret_token"])
    assert cleaned["token"] == "***REDACTED***"
    assert cleaned["nested"][0]["sub"] == "***REDACTED***"
    assert cleaned["nested"][0]["num"] == 123
    assert cleaned["nested"][1] == "plain_text"
    assert cleaned["safe"] is True


def test_get_default_cli_cmd_requires_electron_and_compiled_cli(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_exists = Path.exists

    # 1. Cả 2 file tồn tại -> trả về danh sách 2 phần tử
    def mock_both_exist(self: Path) -> bool:
        s = str(self)
        if "electron" in s or "deploy-cli.js" in s:
            return True
        return original_exists(self)

    monkeypatch.setattr(Path, "exists", mock_both_exist)
    cmd = get_default_cli_cmd()
    assert len(cmd) == 2
    assert "deploy-cli.js" in cmd[1]

    # 2. Thiếu binary Electron -> ném FileNotFoundError, tuyệt đối không fallback sang Node hoặc run-as-node.js
    def mock_no_electron(self: Path) -> bool:
        s = str(self)
        if "electron" in s and ("dist" in s or "node_modules" in s):
            return False
        if "deploy-cli.js" in s:
            return True
        return original_exists(self)

    monkeypatch.setattr(Path, "exists", mock_no_electron)
    with pytest.raises(FileNotFoundError, match="Không tìm thấy binary Electron"):
        get_default_cli_cmd()

    # 3. Thiếu file CLI biên dịch -> ném FileNotFoundError
    def mock_no_compiled_cli(self: Path) -> bool:
        s = str(self)
        if "deploy-cli.js" in s:
            return False
        if "electron" in s:
            return True
        return original_exists(self)

    monkeypatch.setattr(Path, "exists", mock_no_compiled_cli)
    with pytest.raises(FileNotFoundError, match="Không tìm thấy file CLI đã biên dịch"):
        get_default_cli_cmd()


def test_deploy_input_validation_failure_aborts_run(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    adapter = DeployAdapter()

    # 1. app_name rỗng -> abort run và ném ValueError
    with pytest.raises(ValueError, match="app_name không được để trống"):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="",
            source_path=tmp_path,
            db_path=db_file,
        )

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert "deploy_pre_id_error" in (run_row["abort_reason"] or "")
    assert "app_name không được để trống" in (run_row["abort_reason"] or "")

    # 2. vps_id không hợp lệ trên run mới -> abort run và ném ValueError
    run_id2 = start_run(conn, "cpu_spike", 1, deployment_id=None, vps_id=1)
    with pytest.raises(ValueError, match="vps_id phải là số nguyên dương"):
        adapter.deploy(
            conn=conn,
            run_id=run_id2,
            vps_id=-1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    run_row2 = get_run(conn, run_id2)
    assert run_row2 is not None
    assert run_row2["status"] == "aborted"
    assert "deploy_pre_id_error" in (run_row2["abort_reason"] or "")


def test_deploy_spawn_failure_aborts_run(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    adapter = DeployAdapter(
        default_cli_cmd=["non_existent_binary_xyz_12345"],
        default_timeout_s=5.0,
    )

    with pytest.raises((FileNotFoundError, OSError)):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert "deploy_pre_id_error" in (run_row["abort_reason"] or "")


def test_deploy_events_and_steps_sanitized(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (18, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "cpu_spike", 1, deployment_id=None, vps_id=1)

    mock_script = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 18}), flush=True)\n"
        "print(json.dumps({'event': 'step_start', 'step': 'BUILD_super_ssh_pass', 'detail': 'custom_env_secret_123'}), flush=True)\n"
        "print(json.dumps({'event': 'step_done', 'step': 'BUILD_super_ssh_pass', 'log': 'Deployed with custom_env_secret_123'}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 18, 'status': 'running', 'app_url': 'http://super_ssh_pass:custom_env_secret_123@127.0.0.1:3000'}), flush=True)\n"
        "sys.exit(0)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    res = adapter.deploy(
        conn=conn,
        run_id=run_id,
        vps_id=1,
        app_name="demo-app",
        source_path=tmp_path,
        db_path=db_file,
        ssh_secret="super_ssh_pass",
        env_vars={"API_KEY": "custom_env_secret_123"},
    )

    assert res.deployment_id == 18
    assert res.status == "running"
    # app_url đã được khử
    assert "super_ssh_pass" not in (res.app_url or "")
    assert "custom_env_secret_123" not in (res.app_url or "")
    assert "***REDACTED***" in (res.app_url or "")

    # res.steps đã được khử triệt để ngay tại mức event
    assert len(res.steps) == 2
    for step in res.steps:
        step_str = json.dumps(step)
        assert "super_ssh_pass" not in step_str
        assert "custom_env_secret_123" not in step_str
        assert "***REDACTED***" in step_str


def test_deploy_posix_start_new_session(
    file_db: tuple[sqlite3.Connection, Path],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (19, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    # 1. Trên POSIX (Linux/macOS): phải truyền start_new_session=True
    monkeypatch.setattr(sys, "platform", "linux")

    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = 0
        mock_proc.returncode = 0
        mock_proc.stdout.readline.side_effect = [
            '{"event": "assigned", "deployment_id": 19}\n',
            '{"event": "finished", "deployment_id": 19, "status": "running"}\n',
            "",
        ]
        mock_proc.stderr.readline.side_effect = [""]
        mock_popen.return_value = mock_proc

        adapter = DeployAdapter(default_cli_cmd=["dummy_cli"])
        res = adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )
        assert res.deployment_id == 19
        assert mock_popen.call_args[1].get("start_new_session") is True

    # Kết thúc run_id trước khi khởi tạo run tiếp theo để tuân thủ quy tắc Single Active Run
    from experiments.run_store import abort_run

    abort_run(conn, run_id, reason="test part 1 finished")

    # 2. Trên Windows: KHÔNG truyền start_new_session
    monkeypatch.setattr(sys, "platform", "win32")
    run_id2 = start_run(conn, "slow_db", 1, deployment_id=None, vps_id=1)

    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = 0
        mock_proc.returncode = 0
        mock_proc.stdout.readline.side_effect = [
            '{"event": "assigned", "deployment_id": 19}\n',
            '{"event": "finished", "deployment_id": 19, "status": "running"}\n',
            "",
        ]
        mock_proc.stderr.readline.side_effect = [""]
        mock_popen.return_value = mock_proc

        adapter = DeployAdapter(default_cli_cmd=["dummy_cli"])
        res2 = adapter.deploy(
            conn=conn,
            run_id=run_id2,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
        )
        assert res2.deployment_id == 19
        assert "start_new_session" not in mock_popen.call_args[1]


def test_deploy_db_mismatch_aborts_run_before_spawn(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, _ = file_db
    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    adapter = DeployAdapter()
    mismatch_db = tmp_path / "mismatch.db"

    with pytest.raises(ValueError, match="không khớp với file database chính"):
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=mismatch_db,
        )

    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert "deploy_pre_id_error" in (run_row["abort_reason"] or "")
    assert "không khớp" in (run_row["abort_reason"] or "")


def test_deploy_ram_db_aborts_run_before_spawn(tmp_path: Path) -> None:
    mem_conn = sqlite3.connect(":memory:")
    mem_conn.row_factory = sqlite3.Row
    mem_conn.executescript(_SCHEMA)
    mem_conn.execute("INSERT INTO vps (id) VALUES (1)")
    mem_conn.execute("INSERT INTO app (id, vps_id) VALUES (1, 1)")
    mem_conn.commit()

    run_id = start_run(mem_conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    adapter = DeployAdapter()

    with pytest.raises(ValueError, match="database trong RAM"):
        adapter.deploy(
            conn=mem_conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
        )

    run_row = get_run(mem_conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert "deploy_pre_id_error" in (run_row["abort_reason"] or "")
    assert "database trong RAM" in (run_row["abort_reason"] or "")


def test_deploy_pre_spawn_error_sanitizes_secret_in_exception(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, _ = file_db
    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    adapter = DeployAdapter()
    secret_token = "secret_ssh_token_ultra_999"
    secret_env = "env_pass_secret_888"

    # Đường dẫn db_path chứa secret_token
    bad_db_path = tmp_path / f"mismatch_{secret_token}.db"

    with pytest.raises(ValueError) as exc_info:
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=bad_db_path,
            ssh_secret=secret_token,
            env_vars={"API_KEY": secret_env},
        )

    # Ngoại lệ ném ra ngoài caller bắt buộc đã được khử secret
    err_msg = str(exc_info.value)
    assert secret_token not in err_msg
    assert secret_env not in err_msg
    assert "***REDACTED***" in err_msg

    # DB abort_reason cũng được khử secret
    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    abort_reason = run_row["abort_reason"] or ""
    assert secret_token not in abort_reason
    assert secret_env not in abort_reason
    assert "***REDACTED***" in abort_reason


def test_deploy_inherited_env_vars_cleared(
    file_db: tuple[sqlite3.Connection, Path],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (25, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    # Giả lập môi trường tiến trình cha có sẵn 3 biến kế thừa
    monkeypatch.setenv("OPSPILOT_APP_ENV_JSON", '{"STALE": "stale_value"}')
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "stale_ssh_secret")
    monkeypatch.setenv("OPSPILOT_DEPLOY_SECRET", "stale_deploy_secret")

    # Script con kiểm tra:
    # 1. 3 biến kế thừa đã bị xoá khỏi proc_env khi caller không truyền
    # 2. Phát assigned và finished bình thường
    mock_script = (
        "import sys, os, json\n"
        "assert 'OPSPILOT_APP_ENV_JSON' not in os.environ, 'OPSPILOT_APP_ENV_JSON bi ke thua'\n"
        "assert 'OPSPILOT_SSH_SECRET' not in os.environ, 'OPSPILOT_SSH_SECRET bi ke thua'\n"
        "assert 'OPSPILOT_DEPLOY_SECRET' not in os.environ, 'OPSPILOT_DEPLOY_SECRET bi ke thua'\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 25}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 25, 'status': 'running'}), flush=True)\n"
        "sys.exit(0)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    # Caller không truyền ssh_secret và env_vars -> kiểm tra proc_env sạch
    res = adapter.deploy(
        conn=conn,
        run_id=run_id,
        vps_id=1,
        app_name="demo-app",
        source_path=tmp_path,
        db_path=db_file,
        ssh_secret=None,
        env_vars=None,
    )

    assert res.deployment_id == 25
    assert res.status == "running"


def test_deploy_simulated_stderr_secret_not_leaked_in_exception_or_db(
    file_db: tuple[sqlite3.Connection, Path], tmp_path: Path
) -> None:
    conn, db_file = file_db
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (26, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    # Script con giả lập lỗi in secret từ DB (Python không biết chuỗi secret này) ra stderr và crash
    db_secret_simulated = "super_classified_db_cipher_password_xyz"
    mock_script = (
        "import sys\n"
        f"print('FATAL ERROR: Failed connecting with credential {db_secret_simulated}', file=sys.stderr, flush=True)\n"
        "sys.exit(1)\n"
    )

    adapter = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script],
        default_timeout_s=5.0,
    )

    with pytest.raises(DeployPreIdError) as exc_info:
        adapter.deploy(
            conn=conn,
            run_id=run_id,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
            # Caller không biết và không truyền secret này
            ssh_secret=None,
            env_vars=None,
        )

    # 1. Exception ném ra ngoài không chứa secret giả lập trên stderr
    err_str = str(exc_info.value)
    assert db_secret_simulated not in err_str
    assert "CLI thoát với mã lỗi 1 trước khi cấp deployment_id" in err_str

    # 2. SQLite DB abort_reason không chứa secret giả lập trên stderr
    run_row = get_run(conn, run_id)
    assert run_row is not None
    assert run_row["status"] == "aborted"
    abort_reason = run_row["abort_reason"] or ""
    assert db_secret_simulated not in abort_reason
    assert "CLI thoát với mã lỗi 1 trước khi cấp deployment_id" in abort_reason

    # 3. Thử nghiệm tương tự cho Nhánh 2 (đã cấp assigned ID nhưng crash không phát finished)
    run_id2 = start_run(conn, "cpu_spike", 1, deployment_id=None, vps_id=1)
    mock_script_branch2 = (
        "import sys, json\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 26}), flush=True)\n"
        f"print('FATAL UNHANDLED DUMP: secret_token={db_secret_simulated}', file=sys.stderr, flush=True)\n"
        "sys.exit(2)\n"
    )

    adapter2 = DeployAdapter(
        default_cli_cmd=[sys.executable, "-c", mock_script_branch2],
        default_timeout_s=5.0,
    )

    with pytest.raises(DeployProtocolError) as exc_info2:
        adapter2.deploy(
            conn=conn,
            run_id=run_id2,
            vps_id=1,
            app_name="demo-app",
            source_path=tmp_path,
            db_path=db_file,
            ssh_secret=None,
            env_vars=None,
        )

    err_str2 = str(exc_info2.value)
    assert db_secret_simulated not in err_str2
    assert "CLI thoát với mã lỗi 2 mà không phát event 'finished'" in err_str2

    run_row2 = get_run(conn, run_id2)
    assert run_row2 is not None
    assert run_row2["status"] == "aborted"
    abort_reason2 = run_row2["abort_reason"] or ""
    assert db_secret_simulated not in abort_reason2
    assert "CLI thoát với mã lỗi 2 mà không phát event 'finished'" in abort_reason2
