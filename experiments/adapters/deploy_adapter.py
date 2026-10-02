"""DeployAdapter: Điều phối quy trình deploy app demo lên VPS qua CLI TypeScript và DeployPipeline.

Ràng buộc và quy tắc (TK-S6 P2d-1b):
  1. Sử dụng cùng cơ sở dữ liệu SQLite: Không tự tạo deployment bằng SQL thuần và không dùng
     DB tạm (như try-deploy.ts). Gọi CLI TypeScript mỏng vận hành trên chính file DB của thí nghiệm.
  2. Gắn deployment_id ngay khi nhận ID:
     CLI phát thông điệp máy đọc được 'assigned' kèm deployment_id. Adapter lập tức gọi
     attach_deployment_id(conn, run_id, deployment_id) để gắn vào experiment_run đang running.
  3. Chờ kết quả và xử lý lỗi:
     - Nếu deploy thành công (finished với status='running'): trả về DeployResult.
     - Nếu deploy thất bại (finished với status='failed'): giữ nguyên bản ghi deployment failed
       trong SQLite (audit trail), gọi abort_run(conn, run_id, reason=...), và ném DeployFailedError.
     - Nếu lỗi trước khi có ID (CLI lỗi pre-check/validation/crashes trước khi phát assigned):
       gọi abort_run(conn, run_id, reason=...), ném DeployPreIdError.
     - Nếu timeout: terminate tiến trình CLI, gọi abort_run(conn, run_id, reason=...), ném DeployTimeoutError.
     - Nếu output sai định dạng / process crash bất thường: gọi abort_run(conn, run_id, reason=...),
       ném DeployProtocolError.
  4. Bảo mật credential:
     Tuyệt đối không log, in hoặc đưa SSH secret/password vào exception message hay CLI command line
     (nếu truyền cho subprocess, truyền qua biến môi trường OPSPILOT_SSH_SECRET).
"""

from __future__ import annotations

import json
import os
import queue
import sqlite3
import subprocess
import threading
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from experiments.run_store import RunStoreError, abort_run, attach_deployment_id


class DeployError(Exception):
    """Lỗi cơ sở cho toàn bộ các sự cố trong quy trình deploy."""


class DeployPreIdError(DeployError):
    """Lỗi xảy ra trước khi pipeline tạo và cấp deployment_id (validation, detect, thiếu VPS...)."""


class DeployFailedError(DeployError):
    """Lỗi xảy ra trong quá trình deploy sau khi đã có deployment_id (status='failed').

    Bản ghi deployment ở trạng thái 'failed' được giữ lại trong DB để đối soát.
    """

    def __init__(self, message: str, deployment_id: int | None = None) -> None:
        super().__init__(message)
        self.deployment_id = deployment_id


class DeployTimeoutError(DeployError):
    """Lỗi timeout khi chờ CLI thực thi."""

    def __init__(self, message: str, deployment_id: int | None = None) -> None:
        super().__init__(message)
        self.deployment_id = deployment_id


class DeployProtocolError(DeployError):
    """Lỗi output CLI sai định dạng hoặc kết thúc bất thường không đúng giao thức."""

    def __init__(self, message: str, deployment_id: int | None = None) -> None:
        super().__init__(message)
        self.deployment_id = deployment_id


@dataclass(frozen=True)
class DeployResult:
    """Kết quả deploy thành công từ DeployAdapter."""

    deployment_id: int
    status: str
    app_url: str | None = None
    total_duration_ms: float | None = None
    steps: Sequence[dict[str, Any]] = ()


def resolve_db_path(
    conn: sqlite3.Connection,
    explicit_path: str | Path | None = None,
) -> Path:
    """Xác định đường dẫn file SQLite DB từ tham số tường minh hoặc connection."""
    if explicit_path is not None:
        p = Path(explicit_path).resolve()
        return p

    rows = conn.execute("PRAGMA database_list").fetchall()
    for row in rows:
        name = row[1] if not hasattr(row, "keys") else row["name"]
        file_path = row[2] if not hasattr(row, "keys") else row["file"]
        if name == "main" and file_path:
            return Path(file_path).resolve()

    raise ValueError(
        "Không thể tự động xác định file SQLite DB từ connection (có thể do dùng in-memory ':memory:'). "
        "Hãy truyền db_path tường minh cho DeployAdapter."
    )


def get_default_cli_cmd() -> list[str]:
    """Tìm lệnh mặc định để gọi CLI deploy-cli.ts qua Electron/Node."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    app_dir = repo_root / "app"
    compiled_cli = app_dir / ".out-scripts" / "scripts" / "deploy-cli.js"
    run_as_node = app_dir / "scripts" / "run-as-node.js"

    if run_as_node.exists() and compiled_cli.exists():
        return ["node", str(run_as_node), str(compiled_cli)]
    return ["node", str(compiled_cli)]


class DeployAdapter:
    """Adapter điều phối DeployPipeline qua CLI TypeScript và SQLite DB."""

    def __init__(
        self,
        default_cli_cmd: Sequence[str] | None = None,
        default_timeout_s: float = 300.0,
    ) -> None:
        self.default_cli_cmd = (
            list(default_cli_cmd) if default_cli_cmd is not None else None
        )
        self.default_timeout_s = float(default_timeout_s)

    def deploy(
        self,
        conn: sqlite3.Connection,
        run_id: int,
        vps_id: int,
        app_name: str,
        source_path: str | Path,
        db_path: str | Path | None = None,
        app_id: int | None = None,
        host_port: int | None = None,
        env_vars: Mapping[str, str] | None = None,
        ssh_secret: str | None = None,
        timeout_s: float | None = None,
        cli_cmd: Sequence[str] | None = None,
    ) -> DeployResult:
        """Thực hiện deploy app demo lên VPS, gắn deployment_id ngay khi nhận ID và theo dõi kết quả."""
        if type(run_id) is not int or run_id <= 0:
            raise ValueError("run_id phải là số nguyên dương")
        if type(vps_id) is not int or vps_id <= 0:
            raise ValueError("vps_id phải là số nguyên dương")
        if not app_name or not app_name.strip():
            raise ValueError("app_name không được để trống")

        source_path_resolved = Path(source_path).resolve()
        target_db_path = resolve_db_path(conn, db_path)
        effective_timeout = (
            float(timeout_s) if timeout_s is not None else self.default_timeout_s
        )

        # 1. Chuẩn bị command line (TUYỆT ĐỐI KHÔNG ĐƯA CREDENTIAL VÀO CMD)
        base_cmd = list(
            cli_cmd
            if cli_cmd is not None
            else (self.default_cli_cmd or get_default_cli_cmd())
        )
        cmd = list(base_cmd)
        cmd.extend(["--db", str(target_db_path)])
        cmd.extend(["--vps-id", str(vps_id)])
        cmd.extend(["--app-name", app_name.strip()])
        cmd.extend(["--source-path", str(source_path_resolved)])

        if app_id is not None:
            cmd.extend(["--app-id", str(app_id)])
        if host_port is not None:
            cmd.extend(["--host-port", str(host_port)])
        if env_vars:
            cmd.extend(["--env-json", json.dumps(dict(env_vars))])

        # 2. Chuẩn bị biến môi trường (Truyền SSH secret an toàn qua env)
        proc_env = os.environ.copy()
        if ssh_secret:
            proc_env["OPSPILOT_SSH_SECRET"] = ssh_secret

        # 3. Khởi chạy tiến trình CLI
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=proc_env,
        )

        output_queue: queue.Queue[tuple[str, str]] = queue.Queue()

        def _stream_reader(pipe: Any, name: str) -> None:
            try:
                for line in iter(pipe.readline, ""):
                    output_queue.put((name, line))
            finally:
                try:
                    pipe.close()
                except OSError:
                    pass

        t_out = threading.Thread(
            target=_stream_reader, args=(proc.stdout, "stdout"), daemon=True
        )
        t_err = threading.Thread(
            target=_stream_reader, args=(proc.stderr, "stderr"), daemon=True
        )
        t_out.start()
        t_err.start()

        assigned_deployment_id: int | None = None
        finished_event: dict[str, Any] | None = None
        error_event: dict[str, Any] | None = None
        steps: list[dict[str, Any]] = []
        stderr_lines: list[str] = []
        raw_stdout_lines: list[str] = []

        deadline = time.monotonic() + effective_timeout
        timed_out = False

        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break

            try:
                stream_name, line = output_queue.get(
                    timeout=min(0.2, max(0.01, remaining))
                )
            except queue.Empty:
                if proc.poll() is not None and output_queue.empty():
                    break
                continue

            if stream_name == "stderr":
                stderr_lines.append(line)
                continue

            raw_line = line.strip()
            if not raw_line:
                continue
            raw_stdout_lines.append(raw_line)

            # Phân tích thông điệp máy đọc được
            event_obj = self._parse_json_event(raw_line)
            if event_obj is None:
                continue

            evt_type = event_obj.get("event")

            # Sự kiện 1: Gán deployment_id ngay khi nhận ID
            if evt_type == "assigned":
                dep_id = event_obj.get("deployment_id")
                if not isinstance(dep_id, int) or dep_id <= 0:
                    abort_reason = "deploy_protocol_error: Thông điệp 'assigned' chứa deployment_id không hợp lệ"
                    self._abort_and_kill(
                        proc, conn, run_id, abort_reason, assigned_deployment_id
                    )
                    raise DeployProtocolError(
                        abort_reason, deployment_id=assigned_deployment_id
                    )

                assigned_deployment_id = dep_id
                try:
                    # GẮN ID NGAY QUA attach_deployment_id()
                    attach_deployment_id(
                        conn, run_id, assigned_deployment_id, auto_commit=True
                    )
                except RunStoreError as e:
                    abort_reason = (
                        f"attach_deployment_failed: Không thể gắn deployment_id={assigned_deployment_id} "
                        f"vào run id={run_id}: {e}"
                    )
                    self._abort_and_kill(
                        proc, conn, run_id, abort_reason, assigned_deployment_id
                    )
                    raise DeployError(abort_reason) from e

            elif evt_type in ("step_start", "step_done", "step_failed"):
                steps.append(event_obj)

            elif evt_type == "finished":
                finished_event = event_obj

            elif evt_type == "error":
                error_event = event_obj

        # Thu gom tiến trình
        if timed_out:
            self._abort_and_kill(
                proc,
                conn,
                run_id,
                f"deploy_timeout: Quá thời gian chờ {effective_timeout:.1f}s"
                + (
                    f" sau khi cấp deployment_id={assigned_deployment_id}"
                    if assigned_deployment_id
                    else " trước khi nhận deployment_id"
                ),
                assigned_deployment_id,
            )
            reason = f"Quá thời gian chờ {effective_timeout:.1f}s" + (
                f" (deployment_id={assigned_deployment_id})"
                if assigned_deployment_id
                else ""
            )
            raise DeployTimeoutError(reason, deployment_id=assigned_deployment_id)

        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            self._terminate_proc(proc)

        # 4. Kiểm tra các nhánh kết quả

        # Nhánh 1: Lỗi trước khi có ID
        if assigned_deployment_id is None:
            err_msg = ""
            if error_event and "error" in error_event:
                err_msg = str(error_event["error"])
            elif stderr_lines:
                err_msg = "".join(stderr_lines).strip()
            elif proc.returncode != 0:
                err_msg = f"CLI thoát với mã lỗi {proc.returncode} trước khi cấp deployment_id"
            else:
                err_msg = "CLI kết thúc mà không phát thông điệp 'assigned' chứa deployment_id"

            abort_reason = f"deploy_pre_id_error: {err_msg}"
            self._safe_abort(conn, run_id, abort_reason)
            raise DeployPreIdError(f"Deploy thất bại trước khi có ID: {err_msg}")

        # Nhánh 2: Đã có ID nhưng không có event finished hoặc output sai định dạng
        if finished_event is None:
            detail = ""
            if stderr_lines:
                detail = "".join(stderr_lines).strip()
            elif proc.returncode != 0:
                detail = f"CLI thoát với mã lỗi {proc.returncode} mà không phát event 'finished'"
            else:
                detail = "CLI kết thúc mà không phát event 'finished'"

            abort_reason = f"deploy_protocol_error: {detail}"
            self._safe_abort(conn, run_id, abort_reason)
            raise DeployProtocolError(
                f"CLI không phát event finished cho deployment {assigned_deployment_id}: {detail}",
                deployment_id=assigned_deployment_id,
            )

        # Nhánh 3: Deploy thất bại (status != 'running')
        finished_status = finished_event.get("status")
        if finished_status != "running":
            # Bản ghi deployment trong SQLite VẪN ĐƯỢC GIỮ NGUYÊN trạng thái 'failed'
            err_detail = finished_event.get("error")
            if not err_detail:
                # Tìm lỗi từ step_failed gần nhất
                failed_steps = [s for s in steps if s.get("event") == "step_failed"]
                if failed_steps:
                    last_step = failed_steps[-1]
                    err_detail = f"Bước {last_step.get('step')} lỗi: {last_step.get('error', 'không rõ')}"
                else:
                    err_detail = f"Pipeline kết thúc với status='{finished_status}'"

            abort_reason = f"deploy_failed: {err_detail}"
            self._safe_abort(conn, run_id, abort_reason)
            raise DeployFailedError(
                f"Deploy thất bại: {err_detail}",
                deployment_id=assigned_deployment_id,
            )

        # Nhánh 4: Deploy thành công
        return DeployResult(
            deployment_id=assigned_deployment_id,
            status="running",
            app_url=finished_event.get("app_url"),
            total_duration_ms=finished_event.get("total_duration_ms"),
            steps=tuple(steps),
        )

    def _parse_json_event(self, line: str) -> dict[str, Any] | None:
        """Parse chuỗi JSON dòng máy đọc được nếu có."""
        if not (line.startswith("{") and line.endswith("}")):
            return None
        try:
            data = json.loads(line)
            if isinstance(data, dict) and "event" in data:
                return data
        except json.JSONDecodeError:
            return None
        return None

    def _terminate_proc(self, proc: subprocess.Popen[str]) -> None:
        """Dừng tiến trình con an toàn."""
        try:
            proc.terminate()
            proc.wait(timeout=2.0)
        except (OSError, subprocess.SubprocessError):
            try:
                proc.kill()
                proc.wait(timeout=1.0)
            except (OSError, subprocess.SubprocessError):
                pass

    def _safe_abort(self, conn: sqlite3.Connection, run_id: int, reason: str) -> None:
        """Gọi abort_run an toàn, nuốt ngoại lệ nếu run đã bị huỷ trước đó."""
        try:
            abort_run(conn, run_id, reason=reason, auto_commit=True)
        except RunStoreError:
            pass

    def _abort_and_kill(
        self,
        proc: subprocess.Popen,
        conn: sqlite3.Connection,
        run_id: int,
        reason: str,
        deployment_id: int | None,
    ) -> None:
        """Huỷ tiến trình và gọi abort_run."""
        self._terminate_proc(proc)
        self._safe_abort(conn, run_id, reason)
