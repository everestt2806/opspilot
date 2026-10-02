"""Tests cho LoadgenAdapter và cấu hình pilot 4500s tường minh (TK-S6 P2d-3)."""

from __future__ import annotations

import shlex
import sys
import time
from pathlib import Path

import pytest

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
    """Mock SSH client ghi lại các lệnh thực thi và trả về kết quả giả lập."""

    def __init__(
        self,
        exit_code: int = 0,
        stdout: str = "",
        stderr: str = "",
        handlers: dict[str, tuple[int, str, str]] | None = None,
    ) -> None:
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.handlers = handlers or {}
        self.executed_commands: list[str] = []

    def exec_command(
        self, command: str, timeout: float | None = None
    ) -> tuple[int, str, str]:
        self.executed_commands.append(command)
        for pattern, response in self.handlers.items():
            if pattern in command:
                return response
        return self.exit_code, self.stdout, self.stderr


def test_loadgen_adapter_start_and_stop_ssh_mock() -> None:
    """Kiểm thử: start và stop loadgen container trên VPS qua mock SSH."""
    mock_ssh = MockSshClient(exit_code=0, stdout="container-12345\n")
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

    # Kiểm tra lệnh SSH đã thực thi
    assert len(mock_ssh.executed_commands) == 2
    # 1. Pre-cleanup
    assert "docker rm -f opspilot-loadgen" in mock_ssh.executed_commands[0]
    # 2. Docker run
    run_cmd = mock_ssh.executed_commands[1]
    assert "docker run -d --name opspilot-loadgen" in run_cmd
    assert "--network host" in run_cmd
    assert "-e APP_URL=http://127.0.0.1:3000" in run_cmd
    assert "-e LOADGEN_RATE_RPS=5.0" in run_cmd
    assert "-e LOADGEN_DURATION_S=1800.0" in run_cmd
    assert "-e LOADGEN_PILOT_4500=false" in run_cmd
    assert "-v /opt/opspilot/demo-app/metrics:/var/metrics" in run_cmd

    # Stop container
    handle.stop()
    assert handle.is_running is False
    assert len(mock_ssh.executed_commands) == 3
    assert "docker stop -t 2 opspilot-loadgen" in mock_ssh.executed_commands[2]


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
        "docker rm -f opspilot-loadgen" in cmd for cmd in mock_ssh.executed_commands
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

    handle_default_huge = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=99999.0,
        allow_pilot_4500=False,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_default_huge.effective_duration_s == 1800.0

    # Nếu truyền nhỏ hơn 1800s thì tôn trọng giá trị đó
    handle_default_short = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=600.0,
        allow_pilot_4500=False,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_default_short.effective_duration_s == 600.0

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

    # Nếu truyền vượt quá 4500s (ví dụ 99999s), cap tối đa tại 4500s
    handle_pilot_huge = adapter.start(
        app_url="http://127.0.0.1:3000",
        duration_s=99999.0,
        allow_pilot_4500=True,
        app_name="demo-app",
        ssh_client=mock_ssh,
    )
    assert handle_pilot_huge.effective_duration_s == 4500.0


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

    def mock_runner(cmd: str) -> tuple[int, str, str]:
        recorded.append(cmd)
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
            "docker inspect": (0, "running\n", ""),
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

    assert "Không thể dừng container" in str(exc_info.value)
    assert "mã 1" in str(exc_info.value)
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
            "docker rm -f opspilot-loadgen": (
                1,
                "",
                "Error response from daemon: removal of container is already in progress",
            ),
            "docker inspect": (0, "removing\n", ""),
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

    assert "Không thể dọn dẹp container" in str(exc_info.value)
    assert "mã 1" in str(exc_info.value)
    assert "removal of container is already in progress" in str(exc_info.value)

    # KHÔNG ĐƯỢC đánh dấu stopped giả!
    assert handle._is_stopped is False
    assert handle.is_running is True


def test_loadgen_adapter_docker_rm_already_removed_is_safe() -> None:
    """Kiểm thử: Khi container đã bị xoá trước đó (No such container), cleanup hoàn tất an toàn và đánh dấu stopped."""
    mock_ssh = MockSshClient(
        exit_code=0,
        handlers={
            "docker rm -f opspilot-loadgen": (
                1,
                "",
                "Error response from daemon: No such container: opspilot-loadgen",
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
