"""Orchestrator thí nghiệm OpsPilot TK-S6 (docs/tasks/tk-s6-load-gen-experiment-harness.md:843).

Thực hiện quy trình 10 bước chuẩn hoá của TK-S6:
  1. Khởi tạo bản ghi Attempt trong SQLite TRƯỚC mọi bước SSH/deploy (run_id, status='running', deployment_id=None).
  2. Đo độ lệch đồng hồ (Clock Skew Gate: |offset| <= 2000ms).
  3. Deploy thật app demo lên VPS: gắn deployment_id ngay khi nhận ID, giữ nguyên bản ghi deployment failed khi lỗi.
  4. Reset ML service và tắt fault cũ, khởi động Headless Poller và Load Generator 4500s.
  5. Pha A (Baseline 30 phút, tối thiểu 162 mẫu) -> POST /train.
  6. Pha B (Holdout bình thường 15 phút).
  7. Pha C (Fault Injection 20 phút): áp dụng lịch fault, đặt fault_end_ts = fault_start_ts + 1200s và chỉ chờ phần thời gian còn lại.
  8. Pha D (Phục hồi 10 phút, reset fault) -> dừng Load Generator.
  9. Drain Headless Poller và kiểm tra cổng toàn vẹn (Integrity Gate: 450 mẫu, gap <= 120s, đủ 5 method, non-null BCD).
 10. Chốt hoàn tất run (complete_run).
 11. Khối finally: dọn dẹp sạch fault, dừng container loadgen, dừng poller, đóng SSH và DB.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Đảm bảo đường dẫn import tương đối và tuyệt đối
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from experiments.adapters.deploy_adapter import (
    DeployAdapter,
    DeployError,
    DeployFailedError,
)
from experiments.adapters.loadgen_adapter import (
    LoadgenAdapter,
    LoadgenHandle,
    _exec_ssh,
)
from experiments.adapters.ml_client import (
    MlClient,
)
from experiments.adapters.poller_adapter import (
    PollerAdapter,
    PollerHandle,
)
from experiments.faults.scheduler import apply_plan, plan_fault, reset_fault
from experiments.protocol import (
    INTERVAL_S,
    PHASE_A_S,
    PHASE_B_S,
    PHASE_C_S,
    PHASE_D_S,
    check_integrity,
    clock_offset_ms,
    clock_skew_too_large,
    enough_train_samples,
)
from experiments.run_store import (
    abort_run,
    complete_run,
    count_phase_a_samples,
    normalize_ts,
    start_run,
    to_epoch_seconds,
    update_phase_schedule,
)

logger = logging.getLogger("experiments.runner")


class ExperimentError(Exception):
    """Lớp cơ sở cho toàn bộ các ngoại lệ trong orchestrator thí nghiệm."""


class ClockSkewError(ExperimentError):
    """Ném ra khi độ lệch đồng hồ giữa VPS và máy local vượt ngưỡng an toàn (>2000ms)."""


class InsufficientSamplesError(ExperimentError):
    """Ném ra khi số mẫu thu thập trong Pha A không đạt tối thiểu 162 mẫu (90% của 180)."""


class IntegrityError(ExperimentError):
    """Ném ra khi dữ liệu thí nghiệm không vượt qua cổng kiểm tra toàn vẹn (Integrity Gate)."""


class ExperimentAbortedError(ExperimentError):
    """Ném ra khi một attempt bị huỷ (aborted)."""

    def __init__(self, message: str, run_id: int, reason: str) -> None:
        super().__init__(message)
        self.run_id = run_id
        self.reason = reason


@dataclass(frozen=True)
class RunResult:
    """Kết quả hoàn tất hoặc huỷ bỏ của một attempt thí nghiệm."""

    run_id: int
    scenario: str
    repeat_index: int
    attempt_index: int
    vps_id: int | None
    deployment_id: int | None
    status: str  # "completed" | "aborted"
    abort_reason: str | None = None
    baseline_start_ts: str | None = None
    train_at_ts: str | None = None
    train_sample_count: int | None = None
    fault_start_ts: str | None = None
    fault_end_ts: str | None = None
    run_end_ts: str | None = None
    clock_offset_ms: int = 0


def measure_clock_offset_ms(
    ssh_client: Any | None = None,
    clock_fn: Callable[[], float] = time.time,
) -> int:
    """Đo độ lệch đồng hồ giữa VPS và máy local (vps_ms - local_ms)."""
    if ssh_client is None:
        return 0

    local_start = clock_fn() * 1000.0
    code, stdout, stderr = _exec_ssh(ssh_client, "date +%s%3N", timeout=5.0)
    local_end = clock_fn() * 1000.0

    if code != 0 or not stdout.strip():
        raise RuntimeError(
            f"Không thể đo đồng hồ VPS qua SSH (mã {code}): {stderr.strip() or stdout.strip()}"
        )

    vps_ms = float(stdout.strip())
    local_mid = (local_start + local_end) / 2.0
    return clock_offset_ms(vps_ms, local_mid)


def fetch_phase_a_samples_for_train(
    conn: sqlite3.Connection,
    deployment_id: int,
    baseline_start_ts: str | float,
    train_at_ts: str | float,
) -> list[dict[str, Any]]:
    """Truy vấn các mẫu metric_sample của Pha A [baseline_start_ts, train_at_ts) để nạp vào POST /train."""
    start_sec = to_epoch_seconds(baseline_start_ts)
    end_sec = to_epoch_seconds(train_at_ts)

    cur = conn.cursor()
    cur.execute(
        """
        SELECT ts_vps, seq, cpu_pct, mem_mb, mem_pct, mem_limit_mb,
               latency_ms, http_error_rate, db_response_ms, container_up,
               host_cpu_pct, host_mem_pct
        FROM metric_sample
        WHERE deployment_id = ?
        ORDER BY ts_vps ASC
        """,
        (deployment_id,),
    )
    samples: list[dict[str, Any]] = []
    for row in cur.fetchall():
        ts_vps = row[0] if not hasattr(row, "keys") else row["ts_vps"]
        if ts_vps is not None:
            sample_sec = to_epoch_seconds(ts_vps)
            if start_sec <= sample_sec < end_sec:
                samples.append(
                    {
                        "ts": str(ts_vps),
                        "seq": row[1] if not hasattr(row, "keys") else row["seq"],
                        "cpu_pct": row[2]
                        if not hasattr(row, "keys")
                        else row["cpu_pct"],
                        "mem_mb": row[3] if not hasattr(row, "keys") else row["mem_mb"],
                        "mem_pct": row[4]
                        if not hasattr(row, "keys")
                        else row["mem_pct"],
                        "mem_limit_mb": row[5]
                        if not hasattr(row, "keys")
                        else row["mem_limit_mb"],
                        "latency_ms": row[6]
                        if not hasattr(row, "keys")
                        else row["latency_ms"],
                        "http_error_rate": row[7]
                        if not hasattr(row, "keys")
                        else row["http_error_rate"],
                        "db_response_ms": row[8]
                        if not hasattr(row, "keys")
                        else row["db_response_ms"],
                        "container_up": row[9]
                        if not hasattr(row, "keys")
                        else row["container_up"],
                        "host_cpu_pct": row[10]
                        if not hasattr(row, "keys")
                        else row["host_cpu_pct"],
                        "host_mem_pct": row[11]
                        if not hasattr(row, "keys")
                        else row["host_mem_pct"],
                    }
                )
    return samples


def fetch_run_integrity_data(
    conn: sqlite3.Connection,
    deployment_id: int,
    baseline_start_ts: str | float,
    run_end_ts: str | float,
    train_at_ts: str | float,
) -> tuple[int, list[float], list[int], bool]:
    """Truy vấn dữ liệu từ SQLite phục vụ kiểm tra toàn vẹn check_integrity (Step 9)."""
    start_sec = to_epoch_seconds(baseline_start_ts)
    end_sec = to_epoch_seconds(run_end_ts)
    train_sec = to_epoch_seconds(train_at_ts)

    cur = conn.cursor()
    # Lấy danh sách metric_sample kèm số lượng score_sample của từng mẫu
    cur.execute(
        """
        SELECT m.id, m.ts_vps, COUNT(s.id) AS score_count
        FROM metric_sample m
        LEFT JOIN score_sample s ON s.metric_sample_id = m.id
        WHERE m.deployment_id = ?
        GROUP BY m.id
        ORDER BY m.ts_vps ASC
        """,
        (deployment_id,),
    )
    rows = cur.fetchall()

    filtered_samples: list[tuple[int, float, int]] = []
    for row in rows:
        m_id = row[0] if not hasattr(row, "keys") else row["id"]
        ts_raw = row[1] if not hasattr(row, "keys") else row["ts_vps"]
        score_count = row[2] if not hasattr(row, "keys") else row["score_count"]
        if ts_raw is not None:
            epoch = to_epoch_seconds(ts_raw)
            if start_sec <= epoch <= end_sec:
                filtered_samples.append((m_id, epoch, score_count))

    sample_count = len(filtered_samples)
    metric_timestamps = [epoch for _, epoch, _ in filtered_samples]
    scores_per_sample = [sc for _, _, sc in filtered_samples]

    # Kiểm tra score != null trong các pha B, C, D (ts_vps >= train_sec)
    cur.execute(
        """
        SELECT m.ts_vps, s.score
        FROM score_sample s
        JOIN metric_sample m ON s.metric_sample_id = m.id
        WHERE s.deployment_id = ?
        """,
        (deployment_id,),
    )
    score_rows = cur.fetchall()
    has_null_in_bcd = False
    for row in score_rows:
        ts_raw = row[0] if not hasattr(row, "keys") else row["ts_vps"]
        score_val = row[1] if not hasattr(row, "keys") else row["score"]
        if ts_raw is not None:
            epoch = to_epoch_seconds(ts_raw)
            if train_sec <= epoch <= end_sec and score_val is None:
                has_null_in_bcd = True
                break

    non_null_scores_in_bcd = (not has_null_in_bcd) and (sample_count > 0)
    return (
        sample_count,
        metric_timestamps,
        scores_per_sample,
        non_null_scores_in_bcd,
    )


def wait_with_checks(
    duration_s: float,
    check_interval_s: float = 10.0,
    loadgen_handle: LoadgenHandle | None = None,
    poller_handle: PollerHandle | None = None,
    sleeper_fn: Callable[[float], None] = time.sleep,
    clock_fn: Callable[[], float] = time.time,
) -> None:
    """Chờ trong khoảng duration_s, định kỳ kiểm tra trạng thái sống của loadgen và poller."""
    if duration_s <= 0:
        return
    start = clock_fn()
    target = start + duration_s
    while True:
        now = clock_fn()
        remaining = target - now
        if remaining <= 1e-6:
            break

        # Kiểm tra sống của loadgen và poller
        if loadgen_handle is not None:
            loadgen_handle.assert_running()
        if poller_handle is not None and not poller_handle.is_alive:
            last_err = poller_handle.get_last_error()
            raise RuntimeError(
                f"Headless Poller bị dừng bất thường trong quá trình chờ: {last_err or 'tiến trình đã thoát'}"
            )

        step = min(remaining, check_interval_s)
        prev = now
        sleeper_fn(step)
        if clock_fn() <= prev:
            break


def run_attempt(
    scenario: str,
    repeat_index: int,
    vps_id: int,
    db_path: Path | str,
    app_name: str,
    source_path: Path | str,
    app_url: str,
    ml_url: str = "http://127.0.0.1:8000",
    ssh_client: Any | None = None,
    deploy_adapter: DeployAdapter | None = None,
    ml_client: MlClient | None = None,
    poller_adapter: PollerAdapter | None = None,
    loadgen_adapter: LoadgenAdapter | None = None,
    apply_fault_fn: Callable[..., None] | None = None,
    reset_fault_fn: Callable[[str], bool] | None = None,
    clock_fn: Callable[[], float] = time.time,
    sleeper_fn: Callable[[float], None] = time.sleep,
    time_scale: float = 1.0,
    check_interval_s: float = 10.0,
    measure_clock_fn: Callable[..., int] | None = None,
    allow_pilot_4500: bool = True,
    loadgen_counter_mount_dir: str | None = None,
    custom_poller_cmd: Sequence[str] | None = None,
    custom_deploy_cmd: Sequence[str] | None = None,
    raise_on_abort: bool = False,
) -> RunResult:
    """Thực thi một attempt thí nghiệm theo đúng luồng 10 bước của TK-S6.

    Args:
        scenario: Kịch bản lỗi ("memory_leak", "cpu_spike", "error_burst", "slow_db", "latency_creep").
        repeat_index: Chỉ số lần lặp (1..N).
        vps_id: ID của VPS trong bảng vps.
        db_path: Đường dẫn tới file SQLite DB của thí nghiệm.
        app_name: Tên ứng dụng demo (ví dụ "demo-app").
        source_path: Thư mục nguồn của app demo trên máy local.
        app_url: URL truy cập app demo trên VPS (ví dụ "http://127.0.0.1:3000").
        ml_url: URL của ML Service (mặc định "http://127.0.0.1:8000").
        ssh_client: Client SSH kết nối tới VPS (hoặc Mock SSH).
        deploy_adapter: Adapter deploy app.
        ml_client: Client giao tiếp ML Service.
        poller_adapter: Adapter Headless Poller.
        loadgen_adapter: Adapter Load Generator.
        clock_fn: Hàm cung cấp mốc thời gian hiện tại (epoch seconds).
        sleeper_fn: Hàm chờ thời gian.
        time_scale: Hệ số co giãn thời gian (1.0 là thời gian thật, <1.0 cho test mô phỏng).
        check_interval_s: Khoảng chu kỳ kiểm tra trạng thái sống của tiến trình khi chờ.
        measure_clock_fn: Hàm đo clock skew (nếu muốn override).
        allow_pilot_4500: Cờ cho phép chạy loadgen 4500s.
        loadgen_counter_mount_dir: Thư mục mount counter trên host.
        custom_poller_cmd: Lệnh thực thi poller tuỳ biến.
        custom_deploy_cmd: Lệnh thực thi deploy CLI tuỳ biến.
        raise_on_abort: Nếu True, ném ngoại lệ khi attempt bị abort.

    Returns:
        RunResult chứa toàn bộ thông tin và kết quả của attempt.
    """
    db_file = Path(db_path).resolve()
    conn = sqlite3.connect(db_file)
    conn.execute("PRAGMA foreign_keys = ON;")

    run_id: int | None = None
    attempt_index: int = 1
    deployment_id: int | None = None
    poller_handle: PollerHandle | None = None
    loadgen_handle: LoadgenHandle | None = None
    offset_ms: int = 0

    baseline_start_ts: str | None = None
    train_at_ts: str | None = None
    sample_count_a: int | None = None
    fault_start_ts: str | None = None
    fault_end_ts: str | None = None
    run_end_ts: str | None = None

    _apply_fault = apply_fault_fn or apply_plan
    _reset_fault = reset_fault_fn or reset_fault

    try:
        # =========================================================================
        # BƯỚC 1: Khởi tạo bản ghi Attempt trong SQLite TRƯỚC mọi bước SSH/deploy
        # =========================================================================
        run_id = start_run(
            conn,
            scenario=scenario,
            repeat_index=repeat_index,
            deployment_id=None,
            vps_id=vps_id,
            auto_commit=True,
        )
        cur = conn.cursor()
        cur.execute("SELECT attempt_index FROM experiment_run WHERE id = ?", (run_id,))
        attempt_index = cur.fetchone()[0]
        logger.info(
            "Bắt đầu attempt %d cho run_id=%d (%s, repeat=%d)",
            attempt_index,
            run_id,
            scenario,
            repeat_index,
        )

        # =========================================================================
        # BƯỚC 2: Đo độ lệch đồng hồ (Clock Skew Gate)
        # =========================================================================
        if measure_clock_fn is not None:
            offset_ms = measure_clock_fn(ssh_client, clock_fn=clock_fn)
        else:
            offset_ms = measure_clock_offset_ms(ssh_client, clock_fn=clock_fn)

        cur.execute(
            "UPDATE experiment_run SET clock_offset_ms = ? WHERE id = ? AND status = 'running'",
            (offset_ms, run_id),
        )
        conn.commit()

        if clock_skew_too_large(offset_ms):
            reason = f"clock_skew_too_large: {offset_ms}ms"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ClockSkewError(
                f"Độ lệch đồng hồ quá lớn ({offset_ms}ms > 2000ms), đã huỷ attempt {attempt_index}"
            )

        # =========================================================================
        # BƯỚC 3: Deploy thật App Demo: gắn deployment_id ngay khi cấp và giữ failed nếu lỗi
        # =========================================================================
        d_adapter = deploy_adapter or DeployAdapter()
        try:
            deploy_res = d_adapter.deploy(
                conn=conn,
                run_id=run_id,
                vps_id=vps_id,
                app_name=app_name,
                source_path=source_path,
                db_path=db_file,
                cli_cmd=custom_deploy_cmd,
            )
            deployment_id = deploy_res.deployment_id
        except DeployFailedError as dfe:
            deployment_id = dfe.deployment_id
            raise
        except DeployError:
            raise

        # =========================================================================
        # BƯỚC 4: Chuẩn bị môi trường & Dọn dẹp trạng thái cũ
        # =========================================================================
        m_client = ml_client or MlClient(base_url=ml_url)
        m_client.reset_models(deployment_id=deployment_id)
        _reset_fault(app_url)

        p_adapter = poller_adapter or PollerAdapter()
        poller_handle = p_adapter.start(
            db_path=db_file,
            deployment_id=deployment_id,
            experiment_run_id=run_id,
            cli_cmd=custom_poller_cmd,
        )

        lg_adapter = loadgen_adapter or LoadgenAdapter()
        loadgen_handle = lg_adapter.start(
            app_url=app_url,
            rate_rps=5.0,
            duration_s=4500.0,
            allow_pilot_4500=allow_pilot_4500,
            app_name=app_name,
            ssh_client=ssh_client,
            counter_mount_dir=loadgen_counter_mount_dir,
        )
        loadgen_handle.assert_running()

        if not poller_handle.is_alive:
            raise RuntimeError(
                "Headless Poller không ở trạng thái sẵn sàng sau khi khởi chạy"
            )

        # =========================================================================
        # BƯỚC 5: Pha A (Thu thập Baseline 30 phút, tối thiểu 162 mẫu -> Train)
        # =========================================================================
        baseline_start_epoch = clock_fn() + (offset_ms / 1000.0)
        baseline_start_ts = normalize_ts(baseline_start_epoch)
        update_phase_schedule(
            conn, run_id, baseline_start_ts=baseline_start_ts, auto_commit=True
        )

        phase_a_dur = PHASE_A_S * time_scale
        wait_with_checks(
            phase_a_dur,
            check_interval_s=check_interval_s,
            loadgen_handle=loadgen_handle,
            poller_handle=poller_handle,
            sleeper_fn=sleeper_fn,
            clock_fn=clock_fn,
        )

        train_at_epoch = clock_fn() + (offset_ms / 1000.0)
        train_at_ts = normalize_ts(train_at_epoch)
        sample_count_a = count_phase_a_samples(
            conn, deployment_id, baseline_start_ts, train_at_ts
        )

        if not enough_train_samples(sample_count_a, minimum=180):
            reason = f"insufficient_phase_a_samples: {sample_count_a} < 162"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise InsufficientSamplesError(
                f"Pha A không đủ mẫu huấn luyện: {sample_count_a} < 162 mẫu (90% của 180)"
            )

        # Lấy mẫu huấn luyện và gọi POST /train
        train_samples = fetch_phase_a_samples_for_train(
            conn, deployment_id, baseline_start_ts, train_at_ts
        )
        m_client.train_models(deployment_id=deployment_id, samples=train_samples)
        update_phase_schedule(
            conn,
            run_id,
            train_at_ts=train_at_ts,
            train_sample_count=sample_count_a,
            auto_commit=True,
        )

        # =========================================================================
        # BƯỚC 6: Pha B (Holdout bình thường 15 phút)
        # =========================================================================
        phase_b_dur = PHASE_B_S * time_scale
        wait_with_checks(
            phase_b_dur,
            check_interval_s=check_interval_s,
            loadgen_handle=loadgen_handle,
            poller_handle=poller_handle,
            sleeper_fn=sleeper_fn,
            clock_fn=clock_fn,
        )

        # =========================================================================
        # BƯỚC 7: Pha C (Tác động lỗi Fault Injection 20 phút)
        # Quy tắc: fault_end_ts = fault_start_ts + 1200s, chỉ chờ phần thời gian còn lại
        # =========================================================================
        fault_start_epoch = clock_fn() + (offset_ms / 1000.0)
        fault_start_ts = normalize_ts(fault_start_epoch)
        update_phase_schedule(
            conn, run_id, fault_start_ts=fault_start_ts, auto_commit=True
        )

        fault_plan = plan_fault(scenario, duration_s=PHASE_C_S)
        _apply_fault(app_url, fault_plan, sleep_fn=sleeper_fn, now_fn=clock_fn)

        # Tính thời gian còn lại của Pha C
        elapsed_c = (clock_fn() + (offset_ms / 1000.0)) - fault_start_epoch
        remaining_c = max(0.0, (PHASE_C_S * time_scale) - elapsed_c)
        if remaining_c > 0:
            wait_with_checks(
                remaining_c,
                check_interval_s=check_interval_s,
                loadgen_handle=loadgen_handle,
                poller_handle=poller_handle,
                sleeper_fn=sleeper_fn,
                clock_fn=clock_fn,
            )

        fault_end_epoch = fault_start_epoch + (PHASE_C_S * time_scale)
        fault_end_ts = normalize_ts(fault_end_epoch)
        update_phase_schedule(conn, run_id, fault_end_ts=fault_end_ts, auto_commit=True)

        # =========================================================================
        # BƯỚC 8: Pha D (Phục hồi 10 phút, reset fault) -> Dừng Load Generator
        # =========================================================================
        _reset_fault(app_url)
        phase_d_dur = PHASE_D_S * time_scale
        wait_with_checks(
            phase_d_dur,
            check_interval_s=check_interval_s,
            loadgen_handle=loadgen_handle,
            poller_handle=poller_handle,
            sleeper_fn=sleeper_fn,
            clock_fn=clock_fn,
        )

        # Dừng Load Generator ở cuối Pha D
        loadgen_handle.stop()

        # =========================================================================
        # BƯỚC 9: Draining dữ liệu & Cổng kiểm tra toàn vẹn (Integrity Gate)
        # =========================================================================
        poller_handle.drain(timeout_s=30.0)

        run_end_epoch = clock_fn() + (offset_ms / 1000.0)
        run_end_ts = normalize_ts(run_end_epoch)

        (
            tot_samples,
            metric_ts_list,
            scores_per_sample,
            non_null_bcd,
        ) = fetch_run_integrity_data(
            conn=conn,
            deployment_id=deployment_id,
            baseline_start_ts=baseline_start_ts,
            run_end_ts=run_end_ts,
            train_at_ts=train_at_ts,
        )

        report = check_integrity(
            sample_count=tot_samples,
            metric_timestamps=metric_ts_list,
            scores_per_sample=scores_per_sample,
            non_null_scores_in_bcd=non_null_bcd,
            interval_s=INTERVAL_S,
        )

        if not report.ok:
            reason = report.reasons[0] if report.reasons else "integrity_gate_failed"
            abort_run(
                conn,
                run_id,
                reason=f"integrity_failed: {reason}",
                auto_commit=True,
            )
            raise IntegrityError(
                f"Kiểm tra toàn vẹn thất bại: {'; '.join(report.reasons)}"
            )

        # =========================================================================
        # BƯỚC 10: Chốt hoàn thành run (complete_run)
        # =========================================================================
        complete_run(conn, run_id, run_end_ts=run_end_ts, auto_commit=True)

        return RunResult(
            run_id=run_id,
            scenario=scenario,
            repeat_index=repeat_index,
            attempt_index=attempt_index,
            vps_id=vps_id,
            deployment_id=deployment_id,
            status="completed",
            baseline_start_ts=baseline_start_ts,
            train_at_ts=train_at_ts,
            train_sample_count=sample_count_a,
            fault_start_ts=fault_start_ts,
            fault_end_ts=fault_end_ts,
            run_end_ts=run_end_ts,
            clock_offset_ms=offset_ms,
        )

    except BaseException as exc:
        # Xử lý dọn dẹp và abort_run nếu chưa được abort
        abort_reason_str = str(exc)
        if run_id is not None:
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT status, abort_reason, deployment_id FROM experiment_run WHERE id = ?",
                    (run_id,),
                )
                row = cur.fetchone()
                if row:
                    curr_st = row[0]
                    curr_reason = row[1]
                    curr_dep = row[2]
                    if deployment_id is None and curr_dep is not None:
                        deployment_id = curr_dep
                    if curr_st == "running":
                        abort_run(
                            conn,
                            run_id,
                            reason=abort_reason_str,
                            auto_commit=True,
                        )
                    elif curr_reason:
                        abort_reason_str = curr_reason
            except (sqlite3.Error, OSError) as store_err:
                logger.error(
                    "Lỗi khi kiểm tra/cập nhật abort_run trong except: %s",
                    store_err,
                )

        if raise_on_abort:
            if isinstance(exc, ExperimentError):
                raise
            raise ExperimentAbortedError(
                f"Attempt {attempt_index} bị huỷ: {abort_reason_str}",
                run_id=run_id or 0,
                reason=abort_reason_str,
            ) from exc

        return RunResult(
            run_id=run_id or 0,
            scenario=scenario,
            repeat_index=repeat_index,
            attempt_index=attempt_index,
            vps_id=vps_id,
            deployment_id=deployment_id,
            status="aborted",
            abort_reason=abort_reason_str,
            baseline_start_ts=baseline_start_ts,
            train_at_ts=train_at_ts,
            train_sample_count=sample_count_a,
            fault_start_ts=fault_start_ts,
            fault_end_ts=fault_end_ts,
            run_end_ts=run_end_ts,
            clock_offset_ms=offset_ms,
        )

    finally:
        # Khối finally dọn dẹp sạch sẽ tài nguyên, app fault, container và tiến trình
        try:
            _reset_fault(app_url)
        except Exception as e:  # noqa: BLE001
            logger.debug("Bỏ qua lỗi khi reset_fault trong finally: %s", e)

        if loadgen_handle is not None:
            try:
                loadgen_handle.cleanup()
            except (OSError, RuntimeError) as e:
                logger.debug("Bỏ qua lỗi khi loadgen cleanup trong finally: %s", e)

        if poller_handle is not None and poller_handle.is_alive:
            try:
                poller_handle.stop()
            except (OSError, RuntimeError) as e:
                logger.debug("Bỏ qua lỗi khi poller stop trong finally: %s", e)

        try:
            conn.close()
        except sqlite3.Error as e:
            logger.debug("Bỏ qua lỗi khi đóng SQLite connection trong finally: %s", e)


def run_experiment(
    scenario: str,
    repeat_index: int,
    vps_id: int,
    db_path: Path | str,
    app_name: str,
    source_path: Path | str,
    app_url: str,
    max_attempts: int = 3,
    **kwargs: Any,
) -> RunResult:
    """Điều phối toàn bộ quá trình chạy thí nghiệm, tự động retry khi attempt trước bị abort (tối đa max_attempts lần)."""
    last_res: RunResult | None = None
    for attempt in range(1, max_attempts + 1):
        res = run_attempt(
            scenario=scenario,
            repeat_index=repeat_index,
            vps_id=vps_id,
            db_path=db_path,
            app_name=app_name,
            source_path=source_path,
            app_url=app_url,
            raise_on_abort=False,
            **kwargs,
        )
        last_res = res
        if res.status == "completed":
            logger.info(
                "Run hoàn thành thành công tại attempt %d (run_id=%d)",
                attempt,
                res.run_id,
            )
            return res

        logger.warning(
            "Attempt %d bị huỷ (run_id=%d, lý do: %s).",
            attempt,
            res.run_id,
            res.abort_reason,
        )
        if attempt < max_attempts:
            logger.info("Thử lại với attempt %d...", attempt + 1)

    if last_res is not None:
        return last_res
    raise RuntimeError(
        f"Toàn bộ {max_attempts} attempts đều thất bại cho scenario={scenario}, repeat={repeat_index}"
    )


def build_parser() -> argparse.ArgumentParser:
    """Xây dựng parser dòng lệnh cho script run_experiment."""
    parser = argparse.ArgumentParser(
        description="OpsPilot Experiment Orchestrator (TK-S6)"
    )
    parser.add_argument(
        "--scenario",
        required=True,
        choices=[
            "memory_leak",
            "cpu_spike",
            "error_burst",
            "slow_db",
            "latency_creep",
        ],
        help="Kịch bản lỗi cần kiểm thử",
    )
    parser.add_argument("--repeat", type=int, default=1, help="Chỉ số lặp (1..N)")
    parser.add_argument("--vps-id", type=int, default=1, help="ID của VPS")
    parser.add_argument("--db-path", required=True, help="Đường dẫn file SQLite DB")
    parser.add_argument("--app-name", default="express-api", help="Tên ứng dụng demo")
    parser.add_argument(
        "--source-path",
        default="demo-apps/express-api",
        help="Đường dẫn mã nguồn demo app",
    )
    parser.add_argument(
        "--app-url", required=True, help="URL truy cập app demo trên VPS"
    )
    parser.add_argument(
        "--ml-url", default="http://127.0.0.1:8000", help="URL của ML Service"
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=3,
        help="Số lần thử tối đa (1..3)",
    )
    return parser


if __name__ == "__main__":  # pragma: no cover
    args = build_parser().parse_args()
    logging.basicConfig(level=logging.INFO)
    result = run_experiment(
        scenario=args.scenario,
        repeat_index=args.repeat,
        vps_id=args.vps_id,
        db_path=args.db_path,
        app_name=args.app_name,
        source_path=args.source_path,
        app_url=args.app_url,
        ml_url=args.ml_url,
        max_attempts=args.max_attempts,
    )
    print(
        f"KẾT QUẢ RUN: status={result.status}, attempt={result.attempt_index}, run_id={result.run_id}"
    )
    if result.status != "completed":
        sys.exit(1)
