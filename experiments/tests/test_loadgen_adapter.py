"""Tests cho LoadgenAdapter và cấu hình pilot 4500s tường minh (TK-S6 P2d-3)."""

from __future__ import annotations

import json
import shlex
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from collector.collect import read_loadgen_error_rate
from experiments.adapters.loadgen_adapter import (
    LoadgenAdapter,
    LoadgenExecutionError,
    LoadgenHandle,
    LoadgenStartupError,
    LoadgenTargetError,
)
from experiments.load_gen.loadgen import (
    DEFAULT_MAX_DURATION_S,
    PILOT_MAX_DURATION_S,
    Counter,
)


class MockSshClient:
    """Mock SSH client ghi lại các lệnh thực thi và mô phỏng trạng thái container."""

    def __init__(
        self,
        exit_code: int = 0,
        stdout: str = "",
        stderr: str = "",
        handlers: dict[str, tuple[int, str, str]] | None = None,
        simulate_docker: bool = True,
    ) -> None:
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.handlers = handlers or {}
        self.simulate_docker = simulate_docker
        self.containers: dict[str, str] = {}
        self.executed_commands: list[str] = []

    def _extract_container_name(self, command: str) -> str:
        parts = command.split()
        if "--name" in parts:
            idx = parts.index("--name")
            if idx + 1 < len(parts):
                return parts[idx + 1].strip("'\"")
        return parts[-1].strip("'\"")

    def exec_command(
        self, command: str, timeout: float | None = None
    ) -> tuple[int, str, str]:
        self.executed_commands.append(command)
        for pattern, response in self.handlers.items():
            if pattern in command:
                code, out, err = response
                c_name = self._extract_container_name(command)
                if "docker stop" in command and code == 0:
                    self.containers[c_name] = "exited"
                elif "docker rm" in command and (
                    code == 0 or "no such container" in err.lower()
                ):
                    self.containers.pop(c_name, None)
                elif "docker rm" in command and "removing" in err.lower():
                    self.containers[c_name] = "removing"
                elif "docker inspect" in command and code == 0 and out.strip():
                    self.containers[c_name] = out.strip().lower()
                return code, out, err

        if self.simulate_docker:
            c_name = self._extract_container_name(command)
            if "docker run" in command:
                self.containers[c_name] = "running"
                return self.exit_code, self.stdout or "mock-cid\n", self.stderr
            if "docker stop" in command:
                if self.exit_code == 0:
                    self.containers[c_name] = "exited"
                return self.exit_code, self.stdout or f"{c_name}\n", self.stderr
            if "docker rm" in command:
                if self.exit_code == 0:
                    self.containers.pop(c_name, None)
                return self.exit_code, self.stdout or f"{c_name}\n", self.stderr
            if "docker inspect" in command:
                if c_name not in self.containers:
                    return (
                        1,
                        "",
                        f"Error response from daemon: No such container: {c_name}",
                    )
                return 0, f"{self.containers[c_name]}\n", ""
            if "docker logs" in command:
                return 0, "", ""

        return self.exit_code, self.stdout, self.stderr


def test_loadgen_adapter_start_and_stop_ssh_mock() -> None:
    """Kiểm thử: start và stop loadgen container trên VPS qua mock SSH."""
    mock_ssh = MockSshClient(exit_code=0)
    adapter = LoadgenAdapter(default_rate_rps=5.0)

    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        rate_rps=5.0,
        duration_s=1800.0,
        allow_pilot_4500=False,
        counter_mount_dir="/opt/opspilot/demo-app/metrics",
        ssh_client=mock_ssh,
    )

    assert handle.mode == "ssh"
    assert handle.is_running is True
    assert handle.effective_duration_s == 1800.0
    assert handle.allow_pilot_4500 is False
    assert handle.docker_network == "host"
    assert handle.counter_mount_dir == "/opt/opspilot/demo-app/metrics"
    assert handle.container_name == "opspilot-loadgen"

    # Kiểm tra lệnh SSH đã thực thi
    # 1. Pre-check inspect (container chưa tồn tại, tránh rm -f mù)
    assert (
        "docker inspect -f '{{.State.Status}}' opspilot-loadgen"
        in mock_ssh.executed_commands[0]
    )
    # Tuyệt đối không gọi docker rm -f mù trước run khi container chưa tồn tại
    assert not any("docker rm -f" in cmd for cmd in mock_ssh.executed_commands[:2])
    # 2. Docker run
    run_cmd = mock_ssh.executed_commands[1]
    assert "docker run -d --name opspilot-loadgen" in run_cmd
    assert "--network host" in run_cmd
    assert "-e APP_URL=http://127.0.0.1:3000" in run_cmd
    assert "-e LOADGEN_RATE_RPS=5.0" in run_cmd
    assert "-e LOADGEN_DURATION_S=1800.0" in run_cmd
    assert "-e LOADGEN_PILOT_4500=false" in run_cmd
    assert "-v /opt/opspilot/demo-app/metrics:/var/metrics" in run_cmd
    # 3. Post-run verify running
    assert (
        "docker inspect -f '{{.State.Status}}' opspilot-loadgen"
        in mock_ssh.executed_commands[2]
    )

    # Stop container
    handle.stop()
    assert handle.is_running is False
    # 4. Docker stop và 5. Post-stop verify exited (do is_running ở dòng trên đã thực thi 1 lượt inspect)
    assert "docker stop -t 2 opspilot-loadgen" in mock_ssh.executed_commands[4]
    assert (
        "docker inspect -f '{{.State.Status}}' opspilot-loadgen"
        in mock_ssh.executed_commands[5]
    )


def test_loadgen_adapter_start_and_stop_local(tmp_path: Path) -> None:
    """Kiểm thử: start và stop tiến trình loadgen cục bộ (local mode)."""
    stop_file = tmp_path / "test_loadgen.stop"
    counter_file = tmp_path / "test_counter.json"

    # Script mock mô phỏng loadgen chạy nền và lắng nghe stop_file
    mock_script = (
        "import sys, time, json\n"
        "from pathlib import Path\n"
        "stop_p = Path(sys.argv[1])\n"
        "counter_p = Path(sys.argv[2])\n"
        "counter_p.write_text(json.dumps({'requests': 10}), encoding='utf-8')\n"
        "while not stop_p.exists():\n"
        "    time.sleep(0.05)\n"
    )

    adapter = LoadgenAdapter()
    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        rate_rps=5.0,
        local=True,
        stop_file=stop_file,
        counter_path=counter_file,
        custom_cmd=[
            sys.executable,
            "-c",
            mock_script,
            str(stop_file),
            str(counter_file),
        ],
    )

    assert handle.mode == "local"
    assert handle.is_running is True

    # Chờ file counter xuất hiện
    time.sleep(0.1)
    assert counter_file.exists()

    # Dừng êm dịu qua stop()
    handle.stop(timeout_s=3.0)
    assert handle.is_running is False


def test_loadgen_adapter_startup_error_invalid_target() -> None:
    """Kiểm thử: từ chối target không hợp lệ hoặc host public không thuộc allowlist."""
    adapter = LoadgenAdapter()

    # URL không đúng định dạng
    with pytest.raises(LoadgenTargetError, match="Target URL không hợp lệ"):
        adapter.start(app_url="not-a-valid-url")

    # Host public không nằm trong allowlist
    with pytest.raises(
        LoadgenTargetError, match="target public chưa nằm trong allowlist"
    ):
        adapter.start(app_url="http://public-target.com:8080")


def test_loadgen_adapter_startup_error_invalid_rate() -> None:
    """Kiểm thử: từ chối rate_rps <= 0 hoặc > MAX_RPS."""
    adapter = LoadgenAdapter()

    with pytest.raises(ValueError, match="rate_rps phải trong khoảng"):
        adapter.start(app_url="http://127.0.0.1:3000", rate_rps=0.0)

    with pytest.raises(ValueError, match="rate_rps phải trong khoảng"):
        adapter.start(app_url="http://127.0.0.1:3000", rate_rps=55.0)


def test_loadgen_adapter_startup_error_ssh_failure() -> None:
    """Kiểm thử: khi lệnh docker run qua SSH thất bại, ném LoadgenStartupError."""
    failing_ssh = MockSshClient(
        exit_code=1,
        stderr="docker: Error response from daemon: Conflict. The container name is already in use.",
    )
    adapter = LoadgenAdapter()

    with pytest.raises(LoadgenStartupError) as exc_info:
        adapter.start(
            app_url="http://127.0.0.1:3000",
            app_name="demo-app",
            ssh_client=failing_ssh,
        )

    assert "The container name is already in use" in str(exc_info.value)
    assert "mã 1" in str(exc_info.value)


def test_loadgen_adapter_startup_error_local_spawn_failure(tmp_path: Path) -> None:
    """Kiểm thử: khi lệnh local kết thúc sớm với mã lỗi khác 0, ném LoadgenStartupError."""
    adapter = LoadgenAdapter()

    # Script thoát ngay với mã lỗi 42
    crash_script = (
        "import sys; sys.stderr.write('Fatal port binding error\\n'); sys.exit(42)"
    )

    with pytest.raises(LoadgenStartupError) as exc_info:
        adapter.start(
            app_url="http://127.0.0.1:3000",
            local=True,
            custom_cmd=[sys.executable, "-c", crash_script],
        )

    assert "mã lỗi 42" in str(exc_info.value)
    assert "Fatal port binding error" in str(exc_info.value)


def test_loadgen_adapter_cleanup_context_manager_ssh() -> None:
    """Kiểm thử: context manager dọn dẹp (docker rm -f) khi có ngoại lệ trong runner."""
    mock_ssh = MockSshClient(exit_code=0)
    adapter = LoadgenAdapter()

    saved_handle: LoadgenHandle | None = None
    with (
        pytest.raises(RuntimeError, match="Simulation skew error"),
        adapter.start(
            app_url="http://127.0.0.1:3000",
            app_name="demo-app",
            ssh_client=mock_ssh,
        ) as handle,
    ):
        saved_handle = handle
        assert handle.is_running is True
        raise RuntimeError("Simulation skew error")

    assert saved_handle is not None
    assert saved_handle.is_running is False
    # Xác nhận docker rm -f đã được gọi trong khối cleanup
    assert any(
        f"docker rm -f {saved_handle.container_name}" in cmd
        for cmd in mock_ssh.executed_commands
    )


def test_loadgen_adapter_cleanup_context_manager_local(tmp_path: Path) -> None:
    """Kiểm thử: context manager dọn dẹp tiến trình con cục bộ khi có ngoại lệ."""
    stop_file = tmp_path / "test_cleanup.stop"

    mock_infinite = "import sys, time\nwhile True:\n    time.sleep(0.1)\n"

    adapter = LoadgenAdapter()
    saved_handle: LoadgenHandle | None = None

    with (
        pytest.raises(RuntimeError, match="Experiment exception"),
        adapter.start(
            app_url="http://127.0.0.1:3000",
            local=True,
            stop_file=stop_file,
            custom_cmd=[sys.executable, "-c", mock_infinite],
        ) as handle,
    ):
        saved_handle = handle
        assert handle.is_running is True
        raise RuntimeError("Experiment exception")

    assert saved_handle is not None
    # Tiến trình phải bị dừng triệt để sau khi ra khỏi with
    assert saved_handle.is_running is False
    if saved_handle.proc:
        assert saved_handle.proc.poll() is not None


def test_loadgen_adapter_two_duration_limits_default_vs_pilot() -> None:
    """Kiểm thử: Hai giới hạn thời lượng: mặc định cap 1800s, pilot tường minh mở 4500s."""
    mock_ssh = MockSshClient(exit_code=0)
    adapter = LoadgenAdapter()

    # 1. Chế độ MẶC ĐỊNH (allow_pilot_4500=False):
    # Dù truyền 4500s hay 99999s, adapter bắt buộc cap về trần mặc định 1800s (DEFAULT_MAX_DURATION_S)
    handle_default_4500 = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=4500.0,
        allow_pilot_4500=False,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_default_4500.effective_duration_s == DEFAULT_MAX_DURATION_S
    assert handle_default_4500.effective_duration_s == 1800.0
    handle_default_4500.stop()

    handle_default_huge = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=99999.0,
        allow_pilot_4500=False,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_default_huge.effective_duration_s == 1800.0
    handle_default_huge.stop()

    # Nếu truyền nhỏ hơn 1800s thì tôn trọng giá trị đó
    handle_default_short = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=600.0,
        allow_pilot_4500=False,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_default_short.effective_duration_s == 600.0
    handle_default_short.stop()

    # 2. Chế độ PILOT TƯỜNG MINH (allow_pilot_4500=True):
    # Cho phép mở rộng lên tới 4500s (PILOT_MAX_DURATION_S)
    handle_pilot_4500 = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=4500.0,
        allow_pilot_4500=True,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_pilot_4500.effective_duration_s == PILOT_MAX_DURATION_S
    assert handle_pilot_4500.effective_duration_s == 4500.0
    handle_pilot_4500.stop()

    # Nếu truyền vượt quá 4500s (ví dụ 99999s), cap tối đa tại 4500s
    handle_pilot_huge = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=99999.0,
        allow_pilot_4500=True,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_pilot_huge.effective_duration_s == 4500.0
    handle_pilot_huge.stop()


def test_loadgen_adapter_counter_not_reset_across_phases() -> None:
    """Kiểm thử: Bộ đếm Counter cửa sổ trượt 60s KHÔNG bị reset giữa các pha A, B, C, D khi chạy liên tục.

    TK-S6: Khi chạy 1 tiến trình liên tục duy nhất suốt 75 phút (4500s):
      - Pha A: t=0 -> 1800s
      - Pha B: t=1800 -> 2700s
      - Pha C: t=2700 -> 3900s
      - Pha D: t=3900 -> 4500s
    Tại ranh giới các pha (ví dụ t=1800s, t=2700s), cửa sổ trượt 60s duy trì đầy đủ (300 req),
    không bị tụt về 0 như trường hợp khởi động lại tiến trình mới (segmented).
    """
    # Khởi tạo một Counter liên tục suốt phiên chạy (như một tiến trình loadgen duy nhất)
    continuous_counter = Counter(window_s=60.0)

    # 1. Pha A (mô phỏng 60s cuối của Pha A, từ t=1740s đến t=1800s, tốc độ 5 req/s)
    # Tổng cộng 60s * 5 req/s = 300 requests
    for t_step in range(300):
        t_sec = 1740.0 + (t_step * 0.2)
        continuous_counter.record(now=t_sec, is_error=False)

    snap_end_phase_a = continuous_counter.snapshot(now=1800.0)
    assert snap_end_phase_a["requests"] == 300
    assert snap_end_phase_a["total_requests"] == 300
    assert snap_end_phase_a["error_rate"] == 0.0

    # 2. Chuyển sang Pha B: thời điểm t=1801.0s (ngay sau ranh giới Pha A -> B)
    # Thêm 5 request đầu tiên của Pha B tại t=1800.0 -> 1801.0s
    for t_step in range(5):
        t_sec = 1800.2 + (t_step * 0.2)
        continuous_counter.record(now=t_sec, is_error=False)

    snap_start_phase_b = continuous_counter.snapshot(now=1801.0)
    # Cửa sổ trượt 60s (t=1741.0 -> 1801.0) vẫn duy trì đủ 300 requests (đã trượt và evict 5 req cũ nhất)
    assert snap_start_phase_b["requests"] == 300
    # Tổng requests tích lũy tăng liên tục (305), TUYỆT ĐỐI KHÔNG BỊ RESET VỀ 0
    assert snap_start_phase_b["total_requests"] == 305

    # 3. Đối chiếu nếu khởi động lại tiến trình (segmented mode):
    # Mỗi lần tạo instance Counter mới, cửa sổ trượt bị reset về 0
    restarted_counter = Counter(window_s=60.0)
    restarted_snap = restarted_counter.snapshot(now=1800.0)
    assert restarted_snap["requests"] == 0  # Bị gián đoạn
    assert restarted_snap["total_requests"] == 0


def test_loadgen_adapter_callable_ssh_mock() -> None:
    """Kiểm thử: hỗ trợ ssh_client dạng callable (cmd) -> (code, stdout, stderr)."""
    recorded: list[str] = []
    state = {"status": None}

    def mock_runner(cmd: str) -> tuple[int, str, str]:
        recorded.append(cmd)
        if "docker run" in cmd:
            state["status"] = "running"
            return 0, "mock-out", ""
        if "docker stop" in cmd:
            state["status"] = "exited"
            return 0, "mock-out", ""
        if "docker rm" in cmd:
            state["status"] = None
            return 0, "mock-out", ""
        if "docker inspect" in cmd:
            if state["status"] is None:
                return 1, "", "No such container"
            return 0, f"{state['status']}\n", ""
        return 0, "mock-out", ""

    adapter = LoadgenAdapter()
    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_runner,
        container_name="callable-loadgen",
    )

    assert handle.mode == "ssh"
    assert handle.is_running is True
    assert any("callable-loadgen" in c for c in recorded)

    handle.stop()
    assert handle.is_running is False
    assert any("docker stop -t 2 callable-loadgen" in c for c in recorded)


def test_loadgen_adapter_ssh_shell_injection_protection_with_quotes_and_special_chars() -> (
    None
):
    """Kiểm thử: URL chứa dấu ' và ký tự shell ($ ; & |) được escape an toàn, không thể chèn lệnh."""
    mock_ssh = MockSshClient(exit_code=0)
    adapter = LoadgenAdapter()

    # URL hợp lệ trên loopback chứa dấu nháy đơn, chấm phẩy, biến môi trường và lệnh shell
    malicious_url = "http://127.0.0.1:3000/items?search='foo'&injection=$(touch /tmp/pwned);echo 'hacked'|id"

    handle = adapter.start(
        app_url=malicious_url,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )

    assert handle.is_running is True
    run_cmd = mock_ssh.executed_commands[1]

    # Phân tích lệnh shell bằng shlex.split giống hệt như shell POSIX trên VPS
    tokens = shlex.split(run_cmd)

    # 1. Chứng minh các từ khoá shell độc hại KHÔNG trở thành command độc lập
    assert "touch" not in tokens
    assert "/tmp/pwned" not in tokens
    assert "echo" not in tokens
    assert "hacked" not in tokens
    assert "id" not in tokens
    assert "|" not in tokens
    assert ";" not in tokens

    # 2. Toàn bộ chuỗi URL và query độc hại được truyền nguyên vẹn dưới dạng 1 tham số duy nhất vào APP_URL
    app_url_arg = next(t for t in tokens if t.startswith("APP_URL="))
    assert app_url_arg == f"APP_URL={malicious_url}"


def test_loadgen_adapter_docker_network_and_counter_mount_mapping() -> None:
    """Kiểm thử: Mapping mạng Docker và mount counter đường host collector đọc."""
    mock_ssh = MockSshClient(exit_code=0)
    adapter = LoadgenAdapter()

    # Ca 1: Target là host nội bộ 'app' -> tự động chọn network '<app_name>_default' và mount '/opt/opspilot/<app_name>/metrics'
    handle_internal = adapter.start(
        app_url="http://app:3000/api",
        app_name="express-demo",
        ssh_client=mock_ssh,
    )
    assert handle_internal.docker_network == "express-demo_default"
    assert handle_internal.counter_mount_dir == "/opt/opspilot/express-demo/metrics"
    run_cmd_1 = mock_ssh.executed_commands[1]
    assert "--network express-demo_default" in run_cmd_1
    assert "-v /opt/opspilot/express-demo/metrics:/var/metrics" in run_cmd_1

    # Ca 2: Target là 127.0.0.1 -> tự động chọn network 'host'
    mock_ssh.executed_commands.clear()
    handle_host = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="next-app",
        ssh_client=mock_ssh,
    )
    assert handle_host.docker_network == "host"
    assert handle_host.counter_mount_dir == "/opt/opspilot/next-app/metrics"
    run_cmd_2 = mock_ssh.executed_commands[1]
    assert "--network host" in run_cmd_2
    assert "-v /opt/opspilot/next-app/metrics:/var/metrics" in run_cmd_2

    # Ca 3: Chỉ định tường minh docker_network và counter_mount_dir
    mock_ssh.executed_commands.clear()
    handle_explicit = adapter.start(
        app_url="http://127.0.0.1:3000",
        docker_network="custom-overlay",
        counter_mount_dir="/var/custom/opspilot/metrics",
        ssh_client=mock_ssh,
    )
    assert handle_explicit.docker_network == "custom-overlay"
    assert handle_explicit.counter_mount_dir == "/var/custom/opspilot/metrics"
    run_cmd_3 = mock_ssh.executed_commands[1]
    assert "--network custom-overlay" in run_cmd_3
    assert "-v /var/custom/opspilot/metrics:/var/metrics" in run_cmd_3

    # Ca 4: Thiếu cả app_name và counter_mount_dir trong chế độ SSH -> Bị từ chối ngay lập tức
    with pytest.raises(
        ValueError, match="Bắt buộc cung cấp counter_mount_dir hoặc app_name"
    ):
        adapter.start(app_url="http://127.0.0.1:3000", ssh_client=mock_ssh)

    # Ca 5: Dùng host 'app' nhưng không có app_name và không chỉ định docker_network -> Bị từ chối
    with pytest.raises(
        ValueError,
        match="app_name là bắt buộc khi target sử dụng hostname 'app'",
    ):
        adapter.start(
            app_url="http://app:3000",
            counter_mount_dir="/opt/opspilot/demo/metrics",
            ssh_client=mock_ssh,
        )


def test_loadgen_adapter_docker_stop_failure_raises_error_and_not_marked_stopped() -> (
    None
):
    """Kiểm thử: Khi docker stop thất bại, ném LoadgenExecutionError và KHÔNG đánh dấu stopped giả."""
    mock_ssh = MockSshClient(
        exit_code=0,
        handlers={
            "docker stop": (
                1,
                "",
                "Error response from daemon: cannot stop container: context deadline exceeded",
            ),
        },
    )
    adapter = LoadgenAdapter()
    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True

    # Gọi stop() -> Bị lỗi
    with pytest.raises(LoadgenExecutionError) as exc_info:
        handle.stop()

    assert "vẫn đang chạy hoặc trạng thái không hợp lệ sau lệnh dừng" in str(
        exc_info.value
    )
    assert "mã=1" in str(exc_info.value)
    assert "context deadline exceeded" in str(exc_info.value)

    # KHÔNG ĐƯỢC đánh dấu stopped giả!
    assert handle._is_stopped is False
    assert handle.is_running is True


def test_loadgen_adapter_docker_rm_failure_raises_error_and_not_marked_stopped() -> (
    None
):
    """Kiểm thử: Khi docker rm -f thất bại, ném LoadgenExecutionError và KHÔNG đánh dấu stopped giả."""
    mock_ssh = MockSshClient(
        exit_code=0,
        handlers={
            "docker rm -f": (
                1,
                "",
                "Error response from daemon: removal of container is already in progress",
            ),
        },
    )
    adapter = LoadgenAdapter()
    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True

    # Gọi cleanup() -> Bị lỗi
    with pytest.raises(LoadgenExecutionError) as exc_info:
        handle.cleanup()

    assert "chưa biến mất sau lệnh dọn dẹp" in str(exc_info.value)
    assert "mã=1" in str(exc_info.value)
    assert "removal of container is already in progress" in str(exc_info.value)

    # KHÔNG ĐƯỢC đánh dấu stopped giả!
    assert handle._is_stopped is False
    assert handle.is_running is True


def test_loadgen_adapter_docker_rm_already_removed_is_safe() -> None:
    """Kiểm thử: Khi container đã bị xoá trước đó (No such container), cleanup hoàn tất an toàn và đánh dấu stopped."""
    mock_ssh = MockSshClient(
        exit_code=0,
        handlers={
            "docker rm -f": (
                1,
                "",
                "Error response from daemon: No such container",
            ),
        },
    )
    adapter = LoadgenAdapter()
    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True

    # Gọi cleanup() khi container không còn nữa -> an toàn, không ném lỗi
    handle.cleanup()
    assert handle.is_running is False
    assert handle._is_stopped is True


def test_loadgen_adapter_invalid_container_or_network_name() -> None:
    """Kiểm thử: từ chối container_name hoặc docker_network chứa ký tự không an toàn."""
    mock_ssh = MockSshClient(exit_code=0)
    adapter = LoadgenAdapter()

    with pytest.raises(ValueError, match="container_name không hợp lệ"):
        adapter.start(
            app_url="http://127.0.0.1:3000",
            app_name="demo-app",
            container_name="bad;name",
            ssh_client=mock_ssh,
        )

    with pytest.raises(ValueError, match="docker_network không hợp lệ"):
        adapter.start(
            app_url="http://127.0.0.1:3000",
            app_name="demo-app",
            docker_network="bad net$",
            ssh_client=mock_ssh,
        )


def test_loadgen_adapter_container_exits_immediately_raises_error() -> None:
    """Kiểm thử: container kết thúc ngay sau khi spawn (exited) -> ném LoadgenStartupError và dọn dẹp."""
    # Khi pre-check inspect chạy: trả về mã 1 (chưa có container)
    # Khi docker run -d chạy: trả về mã 0
    # Khi post-check inspect chạy: trả về mã 0 nhưng status là exited (thoát ngay!)
    mock_ssh = MockSshClient(
        exit_code=0,
        handlers={
            "docker run -d": (0, "c-failed-123\n", ""),
            "docker logs": (
                0,
                "Fatal: database connection refused on startup\n",
                "",
            ),
            "docker rm -f": (0, "", ""),
        },
        simulate_docker=False,
    )
    # Lần 1 (pre-check): chưa tồn tại -> trả 1
    # Lần 2 (post-check): container đã exited -> trả 0, "exited\n"
    inspect_calls = 0

    def mock_inspect(cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        nonlocal inspect_calls
        mock_ssh.executed_commands.append(cmd)
        inspect_calls += 1
        if inspect_calls == 1:
            return 1, "", "Error response from daemon: No such container"
        return 0, "exited\n", ""

    mock_ssh.exec_command = mock_inspect  # type: ignore[assignment]
    # Ghi đè lại handler run và logs
    original_inspect = mock_inspect

    def router(cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        if "docker inspect" in cmd:
            return original_inspect(cmd, timeout)
        mock_ssh.executed_commands.append(cmd)
        if "docker run" in cmd:
            return 0, "c-failed-123\n", ""
        if "docker logs" in cmd:
            return 0, "Fatal: database connection refused on startup\n", ""
        if "docker rm" in cmd:
            return 0, "", ""
        return 0, "", ""

    mock_ssh.exec_command = router  # type: ignore[assignment]
    adapter = LoadgenAdapter()

    with pytest.raises(LoadgenStartupError) as exc_info:
        adapter.start(
            app_url="http://127.0.0.1:3000",
            app_name="demo-app",
            ssh_client=mock_ssh,
        )

    err = str(exc_info.value)
    assert "không ở trạng thái running sau khi khởi chạy" in err
    assert "status=exited" in err
    assert "Fatal: database connection refused" in err
    # Đã gọi dọn dẹp container hỏng
    assert any("docker rm -f" in cmd for cmd in mock_ssh.executed_commands)


def test_loadgen_adapter_docker_stop_exit_code_zero_but_still_running_raises_error() -> (
    None
):
    """Kiểm thử: docker stop trả mã 0 nhưng container vẫn running -> ném LoadgenExecutionError và KHÔNG đặt _is_stopped=True."""
    mock_ssh = MockSshClient(
        exit_code=0,
        handlers={
            "docker stop": (0, "stopped-ok\n", ""),
            "docker inspect": (0, "running\n", ""),
        },
        simulate_docker=False,
    )
    # Thiết lập pre-check inspect trả mã 1 để vượt qua start
    inspect_calls = 0

    def router(cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        nonlocal inspect_calls
        mock_ssh.executed_commands.append(cmd)
        if "docker inspect" in cmd:
            inspect_calls += 1
            if inspect_calls == 1:
                return 1, "", "No such container"
            # Sau run và sau stop đều trả running
            return 0, "running\n", ""
        if "docker run" in cmd:
            return 0, "cid-123\n", ""
        if "docker stop" in cmd:
            # Lệnh stop trả mã 0 thành công
            return 0, "cid-123\n", ""
        return 0, "", ""

    mock_ssh.exec_command = router  # type: ignore[assignment]
    adapter = LoadgenAdapter()
    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True

    # Gọi stop() -> Bị lỗi vì inspect vẫn thấy running mặc dù docker stop trả mã 0
    with pytest.raises(LoadgenExecutionError) as exc_info:
        handle.stop()

    err = str(exc_info.value)
    assert "vẫn đang chạy hoặc trạng thái không hợp lệ sau lệnh dừng" in err
    assert "status=running" in err
    assert "mã=0" in err

    # KHÔNG được đặt _is_stopped=True
    assert handle._is_stopped is False
    assert handle.is_running is True


def test_loadgen_adapter_and_collector_shared_counter_mount_path(
    tmp_path: Path,
) -> None:
    """Kiểm thử: đường file chung từ mount của loadgen (/var/metrics/loadgen_counter.json) đến collector đọc (read_loadgen_error_rate)."""
    # 1. Giả lập thư mục mount trên host: /opt/opspilot/demo-app/metrics
    host_metrics_dir = tmp_path / "opt" / "opspilot" / "demo-app" / "metrics"
    host_metrics_dir.mkdir(parents=True, exist_ok=True)
    shared_counter_file = host_metrics_dir / "loadgen_counter.json"

    # 2. Kiểm tra template docker-compose: collector mount ./metrics:/var/metrics và có LOADGEN_COUNTER_PATH
    repo_root = Path(__file__).parents[2]
    compose_template = (
        repo_root / "templates" / "docker-compose.template.yml"
    ).read_text(encoding="utf-8")
    assert "LOADGEN_COUNTER_PATH: /var/metrics/loadgen_counter.json" in compose_template
    assert "./metrics:/var/metrics" in compose_template

    # 3. Giả lập Loadgen container ghi counter vào mount path
    now_wall = time.time()
    now_iso = (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    counter_payload = {
        "window_s": 60.0,
        "requests": 300,
        "errors_5xx": 15,
        "ts": now_iso,
        "source": "loadgen",
    }
    shared_counter_file.write_text(json.dumps(counter_payload), encoding="utf-8")

    # 4. Collector đọc từ đường dẫn file được mount
    error_rate, req_count = read_loadgen_error_rate(
        str(shared_counter_file), wall_now=now_wall, max_age_s=30.0
    )
    assert error_rate == pytest.approx(15 / 300)
    assert req_count == 300


def test_loadgen_adapter_avoids_blind_rm_and_protects_running_container() -> None:
    """Kiểm thử: tránh docker rm -f mù khi container không tồn tại, và từ chối xoá mù nếu container đang running."""
    # Ca 1: Container chưa tồn tại -> không có lệnh docker rm -f nào được gọi trước docker run
    mock_ssh = MockSshClient(exit_code=0, simulate_docker=True)
    adapter = LoadgenAdapter()

    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="crm-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True
    # Container name tự động theo app_name: opspilot-loadgen-crm-app
    assert handle.container_name == "opspilot-loadgen-crm-app"

    # Xác nhận các lệnh: inspect pre-check, run, inspect post-check (tuyệt đối KHÔNG có rm -f mù trước run)
    pre_run_cmds = [
        cmd for cmd in mock_ssh.executed_commands if "docker run" not in cmd
    ]
    assert not any("docker rm -f" in cmd for cmd in pre_run_cmds)

    # Ca 2: Container ĐANG CHẠY của một phiên khác -> từ chối xoá mù, ném LoadgenStartupError
    running_ssh = MockSshClient(
        exit_code=0,
        handlers={
            "docker inspect": (0, "running\n", ""),
        },
        simulate_docker=False,
    )
    with pytest.raises(LoadgenStartupError) as exc_info:
        adapter.start(
            app_url="http://127.0.0.1:3000",
            app_name="crm-app",
            ssh_client=running_ssh,
        )

    assert "đang chạy trên VPS" in str(exc_info.value)
    assert "Tránh xoá mù để không làm gián đoạn phiên khác" in str(exc_info.value)
    assert not any("docker rm -f" in cmd for cmd in running_ssh.executed_commands)


def test_loadgen_adapter_docker_stop_inspect_empty_error_raises_execution_error() -> (
    None
):
    """Kiểm thử: sau docker stop, inspect trả lỗi mã khác 0 nhưng stderr rỗng (không có 'No such container') -> ném LoadgenExecutionError và giữ _is_stopped=False."""
    mock_ssh = MockSshClient(exit_code=0, simulate_docker=True)
    adapter = LoadgenAdapter()

    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True

    # Cài đặt router: docker stop trả về 0, nhưng inspect sau stop trả về (1, "", "")
    # (lỗi rỗng, không phải "No such container")
    def router(cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        mock_ssh.executed_commands.append(cmd)
        if "docker stop" in cmd:
            return 0, "demo-app\n", ""
        if "docker inspect" in cmd:
            # Lỗi rỗng: exit code 1, không có message lỗi rõ ràng
            return 1, "", ""
        return 0, "", ""

    mock_ssh.exec_command = router  # type: ignore[assignment]

    with pytest.raises(LoadgenExecutionError) as exc_info:
        handle.stop()

    err = str(exc_info.value)
    assert "Không thể xác nhận trạng thái container" in err
    assert "lỗi rỗng hoặc mất kết nối" in err
    assert "mã=1" in err

    # Bắt buộc giữ _is_stopped = False
    assert handle._is_stopped is False


def test_loadgen_adapter_docker_cleanup_inspect_empty_error_raises_execution_error() -> (
    None
):
    """Kiểm thử: sau cleanup (docker rm -f), inspect trả lỗi rỗng -> ném LoadgenExecutionError và giữ _is_stopped=False."""
    mock_ssh = MockSshClient(exit_code=0, simulate_docker=True)
    adapter = LoadgenAdapter()

    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True

    # Cài đặt router: docker rm -f trả về 0, nhưng inspect sau cleanup trả về (1, "", "")
    def router(cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        mock_ssh.executed_commands.append(cmd)
        if "docker rm" in cmd:
            return 0, "", ""
        if "docker inspect" in cmd:
            return 1, "", ""
        return 0, "", ""

    mock_ssh.exec_command = router  # type: ignore[assignment]

    with pytest.raises(LoadgenExecutionError) as exc_info:
        handle.cleanup()

    err = str(exc_info.value)
    assert "Không thể xác nhận container" in err
    assert "đã biến mất sau cleanup" in err
    assert "lỗi rỗng hoặc mất kết nối" in err
    assert "mã=1" in err

    # Bắt buộc giữ _is_stopped = False
    assert handle._is_stopped is False


def test_loadgen_adapter_container_dies_after_successful_start_detected_by_runner() -> (
    None
):
    """Kiểm thử: container chết sau khi start thành công được phát hiện qua is_running và assert_running().

    Runner trong suốt các pha A-D gọi assert_running() để phát hiện container bị thoát sớm,
    không dựa riêng vào cờ _is_stopped trong handle.
    """
    mock_ssh = MockSshClient(exit_code=0, simulate_docker=True)
    adapter = LoadgenAdapter()

    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    # Lúc đầu container đang chạy thực tế
    assert handle.is_running is True
    handle.assert_running()  # Không ném lỗi

    # Ca 1: Container bị crash/exit trên VPS trong quá trình thí nghiệm (status='exited')
    mock_ssh.containers[handle.container_name] = "exited"

    # is_running truy vấn thực tế trên VPS và trả về False dù _is_stopped vẫn là False!
    assert handle._is_stopped is False
    assert handle.is_running is False

    with pytest.raises(LoadgenExecutionError) as exc_info:
        handle.assert_running()

    err_exited = str(exc_info.value)
    assert "không còn ở trạng thái running trên VPS" in err_exited
    assert "status=exited" in err_exited

    # Ca 2: Container bị xoá hoặc biến mất hoàn toàn trên VPS
    mock_ssh.containers.pop(handle.container_name, None)
    assert handle.is_running is False

    with pytest.raises(LoadgenExecutionError) as exc_info_gone:
        handle.assert_running()

    err_gone = str(exc_info_gone.value)
    assert "không tồn tại hoặc không thể inspect trên VPS" in err_gone
    assert "No such container" in err_gone


def test_loadgen_adapter_assert_running_ssh_connection_error() -> None:
    """Kiểm thử: khi mất kết nối SSH khi runner kiểm tra sống, assert_running() ném LoadgenExecutionError."""
    mock_ssh = MockSshClient(exit_code=0, simulate_docker=True)
    adapter = LoadgenAdapter()

    handle = adapter.start(
        app_url="http://127.0.0.1:3000",
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle.is_running is True

    # Giả lập mất kết nối SSH
    def broken_ssh(cmd: str, timeout: float | None = None) -> tuple[int, str, str]:
        raise RuntimeError("SSH connection reset by peer")

    mock_ssh.exec_command = broken_ssh  # type: ignore[assignment]

    # is_running an toàn trả về False
    assert handle.is_running is False

    # assert_running ném LoadgenExecutionError với nguyên nhân SSH
    with pytest.raises(LoadgenExecutionError) as exc_info:
        handle.assert_running()

    assert "Lỗi SSH khi kiểm tra trạng thái container" in str(exc_info.value)
    assert "SSH connection reset by peer" in str(exc_info.value)
