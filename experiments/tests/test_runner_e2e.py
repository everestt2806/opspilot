"""End-to-End Simulation Tests cho Orchestrator Thí nghiệm run_experiment.py (TK-S6 P2d-4).

Kiểm thử toàn diện chu trình thí nghiệm với clock/sleeper mô phỏng và adapter giả:
  - Attempt 1 abort (deploy failure / clock skew) -> Attempt 2 retry thành công -> export CSV -> phân tích analyze.
  - Không chờ 75 phút thật (thực thi trong tích tắc nhờ SimulatedClock).
  - Kiểm tra các cổng kiểm soát: Clock Skew Gate, Insufficient Phase A samples, Integrity Gate.
  - Kiểm tra phát hiện container loadgen hoặc headless poller chết giữa chừng qua wait_with_checks.
  - Xác nhận audit trail: bản ghi deployment failed được giữ nguyên trong SQLite khi abort.
"""

from __future__ import annotations

import sqlite3
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

# Thiết lập đường dẫn import
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
_EXP_DIR = Path(__file__).resolve().parents[1]
if str(_EXP_DIR) not in sys.path:
    sys.path.insert(0, str(_EXP_DIR))

from experiments.adapters.deploy_adapter import (
    DeployAdapter,
    DeployFailedError,
    DeployResult,
)
from experiments.adapters.loadgen_adapter import (
    LoadgenAdapter,
    LoadgenExecutionError,
    LoadgenHandle,
)
from experiments.adapters.ml_client import MlClient
from experiments.adapters.poller_adapter import (
    PollerAdapter,
    PollerDrainResult,
)
from experiments.analyze import collect_operational_telemetry, main_table
from experiments.export_results import export_run
from experiments.protocol import (
    PHASE_A_S,
    PHASE_B_S,
    PHASE_C_S,
)
from experiments.run_experiment import (
    ExperimentError,
    SshKeyFileError,
    UnsupportedAppError,
    measure_clock_offset_ms,
    run_attempt,
    run_experiment,
    wait_with_checks,
)
from experiments.run_store import (
    abort_run,
    attach_deployment_id,
    normalize_ts,
    start_run,
    to_epoch_seconds,
)

# Schema SQLite kiểm thử tối thiểu nhưng đầy đủ toàn bộ bảng và trường cho TK-S6
_TEST_SCHEMA = """
CREATE TABLE vps (
  id INTEGER PRIMARY KEY,
  name TEXT,
  host TEXT DEFAULT '127.0.0.1',
  port INTEGER DEFAULT 22,
  username TEXT DEFAULT 'root',
  auth_type TEXT DEFAULT 'key'
);

CREATE TABLE app (
  id INTEGER PRIMARY KEY,
  vps_id INTEGER NOT NULL REFERENCES vps(id),
  name TEXT
);

CREATE TABLE deployment (
  id INTEGER PRIMARY KEY,
  app_id INTEGER REFERENCES app(id),
  version INTEGER DEFAULT 1,
  image_tag TEXT DEFAULT 'demo:v1',
  status TEXT NOT NULL,
  failed_step TEXT,
  started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at TEXT
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
  abort_reason      TEXT,
  notes             TEXT,
  UNIQUE (scenario, repeat_index, attempt_index)
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

CREATE TABLE score_sample (
  id               INTEGER PRIMARY KEY,
  metric_sample_id INTEGER NOT NULL REFERENCES metric_sample(id) ON DELETE CASCADE,
  deployment_id    INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  ts_vps           TEXT    NOT NULL,
  method           TEXT    NOT NULL CHECK (method IN
                     ('rule','zscore_ewma','iforest','ocsvm','ensemble')),
  score            REAL,
  above_threshold  INTEGER NOT NULL DEFAULT 0 CHECK (above_threshold IN (0,1)),
  detail_json      TEXT,
  UNIQUE (metric_sample_id, method)
);

CREATE TABLE alert (
  id                INTEGER PRIMARY KEY,
  deployment_id     INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  metric_sample_id  INTEGER REFERENCES metric_sample(id) ON DELETE SET NULL,
  method            TEXT    NOT NULL CHECK (method IN
                      ('rule','zscore_ewma','iforest','ocsvm','ensemble')),
  ts_vps            TEXT    NOT NULL,
  ts_resolved       TEXT,
  peak_score        REAL    NOT NULL,
  detail_json       TEXT,
  label             TEXT    CHECK (label IN ('true_positive','false_positive')),
  labeled_at        TEXT,
  acted             TEXT    NOT NULL DEFAULT 'none',
  experiment_run_id INTEGER REFERENCES experiment_run(id) ON DELETE SET NULL
);
"""


def _init_test_db(db_path: Path) -> None:
    """Khởi tạo cấu trúc bảng SQLite và bản ghi VPS/App mồi."""
    conn = sqlite3.connect(db_path)
    conn.executescript(_TEST_SCHEMA)
    conn.execute("INSERT INTO vps (id) VALUES (1)")
    conn.execute("INSERT INTO app (id, vps_id, name) VALUES (1, 1, 'express-api')")
    conn.commit()
    conn.close()


class SimulatedClock:
    """Đồng hồ mô phỏng cho phép co giãn hoặc nhảy thời gian tức thì trong test."""

    def __init__(self, start_epoch: float = 1727800000.0) -> None:
        self.current_time = start_epoch

    def now(self) -> float:
        return self.current_time

    def sleep(self, seconds: float) -> None:
        self.current_time += seconds


class MockDeployAdapter(DeployAdapter):
    """DeployAdapter giả lập: điều khiển ca thành công hoặc lỗi deploy theo attempt."""

    def __init__(self, failure_attempts: set[int] | None = None) -> None:
        super().__init__()
        self.failure_attempts = failure_attempts or set()
        self.call_count = 0
        self.deployed_ids: list[int] = []
        self.deployed_env_vars: list[Any] = []
        self.deployed_kwargs: list[dict[str, Any]] = []
        self.deployed_ssh_secrets: list[str | None] = []

    def deploy(
        self,
        conn: sqlite3.Connection,
        run_id: int,
        vps_id: int,
        app_name: str,
        source_path: str | Path,
        **kwargs: Any,
    ) -> DeployResult:
        self.call_count += 1
        dep_id = 100 + self.call_count
        self.deployed_ids.append(dep_id)
        self.deployed_env_vars.append(kwargs.get("env_vars"))
        self.deployed_kwargs.append(dict(kwargs))
        self.deployed_ssh_secrets.append(kwargs.get("ssh_secret"))

        cur = conn.cursor()
        cur.execute(
            "INSERT INTO deployment (id, app_id, status) VALUES (?, 1, 'pending')",
            (dep_id,),
        )
        conn.commit()

        # 1. Gắn deployment_id ngay khi pipeline cấp ID (TRƯỚC khi lỗi hoặc chạy nền)
        attach_deployment_id(conn, run_id, dep_id, auto_commit=True)

        if self.call_count in self.failure_attempts:
            # Ghi bản ghi deployment failed vào DB làm bằng chứng kiểm toán (audit trail)
            cur.execute(
                "UPDATE deployment SET status = 'failed', failed_step = 'BUILD' WHERE id = ?",
                (dep_id,),
            )
            conn.commit()
            reason = "deploy_failed: Docker image build failed on VPS (exit code 1)"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise DeployFailedError(
                "Docker image build failed on VPS (exit code 1)",
                deployment_id=dep_id,
            )

        # Deploy thành công -> bản ghi deployment có status='running'
        cur.execute(
            "UPDATE deployment SET status = 'running' WHERE id = ?",
            (dep_id,),
        )
        conn.commit()
        return DeployResult(
            deployment_id=dep_id,
            status="running",
            app_url="http://127.0.0.1:3000",
        )


class MockMlClient(MlClient):
    """ML Client giả lập theo dõi các lệnh reset và train."""

    def __init__(self) -> None:
        super().__init__()
        self.resets: list[int] = []
        self.train_calls: list[tuple[int, int]] = []  # (deployment_id, count)

    def check_health(
        self, timeout_s: float = 5.0, raise_for_status: bool = False
    ) -> bool:
        return True

    def reset_models(
        self, deployment_id: int, timeout_s: float = 10.0
    ) -> dict[str, Any]:
        self.resets.append(deployment_id)
        return {"status": "ok", "deployment_id": deployment_id}

    def train_models(
        self,
        deployment_id: int,
        samples: list[dict[str, Any]],
        timeout_s: float = 60.0,
    ) -> dict[str, Any]:
        self.train_calls.append((deployment_id, len(samples)))
        return {
            "status": "trained",
            "deployment_id": deployment_id,
            "samples_count": len(samples),
        }


class MockPollerHandle:
    """Handle của Headless Poller giả lập."""

    def __init__(
        self,
        db_path: Path,
        deployment_id: int,
        experiment_run_id: int | None,
        clock: SimulatedClock,
        sample_count: int = 450,
        missing_scores: bool = False,
        time_scale: float = 1.0,
    ) -> None:
        self.db_path = db_path
        self.deployment_id = deployment_id
        self.experiment_run_id = experiment_run_id
        self.clock = clock
        self.sample_count = sample_count
        self.missing_scores = missing_scores
        self.time_scale = time_scale
        self.is_alive = True
        self.is_drained = False

        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            offset_s = 0.0
            if self.experiment_run_id is not None:
                cur.execute(
                    "SELECT clock_offset_ms FROM experiment_run WHERE id = ?",
                    (self.experiment_run_id,),
                )
                row = cur.fetchone()
                if row and row[0]:
                    offset_s = row[0] / 1000.0
            self.start_epoch = clock.now() + offset_s

            # Ghi trước các mẫu metric_sample của Pha A vào DB
            phase_a_count = min(self.sample_count, 180)
            for i in range(phase_a_count):
                t_epoch = self.start_epoch + (i * 10.0 * self.time_scale)
                t_iso = normalize_ts(t_epoch)
                cur.execute(
                    """
                    INSERT INTO metric_sample (
                        deployment_id, seq, ts_vps, ts_local, cpu_pct, mem_mb, mem_pct,
                        latency_ms, http_error_rate, container_up, host_cpu_pct, host_mem_pct
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 10.0, 20.0)
                    """,
                    (
                        self.deployment_id,
                        i + 1,
                        t_iso,
                        t_iso,
                        25.0,
                        120.0,
                        30.0,
                        15.0,
                        0.0,
                    ),
                )
            conn.commit()
            conn.close()
        except sqlite3.OperationalError:
            pass

    def get_last_error(self) -> str | None:
        return None

    def drain(self, timeout_s: float = 30.0) -> PollerDrainResult:
        self.is_drained = True
        conn = sqlite3.connect(self.db_path)
        try:
            cur = conn.cursor()

            phase_a_count = min(self.sample_count, 180)
            train_at_epoch = self.start_epoch + (PHASE_A_S * self.time_scale)
            fault_start_epoch = train_at_epoch + (PHASE_B_S * self.time_scale)
            fault_end_epoch = fault_start_epoch + (PHASE_C_S * self.time_scale)

            # Ghi các mẫu còn lại (Pha B, C, D)
            for i in range(phase_a_count, self.sample_count):
                t_epoch = self.start_epoch + (i * 10.0 * self.time_scale)
                t_iso = normalize_ts(t_epoch)
                cur.execute(
                    """
                    INSERT INTO metric_sample (
                        deployment_id, seq, ts_vps, ts_local, cpu_pct, mem_mb, mem_pct,
                        latency_ms, http_error_rate, container_up, host_cpu_pct, host_mem_pct
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 10.0, 20.0)
                    """,
                    (
                        self.deployment_id,
                        i + 1,
                        t_iso,
                        t_iso,
                        25.0
                        + (
                            50.0
                            if fault_start_epoch <= t_epoch < fault_end_epoch
                            else 0.0
                        ),
                        120.0,
                        30.0,
                        15.0,
                        0.0,
                    ),
                )

            cur.execute(
                "SELECT id, ts_vps FROM metric_sample WHERE deployment_id = ? ORDER BY seq ASC",
                (self.deployment_id,),
            )
            samples = cur.fetchall()

            methods = ("rule", "zscore_ewma", "iforest", "ocsvm", "ensemble")
            if self.missing_scores:
                methods = ("rule", "zscore_ewma", "iforest", "ensemble")

            for row in samples:
                m_id = row[0]
                t_iso = row[1]
                t_epoch = to_epoch_seconds(t_iso)
                is_after_train = t_epoch >= train_at_epoch
                is_fault = fault_start_epoch <= t_epoch < fault_end_epoch

                for m in methods:
                    score_val = (0.85 if is_fault else 0.15) if is_after_train else 0.10
                    above = 1 if (is_fault and is_after_train) else 0
                    cur.execute(
                        """
                        INSERT INTO score_sample (
                            metric_sample_id, deployment_id, ts_vps, method, score, above_threshold
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (m_id, self.deployment_id, t_iso, m, score_val, above),
                    )

            cur.execute(
                """
                INSERT INTO alert (
                    deployment_id, method, ts_vps, peak_score, acted, experiment_run_id
                ) VALUES (?, 'ensemble', ?, 0.95, 'none', ?)
                """,
                (
                    self.deployment_id,
                    normalize_ts(fault_start_epoch + (30.0 * self.time_scale)),
                    self.experiment_run_id,
                ),
            )

            conn.commit()
        finally:
            conn.close()
        return PollerDrainResult(exit_code=0, status="drained")

    def stop(self) -> None:
        self.is_alive = False


class MockPollerAdapter(PollerAdapter):
    """PollerAdapter giả lập tạo ra MockPollerHandle theo đúng chữ ký chuẩn của PollerAdapter.start()."""

    def __init__(
        self,
        clock: SimulatedClock,
        sample_count: int = 450,
        missing_scores: bool = False,
        time_scale: float = 1.0,
    ) -> None:
        super().__init__()
        self.clock = clock
        self.sample_count = sample_count
        self.missing_scores = missing_scores
        self.time_scale = time_scale
        self.handles: list[MockPollerHandle] = []
        self.started_ssh_secrets: list[str | None] = []
        self.started_kwargs: list[dict[str, Any]] = []

    def start(
        self,
        conn: sqlite3.Connection,
        db_path: str | Path | None = None,
        interval_ms: int | None = None,
        ml_url: str | None = None,
        mock_metrics_file: str | Path | None = None,
        ssh_secret: str | None = None,
        startup_timeout_s: float = 10.0,
        cli_cmd: Sequence[str] | None = None,
    ) -> MockPollerHandle:
        self.started_ssh_secrets.append(ssh_secret)
        self.started_kwargs.append(
            {
                "db_path": db_path,
                "interval_ms": interval_ms,
                "ml_url": ml_url,
                "mock_metrics_file": mock_metrics_file,
                "ssh_secret": ssh_secret,
                "startup_timeout_s": startup_timeout_s,
                "cli_cmd": cli_cmd,
            }
        )
        # Lấy experiment_run_id và deployment_id từ DB giống như Headless Poller thật
        cur = conn.cursor()
        cur.execute(
            "SELECT id, deployment_id FROM experiment_run WHERE status = 'running' ORDER BY id DESC LIMIT 1"
        )
        row = cur.fetchone()
        exp_run_id = row[0] if row else None
        dep_id = row[1] if row and row[1] is not None else 1

        actual_db_path = Path(db_path) if db_path is not None else Path("test.db")
        handle = MockPollerHandle(
            db_path=actual_db_path,
            deployment_id=dep_id,
            experiment_run_id=exp_run_id,
            clock=self.clock,
            sample_count=self.sample_count,
            missing_scores=self.missing_scores,
            time_scale=self.time_scale,
        )
        self.handles.append(handle)
        return handle


class MockLoadgenHandle(LoadgenHandle):
    """LoadgenHandle giả lập."""

    def __init__(
        self,
        fail_stop: bool = False,
        fail_cleanup: bool = False,
    ) -> None:
        super().__init__(
            mode="ssh",
            app_url="http://127.0.0.1:3000",
            rate_rps=5.0,
            effective_duration_s=4500.0,
            allow_pilot_4500=True,
            container_name="mock-loadgen",
        )
        self._mock_running = True
        self.stopped_count = 0
        self.cleanup_count = 0
        self.fail_stop = fail_stop
        self.fail_cleanup = fail_cleanup

    @property
    def is_running(self) -> bool:
        if self._is_stopped:
            return False
        return self._mock_running

    def assert_running(self) -> None:
        if self._is_stopped or not self._mock_running:
            raise LoadgenExecutionError(
                "Container mock-loadgen không còn chạy trên VPS"
            )

    def stop(self, timeout_s: float = 5.0) -> None:
        if self.fail_stop:
            raise LoadgenExecutionError("Mô phỏng lỗi khi dừng container loadgen")
        self._is_stopped = True
        self._mock_running = False
        self.stopped_count += 1

    def cleanup(self) -> None:
        if self.fail_cleanup:
            raise LoadgenExecutionError("Mô phỏng lỗi khi dọn dẹp container loadgen")
        self._is_stopped = True
        self._is_cleaned = True
        self._mock_running = False
        self.cleanup_count += 1


class MockLoadgenAdapter(LoadgenAdapter):
    """LoadgenAdapter giả lập."""

    def __init__(
        self,
        fail_stop: bool = False,
        fail_cleanup: bool = False,
    ) -> None:
        super().__init__()
        self.handles: list[MockLoadgenHandle] = []
        self.fail_stop = fail_stop
        self.fail_cleanup = fail_cleanup

    def start(self, *args: Any, **kwargs: Any) -> MockLoadgenHandle:
        handle = MockLoadgenHandle(
            fail_stop=self.fail_stop,
            fail_cleanup=self.fail_cleanup,
        )
        self.handles.append(handle)
        return handle


class MockSshClient:
    """Mock SSH client cho phép đo đồng hồ và thực thi lệnh giả lập."""

    def __init__(
        self,
        exit_code: int = 0,
        stdout: str = "",
        stderr: str = "",
        verify_fail: Exception | None = None,
    ) -> None:
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.verify_fail = verify_fail
        self.executed_commands: list[str] = []

    def verify_connection(self, timeout: float = 10.0) -> None:
        if self.verify_fail is not None:
            raise self.verify_fail
        if self.exit_code != 0:
            lower = self.stderr.lower()
            if (
                "host key verification failed" in lower
                or "host identification has changed" in lower
            ):
                from experiments.run_experiment import SshHostKeyError

                raise SshHostKeyError(self.stderr)
            if "permission denied" in lower or "authentication failed" in lower:
                from experiments.run_experiment import SshAuthenticationError

                raise SshAuthenticationError(self.stderr)
            from experiments.run_experiment import SshError

            raise SshError(self.stderr)

    def exec(self, cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        self.executed_commands.append(cmd)
        if "date" in cmd:
            return 0, str(int(1727800000.0 * 1000)), ""
        return self.exit_code, self.stdout, self.stderr


# =============================================================================
# CÁC TEST CASES E2E CHÍNH
# =============================================================================


def test_e2e_attempt_1_abort_then_attempt_2_success_export_and_analyze(
    tmp_path: Path,
) -> None:
    """E2E Test đầy đủ: Attempt 1 abort (deploy failure) -> Attempt 2 thành công -> Export CSV -> Analyze."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock(start_epoch=1727800000.0)

    # Cấu hình DeployAdapter: attempt 1 thất bại (call 1), attempt 2 thành công (call 2)
    deploy_adapter = MockDeployAdapter(failure_attempts={1})
    ml_client = MockMlClient()
    time_scale = 0.001
    check_interval = 0.5

    def mock_apply_fault(
        url: str, plan: Any, sleep_fn: Any = None, now_fn: Any = None
    ) -> None:
        if sleep_fn:
            sleep_fn(1200.0 * time_scale)

    def mock_reset_fault(url: str) -> bool:
        return True

    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter()

    # 1. Chạy Orchestrator cấp cao `run_experiment` (tự động retry qua các attempt)
    final_res = run_experiment(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "mock_src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=mock_apply_fault,
        reset_fault_fn=mock_reset_fault,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        check_interval_s=check_interval,
        measure_clock_fn=lambda *args, **kwargs: 15,  # Skew 15ms an toàn
        allow_pilot_4500=True,
        max_attempts=3,
    )

    # Xác nhận kết quả run cuối cùng
    assert final_res.status == "completed"
    assert final_res.attempt_index == 2
    assert final_res.scenario == "memory_leak"
    assert final_res.deployment_id == 102
    assert final_res.clock_offset_ms == 15

    # 2. Kiểm tra trực tiếp cơ sở dữ liệu SQLite
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()

    # Xác nhận CẢ 2 attempt đều được ghi lại trong SQLite với audit trail đầy đủ
    cur.execute(
        "SELECT id, attempt_index, status, abort_reason, deployment_id FROM experiment_run ORDER BY attempt_index ASC"
    )
    runs = cur.fetchall()
    assert len(runs) == 2

    # Attempt 1: Aborted do deploy_failed, giữ nguyên deployment_id=101
    attempt_1 = runs[0]
    assert attempt_1[1] == 1  # attempt_index
    assert attempt_1[2] == "aborted"
    assert "deploy_failed" in attempt_1[3]
    assert attempt_1[4] == 101  # deployment_id

    # Attempt 2: Completed, deployment_id=102
    attempt_2 = runs[1]
    assert attempt_2[1] == 2
    assert attempt_2[2] == "completed"
    assert attempt_2[3] is None
    assert attempt_2[4] == 102

    # Bản ghi deployment failed của attempt 1 vẫn được GIỮ NGUYÊN trong bảng deployment
    cur.execute("SELECT id, status, failed_step FROM deployment WHERE id = 101")
    dep_failed = cur.fetchone()
    assert dep_failed is not None
    assert dep_failed[1] == "failed"
    assert dep_failed[2] == "BUILD"

    # Bản ghi deployment running của attempt 2
    cur.execute("SELECT id, status FROM deployment WHERE id = 102")
    dep_running = cur.fetchone()
    assert dep_running is not None
    assert dep_running[1] == "running"

    # 3. Kiểm tra mốc Pha C: fault_end_ts = fault_start_ts + 1200s
    cur.execute(
        "SELECT fault_start_ts, fault_end_ts FROM experiment_run WHERE id = ?",
        (attempt_2[0],),
    )
    f_start_str, f_end_str = cur.fetchone()
    from experiments.run_store import to_epoch_seconds

    f_start_sec = to_epoch_seconds(f_start_str)
    f_end_sec = to_epoch_seconds(f_end_str)
    # Trong test time_scale, thời lượng thực là PHASE_C_S * time_scale
    assert f_end_sec == pytest.approx(f_start_sec + (PHASE_C_S * time_scale), abs=0.1)

    # 4. Kiểm tra ML client đã được gọi reset và train
    assert 102 in ml_client.resets
    assert len(ml_client.train_calls) == 1
    assert ml_client.train_calls[0][0] == 102
    # Pha A có 180 mẫu (1800s / 10s = 180 mẫu)
    assert ml_client.train_calls[0][1] == 180

    # 5. Kiểm tra export_run và analyze trên dữ liệu vừa sinh ra
    results_dir = tmp_path / "results"
    out_dir_2 = results_dir / "run_memory_leak_1_attempt_2"
    out_dir_1 = results_dir / "run_memory_leak_1_attempt_1"
    export_run(conn, attempt_2[0], out_dir=out_dir_2)
    export_run(conn, attempt_1[0], out_dir=out_dir_1)

    # Kiểm tra các file CSV đã được xuất đầy đủ cho attempt completed
    assert (out_dir_2 / "metric_sample.csv").exists()
    assert (out_dir_2 / "score_sample.csv").exists()
    assert (out_dir_2 / "experiment_run.csv").exists()
    assert (out_dir_2 / "alert.csv").exists()
    assert (out_dir_2 / "meta.json").exists()

    # Thu thập Operational Telemetry từ cả 2 thư mục xuất
    telemetry = collect_operational_telemetry([out_dir_1, out_dir_2])
    assert telemetry.total_runs == 2
    assert telemetry.completed_runs == 1
    assert telemetry.aborted_runs == 1
    assert telemetry.retry_success_count == 1
    assert any("deploy_failed" in reason for reason in telemetry.abort_reasons)

    # Chạy bảng phân tích chính main_table()
    table_md = main_table([out_dir_1, out_dir_2], grace_s=60)
    assert "| Method | Precision | Recall | F1 | Delay (s) | #censored |" in table_md
    assert "| ensemble |" in table_md

    # 6. Kiểm tra dọn dẹp trong khối finally
    # Loadgen handle của attempt 2 đã được stop() và cleanup()
    assert loadgen_adapter.handles[-1].stopped_count >= 1
    assert loadgen_adapter.handles[-1].cleanup_count >= 1
    # Poller handle đã được drain() và stop()
    assert poller_adapter.handles[-1].is_drained is True
    assert poller_adapter.handles[-1].is_alive is False

    conn.close()


def test_e2e_clock_skew_too_large_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Lệch đồng hồ vượt ngưỡng (>2000ms) huỷ attempt và không gọi deploy."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()

    res = run_attempt(
        scenario="cpu_spike",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        measure_clock_fn=lambda *args, **kwargs: 2500,  # 2500ms > 2000ms
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "clock_skew_too_large" in (res.abort_reason or "")
    assert res.clock_offset_ms == 2500
    # Deploy tuyệt đối không được gọi khi clock skew gate thất bại
    assert deploy_adapter.call_count == 0


def test_e2e_insufficient_phase_a_samples_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Pha A thu thập không đủ 162 mẫu (<90% của 180) -> ném lỗi và huỷ attempt."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    time_scale = 0.001
    check_interval = 0.5
    # Chỉ giả lập 100 mẫu (< 162)
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=100, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="error_burst",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        check_interval_s=check_interval,
        measure_clock_fn=lambda *args, **kwargs: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "insufficient_phase_a_samples" in (res.abort_reason or "")
    # Không được gọi train khi mẫu không đủ
    assert len(ml_client.train_calls) == 0


def test_e2e_integrity_gate_failure_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Dữ liệu thiếu phương pháp chấm điểm (4 thay vì 5) -> Integrity Gate từ chối và huỷ attempt."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    time_scale = 0.001
    check_interval = 0.5

    def mock_apply_fault(
        url: str, plan: Any, sleep_fn: Any = None, now_fn: Any = None
    ) -> None:
        if sleep_fn:
            sleep_fn(1200.0 * time_scale)

    # Mock poller chỉ ghi 4 phương pháp (thiếu ocsvm)
    poller_adapter = MockPollerAdapter(
        clock=clock,
        sample_count=450,
        missing_scores=True,
        time_scale=time_scale,
    )
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="slow_db",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=mock_apply_fault,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        check_interval_s=check_interval,
        measure_clock_fn=lambda *args, **kwargs: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "integrity_failed" in (res.abort_reason or "")


def test_e2e_loadgen_death_during_wait_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Loadgen container chết giữa chừng trong lúc chờ -> wait_with_checks phát hiện và huỷ attempt."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    time_scale = 0.001
    check_interval = 0.1
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter()

    # Can thiệp để loadgen chết ngay khi bắt đầu Phase A
    def simulate_crash_clock_sleep(sec: float) -> None:
        clock.current_time += sec
        if loadgen_adapter.handles:
            # Mô phỏng container loadgen bị chết
            loadgen_adapter.handles[-1]._mock_running = False

    res = run_attempt(
        scenario="latency_creep",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=simulate_crash_clock_sleep,
        time_scale=time_scale,
        check_interval_s=check_interval,
        measure_clock_fn=lambda *args, **kwargs: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "không còn chạy trên VPS" in (res.abort_reason or "")


# =============================================================================
# CÁC TEST CASES MỚI BỔ SUNG CHO P2d-4 FIX
# =============================================================================


def test_poller_adapter_signature_strict() -> None:
    """Kiểm thử: Chữ ký của PollerAdapter.start() phải chuẩn, không chứa deployment_id hay experiment_run_id."""
    import inspect

    sig = inspect.signature(PollerAdapter.start)
    param_names = list(sig.parameters.keys())
    assert "self" in param_names
    assert "conn" in param_names
    assert "deployment_id" not in param_names
    assert "experiment_run_id" not in param_names

    class StrictPollerAdapter(PollerAdapter):
        def start(self, conn: sqlite3.Connection, **kwargs: Any) -> Any:
            if "deployment_id" in kwargs:
                raise TypeError("unexpected keyword argument 'deployment_id'")
            if "experiment_run_id" in kwargs:
                raise TypeError("unexpected keyword argument 'experiment_run_id'")
            mock_handle = MockPollerHandle(
                db_path=Path("test.db"),
                deployment_id=1,
                experiment_run_id=1,
                clock=SimulatedClock(),
            )
            return mock_handle

    strict_adapter = StrictPollerAdapter()
    test_conn = sqlite3.connect(":memory:")
    handle = strict_adapter.start(
        conn=test_conn, db_path="test.db", ml_url="http://127.0.0.1:8000"
    )
    assert handle is not None
    test_conn.close()


def test_e2e_missing_ssh_client_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Thiếu SSH client -> abort trước clock gate có lý do, không trả offset 0 và không chạy loadgen local."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    deploy_adapter = MockDeployAdapter()
    loadgen_adapter = MockLoadgenAdapter()

    # 1. measure_clock_offset_ms trực tiếp phải ném lỗi khi thiếu SSH
    with pytest.raises(ValueError, match="Yêu cầu ssh_client hợp lệ"):
        measure_clock_offset_ms(ssh_client=None)

    # 2. run_attempt phải abort ngay trước clock gate
    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=None,
        deploy_adapter=deploy_adapter,
        loadgen_adapter=loadgen_adapter,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "missing_ssh_client" in (res.abort_reason or "")
    assert deploy_adapter.call_count == 0
    assert len(loadgen_adapter.handles) == 0


def test_e2e_reset_fault_step4_failure_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Lỗi reset_fault tại Bước 4 -> abort attempt và không ghi completed."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    poller_adapter = MockPollerAdapter(clock=clock)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        reset_fault_fn=lambda url: False,  # Báo lỗi reset fault
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "reset_fault_failed" in (res.abort_reason or "")
    assert res.status != "completed"


def test_e2e_apply_fault_failure_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Lỗi áp dụng fault tại Pha C -> abort attempt và không ghi completed."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    time_scale = 0.001
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter()

    def failing_apply_fault(url: str, plan: Any, **kw: Any) -> None:
        raise RuntimeError("Lỗi mạng khi gọi endpoint fault")

    res = run_attempt(
        scenario="cpu_spike",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=failing_apply_fault,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "apply_fault_failed" in (res.abort_reason or "")
    assert res.status != "completed"


def test_e2e_reset_fault_step8_failure_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Lỗi reset fault tại đầu Pha D (Bước 8) -> abort attempt và không ghi completed."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    time_scale = 0.001
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter()

    reset_calls = 0

    def mock_reset_fault(url: str) -> bool:
        nonlocal reset_calls
        reset_calls += 1
        # Lần 1 (Step 4) thành công, Lần 2 (Step 8) thất bại
        return reset_calls == 1

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=mock_reset_fault,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "reset_fault_failed" in (res.abort_reason or "")
    assert res.status != "completed"


def test_e2e_loadgen_stop_failure_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Lỗi khi loadgen stop -> abort attempt và không ghi completed."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    time_scale = 0.001
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter(fail_stop=True)

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "loadgen_stop_failed" in (res.abort_reason or "")
    assert res.status != "completed"


def test_e2e_loadgen_cleanup_failure_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Lỗi khi loadgen cleanup -> abort attempt và không ghi completed."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    time_scale = 0.001
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter(fail_cleanup=True)

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "loadgen_cleanup_failed" in (res.abort_reason or "")
    assert res.status != "completed"


def test_e2e_poller_death_during_wait_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Headless poller chết giữa chừng -> wait_with_checks phát hiện và huỷ attempt mà không ném AttributeError."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    time_scale = 0.001
    check_interval = 0.1
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter()

    # Can thiệp để poller chết ngay trong Phase A
    def simulate_crash_clock_sleep(sec: float) -> None:
        clock.current_time += sec
        if poller_adapter.handles:
            poller_adapter.handles[-1].is_alive = False

    res = run_attempt(
        scenario="latency_creep",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=simulate_crash_clock_sleep,
        time_scale=time_scale,
        check_interval_s=check_interval,
        measure_clock_fn=lambda *args, **kwargs: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "Headless Poller bị dừng bất thường" in (res.abort_reason or "")


def test_e2e_wait_with_checks_stalled_clock_raises_error() -> None:
    """Kiểm thử: wait_with_checks() phải ném lỗi nếu đồng hồ không tiến sau sleeper_fn."""
    with pytest.raises(RuntimeError, match="Đồng hồ không tiến"):
        wait_with_checks(
            duration_s=10.0,
            check_interval_s=1.0,
            sleeper_fn=lambda s: None,  # không làm gì, đồng hồ không chạy
            clock_fn=lambda: 1000.0,  # luôn trả về 1000.0 cố định
        )


def test_e2e_pilot_flag_disabled_aborts_before_deploy(tmp_path: Path) -> None:
    """Kiểm thử: Khi không bật cờ allow_pilot_4500 (mặc định), attempt bị huỷ trước deploy."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    loadgen_adapter = MockLoadgenAdapter()
    poller_adapter = MockPollerAdapter(clock=clock)

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=False,  # Mặc định False
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "pilot_mode_required" in (res.abort_reason or "")
    # Tuyệt đối không gọi deploy_adapter khi chưa bật cờ pilot
    assert deploy_adapter.call_count == 0
    assert len(loadgen_adapter.handles) == 0


def test_cli_resolves_ssh_client_and_does_not_abort_from_missing_ssh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Kiểm thử: CLI nối SSH client hợp lệ bằng credential an toàn, không luôn abort vì thiếu SSH."""
    from experiments.run_experiment import (
        SystemSshClient,
        build_parser,
        resolve_ssh_client,
    )

    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    # Đảm bảo bảng vps có thông tin host, username
    conn = sqlite3.connect(db_file)
    conn.execute(
        "UPDATE vps SET host = '192.168.1.100', port = 2222, username = 'ops_user', auth_type = 'key' WHERE id = 1"
    )
    conn.commit()

    # 1a. Bảo mật argv: --ssh-secret chứa chuỗi thô bị loại bỏ khỏi parser và từ chối khi gọi
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--ssh-secret", "super_secret_ssh_key_data"])

    # 1b. CLI hỗ trợ truyền đường dẫn key qua --ssh-key-file và cờ pilot
    key_file = tmp_path / "test_id_rsa"
    key_file.write_text("test_key_content", encoding="utf-8")
    cli_args = parser.parse_args(
        [
            "--scenario",
            "memory_leak",
            "--db-path",
            str(db_file),
            "--app-url",
            "http://127.0.0.1:3000",
            "--ssh-key-file",
            str(key_file),
            "--allow-pilot-4500",
        ]
    )
    assert cli_args.ssh_key_file == str(key_file)
    assert cli_args.allow_pilot_4500 is True

    # 2. resolve_ssh_client từ tham số ssh_key_file
    client_from_arg = resolve_ssh_client(
        conn, vps_id=1, ssh_key_file=cli_args.ssh_key_file
    )
    assert isinstance(client_from_arg, SystemSshClient)
    assert client_from_arg.host == "192.168.1.100"
    assert client_from_arg.port == 2222
    assert client_from_arg.username == "ops_user"
    assert client_from_arg.auth_type == "key"
    assert client_from_arg._effective_key_file == key_file

    # Bảo mật: __repr__ phải che giấu credential hoàn toàn, không in raw secret
    repr_str = repr(client_from_arg)
    assert "super_secret" not in repr_str
    assert "secret=******" in repr_str

    # 3. resolve_ssh_client từ biến môi trường OPSPILOT_SSH_SECRET
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "env_secret_key_999")
    client_from_env = resolve_ssh_client(conn, vps_id=1)
    assert isinstance(client_from_env, SystemSshClient)
    assert "env_secret_key_999" not in repr(client_from_env)
    assert "secret=******" in repr(client_from_env)

    # 4. Khi ssh_client=None nhưng có OPSPILOT_SSH_SECRET, run_attempt tự động phân giải SSH client và không abort vì missing_ssh_client
    monkeypatch.setattr(
        SystemSshClient, "verify_connection", lambda self, *a, **kw: None
    )

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=None,  # Để None để kích hoạt resolve_ssh_client
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda client, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    # Không bị abort vì missing_ssh_client!
    assert (res.abort_reason or "") != "missing_ssh_client"
    assert "missing_ssh_client" not in (res.abort_reason or "")
    assert res.status == "completed"

    conn.close()


def test_e2e_phase_c_process_death_aborts_attempt(tmp_path: Path) -> None:
    """Kiểm thử: Loadgen hoặc Poller chết giữa Phase C (khi apply_plan đang chờ/gửi fault) -> abort attempt."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    ssh_client = MockSshClient()
    time_scale = 0.001
    check_interval = 0.1

    # Trường hợp 1: Loadgen container chết khi apply_plan đang chờ giữa các actions
    poller_adapter = MockPollerAdapter(
        clock=clock, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter = MockLoadgenAdapter()

    def crashing_apply_fault_loadgen(
        url: str,
        plan: Any,
        sleep_fn: Any = None,
        now_fn: Any = None,
        check_fn: Any = None,
    ) -> None:
        # Giả lập loadgen chết ngay khi apply_plan bắt đầu
        if loadgen_adapter.handles:
            loadgen_adapter.handles[-1]._mock_running = False
        # Gọi check_fn định kỳ
        if check_fn:
            check_fn()

    res = run_attempt(
        scenario="cpu_spike",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=crashing_apply_fault_loadgen,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=time_scale,
        check_interval_s=check_interval,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "apply_fault_failed" in (res.abort_reason or "")
    assert "không còn chạy trên VPS" in (res.abort_reason or "")
    # Cleanup phải được gọi trong finally
    assert loadgen_adapter.handles[-1]._is_cleaned is True

    # Trường hợp 2: Poller chết khi apply_plan đang gửi fault trong Phase C
    db_file2 = tmp_path / "opspilot_poller_crash.db"
    _init_test_db(db_file2)
    clock2 = SimulatedClock()
    deploy_adapter2 = MockDeployAdapter()
    ml_client2 = MockMlClient()
    poller_adapter2 = MockPollerAdapter(
        clock=clock2, sample_count=450, time_scale=time_scale
    )
    loadgen_adapter2 = MockLoadgenAdapter()

    def crashing_apply_fault_poller(
        url: str,
        plan: Any,
        sleep_fn: Any = None,
        now_fn: Any = None,
        check_fn: Any = None,
    ) -> None:
        # Giả lập poller chết giữa chừng
        if poller_adapter2.handles:
            poller_adapter2.handles[-1].is_alive = False
        if check_fn:
            check_fn()

    res2 = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file2,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter2,
        ml_client=ml_client2,
        poller_adapter=poller_adapter2,
        loadgen_adapter=loadgen_adapter2,
        apply_fault_fn=crashing_apply_fault_poller,
        reset_fault_fn=lambda url: True,
        clock_fn=clock2.now,
        sleeper_fn=clock2.sleep,
        time_scale=time_scale,
        check_interval_s=check_interval,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res2.status == "aborted"
    assert "apply_fault_failed" in (res2.abort_reason or "")
    assert "Headless Poller bị dừng bất thường trong Pha C" in (res2.abort_reason or "")


def test_system_ssh_client_transport_uses_credentials_and_strict_host_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Kiểm thử mức transport: SystemSshClient truyền đúng credential (-i), IdentitiesOnly, StrictHostKeyChecking=yes, và không để lộ secret trong argv."""
    import subprocess

    from experiments import run_experiment as runner
    from experiments.run_experiment import SystemSshClient

    monkeypatch.setattr(runner, "_restrict_windows_key_acl", lambda *_args, **_kwargs: None)

    captured_cmds: list[list[str]] = []

    def mock_run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        captured_cmds.append(list(args))
        return subprocess.CompletedProcess(
            args=args, returncode=0, stdout="success\n", stderr=""
        )

    monkeypatch.setattr(subprocess, "run", mock_run)

    secret_raw = "MOCK_PRIVATE_KEY_PLAINTEXT_SECRET_12345"

    # 1. Khởi tạo bằng raw secret -> phải tạo temp key file, dùng -i, và StrictHostKeyChecking=yes
    client1 = SystemSshClient(
        host="10.0.0.1",
        port=2222,
        username="deployer",
        auth_type="key",
        secret=secret_raw,
    )
    assert client1._effective_key_file is not None
    assert client1._effective_key_file.is_file()
    assert client1._effective_key_file.read_text(encoding="utf-8") == secret_raw

    code, _stdout, _stderr = client1.exec("uptime")
    assert code == 0
    assert len(captured_cmds) == 1
    cmd_args = captured_cmds[0]

    # Kiểm tra các tham số an toàn bắt buộc trong lệnh SSH:
    assert "-p" in cmd_args and cmd_args[cmd_args.index("-p") + 1] == "2222"
    assert "StrictHostKeyChecking=yes" in cmd_args
    assert "StrictHostKeyChecking=no" not in cmd_args
    assert "UserKnownHostsFile=/dev/null" not in cmd_args
    assert "-i" in cmd_args and cmd_args[cmd_args.index("-i") + 1] == str(
        client1._effective_key_file
    )
    assert "IdentitiesOnly=yes" in cmd_args
    assert "deployer@10.0.0.1" in cmd_args
    assert "uptime" in cmd_args

    # Tuyệt đối không có chuỗi secret thô trong argv của tiến trình ssh!
    for arg in cmd_args:
        assert secret_raw not in arg

    # Dọn dẹp: close() phải xoá file key tạm
    temp_key_path = client1._effective_key_file
    client1.close()
    assert not temp_key_path.exists()

    # 2. Khởi tạo bằng file key có sẵn và known_hosts_file tuỳ biến
    existing_key = tmp_path / "custom_id_rsa"
    existing_key.write_text("existing_key_data", encoding="utf-8")
    known_hosts = tmp_path / "known_hosts"
    known_hosts.write_text("10.0.0.1 ssh-rsa AAAAB3NzaC1yc2E...", encoding="utf-8")

    captured_cmds.clear()
    with SystemSshClient(
        host="10.0.0.2",
        port=22,
        username="root",
        auth_type="key",
        key_file=existing_key,
        known_hosts_file=known_hosts,
    ) as client2:
        client2.exec("whoami")
        assert len(captured_cmds) == 1
        cmd2_args = captured_cmds[0]
        assert "-i" in cmd2_args and cmd2_args[cmd2_args.index("-i") + 1] == str(
            existing_key
        )
        assert f"UserKnownHostsFile={known_hosts}" in cmd2_args
        assert (
            "GlobalKnownHostsFile=NUL"
            if runner.os.name == "nt"
            else "GlobalKnownHostsFile=/dev/null"
        ) in cmd2_args
        assert "StrictHostKeyChecking=yes" in cmd2_args

    # File key ngoài không bị xoá sau khi đóng client
    assert existing_key.exists()


def test_ssh_bad_credentials_aborts_attempt_before_deploy(tmp_path: Path) -> None:
    """Kiểm thử: Sai credential SSH (Permission denied) làm attempt abort ngay trước khi deploy (deploy_adapter không bao giờ được gọi)."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    # SSH client trả về lỗi xác thực Permission denied
    ssh_client = MockSshClient(
        exit_code=255,
        stderr="root@127.0.0.1: Permission denied (publickey,password).",
    )

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "ssh_auth_error" in (res.abort_reason or "")
    assert "Permission denied" in (res.abort_reason or "")
    # Cốt lõi: deploy_adapter không được gọi dù chỉ 1 lần
    assert deploy_adapter.call_count == 0
    assert len(loadgen_adapter.handles) == 0


def test_ssh_bad_host_key_aborts_attempt_before_deploy(tmp_path: Path) -> None:
    """Kiểm thử: Lỗi host key (Host key verification failed) làm attempt abort ngay trước khi deploy."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    # SSH client trả về lỗi host key verification
    ssh_client = MockSshClient(
        exit_code=255,
        stderr="Host key verification failed.\r\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
    )

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=ssh_client,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "ssh_host_key_error" in (res.abort_reason or "")
    assert "Host key verification failed" in (res.abort_reason or "")
    # Deploy adapter tuyệt đối không được gọi
    assert deploy_adapter.call_count == 0
    assert len(loadgen_adapter.handles) == 0


def test_ssh_unsupported_auth_type_aborts_attempt_before_deploy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Kiểm thử: Kiểu xác thực không hỗ trợ (auth_type='password') bị từ chối rõ ràng và abort trước deploy."""
    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    conn = sqlite3.connect(db_file)
    conn.execute("UPDATE vps SET auth_type = 'password' WHERE id = 1")
    conn.commit()
    conn.close()

    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "super_secret_ssh_password")

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=None,  # Kích hoạt resolve_ssh_client từ vps auth_type='password'
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "unsupported_auth_type" in (res.abort_reason or "")
    assert "only 'key' authentication is supported" in (res.abort_reason or "")
    # Deploy adapter tuyệt đối không được gọi
    assert deploy_adapter.call_count == 0
    assert len(loadgen_adapter.handles) == 0


def test_ssh_secret_never_persisted_in_argv_log_or_db(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Kiểm thử: Secret SSH không bao giờ xuất hiện trong argv của tiến trình, log hệ thống, hay database SQLite."""
    import logging
    import subprocess

    from experiments import run_experiment as runner
    from experiments.run_experiment import SystemSshClient

    monkeypatch.setattr(runner, "_restrict_windows_key_acl", lambda *_args, **_kwargs: None)

    db_file = tmp_path / "opspilot.db"
    _init_test_db(db_file)

    secret_str = "SUPER_SECRET_SSH_KEY_PAYLOAD_ABC_987654321"

    # 1. Kiểm tra argv khi SystemSshClient thực thi lệnh
    executed_args: list[str] = []

    def mock_run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        executed_args.extend(args)
        # Giả lập remote server echo lại nội dung
        return subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout=f"Output with echo: {secret_str}\n",
            stderr=f"Error with echo: {secret_str}\n",
        )

    monkeypatch.setattr(subprocess, "run", mock_run)

    client = SystemSshClient(
        host="127.0.0.1",
        port=22,
        username="root",
        auth_type="key",
        secret=secret_str,
    )

    with caplog.at_level(logging.DEBUG):
        # 1a. Kiểm tra argv
        code, stdout, stderr = client.exec("test_cmd")
        assert code == 0
        for arg in executed_args:
            assert secret_str not in arg

        # 1b. Khử secret trong stdout/stderr trả về
        assert secret_str not in stdout
        assert "******" in stdout
        assert secret_str not in stderr
        assert "******" in stderr

        # 1c. Kiểm tra repr(client)
        assert secret_str not in repr(client)
        assert "secret=******" in repr(client)

        client.close()

    # 1d. Kiểm tra log
    assert secret_str not in caplog.text

    # 2. Kiểm tra khi chạy run_attempt lưu bản ghi vào SQLite DB
    conn = sqlite3.connect(db_file)
    conn.execute(
        "UPDATE vps SET host = '127.0.0.1', port = 22, username = 'root', auth_type = 'key' WHERE id = 1"
    )
    conn.commit()

    monkeypatch.setenv("OPSPILOT_SSH_SECRET", secret_str)
    monkeypatch.setattr(
        SystemSshClient, "verify_connection", lambda self, *a, **kw: None
    )

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=None,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"

    # Kiểm tra toàn bộ cơ sở dữ liệu SQLite: không có bất kỳ bảng hay cột nào chứa secret_str
    cur = conn.cursor()
    cur.execute("SELECT * FROM experiment_run")
    rows = cur.fetchall()
    for row in rows:
        for val in row:
            if val is not None:
                assert secret_str not in str(val)

    cur.execute("SELECT * FROM deployment")
    for row in cur.fetchall():
        for val in row:
            if val is not None:
                assert secret_str not in str(val)

    conn.close()


def test_runner_pilot_express_api_passes_fault_endpoints_env(
    tmp_path: Path,
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"
    assert deploy_adapter.call_count == 1
    assert deploy_adapter.deployed_env_vars[-1] == {"ENABLE_FAULT_ENDPOINTS": "true"}


def test_runner_pilot_default_disabled_aborts_before_deploy(
    tmp_path: Path,
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    deploy_adapter = MockDeployAdapter()

    # 1. Với raise_on_abort=False (trả về RunResult status='aborted')
    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=False,
        raise_on_abort=False,
    )
    assert res.status == "aborted"
    assert "pilot_mode_required" in res.abort_reason
    assert deploy_adapter.call_count == 0

    # 2. Với raise_on_abort=True (ném ngoại lệ ExperimentError)
    with pytest.raises(ExperimentError, match="pilot_mode_required"):
        run_attempt(
            scenario="memory_leak",
            repeat_index=1,
            vps_id=1,
            db_path=db_file,
            app_name="express-api",
            source_path=tmp_path / "src",
            app_url="http://127.0.0.1:3000",
            ssh_client=MockSshClient(),
            deploy_adapter=deploy_adapter,
            measure_clock_fn=lambda *a, **kw: 0,
            allow_pilot_4500=False,
            raise_on_abort=True,
        )
    assert deploy_adapter.call_count == 0


def test_runner_unsupported_app_aborts_before_deploy(
    tmp_path: Path,
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    deploy_adapter = MockDeployAdapter()

    # 1. Với raise_on_abort=False
    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="next-blog",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        deploy_adapter=deploy_adapter,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "aborted"
    assert "unsupported_pilot_app" in res.abort_reason
    assert "next-blog" in res.abort_reason
    assert deploy_adapter.call_count == 0

    # 2. Với raise_on_abort=True
    with pytest.raises(UnsupportedAppError, match="unsupported_pilot_app"):
        run_attempt(
            scenario="memory_leak",
            repeat_index=1,
            vps_id=1,
            db_path=db_file,
            app_name="vite-spa",
            source_path=tmp_path / "src",
            app_url="http://127.0.0.1:3000",
            ssh_client=MockSshClient(),
            deploy_adapter=deploy_adapter,
            measure_clock_fn=lambda *a, **kw: 0,
            allow_pilot_4500=True,
            raise_on_abort=True,
        )
    assert deploy_adapter.call_count == 0


def test_runner_deploy_adapter_does_not_leak_fault_env_in_argv(
    tmp_path: Path,
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)
    conn = sqlite3.connect(db_file)
    conn.execute(
        "INSERT INTO deployment (id, app_id, status) VALUES (55, 1, 'running')"
    )
    conn.commit()

    run_id = start_run(conn, "memory_leak", 1, deployment_id=None, vps_id=1)

    mock_script = (
        "import sys, os, json\n"
        "raw_env = os.environ.get('OPSPILOT_APP_ENV_JSON')\n"
        "assert raw_env is not None, 'OPSPILOT_APP_ENV_JSON must be set in env'\n"
        "env_data = json.loads(raw_env)\n"
        "assert env_data.get('ENABLE_FAULT_ENDPOINTS') == 'true'\n"
        "for arg in sys.argv:\n"
        "    assert 'ENABLE_FAULT_ENDPOINTS' not in arg\n"
        "    assert '--env-json' not in arg\n"
        "print(json.dumps({'event': 'assigned', 'deployment_id': 55}), flush=True)\n"
        "print(json.dumps({'event': 'finished', 'deployment_id': 55, 'status': 'running'}), flush=True)\n"
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
        app_name="express-api",
        source_path=tmp_path,
        db_path=db_file,
        env_vars={"ENABLE_FAULT_ENDPOINTS": "true"},
    )
    assert res.deployment_id == 55
    assert res.status == "running"
    conn.close()


def test_runner_ssh_key_file_propagates_to_deploy_and_poller(
    tmp_path: Path,
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    key_file = tmp_path / "id_ed25519"
    key_content = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest_secret_payload_12345\n-----END OPENSSH PRIVATE KEY-----"
    key_file.write_text(key_content, encoding="utf-8")

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=key_file,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"
    assert deploy_adapter.call_count == 1
    assert deploy_adapter.deployed_ssh_secrets[-1] == key_content
    assert len(poller_adapter.started_ssh_secrets) == 1
    assert poller_adapter.started_ssh_secrets[-1] == key_content
    assert (
        deploy_adapter.deployed_ssh_secrets[-1]
        == poller_adapter.started_ssh_secrets[-1]
    )


def test_runner_ssh_key_file_wins_over_stale_env_secret(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "stale_old_secret_from_env_999")
    monkeypatch.setenv("OPSPILOT_DEPLOY_SECRET", "stale_old_deploy_secret_888")

    key_file = tmp_path / "explicit_key.pem"
    key_content = "explicit_key_data_from_file_777"
    key_file.write_text(key_content, encoding="utf-8")

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=key_file,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"
    assert deploy_adapter.deployed_ssh_secrets[-1] == key_content
    assert poller_adapter.started_ssh_secrets[-1] == key_content
    assert deploy_adapter.deployed_ssh_secrets[-1] != "stale_old_secret_from_env_999"
    assert poller_adapter.started_ssh_secrets[-1] != "stale_old_secret_from_env_999"


def test_runner_ssh_key_file_missing_aborts_before_deploy(
    tmp_path: Path,
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    missing_key = tmp_path / "nonexistent_key_file.pem"
    deploy_adapter = MockDeployAdapter()

    # 1. Với raise_on_abort=False
    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=missing_key,
        deploy_adapter=deploy_adapter,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "aborted"
    assert "ssh_key_file_error" in res.abort_reason
    assert "không tồn tại" in res.abort_reason
    assert deploy_adapter.call_count == 0

    # 2. Với raise_on_abort=True
    with pytest.raises(SshKeyFileError, match="không tồn tại"):
        run_attempt(
            scenario="memory_leak",
            repeat_index=1,
            vps_id=1,
            db_path=db_file,
            app_name="express-api",
            source_path=tmp_path / "src",
            app_url="http://127.0.0.1:3000",
            ssh_client=MockSshClient(),
            ssh_key_file=missing_key,
            deploy_adapter=deploy_adapter,
            measure_clock_fn=lambda *a, **kw: 0,
            allow_pilot_4500=True,
            raise_on_abort=True,
        )
    assert deploy_adapter.call_count == 0


def test_runner_ssh_key_file_empty_aborts_before_deploy(
    tmp_path: Path,
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    empty_key = tmp_path / "empty_key_file.pem"
    empty_key.write_text("   \n\t  \n  ", encoding="utf-8")
    deploy_adapter = MockDeployAdapter()

    # 1. Với raise_on_abort=False
    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=empty_key,
        deploy_adapter=deploy_adapter,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "aborted"
    assert "ssh_key_file_error" in res.abort_reason
    assert "rỗng" in res.abort_reason
    assert deploy_adapter.call_count == 0

    # 2. Với raise_on_abort=True
    with pytest.raises(SshKeyFileError, match="rỗng"):
        run_attempt(
            scenario="memory_leak",
            repeat_index=1,
            vps_id=1,
            db_path=db_file,
            app_name="express-api",
            source_path=tmp_path / "src",
            app_url="http://127.0.0.1:3000",
            ssh_client=MockSshClient(),
            ssh_key_file=empty_key,
            deploy_adapter=deploy_adapter,
            measure_clock_fn=lambda *a, **kw: 0,
            allow_pilot_4500=True,
            raise_on_abort=True,
        )
    assert deploy_adapter.call_count == 0


def test_runner_ssh_key_file_unreadable_aborts_before_deploy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    # 1. Đường dẫn là thư mục (không phải file)
    key_dir = tmp_path / "key_directory"
    key_dir.mkdir()
    deploy_adapter = MockDeployAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=key_dir,
        deploy_adapter=deploy_adapter,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "aborted"
    assert "ssh_key_file_error" in res.abort_reason
    assert "không phải là file" in res.abort_reason
    assert deploy_adapter.call_count == 0

    # 2. Lỗi đọc file (PermissionError)
    valid_key = tmp_path / "perm_key.pem"
    valid_key.write_text("valid_content", encoding="utf-8")

    orig_read_text = Path.read_text

    def mock_failing_read(self: Path, *args: Any, **kwargs: Any) -> str:
        if self == valid_key:
            raise PermissionError("Access is denied")
        return orig_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", mock_failing_read)

    res2 = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=valid_key,
        deploy_adapter=deploy_adapter,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res2.status == "aborted"
    assert "ssh_key_file_error" in res2.abort_reason
    assert "PermissionError" in res2.abort_reason
    assert deploy_adapter.call_count == 0


def test_runner_ssh_key_file_credential_security_no_leak(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    secret_key_token = "UNIQUE_SUPER_SECRET_KEY_PAYLOAD_ABCXYZ_987654321"
    key_file = tmp_path / "secret_key.pem"
    key_file.write_text(secret_key_token, encoding="utf-8")

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=key_file,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"

    # Kiểm tra log không chứa secret
    assert secret_key_token not in caplog.text

    # Kiểm tra toàn bộ cơ sở dữ liệu SQLite
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()
    cur.execute("SELECT * FROM experiment_run")
    for row in cur.fetchall():
        for val in row:
            if val is not None:
                assert secret_key_token not in str(val)

    cur.execute("SELECT * FROM deployment")
    for row in cur.fetchall():
        for val in row:
            if val is not None:
                assert secret_key_token not in str(val)
    conn.close()


def test_runner_credential_fallback_when_no_key_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    monkeypatch.delenv("OPSPILOT_SSH_KEY_FILE", raising=False)
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "standard_fallback_env_secret_111")

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=None,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"
    assert deploy_adapter.deployed_ssh_secrets[-1] == "standard_fallback_env_secret_111"
    assert poller_adapter.started_ssh_secrets[-1] == "standard_fallback_env_secret_111"


def test_read_ssh_key_file_preserves_trailing_newline_and_passes_to_adapters(
    tmp_path: Path,
) -> None:
    """Kiểm tra read_ssh_key_file bảo lưu nguyên vẹn nội dung file (kể cả newline cuối)

    và truyền nguyên vẹn tới DeployAdapter và PollerAdapter.
    """
    from experiments.run_experiment import read_ssh_key_file

    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    key_with_newline = (
        "-----BEGIN OPENSSH PRIVATE KEY-----\n"
        "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n"
        "-----END OPENSSH PRIVATE KEY-----\n\n"
    )
    key_file = tmp_path / "test_newline_key.pem"
    key_file.write_text(key_with_newline, encoding="utf-8")

    # 1. read_ssh_key_file trả nguyên nội dung, không strip newline cuối
    content = read_ssh_key_file(key_file)
    assert content == key_with_newline
    assert content.endswith("\n\n")

    # 2. run_attempt truyền đúng chuỗi có newline cuối vào cả 2 adapter
    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=key_file,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"
    assert deploy_adapter.deployed_ssh_secrets[-1] == key_with_newline
    assert poller_adapter.started_ssh_secrets[-1] == key_with_newline


def test_read_ssh_key_file_called_only_once_during_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Chứng minh file private key chỉ được đọc ĐÚNG MỘT LẦN trong suốt chu trình run_attempt."""
    import experiments.run_experiment as runner_mod

    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    key_file = tmp_path / "single_read_key.pem"
    key_file.write_text("VALID_SINGLE_READ_KEY_DATA\n", encoding="utf-8")

    read_calls = 0
    original_read = runner_mod.read_ssh_key_file

    def counting_read(path: Any) -> str:
        nonlocal read_calls
        read_calls += 1
        return original_read(path)

    monkeypatch.setattr(runner_mod, "read_ssh_key_file", counting_read)

    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    ml_client = MockMlClient()
    poller_adapter = MockPollerAdapter(clock=clock, sample_count=450, time_scale=0.001)
    loadgen_adapter = MockLoadgenAdapter()

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=key_file,
        deploy_adapter=deploy_adapter,
        ml_client=ml_client,
        poller_adapter=poller_adapter,
        loadgen_adapter=loadgen_adapter,
        apply_fault_fn=lambda *a, **kw: None,
        reset_fault_fn=lambda url: True,
        clock_fn=clock.now,
        sleeper_fn=clock.sleep,
        time_scale=0.001,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "completed"
    assert read_calls == 1, f"Yêu cầu chỉ đọc key 1 lần nhưng đã đọc {read_calls} lần!"


def test_resolve_ssh_client_invalid_key_with_stale_env_secret_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Chứng minh resolve_ssh_client KHÔNG nuốt SshKeyFileError để rơi về secret môi trường cũ.

    Khi key file đã chỉ định mà bị lỗi, phải fail closed ngay lập tức.
    """
    from experiments.run_experiment import resolve_ssh_client

    db_file = tmp_path / "test.db"
    _init_test_db(db_file)
    conn = sqlite3.connect(db_file)
    conn.execute(
        "UPDATE vps SET host = '127.0.0.1', port = 22, username = 'root', auth_type = 'key' WHERE id = 1"
    )
    conn.commit()

    # Cài đặt secret cũ còn sót lại trong môi trường
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "stale_old_secret_from_env_123")
    monkeypatch.setenv("OPSPILOT_DEPLOY_SECRET", "stale_deploy_secret_456")

    # 1. File không tồn tại -> phải ném SshKeyFileError, không được trả về client dùng secret môi trường
    missing_key = tmp_path / "nonexistent.pem"
    with pytest.raises(SshKeyFileError, match="không tồn tại"):
        resolve_ssh_client(conn, vps_id=1, ssh_key_file=missing_key)

    # 2. File rỗng -> phải ném SshKeyFileError, không rơi về secret môi trường
    empty_key = tmp_path / "empty.pem"
    empty_key.write_text("   \n\t  \n", encoding="utf-8")
    with pytest.raises(SshKeyFileError, match="rỗng"):
        resolve_ssh_client(conn, vps_id=1, ssh_key_file=empty_key)

    # 3. Chuỗi đường dẫn rỗng -> phải ném SshKeyFileError
    with pytest.raises(SshKeyFileError, match="rỗng"):
        resolve_ssh_client(conn, vps_id=1, ssh_key_file="   ")

    # 4. Khi chỉ định qua biến môi trường OPSPILOT_SSH_KEY_FILE bị lỗi
    monkeypatch.setenv("OPSPILOT_SSH_KEY_FILE", str(missing_key))
    with pytest.raises(SshKeyFileError, match="không tồn tại"):
        resolve_ssh_client(conn, vps_id=1)

    conn.close()


def test_runner_invalid_key_file_with_stale_env_secret_aborts_without_deploy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Chứng minh run_attempt khi key file chỉ định bị lỗi kèm secret môi trường cũ

    sẽ abort ngay lập tức trước deploy, không fallback dùng secret môi trường cũ.
    """
    db_file = tmp_path / "test.db"
    _init_test_db(db_file)

    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "stale_env_secret_should_never_win")
    missing_key = tmp_path / "ghost_key.pem"
    clock = SimulatedClock()
    deploy_adapter = MockDeployAdapter()
    poller_adapter = MockPollerAdapter(clock=clock)

    res = run_attempt(
        scenario="memory_leak",
        repeat_index=1,
        vps_id=1,
        db_path=db_file,
        app_name="express-api",
        source_path=tmp_path / "src",
        app_url="http://127.0.0.1:3000",
        ssh_client=MockSshClient(),
        ssh_key_file=missing_key,
        deploy_adapter=deploy_adapter,
        poller_adapter=poller_adapter,
        measure_clock_fn=lambda *a, **kw: 0,
        allow_pilot_4500=True,
        raise_on_abort=False,
    )
    assert res.status == "aborted"
    assert "ssh_key_file_error" in res.abort_reason
    assert "không tồn tại" in res.abort_reason
    assert deploy_adapter.call_count == 0
    assert len(poller_adapter.started_ssh_secrets) == 0
