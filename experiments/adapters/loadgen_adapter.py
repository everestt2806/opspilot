"""LoadgenAdapter: Điều khiển tiến trình/container sinh tải cho thí nghiệm OpsPilot (TK-S6 P2d-3).

Nhiệm vụ:
  - Điều khiển tiến trình sinh tải 5 req/s (mặc định) xuyên suốt các pha A–D
    (lên đến 75 phút / 4500 giây) mà không làm ngắt quãng hay reset bộ đếm Counter cửa sổ trượt 60s.
  - Tuân thủ nghiêm ngặt trần an toàn thời lượng:
    + Mặc định tối đa 1800 giây (30 phút).
    + Chỉ cho phép mở tối đa 4500 giây khi caller bật cờ pilot tường minh (`allow_pilot_4500=True`).
  - Kiểm tra target lab hợp lệ (localhost, private network, allowlist) trước khi khởi động.
  - Hỗ trợ cả 2 chế độ:
    + SSH Remote: Điều khiển container docker trên VPS qua SSH client.
    + Local Process: Khởi chạy tiến trình Python cục bộ phục vụ dev/test/mock.
  - Hỗ trợ dừng êm dịu (`stop`) và dọn dẹp triệt để (`cleanup`) qua Context Manager.
"""

from __future__ import annotations

import os
import re
import shlex
import signal
import subprocess
import sys
import time
import urllib.parse
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Self

from experiments.load_gen.loadgen import (
    DEFAULT_MAX_DURATION_S,
    MAX_RPS,
    PILOT_MAX_DURATION_S,
    validate_target,
)


class LoadgenError(Exception):
    """Lớp cơ sở cho các lỗi của LoadgenAdapter."""


class LoadgenTargetError(LoadgenError, ValueError):
    """Ném ra khi URL đích không hợp lệ hoặc không thuộc allowlist an toàn."""


class LoadgenStartupError(LoadgenError):
    """Ném ra khi không thể khởi chạy tiến trình hoặc container loadgen."""


class LoadgenExecutionError(LoadgenError):
    """Ném ra khi gặp lỗi trong quá trình điều khiển hoặc dừng tiến trình."""


def _kill_process_tree(proc: subprocess.Popen[Any]) -> None:
    """Dừng triệt để toàn bộ cây tiến trình của tiến trình con cục bộ."""
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


def _exec_ssh(ssh_client: Any, cmd: str, timeout: float = 15.0) -> tuple[int, str, str]:
    """Thực thi lệnh shell qua SSH client (hỗ trợ Paramiko, mock tuple, hoặc callable)."""
    if hasattr(ssh_client, "exec_command"):
        res = ssh_client.exec_command(cmd, timeout=timeout)
        if isinstance(res, tuple) and len(res) == 3:
            stdin_obj, stdout_obj, stderr_obj = res
            if hasattr(stdout_obj, "channel") and hasattr(
                stdout_obj.channel, "recv_exit_status"
            ):
                exit_code = stdout_obj.channel.recv_exit_status()
                out = (
                    stdout_obj.read().decode("utf-8", errors="replace")
                    if hasattr(stdout_obj, "read")
                    else str(stdout_obj)
                )
                err = (
                    stderr_obj.read().decode("utf-8", errors="replace")
                    if hasattr(stderr_obj, "read")
                    else str(stderr_obj)
                )
                return exit_code, out, err
            if isinstance(stdin_obj, int):
                return stdin_obj, str(stdout_obj), str(stderr_obj)
            out = (
                stdout_obj.read().decode("utf-8", errors="replace")
                if hasattr(stdout_obj, "read")
                else str(stdout_obj)
            )
            err = (
                stderr_obj.read().decode("utf-8", errors="replace")
                if hasattr(stderr_obj, "read")
                else str(stderr_obj)
            )
            exit_code = 0
            if hasattr(stdout_obj, "channel") and hasattr(
                stdout_obj.channel, "recv_exit_status"
            ):
                exit_code = stdout_obj.channel.recv_exit_status()
            return exit_code, out, err
    elif hasattr(ssh_client, "exec"):
        res = ssh_client.exec(cmd)
        if isinstance(res, tuple) and len(res) >= 3:
            return int(res[0]), str(res[1]), str(res[2])
        if hasattr(res, "code"):
            return (
                int(res.code),
                str(getattr(res, "stdout", "")),
                str(getattr(res, "stderr", "")),
            )
    elif callable(ssh_client):
        res = ssh_client(cmd)
        if isinstance(res, tuple) and len(res) == 3:
            return int(res[0]), str(res[1]), str(res[2])
        if isinstance(res, int):
            return res, "", ""

    raise TypeError(
        f"ssh_client không hỗ trợ giao thức thực thi lệnh: {type(ssh_client)}"
    )


class LoadgenHandle:
    """Handle điều khiển phiên sinh tải đang hoạt động (cục bộ hoặc trên VPS)."""

    def __init__(
        self,
        mode: str,
        app_url: str,
        rate_rps: float,
        effective_duration_s: float,
        allow_pilot_4500: bool,
        container_name: str | None = None,
        docker_network: str | None = None,
        counter_mount_dir: str | None = None,
        proc: subprocess.Popen[Any] | None = None,
        ssh_client: Any | None = None,
        stop_file: Path | None = None,
    ) -> None:
        self.mode = mode
        self.app_url = app_url
        self.rate_rps = rate_rps
        self.effective_duration_s = effective_duration_s
        self.allow_pilot_4500 = allow_pilot_4500
        self.container_name = container_name
        self.docker_network = docker_network
        self.counter_mount_dir = counter_mount_dir
        self.proc = proc
        self.ssh_client = ssh_client
        self.stop_file = stop_file
        self._is_stopped = False

    @property
    def is_running(self) -> bool:
        """Kiểm tra xem phiên sinh tải còn đang chạy không."""
        if self._is_stopped:
            return False
        if self.mode == "local" and self.proc is not None:
            return self.proc.poll() is None
        return not self._is_stopped

    def get_container_status(self) -> str | None:
        """Lấy trạng thái hiện tại của container trên VPS (nếu ở chế độ SSH)."""
        if self.mode != "ssh" or not self.ssh_client or not self.container_name:
            return None
        quoted = shlex.quote(self.container_name)
        try:
            code, out, _ = _exec_ssh(
                self.ssh_client,
                f"docker inspect -f '{{{{.State.Status}}}}' {quoted}",
                timeout=5.0,
            )
            return out.strip().lower() if code == 0 and out.strip() else None
        except (
            OSError,
            RuntimeError,
            TypeError,
            ValueError,
            LoadgenError,
            subprocess.SubprocessError,
        ):
            return None

    def stop(self, timeout_s: float = 5.0) -> None:
        """Dừng êm dịu phiên sinh tải."""
        if self._is_stopped:
            return

        if self.mode == "local":
            if self.stop_file:
                try:
                    self.stop_file.touch(exist_ok=True)
                except OSError:
                    pass
            if self.proc and self.proc.poll() is None:
                try:
                    self.proc.terminate()
                except OSError:
                    pass
                try:
                    self.proc.wait(timeout=timeout_s)
                except subprocess.TimeoutExpired:
                    _kill_process_tree(self.proc)
            if self.proc and self.proc.poll() is None:
                raise LoadgenExecutionError(
                    f"Không thể dừng tiến trình loadgen cục bộ (PID {self.proc.pid})"
                )
            self._is_stopped = True
        elif self.mode == "ssh":
            if self.ssh_client and self.container_name:
                quoted = shlex.quote(self.container_name)
                try:
                    exit_code, stdout, stderr = _exec_ssh(
                        self.ssh_client,
                        f"docker stop -t 2 {quoted}",
                        timeout=timeout_s + 5.0,
                    )
                except Exception as e:
                    raise LoadgenExecutionError(
                        f"Lỗi SSH khi dừng container '{self.container_name}': {e}"
                    ) from e

                if exit_code != 0:
                    err_msg = (stderr.strip() or stdout.strip()).lower()
                    if "no such container" in err_msg or "not found" in err_msg:
                        self._is_stopped = True
                        return

                    status = self.get_container_status()
                    if status in ("exited", "dead"):
                        self._is_stopped = True
                        return

                    raise LoadgenExecutionError(
                        f"Không thể dừng container '{self.container_name}' (mã {exit_code}, status={status or 'unknown'}): {stderr.strip() or stdout.strip()}"
                    )

            self._is_stopped = True

    def cleanup(self) -> None:
        """Dọn dẹp triệt để tiến trình hoặc container sinh tải."""
        if self.mode == "local":
            if self.proc and self.proc.poll() is None:
                _kill_process_tree(self.proc)
            if self.stop_file and self.stop_file.exists():
                try:
                    self.stop_file.unlink(missing_ok=True)
                except OSError:
                    pass
            if self.proc and self.proc.poll() is None:
                raise LoadgenExecutionError(
                    f"Không thể dừng tiến trình loadgen cục bộ khi cleanup (PID {self.proc.pid})"
                )
            self._is_stopped = True
        elif self.mode == "ssh":
            if self.ssh_client and self.container_name:
                quoted = shlex.quote(self.container_name)
                try:
                    exit_code, stdout, stderr = _exec_ssh(
                        self.ssh_client, f"docker rm -f {quoted}"
                    )
                except Exception as e:
                    raise LoadgenExecutionError(
                        f"Lỗi SSH khi dọn dẹp container '{self.container_name}': {e}"
                    ) from e

                if exit_code != 0:
                    err_msg = (stderr.strip() or stdout.strip()).lower()
                    if "no such container" in err_msg or "not found" in err_msg:
                        self._is_stopped = True
                        return

                    status = self.get_container_status()
                    raise LoadgenExecutionError(
                        f"Không thể dọn dẹp container '{self.container_name}' (mã {exit_code}, status={status or 'unknown'}): {stderr.strip() or stdout.strip()}"
                    )
            self._is_stopped = True

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object,
    ) -> None:
        self.cleanup()


class LoadgenAdapter:
    """Adapter điều khiển tải liên tục 5 req/s cho thí nghiệm (TK-S6)."""

    def __init__(
        self,
        default_rate_rps: float = 5.0,
        default_duration_s: float = DEFAULT_MAX_DURATION_S,
        allow_hosts: Sequence[str] = ("localhost", "127.0.0.1", "::1", "app"),
    ) -> None:
        self.default_rate_rps = default_rate_rps
        self.default_duration_s = default_duration_s
        self.allow_hosts = tuple(allow_hosts)

    def start(
        self,
        app_url: str,
        rate_rps: float | None = None,
        duration_s: float | None = None,
        allow_pilot_4500: bool = False,
        counter_path: str | Path | None = None,
        counter_window_s: float = 60.0,
        container_name: str = "opspilot-loadgen",
        image_tag: str = "opspilot/loadgen:latest",
        counter_mount_dir: str | None = None,
        docker_network: str | None = None,
        app_name: str | None = None,
        ssh_client: Any | None = None,
        local: bool = False,
        allow_hosts: Sequence[str] | None = None,
        stop_file: str | Path | None = None,
        custom_cmd: Sequence[str] | None = None,
    ) -> LoadgenHandle:
        """Khởi chạy loadgen (trên VPS qua SSH hoặc cục bộ qua local process).

        Quy tắc trần thời lượng:
          - Mặc định: tối đa 1800s. Nếu caller truyền >1800s mà không bật pilot, tự động cap về 1800s.
          - Pilot tường minh (`allow_pilot_4500=True`): cho phép lên đến 4500s. Nếu truyền >4500s, cap về 4500s.
        """
        # 1. Bắt buộc kiểm tra target lab an toàn
        hosts = tuple(allow_hosts) if allow_hosts is not None else self.allow_hosts
        try:
            validate_target(app_url, hosts)
        except ValueError as e:
            raise LoadgenTargetError(f"Target URL không hợp lệ: {e}") from e

        # 2. Kiểm tra tốc độ sinh tải (rate_rps)
        rate = float(rate_rps if rate_rps is not None else self.default_rate_rps)
        if rate <= 0 or rate > MAX_RPS:
            raise ValueError(f"rate_rps phải trong khoảng (0, {MAX_RPS}]")

        # 3. Tính toán trần thời lượng nghiêm ngặt
        requested_duration = (
            float(duration_s) if duration_s is not None else self.default_duration_s
        )
        max_limit = PILOT_MAX_DURATION_S if allow_pilot_4500 else DEFAULT_MAX_DURATION_S
        effective_duration = (
            min(requested_duration, float(max_limit))
            if requested_duration > 0
            else float(max_limit)
        )

        # 4. Chế độ SSH Remote (chạy Docker container trên VPS)
        if ssh_client is not None and not local:
            # 4.1. Xác thực container_name và docker_network
            if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$", container_name):
                raise ValueError(f"container_name không hợp lệ: {container_name}")
            if docker_network and not re.match(
                r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$", docker_network
            ):
                raise ValueError(f"docker_network không hợp lệ: {docker_network}")

            # 4.2. Bắt buộc mount counter vào đường dẫn host mà collector thực sự đọc
            mount_host_dir = counter_mount_dir
            if not mount_host_dir:
                if not app_name:
                    raise ValueError(
                        "Bắt buộc cung cấp counter_mount_dir hoặc app_name trong chế độ SSH để mount bộ đếm counter "
                        "vào đường dẫn host mà collector thực sự đọc (/opt/opspilot/<app>/metrics)"
                    )
                mount_host_dir = f"/opt/opspilot/{app_name}/metrics"

            # 4.3. Xác định Docker network phù hợp để loadgen truy cập được app
            parsed_host = urllib.parse.urlparse(app_url).hostname or ""
            if docker_network:
                network = docker_network
            elif parsed_host == "app":
                if not app_name:
                    raise ValueError(
                        "app_name là bắt buộc khi target sử dụng hostname 'app' mà không chỉ định docker_network"
                    )
                network = f"{app_name}_default"
            else:
                network = "host"

            # 4.4. Pre-cleanup container cũ nếu có
            quoted_container_name = shlex.quote(container_name)
            try:
                _exec_ssh(
                    ssh_client,
                    f"docker rm -f {quoted_container_name} 2>/dev/null || true",
                )
            except (OSError, RuntimeError, LoadgenError, subprocess.SubprocessError):
                pass

            # 4.5. Xây dựng lệnh Docker run với quote an toàn tuyệt đối cho mọi tham số
            pilot_env = "true" if allow_pilot_4500 else "false"
            docker_cmd = (
                f"docker run -d --name {quoted_container_name} "
                f"--network {shlex.quote(network)} "
                f"-e APP_URL={shlex.quote(app_url)} "
                f"-e LOADGEN_RATE_RPS={shlex.quote(str(rate))} "
                f"-e LOADGEN_DURATION_S={shlex.quote(str(effective_duration))} "
                f"-e LOADGEN_PILOT_4500={shlex.quote(pilot_env)} "
                f"-e LOADGEN_WINDOW_S={shlex.quote(str(counter_window_s))} "
                f"-v {shlex.quote(str(mount_host_dir))}:/var/metrics "
                f"{shlex.quote(image_tag)}"
            ).strip()

            exit_code, stdout, stderr = _exec_ssh(ssh_client, docker_cmd)
            if exit_code != 0:
                raise LoadgenStartupError(
                    f"Không thể khởi động container loadgen '{container_name}' trên VPS (mã {exit_code}): {stderr.strip() or stdout.strip()}"
                )

            return LoadgenHandle(
                mode="ssh",
                app_url=app_url,
                rate_rps=rate,
                effective_duration_s=effective_duration,
                allow_pilot_4500=allow_pilot_4500,
                container_name=container_name,
                docker_network=network,
                counter_mount_dir=str(mount_host_dir),
                ssh_client=ssh_client,
            )

        # 5. Chế độ Local Process (chạy subprocess cục bộ)
        env = os.environ.copy()
        env["APP_URL"] = app_url
        env["LOADGEN_RATE_RPS"] = str(rate)
        env["LOADGEN_DURATION_S"] = str(effective_duration)
        env["LOADGEN_PILOT_4500"] = "true" if allow_pilot_4500 else "false"
        env["LOADGEN_WINDOW_S"] = str(counter_window_s)
        if counter_path:
            env["LOADGEN_COUNTER_PATH"] = str(Path(counter_path).resolve())

        stop_p = Path(stop_file).resolve() if stop_file else None
        if stop_p:
            env["LOADGEN_STOP_FILE"] = str(stop_p)
            if stop_p.exists():
                try:
                    stop_p.unlink()
                except OSError:
                    pass

        cmd = (
            list(custom_cmd)
            if custom_cmd is not None
            else [sys.executable, "-m", "experiments.load_gen.loadgen"]
        )

        popen_kwargs: dict[str, Any] = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "env": env,
        }
        if sys.platform != "win32":
            popen_kwargs["start_new_session"] = True

        try:
            proc = subprocess.Popen(cmd, **popen_kwargs)
        except Exception as e:
            raise LoadgenStartupError(
                f"Không thể spawn tiến trình loadgen cục bộ: {e}"
            ) from e

        # Kiểm tra xem tiến trình có chết ngay lập tức không (cho thời gian python khởi động trên Windows)
        time.sleep(0.2)
        ret = proc.poll()
        if ret is not None and ret != 0:
            err_msg = ""
            if proc.stderr:
                err_msg = proc.stderr.read().decode("utf-8", errors="replace")
            _kill_process_tree(proc)
            raise LoadgenStartupError(
                f"Tiến trình loadgen kết thúc sớm với mã lỗi {ret}: {err_msg.strip()}"
            )

        return LoadgenHandle(
            mode="local",
            app_url=app_url,
            rate_rps=rate,
            effective_duration_s=effective_duration,
            allow_pilot_4500=allow_pilot_4500,
            proc=proc,
            stop_file=stop_p,
        )

    def stop(self, handle: LoadgenHandle, timeout_s: float = 5.0) -> None:
        """Dừng êm dịu phiên loadgen."""
        handle.stop(timeout_s=timeout_s)

    def cleanup(self, handle: LoadgenHandle) -> None:
        """Dọn dẹp phiên loadgen."""
        handle.cleanup()
