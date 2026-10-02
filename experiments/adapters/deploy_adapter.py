"""DeployAdapter: Điều phối quy trình deploy app demo lên VPS qua CLI TypeScript và DeployPipeline.

Ràng buộc và quy tắc (TK-S6 P2d-1b):
  1. Sử dụng cùng cơ sở dữ liệu SQLite: Không tự tạo deployment bằng SQL thuần và không dùng
     DB tạm (như try-deploy.ts). Gọi CLI TypeScript mỏng vận hành trên chính file DB của thí nghiệm.
  2. Truyền env_vars và secrets qua kênh an toàn ngoài command line:
     - env_vars truyền qua biến môi trường OPSPILOT_APP_ENV_JSON, tuyệt đối không đưa vào command line.
     - SSH secret truyền qua biến môi trường OPSPILOT_SSH_SECRET.
     - Khử SSH secret và mọi giá trị env_vars ngay tại event CLI, stderr, stdout và trước khi trả DeployResult.steps.
     - Tuyệt đối không ghi secret vào event, exception message hoặc abort_reason.
  3. Quản lý tiến trình và dừng triệt để cả cây tiến trình:
     - Tạo process group riêng (start_new_session=True trên POSIX) trước khi dùng killpg.
     - Với đường mặc định, bắt buộc cả binary Electron và CLI đã biên dịch, không fallback sang wrapper
       spawnSync (run-as-node.js) hoặc Node thường để Python quản lý trực tiếp tiến trình Electron con.
     - Khi timeout hoặc có lỗi, dừng cả cây tiến trình (taskkill /F /T trên Windows, killpg trên POSIX).
  4. Siết chặt giao thức event và bảo vệ toàn diện:
     - Bọc cả khâu kiểm tra đầu vào, tìm CLI và subprocess.Popen để tự động abort_run() khi xảy ra lỗi với lý do đã khử secret.
     - Thông điệp 'assigned' chỉ được nhận đúng một lần.
     - Thông điệp 'finished' bắt buộc có deployment_id trùng khớp với assigned_deployment_id.
     - Thành công bắt buộc thỏa mãn đồng thời: exit code của CLI là 0 VÀ bản ghi deployment trong SQLite có status='running'.
     - Khi có bất kỳ lỗi nào: giữ nguyên bản ghi deployment trong DB làm bằng chứng kiểm toán (audit trail),
       huỷ attempt bằng abort_run() kèm lý do rõ ràng đã được khử secret.
"""

from __future__ import annotations

import json
import os
import queue
import signal
import sqlite3
import subprocess
import sys
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


def sanitize_text(text: str, secrets: Sequence[str]) -> str:
    """Loại bỏ triệt để các chuỗi secret khỏi thông điệp log/lỗi/abort_reason."""
    if not text:
        return text
    sanitized = text
    for sec in secrets:
        if sec and len(sec.strip()) > 0:
            sanitized = sanitized.replace(sec, "***REDACTED***")
    return sanitized


def sanitize_obj(obj: Any, secrets: Sequence[str]) -> Any:
    """Đệ quy khử secret khỏi chuỗi, list, tuple, dict."""
    if not secrets:
        return obj
    if isinstance(obj, str):
        return sanitize_text(obj, secrets)
    if isinstance(obj, dict):
        return {
            sanitize_text(str(k), secrets): sanitize_obj(v, secrets)
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [sanitize_obj(item, secrets) for item in obj]
    if isinstance(obj, tuple):
        return tuple(sanitize_obj(item, secrets) for item in obj)
    return obj


def resolve_db_path(
    conn: sqlite3.Connection,
    explicit_path: str | Path | None = None,
) -> Path:
    """Xác định đường dẫn file SQLite DB từ tham số tường minh hoặc connection."""
    if explicit_path is not None:
        return Path(explicit_path).resolve()

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
    """Tìm lệnh mặc định để gọi CLI deploy-cli qua binary Electron trực tiếp.

    Bắt buộc cả binary Electron và file CLI đã biên dịch (.out-scripts/scripts/deploy-cli.js).
    Không fallback sang wrapper spawnSync (run-as-node.js) hoặc Node thường để Python
    có thể quản lý và dừng trực tiếp cả cây tiến trình Electron.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    app_dir = repo_root / "app"
    compiled_cli = app_dir / ".out-scripts" / "scripts" / "deploy-cli.js"

    # 1. Tìm binary Electron để Python quản lý trực tiếp tiến trình con Electron
    if sys.platform == "win32":
        electron_bin = app_dir / "node_modules" / "electron" / "dist" / "electron.exe"
    elif sys.platform == "darwin":
        electron_bin = (
            app_dir
            / "node_modules"
            / "electron"
            / "dist"
            / "Electron.app"
            / "Contents"
            / "MacOS"
            / "Electron"
        )
    else:
        electron_bin = app_dir / "node_modules" / "electron" / "dist" / "electron"

    if not electron_bin.exists():
        raise FileNotFoundError(
            f"Không tìm thấy binary Electron tại '{electron_bin}'. "
            "Bắt buộc có binary Electron để quản lý tiến trình trực tiếp, không dùng wrapper spawnSync."
        )

    if not compiled_cli.exists():
        raise FileNotFoundError(
            f"Không tìm thấy file CLI đã biên dịch tại '{compiled_cli}'. "
            "Hãy chạy 'pnpm --prefix app exec tsc -p tsconfig.scripts.json' để biên dịch deploy-cli.ts."
        )

    return [str(electron_bin), str(compiled_cli)]


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

        # Tập hợp các chuỗi secret cần che giấu trước bất kỳ bước xử lý nào
        secrets_to_redact: list[str] = []
        if ssh_secret:
            secrets_to_redact.append(ssh_secret)
        if env_vars:
            for v in env_vars.values():
                s = str(v)
                if s.strip():
                    secrets_to_redact.append(s)

        def _clean(text: str) -> str:
            return sanitize_text(text, secrets_to_redact)

        def _clean_obj(data: Any) -> Any:
            return sanitize_obj(data, secrets_to_redact)

        proc: subprocess.Popen[str] | None = None

        # Bọc toàn bộ khâu kiểm tra đầu vào, tìm CLI và Popen để tự động abort run đang running nếu có lỗi
        try:
            if type(vps_id) is not int or vps_id <= 0:
                raise ValueError("vps_id phải là số nguyên dương")
            if not app_name or not app_name.strip():
                raise ValueError("app_name không được để trống")
            if not source_path or not str(source_path).strip():
                raise ValueError("source_path không được để trống")

            source_path_resolved = Path(source_path).resolve()
            target_db_path = resolve_db_path(conn, db_path)
            effective_timeout = (
                float(timeout_s) if timeout_s is not None else self.default_timeout_s
            )

            # 1. Chuẩn bị command line (TUYỆT ĐỐI KHÔNG ĐƯA CREDENTIAL / ENV_VARS VÀO COMMAND LINE)
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

            # 2. Chuẩn bị biến môi trường (Truyền SSH secret và env_vars an toàn qua env)
            proc_env = os.environ.copy()
            proc_env["ELECTRON_RUN_AS_NODE"] = "1"
            if ssh_secret:
                proc_env["OPSPILOT_SSH_SECRET"] = ssh_secret
            if env_vars:
                proc_env["OPSPILOT_APP_ENV_JSON"] = json.dumps(dict(env_vars))

            # 3. Khởi chạy tiến trình CLI (tạo process group riêng trên POSIX)
            popen_kwargs: dict[str, Any] = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "bufsize": 1,
                "env": proc_env,
            }
            if sys.platform != "win32":
                popen_kwargs["start_new_session"] = True

            proc = subprocess.Popen(cmd, **popen_kwargs)
        except Exception as e:
            clean_err = _clean(str(e))
            self._safe_abort(conn, run_id, f"deploy_pre_id_error: {clean_err}")
            raise

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
                stderr_lines.append(_clean(line))
                continue

            raw_line = line.strip()
            if not raw_line:
                continue
            raw_stdout_lines.append(_clean(raw_line))

            # Phân tích thông điệp máy đọc được
            event_obj = self._parse_json_event(raw_line)
            if event_obj is None:
                continue

            # Khử secret ngay lập tức tại mức event CLI
            event_obj = _clean_obj(event_obj)

            evt_type = event_obj.get("event")

            # Sự kiện 1: Gán deployment_id ngay khi nhận ID (chỉ được nhận đúng một lần)
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

                if assigned_deployment_id is not None:
                    # VI PHẠM: assigned nhiều hơn một lần
                    abort_reason = (
                        f"deploy_protocol_error: Nhận thông điệp 'assigned' nhiều hơn một lần "
                        f"(id ban đầu={assigned_deployment_id}, id mới={dep_id})"
                    )
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
                    clean_err = _clean(str(e))
                    abort_reason = (
                        f"attach_deployment_failed: Không thể gắn deployment_id={assigned_deployment_id} "
                        f"vào run id={run_id}: {clean_err}"
                    )
                    self._abort_and_kill(
                        proc, conn, run_id, abort_reason, assigned_deployment_id
                    )
                    raise DeployError(abort_reason) from e

            elif evt_type in ("step_start", "step_done", "step_failed"):
                steps.append(event_obj)

            elif evt_type == "finished":
                fin_dep_id = event_obj.get("deployment_id")
                # VI PHẠM: finished.deployment_id không khớp với assigned_deployment_id
                if (
                    assigned_deployment_id is None
                    or fin_dep_id != assigned_deployment_id
                ):
                    abort_reason = (
                        f"deploy_protocol_error: finished.deployment_id ({fin_dep_id}) "
                        f"không khớp với assigned deployment_id ({assigned_deployment_id})"
                    )
                    self._abort_and_kill(
                        proc, conn, run_id, abort_reason, assigned_deployment_id
                    )
                    raise DeployProtocolError(
                        abort_reason, deployment_id=assigned_deployment_id
                    )

                finished_event = event_obj

            elif evt_type == "error":
                error_event = event_obj

        # Thu gom tiến trình khi timeout
        if timed_out:
            abort_reason = _clean(
                f"deploy_timeout: Quá thời gian chờ {effective_timeout:.1f}s"
                + (
                    f" sau khi cấp deployment_id={assigned_deployment_id}"
                    if assigned_deployment_id
                    else " trước khi nhận deployment_id"
                )
            )
            self._abort_and_kill(
                proc,
                conn,
                run_id,
                abort_reason,
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
            self._kill_process_tree(proc)

        # 4. Kiểm tra các nhánh kết quả theo giao thức siết chặt

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

            clean_err = _clean(err_msg)
            abort_reason = f"deploy_pre_id_error: {clean_err}"
            self._abort_and_kill(
                proc, conn, run_id, abort_reason, assigned_deployment_id
            )
            raise DeployPreIdError(f"Deploy thất bại trước khi có ID: {clean_err}")

        # Nhánh 2: Đã có ID nhưng không có event finished hoặc output sai định dạng
        if finished_event is None:
            detail = ""
            if stderr_lines:
                detail = "".join(stderr_lines).strip()
            elif proc.returncode != 0:
                detail = f"CLI thoát với mã lỗi {proc.returncode} mà không phát event 'finished'"
            else:
                detail = "CLI kết thúc mà không phát event 'finished'"

            clean_err = _clean(detail)
            abort_reason = f"deploy_protocol_error: {clean_err}"
            self._abort_and_kill(
                proc, conn, run_id, abort_reason, assigned_deployment_id
            )
            raise DeployProtocolError(
                f"CLI không phát event finished cho deployment {assigned_deployment_id}: {clean_err}",
                deployment_id=assigned_deployment_id,
            )

        # Nhánh 3: Deploy thất bại (finished.status != 'running')
        finished_status = finished_event.get("status")
        if finished_status != "running":
            err_detail = finished_event.get("error")
            if not err_detail:
                failed_steps = [s for s in steps if s.get("event") == "step_failed"]
                if failed_steps:
                    last_step = failed_steps[-1]
                    err_detail = f"Bước {last_step.get('step')} lỗi: {last_step.get('error', 'không rõ')}"
                else:
                    err_detail = f"Pipeline kết thúc với status='{finished_status}'"

            clean_err = _clean(err_detail)
            abort_reason = f"deploy_failed: {clean_err}"
            # Bản ghi deployment trong SQLite VẪN ĐƯỢC GIỮ NGUYÊN (audit trail)
            self._abort_and_kill(
                proc, conn, run_id, abort_reason, assigned_deployment_id
            )
            raise DeployFailedError(
                f"Deploy thất bại: {clean_err}",
                deployment_id=assigned_deployment_id,
            )

        # Nhánh 4: finished.status == 'running' nhưng phải kiểm tra:
        # 4a. Exit code bắt buộc = 0
        if proc.returncode != 0:
            abort_reason = f"deploy_protocol_error: Finished thành công nhưng CLI thoát với mã lỗi {proc.returncode}"
            self._abort_and_kill(
                proc, conn, run_id, abort_reason, assigned_deployment_id
            )
            raise DeployProtocolError(
                abort_reason, deployment_id=assigned_deployment_id
            )

        # 4b. Deployment trong SQLite bắt buộc có status='running'
        cur = conn.cursor()
        cur.execute(
            "SELECT id, status FROM deployment WHERE id = ?",
            (assigned_deployment_id,),
        )
        dep_row = cur.fetchone()
        if dep_row is None:
            abort_reason = f"deploy_protocol_error: Không tìm thấy bản ghi deployment id={assigned_deployment_id} trong SQLite DB"
            self._abort_and_kill(
                proc, conn, run_id, abort_reason, assigned_deployment_id
            )
            raise DeployProtocolError(
                abort_reason, deployment_id=assigned_deployment_id
            )

        actual_status = (
            dep_row[1] if not hasattr(dep_row, "keys") else dep_row["status"]
        )
        if actual_status != "running":
            abort_reason = (
                f"deploy_protocol_error: Deployment id={assigned_deployment_id} trong SQLite có status='{actual_status}', "
                "bắt buộc phải là 'running'"
            )
            self._abort_and_kill(
                proc, conn, run_id, abort_reason, assigned_deployment_id
            )
            raise DeployProtocolError(
                abort_reason, deployment_id=assigned_deployment_id
            )

        # Thành công tuyệt đối
        return DeployResult(
            deployment_id=assigned_deployment_id,
            status="running",
            app_url=_clean(str(finished_event.get("app_url") or "")) or None,
            total_duration_ms=finished_event.get("total_duration_ms"),
            steps=tuple(_clean_obj(steps)),
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

    def _kill_process_tree(self, proc: subprocess.Popen[str]) -> None:
        """Dừng triệt để toàn bộ cây tiến trình (bao gồm cả tiến trình con Electron nếu có)."""
        if proc.poll() is not None:
            return

        pid = proc.pid
        if sys.platform == "win32":
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    timeout=5.0,
                )
            except (OSError, subprocess.SubprocessError):
                pass
        else:
            try:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass

        try:
            proc.terminate()
            proc.wait(timeout=1.0)
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
        proc: subprocess.Popen[str],
        conn: sqlite3.Connection,
        run_id: int,
        reason: str,
        deployment_id: int | None,
    ) -> None:
        """Dừng cây tiến trình CLI và gọi abort_run."""
        self._kill_process_tree(proc)
        self._safe_abort(conn, run_id, reason)
