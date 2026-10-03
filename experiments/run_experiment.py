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
import inspect
import logging
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import types
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Self

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


class SshError(ExperimentError):
    """Ngoại lệ chung cho lỗi kết nối hoặc thực thi SSH."""


class UnsupportedAppError(ExperimentError):
    """Ném ra khi ứng dụng không được hỗ trợ trong orchestrator thí nghiệm pilot."""


class UnsupportedAuthTypeError(SshError):
    """Ném ra khi kiểu xác thực SSH chưa được hỗ trợ (ví dụ: password với OpenSSH CLI)."""


class SshAuthenticationError(SshError):
    """Ném ra khi xác thực SSH thất bại (sai key, permission denied)."""


class SshHostKeyError(SshError):
    """Ném ra khi kiểm tra host key thất bại (Host key verification failed)."""


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


class SystemSshClient:
    """SSH Client thực thi lệnh từ xa bằng công cụ ssh của hệ thống (OpenSSH).

    Bảo mật:
      - Tuyệt đối không in, ghi log hoặc lưu raw credential ra đĩa hoặc DB.
      - Sử dụng temporary file phân quyền chặt (0600) khi credential là private key string và dọn dẹp khi đóng.
      - __repr__ và chuỗi ngoại lệ tự động khử / ẩn secret (hiển thị '******').
      - Bắt buộc kiểm tra host key (StrictHostKeyChecking=yes), không tắt host key checking.
      - Chỉ hỗ trợ kiểu xác thực 'key'; từ chối kiểu 'password' chưa hỗ trợ non-interactively.
    """

    def __init__(
        self,
        host: str,
        port: int = 22,
        username: str = "root",
        auth_type: str = "key",
        secret: str | None = None,
        key_file: str | Path | None = None,
        known_hosts_file: str | Path | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.host = host or "127.0.0.1"
        self.port = int(port or 22)
        self.username = username or "root"
        self.auth_type = auth_type or "key"
        self._secret = secret
        self.timeout = float(timeout)
        self.known_hosts_file = str(known_hosts_file) if known_hosts_file else None

        if self.auth_type != "key":
            raise UnsupportedAuthTypeError(
                f"Unsupported SSH auth_type '{self.auth_type}': OpenSSH CLI only supports 'key' authentication non-interactively"
            )

        self._temp_dir: tempfile.TemporaryDirectory[str] | None = None
        self._effective_key_file: Path | None = None

        if key_file is not None:
            self._effective_key_file = Path(key_file)
        elif self._secret:
            try:
                candidate = Path(self._secret)
                if candidate.is_file():
                    self._effective_key_file = candidate
                else:
                    self._create_temp_key_file(self._secret)
            except OSError:
                self._create_temp_key_file(self._secret)

    def _create_temp_key_file(self, content: str) -> None:
        self._temp_dir = tempfile.TemporaryDirectory(prefix="opspilot_ssh_")
        key_path = Path(self._temp_dir.name) / "id_rsa"
        key_path.write_text(content, encoding="utf-8")
        try:
            os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        self._effective_key_file = key_path

    def close(self) -> None:
        """Dọn dẹp temporary key file và thư mục tạm nếu có."""
        if self._temp_dir is not None:
            try:
                self._temp_dir.cleanup()
            except OSError:
                pass
            self._temp_dir = None

    def __del__(self) -> None:
        self.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: types.TracebackType | None,
    ) -> None:
        self.close()

    def __repr__(self) -> str:
        return (
            f"<SystemSshClient host={self.host!r} port={self.port} "
            f"user={self.username!r} auth_type={self.auth_type!r} secret=******>"
        )

    def exec(self, cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        """Thực thi lệnh shell trên VPS qua ssh binary."""
        effective_timeout = timeout if timeout is not None else self.timeout
        ssh_args = [
            "ssh",
            "-p",
            str(self.port),
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
        ]
        if self._effective_key_file is not None:
            ssh_args.extend(
                [
                    "-i",
                    str(self._effective_key_file),
                    "-o",
                    "IdentitiesOnly=yes",
                ]
            )
        if self.known_hosts_file is not None:
            ssh_args.extend(
                [
                    "-o",
                    f"UserKnownHostsFile={self.known_hosts_file}",
                ]
            )
        ssh_args.extend(
            [
                "-o",
                f"ConnectTimeout={max(1, int(min(effective_timeout, 10)))}",
                f"{self.username}@{self.host}",
                cmd,
            ]
        )
        try:
            res = subprocess.run(
                ssh_args,
                capture_output=True,
                text=True,
                timeout=effective_timeout,
                check=False,
            )
            stdout = res.stdout
            stderr = res.stderr
            if self._secret:
                stdout = stdout.replace(self._secret, "******")
                stderr = stderr.replace(self._secret, "******")
            return res.returncode, stdout, stderr
        except subprocess.TimeoutExpired:
            return 124, "", f"SSH command timed out after {effective_timeout}s"
        except Exception as e:  # noqa: BLE001
            err_msg = str(e)
            if self._secret:
                err_msg = err_msg.replace(self._secret, "******")
            return 1, "", f"SSH execution error: {err_msg}"

    def exec_command(self, cmd: str, timeout: float = 15.0) -> tuple[int, str, str]:
        """Hỗ trợ giao diện tương thích Paramiko / _exec_ssh."""
        return self.exec(cmd, timeout=timeout)

    def verify_connection(self, timeout: float = 10.0) -> None:
        """Xác thực kết nối SSH thật sự tới host trước khi tiếp tục.

        Chạy một lệnh no-op ('true') để kiểm tra tính hợp lệ của credential và host key.
        Ném ra ngoại lệ tương ứng nếu xác thực hoặc kiểm tra host key thất bại.
        """
        code, _stdout, stderr = self.exec("true", timeout=timeout)
        if code == 0:
            return

        lower_err = stderr.lower()
        if (
            "host key verification failed" in lower_err
            or "host identification has changed" in lower_err
            or "no hostkey alg" in lower_err
        ):
            raise SshHostKeyError(
                f"SSH Host Key verification failed for {self.username}@{self.host}:{self.port}: {stderr.strip()}"
            )

        if "permission denied" in lower_err or "authentication failed" in lower_err:
            raise SshAuthenticationError(
                f"SSH authentication failed for {self.username}@{self.host}:{self.port}: {stderr.strip()}"
            )

        raise SshError(
            f"SSH connection failed (code {code}) for {self.username}@{self.host}:{self.port}: {stderr.strip()}"
        )


def resolve_ssh_client(
    conn: sqlite3.Connection,
    vps_id: int,
    ssh_key_file: str | Path | None = None,
    ssh_secret: str | None = None,
    ssh_client: Any | None = None,
    known_hosts_file: str | Path | None = None,
) -> Any | None:
    """Xác định SSH client hợp lệ từ vps table và credential an toàn.

    Bảo mật:
      - Không in hoặc lưu credential ra màn hình/log/đĩa/DB.
      - Ưu tiên:
        1. ssh_client truyền tường minh.
        2. Tạo SystemSshClient từ bản ghi vps kết hợp key_file hoặc secret từ:
           - Tham số ssh_key_file hoặc biến môi trường OPSPILOT_SSH_KEY_FILE
           - Tham số ssh_secret hoặc biến môi trường OPSPILOT_SSH_SECRET, OPSPILOT_DEPLOY_SECRET
      - Kiểm tra auth_type từ vps table; từ chối rõ kiểu chưa hỗ trợ (ví dụ 'password').
      - Trả về None nếu không đủ thông tin kết nối an toàn.
    """
    if ssh_client is not None:
        return ssh_client

    effective_key_file = ssh_key_file or os.environ.get("OPSPILOT_SSH_KEY_FILE")
    effective_secret = (
        ssh_secret
        or os.environ.get("OPSPILOT_SSH_SECRET")
        or os.environ.get("OPSPILOT_DEPLOY_SECRET")
    )
    if not effective_key_file and (
        not effective_secret or not str(effective_secret).strip()
    ):
        return None

    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT host, port, username, auth_type FROM vps WHERE id = ?",
            (vps_id,),
        )
        row = cur.fetchone()
    except (sqlite3.Error, OSError):
        return None

    if not row:
        return None

    host = row[0] or "127.0.0.1"
    port = int(row[1] or 22)
    username = row[2] or "root"
    auth_type = row[3] or "key"

    if auth_type != "key":
        raise UnsupportedAuthTypeError(
            f"Unsupported SSH auth_type '{auth_type}': only 'key' authentication is supported"
        )

    effective_known_hosts = known_hosts_file or os.environ.get("OPSPILOT_KNOWN_HOSTS")

    return SystemSshClient(
        host=host,
        port=port,
        username=username,
        auth_type=auth_type,
        secret=str(effective_secret).strip() if effective_secret else None,
        key_file=effective_key_file,
        known_hosts_file=effective_known_hosts,
    )


def measure_clock_offset_ms(
    ssh_client: Any | None = None,
    clock_fn: Callable[[], float] = time.time,
) -> int:
    """Đo độ lệch đồng hồ giữa VPS và máy local (vps_ms - local_ms)."""
    if ssh_client is None:
        raise ValueError("Yêu cầu ssh_client hợp lệ để đo độ lệch đồng hồ VPS")

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
            err_msg: str | None = None
            if hasattr(poller_handle, "get_last_error"):
                err_msg = poller_handle.get_last_error()
            elif hasattr(poller_handle, "proc") and poller_handle.proc is not None:
                ret = poller_handle.proc.poll()
                err_msg = f"tiến trình đã thoát (exit_code={ret})"
            raise RuntimeError(
                f"Headless Poller bị dừng bất thường trong quá trình chờ: {err_msg or 'tiến trình đã thoát'}"
            )

        step = min(remaining, check_interval_s)
        prev = now
        sleeper_fn(step)
        now_after = clock_fn()
        if now_after <= prev:
            raise RuntimeError(
                f"Đồng hồ không tiến sau khi chờ {step}s (prev={prev}, now={now_after})"
            )


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
    ssh_key_file: str | Path | None = None,
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
    allow_pilot_4500: bool = False,
    ssh_secret: str | None = None,
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
        ssh_key_file: Đường dẫn file SSH private key (hoặc đọc từ OPSPILOT_SSH_KEY_FILE).
        deploy_adapter: Adapter deploy app.
        ml_client: Client giao tiếp ML Service.
        poller_adapter: Adapter Headless Poller.
        loadgen_adapter: Adapter Load Generator.
        clock_fn: Hàm cung cấp mốc thời gian hiện tại (epoch seconds).
        sleeper_fn: Hàm chờ thời gian.
        time_scale: Hệ số co giãn thời gian (1.0 là thời gian thật, <1.0 cho test mô phỏng).
        check_interval_s: Khoảng chu kỳ kiểm tra trạng thái sống của tiến trình khi chờ.
        measure_clock_fn: Hàm đo clock skew (nếu muốn override).
        allow_pilot_4500: Cờ cho phép chạy loadgen 4500s (mặc định False, phải bật tường minh).
        ssh_secret: SSH secret (nếu không đọc từ env OPSPILOT_SSH_SECRET / OPSPILOT_DEPLOY_SECRET).
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

        # Runner/CLI phải có SSH client hợp lệ trước clock gate; thiếu SSH thì abort có lý do, không trả offset 0 và không chạy loadgen local
        resolved_ssh_secret = (
            ssh_secret
            or os.environ.get("OPSPILOT_SSH_SECRET")
            or os.environ.get("OPSPILOT_DEPLOY_SECRET")
        )
        resolved_key_file = ssh_key_file or os.environ.get("OPSPILOT_SSH_KEY_FILE")
        if ssh_client is None:
            try:
                ssh_client = resolve_ssh_client(
                    conn,
                    vps_id=vps_id,
                    ssh_key_file=resolved_key_file,
                    ssh_secret=resolved_ssh_secret,
                )
            except UnsupportedAuthTypeError as e:
                reason = f"unsupported_auth_type: {e}"
                abort_run(conn, run_id, reason=reason, auto_commit=True)
                raise ExperimentError(reason) from e

        if ssh_client is None:
            reason = "missing_ssh_client: Yêu cầu SSH client hợp lệ để kết nối VPS"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(reason)

        # Xác thực kết nối SSH thật sự theo auth_type và host key; không coi việc tạo client là đã kết nối
        if hasattr(ssh_client, "verify_connection") and callable(
            ssh_client.verify_connection
        ):
            try:
                ssh_client.verify_connection()
            except UnsupportedAuthTypeError as e:
                reason = f"unsupported_auth_type: {e}"
                abort_run(conn, run_id, reason=reason, auto_commit=True)
                raise ExperimentError(reason) from e
            except SshHostKeyError as e:
                reason = f"ssh_host_key_error: {e}"
                abort_run(conn, run_id, reason=reason, auto_commit=True)
                raise ExperimentError(reason) from e
            except SshAuthenticationError as e:
                reason = f"ssh_auth_error: {e}"
                abort_run(conn, run_id, reason=reason, auto_commit=True)
                raise ExperimentError(reason) from e
            except SshError as e:
                reason = f"ssh_connect_error: {e}"
                abort_run(conn, run_id, reason=reason, auto_commit=True)
                raise ExperimentError(reason) from e

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
        # Từ chối run 75 phút trước deploy nếu chưa bật pilot tường minh
        if not allow_pilot_4500:
            reason = "pilot_mode_required: Chạy thí nghiệm 75 phút (4500s) bắt buộc bật cờ allow_pilot_4500 tường minh"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(reason)

        # Chỉ hỗ trợ pilot cho ứng dụng express-api (không bật cho app khác)
        if app_name != "express-api":
            reason = f"unsupported_pilot_app: Ứng dụng '{app_name}' không hỗ trợ thí nghiệm pilot (chỉ hỗ trợ 'express-api')"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise UnsupportedAppError(reason)

        deploy_env_vars: dict[str, str] | None = None
        if allow_pilot_4500 and app_name == "express-api":
            deploy_env_vars = {"ENABLE_FAULT_ENDPOINTS": "true"}

        d_adapter = deploy_adapter or DeployAdapter()
        try:
            deploy_res = d_adapter.deploy(
                conn=conn,
                run_id=run_id,
                vps_id=vps_id,
                app_name=app_name,
                source_path=source_path,
                db_path=db_file,
                env_vars=deploy_env_vars,
                ssh_secret=resolved_ssh_secret,
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

        try:
            reset_ok = _reset_fault(app_url)
        except Exception as e:  # noqa: BLE001
            reset_ok = False
            reset_err = str(e)
        else:
            reset_err = "status != 200"

        if not reset_ok:
            reason = f"reset_fault_failed: {reset_err}"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(f"Không thể reset fault trước khi chạy: {reset_err}")

        p_adapter = poller_adapter or PollerAdapter()
        poller_handle = p_adapter.start(
            conn=conn,
            db_path=db_file,
            ml_url=ml_url,
            ssh_secret=resolved_ssh_secret,
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

        def phase_c_check() -> None:
            if loadgen_handle is not None:
                loadgen_handle.assert_running()
            if poller_handle is not None and not poller_handle.is_alive:
                err_msg: str | None = None
                if hasattr(poller_handle, "get_last_error"):
                    err_msg = poller_handle.get_last_error()
                elif hasattr(poller_handle, "proc") and poller_handle.proc is not None:
                    ret = poller_handle.proc.poll()
                    err_msg = f"tiến trình đã thoát (exit_code={ret})"
                raise RuntimeError(
                    f"Headless Poller bị dừng bất thường trong Pha C: {err_msg or 'tiến trình đã thoát'}"
                )

        try:
            apply_kwargs: dict[str, Any] = {
                "sleep_fn": sleeper_fn,
                "now_fn": clock_fn,
            }
            sig = inspect.signature(_apply_fault)
            if "check_fn" in sig.parameters or any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
            ):
                apply_kwargs["check_fn"] = phase_c_check
            _apply_fault(app_url, fault_plan, **apply_kwargs)
        except Exception as e:
            reason = f"apply_fault_failed: {e}"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(f"Áp dụng fault thất bại: {e}") from e

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
        try:
            reset_ok = _reset_fault(app_url)
        except Exception as e:  # noqa: BLE001
            reset_ok = False
            reset_err = str(e)
        else:
            reset_err = "status != 200"

        if not reset_ok:
            reason = f"reset_fault_failed: {reset_err}"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(f"Không thể reset fault ở đầu Pha D: {reset_err}")

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
        try:
            loadgen_handle.stop()
        except Exception as e:
            reason = f"loadgen_stop_failed: {e}"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(f"Dừng load generator thất bại: {e}") from e

        # =========================================================================
        # BƯỚC 9: Draining dữ liệu & Cổng kiểm tra toàn vẹn (Integrity Gate)
        # =========================================================================
        try:
            drain_res = poller_handle.drain(timeout_s=30.0)
            if drain_res.status != "drained" or drain_res.exit_code != 0:
                raise RuntimeError(
                    f"drain thất bại với status={drain_res.status}, exit_code={drain_res.exit_code}"
                )
        except Exception as e:
            reason = f"poller_drain_failed: {e}"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(f"Drain poller thất bại: {e}") from e

        # Dọn dẹp container loadgen và kiểm tra cleanup thành công trước khi hoàn thành run
        try:
            loadgen_handle.cleanup()
        except Exception as e:
            reason = f"loadgen_cleanup_failed: {e}"
            abort_run(conn, run_id, reason=reason, auto_commit=True)
            raise ExperimentError(f"Dọn dẹp container loadgen thất bại: {e}") from e

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
            except Exception as e:  # noqa: BLE001
                logger.debug("Bỏ qua lỗi khi loadgen cleanup trong finally: %s", e)

        if poller_handle is not None and poller_handle.is_alive:
            try:
                poller_handle.stop()
            except Exception as e:  # noqa: BLE001
                logger.debug("Bỏ qua lỗi khi poller stop trong finally: %s", e)

        if (
            ssh_client is not None
            and hasattr(ssh_client, "close")
            and callable(ssh_client.close)
        ):
            try:
                ssh_client.close()
            except Exception as e:  # noqa: BLE001
                logger.debug("Bỏ qua lỗi khi đóng ssh_client trong finally: %s", e)

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
    allow_pilot_4500: bool = False,
    ssh_key_file: str | Path | None = None,
    ssh_secret: str | None = None,
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
            allow_pilot_4500=allow_pilot_4500,
            ssh_key_file=ssh_key_file,
            ssh_secret=ssh_secret,
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
    parser.add_argument(
        "--allow-pilot-4500",
        "--pilot",
        action="store_true",
        default=False,
        help="Bật chế độ pilot chạy tối đa 4500s (75 phút)",
    )
    parser.add_argument(
        "--ssh-key-file",
        default=None,
        help="Đường dẫn file SSH private key để xác thực kết nối VPS an toàn (không truyền raw secret qua argv)",
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
        allow_pilot_4500=args.allow_pilot_4500,
        ssh_key_file=args.ssh_key_file,
    )
    print(
        f"KẾT QUẢ RUN: status={result.status}, attempt={result.attempt_index}, run_id={result.run_id}"
    )
    if result.status != "completed":
        sys.exit(1)
