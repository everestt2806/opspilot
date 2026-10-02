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
    run_attempt,
    run_experiment,
)
from experiments.run_store import (
    abort_run,
    attach_deployment_id,
    normalize_ts,
    to_epoch_seconds,
)

# Schema SQLite kiểm thử tối thiểu nhưng đầy đủ toàn bộ bảng và trường cho TK-S6
_TEST_SCHEMA = """
CREATE TABLE vps (
  id INTEGER PRIMARY KEY
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
                (self.deployment_id, i + 1, t_iso, t_iso, 25.0, 120.0, 30.0, 15.0, 0.0),
            )
        conn.commit()
        conn.close()

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
        return PollerDrainResult(exit_code=0)

    def stop(self) -> None:
        self.is_alive = False


class MockPollerAdapter(PollerAdapter):
    """PollerAdapter giả lập tạo ra MockPollerHandle."""

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

    def start(
        self,
        db_path: Path | str,
        deployment_id: int,
        experiment_run_id: int | None = None,
        **kwargs: Any,
    ) -> MockPollerHandle:
        handle = MockPollerHandle(
            db_path=Path(db_path),
            deployment_id=deployment_id,
            experiment_run_id=experiment_run_id,
            clock=self.clock,
            sample_count=self.sample_count,
            missing_scores=self.missing_scores,
            time_scale=self.time_scale,
        )
        self.handles.append(handle)
        return handle


class MockLoadgenHandle(LoadgenHandle):
    """LoadgenHandle giả lập."""

    def __init__(self) -> None:
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
        self._is_stopped = True
        self._mock_running = False
        self.stopped_count += 1

    def cleanup(self) -> None:
        self._is_stopped = True
        self._mock_running = False
        self.cleanup_count += 1


class MockLoadgenAdapter(LoadgenAdapter):
    """LoadgenAdapter giả lập."""

    def __init__(self) -> None:
        super().__init__()
        self.handles: list[MockLoadgenHandle] = []

    def start(self, *args: Any, **kwargs: Any) -> MockLoadgenHandle:
        handle = MockLoadgenHandle()
        self.handles.append(handle)
        return handle


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
        raise_on_abort=False,
    )

    assert res.status == "aborted"
    assert "không còn chạy trên VPS" in (res.abort_reason or "")
