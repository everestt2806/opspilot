"""PollerAdapter: Điều khiển tiến trình Headless Poller CLI từ Python (TK-S6 P2d-2).

Nhiệm vụ:
  - Khởi chạy tiến trình Headless Poller CLI (`app/scripts/headless-poller.ts`) không chặn (non-blocking)
    sử dụng binary Electron trực tiếp (`ELECTRON_RUN_AS_NODE=1`).
  - Lắng nghe và xác nhận tín hiệu sẵn sàng `{"status": "ready"}`.
  - Hỗ trợ cơ chế drain qua stdin (`drain\\n`): dừng lịch poll, chờ lượt đang chạy,
    poll vét một lần, đóng DB và chờ thông báo `{"status": "drained"}` với exit code 0.
  - Quản lý an toàn tiến trình: timeout và dọn dẹp sạch toàn bộ cây tiến trình
    con khi gặp lỗi hoặc dừng khẩn cấp.
  - Bảo mật tuyệt đối: chỉ dùng event giao thức JSON đã qua khử secret để báo lỗi;
    không ghép stdout thô vào exception; giới hạn log bằng ring-buffer O(1) để chạy 75 phút
    không tích luỹ bộ nhớ vô hạn.
"""

from __future__ import annotations

import collections
import json
import os
import queue
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Self

from experiments.adapters.deploy_adapter import resolve_db_path, sanitize_text


class PollerAdapterError(Exception):
    """Lớp cơ sở cho mọi ngoại lệ của PollerAdapter."""


class PollerStartupError(PollerAdapterError):
    """Ném ra khi Headless Poller không thể khởi động hoặc gặp lỗi trước khi ready."""


class PollerTimeoutError(PollerAdapterError):
    """Ném ra khi Headless Poller không drain kịp trong khoảng thời gian timeout."""


class PollerProtocolError(PollerAdapterError):
    """Ném ra khi giao thức giao tiếp stdin/stdout giữa Python và CLI bị vi phạm."""


@dataclass(frozen=True)
class PollerDrainResult:
    """Kết quả hoàn tất sau khi drain Headless Poller thành công."""

    exit_code: int
    status: str = "drained"


def _kill_process_tree(proc: subprocess.Popen[Any]) -> None:
    """Hủy an toàn cả cây tiến trình con để tránh sót zombie."""
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


def get_default_poller_cli_cmd() -> list[str]:
    """Tìm lệnh mặc định để gọi CLI headless-poller qua binary Electron trực tiếp.

    Bắt buộc cả binary Electron và file CLI đã biên dịch (.out-scripts/scripts/headless-poller.js).
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    app_dir = repo_root / "app"
    compiled_cli = app_dir / ".out-scripts" / "scripts" / "headless-poller.js"

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
            "Hãy chạy 'pnpm --prefix app exec tsc -p tsconfig.scripts.json' để biên dịch headless-poller.ts."
        )

    return [str(electron_bin), str(compiled_cli)]


class PollerHandle:
    """Handle điều khiển tiến trình Headless Poller đang chạy trong nền."""

    def __init__(
        self,
        proc: subprocess.Popen[str],
        db_path: Path,
        events_queue: queue.Queue[dict[str, Any]],
        recent_stdout: collections.deque[str],
        recent_stderr: collections.deque[str],
        secrets_to_redact: list[str] | None = None,
    ) -> None:
        self.proc = proc
        self.db_path = db_path
        self._events_queue = events_queue
        self._recent_stdout = recent_stdout
        self._recent_stderr = recent_stderr
        self._secrets_to_redact = list(secrets_to_redact or [])
        self._is_drained = False

    @property
    def is_drained(self) -> bool:
        return self._is_drained

    @property
    def is_alive(self) -> bool:
        return self.proc.poll() is None

    def get_last_error(self) -> str | None:
        """Lấy thông tin lỗi gần nhất từ stderr hoặc exit code."""
        if self._recent_stderr:
            return self._clean("\n".join(self._recent_stderr))
        if self.proc.poll() is not None and self.proc.returncode != 0:
            return f"Tiến trình poller thoát với mã lỗi {self.proc.returncode}"
        return None

    def _clean(self, text: str) -> str:
        return sanitize_text(text, self._secrets_to_redact)

    def drain(self, timeout_s: float = 30.0) -> PollerDrainResult:
        """Gửi lệnh drain qua stdin và chờ tiến trình hoàn tất thu gom dữ liệu."""
        if self._is_drained:
            return PollerDrainResult(exit_code=0, status="drained")

        if self.proc.poll() is not None:
            raise PollerProtocolError(
                f"Tiến trình poller đã kết thúc trước khi drain (exit_code={self.proc.returncode})"
            )

        # 1. Gửi lệnh drain\n qua stdin
        if self.proc.stdin and not self.proc.stdin.closed:
            try:
                self.proc.stdin.write("drain\n")
                self.proc.stdin.flush()
            except OSError as e:
                _kill_process_tree(self.proc)
                raise PollerProtocolError(
                    f"Không thể gửi 'drain' qua stdin: {self._clean(str(e))}"
                ) from e

        # 2. Chờ tiến trình kết thúc và phát event drained
        deadline = time.monotonic() + timeout_s
        drained_event_received = False
        error_event: dict[str, Any] | None = None

        while time.monotonic() < deadline:
            # Kiểm tra event từ queue
            try:
                event = self._events_queue.get(timeout=0.05)
                if event.get("status") == "drained":
                    drained_event_received = True
                elif event.get("status") == "error":
                    error_event = event
            except queue.Empty:
                pass

            # Kiểm tra tiến trình đã thoát chưa
            ret = self.proc.poll()
            if ret is not None:
                # Đọc nốt các event còn lại trong queue
                while not self._events_queue.empty():
                    try:
                        event = self._events_queue.get_nowait()
                        if event.get("status") == "drained":
                            drained_event_received = True
                        elif event.get("status") == "error":
                            error_event = event
                    except queue.Empty:
                        break

                if ret != 0:
                    _kill_process_tree(self.proc)
                    if error_event and "error" in error_event:
                        err_msg = self._clean(str(error_event["error"]))
                    else:
                        err_msg = (
                            f"Headless Poller thoát với mã lỗi {ret} trong khi drain"
                        )
                    raise PollerProtocolError(
                        f"Headless Poller drain thất bại: {err_msg}"
                    )

                if not drained_event_received:
                    _kill_process_tree(self.proc)
                    raise PollerProtocolError(
                        "Headless Poller đã thoát nhưng không phát event 'drained'"
                    )

                self._is_drained = True
                return PollerDrainResult(exit_code=ret, status="drained")

        # Quá thời gian timeout
        _kill_process_tree(self.proc)
        raise PollerTimeoutError(
            f"Headless Poller không hoàn thành drain trong {timeout_s:.1f} giây"
        )

    def stop(self) -> None:
        """Dừng khẩn cấp và dọn sạch cây tiến trình."""
        if not self._is_drained and self.proc.poll() is None:
            _kill_process_tree(self.proc)

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object,
    ) -> None:
        if not self._is_drained and self.is_alive:
            self.stop()


class PollerAdapter:
    """Adapter Python điều khiển Headless Poller CLI (TK-S6 P2d-2)."""

    def __init__(
        self,
        default_cli_cmd: Sequence[str] | None = None,
        default_drain_timeout_s: float = 30.0,
    ) -> None:
        self.default_cli_cmd = (
            list(default_cli_cmd) if default_cli_cmd is not None else None
        )
        self.default_drain_timeout_s = float(default_drain_timeout_s)

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
    ) -> PollerHandle:
        """Khởi chạy Headless Poller không chặn, chờ xác nhận ready và trả về PollerHandle."""
        # 1. Tập hợp các chuỗi secret cần che giấu
        secrets_to_redact: list[str] = []
        if ssh_secret:
            secrets_to_redact.append(ssh_secret)

        def _clean(text: str) -> str:
            return sanitize_text(text, secrets_to_redact)

        # 2. Xác thực SQLite DB (bắt buộc file thật trên đĩa, từ chối :memory:)
        target_db_path = resolve_db_path(conn, db_path)

        # 3. Chuẩn bị biến môi trường (xoá biến kế thừa, cấu hình an toàn)
        proc_env = os.environ.copy()
        proc_env["ELECTRON_RUN_AS_NODE"] = "1"
        proc_env.pop("OPSPILOT_APP_ENV_JSON", None)
        proc_env.pop("OPSPILOT_SSH_SECRET", None)
        proc_env.pop("OPSPILOT_DEPLOY_SECRET", None)

        if ssh_secret:
            proc_env["OPSPILOT_SSH_SECRET"] = ssh_secret

        # 4. Chuẩn bị command line
        cmd = list(
            cli_cmd
            if cli_cmd is not None
            else (self.default_cli_cmd or get_default_poller_cli_cmd())
        )
        cmd.extend(["--db", str(target_db_path)])

        if interval_ms is not None:
            if interval_ms <= 0:
                raise ValueError("interval_ms phải là số nguyên dương")
            cmd.extend(["--interval-ms", str(interval_ms)])

        if ml_url is not None:
            if not ml_url.strip():
                raise ValueError("ml_url không được để trống")
            cmd.extend(["--ml-url", str(ml_url)])

        if mock_metrics_file is not None:
            mock_path = Path(mock_metrics_file).resolve()
            cmd.extend(["--mock-metrics-file", str(mock_path)])

        # 5. Khởi chạy tiến trình CLI
        popen_kwargs: dict[str, Any] = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True,
            "bufsize": 1,
            "env": proc_env,
        }
        if sys.platform != "win32":
            popen_kwargs["start_new_session"] = True

        try:
            proc = subprocess.Popen(cmd, **popen_kwargs)
        except Exception as e:
            raise PollerStartupError(
                f"Không thể spawn tiến trình CLI: {_clean(str(e))}"
            ) from e

        # Hàng đợi sự kiện giao thức máy đọc được và bộ đệm ring-buffer O(1)
        # Giới hạn maxlen=50 để chạy 75 phút không tích lũy bộ nhớ vô hạn
        events_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=200)
        recent_stdout: collections.deque[str] = collections.deque(maxlen=50)
        recent_stderr: collections.deque[str] = collections.deque(maxlen=50)

        def _stdout_reader(pipe: Any) -> None:
            try:
                for line in iter(pipe.readline, ""):
                    trimmed = line.strip()
                    if trimmed.startswith("{") and trimmed.endswith("}"):
                        try:
                            parsed = json.loads(trimmed)
                            if isinstance(parsed, dict) and "status" in parsed:
                                try:
                                    events_queue.put_nowait(parsed)
                                except queue.Full:
                                    pass
                        except json.JSONDecodeError:
                            pass
                    recent_stdout.append(trimmed)
            finally:
                try:
                    pipe.close()
                except OSError:
                    pass

        def _stderr_reader(pipe: Any) -> None:
            try:
                for line in iter(pipe.readline, ""):
                    recent_stderr.append(line.strip())
            finally:
                try:
                    pipe.close()
                except OSError:
                    pass

        t_out = threading.Thread(
            target=_stdout_reader, args=(proc.stdout,), daemon=True
        )
        t_err = threading.Thread(
            target=_stderr_reader, args=(proc.stderr,), daemon=True
        )
        t_out.start()
        t_err.start()

        # 6. Chờ tín hiệu {"status": "ready"}
        deadline = time.monotonic() + startup_timeout_s
        is_ready = False
        startup_err: str | None = None

        while time.monotonic() < deadline:
            # Kiểm tra event từ queue
            try:
                event = events_queue.get(timeout=0.05)
                if event.get("status") == "ready":
                    is_ready = True
                    break
                if event.get("status") == "error":
                    startup_err = _clean(str(event.get("error", "Lỗi không xác định")))
                    break
            except queue.Empty:
                pass

            # Kiểm tra tiến trình có chết sớm không
            ret = proc.poll()
            if ret is not None:
                _kill_process_tree(proc)
                # Đọc event lỗi còn sót trong queue nếu có
                while not events_queue.empty():
                    try:
                        ev = events_queue.get_nowait()
                        if ev.get("status") == "error":
                            startup_err = _clean(
                                str(ev.get("error", "Lỗi không xác định"))
                            )
                    except queue.Empty:
                        break

                if startup_err:
                    raise PollerStartupError(
                        f"Headless Poller khởi động thất bại: {startup_err}"
                    )
                raise PollerStartupError(
                    f"Headless Poller kết thúc đột ngột với mã lỗi {ret} trước khi ready"
                )

        if not is_ready:
            _kill_process_tree(proc)
            if startup_err:
                raise PollerStartupError(
                    f"Headless Poller khởi động thất bại: {startup_err}"
                )
            raise PollerStartupError(
                f"Headless Poller không phát tín hiệu 'ready' trong {startup_timeout_s:.1f}s"
            )

        return PollerHandle(
            proc=proc,
            db_path=target_db_path,
            events_queue=events_queue,
            recent_stdout=recent_stdout,
            recent_stderr=recent_stderr,
            secrets_to_redact=secrets_to_redact,
        )

    def drain(
        self, handle: PollerHandle, timeout_s: float | None = None
    ) -> PollerDrainResult:
        """Thực hiện drain poller qua handle."""
        effective_timeout = (
            float(timeout_s) if timeout_s is not None else self.default_drain_timeout_s
        )
        return handle.drain(effective_timeout)
