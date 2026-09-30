"""Orchestrator một run thí nghiệm (TK-S6, docs/07 mục 7). PHẦN I/O.

Ghép các mảnh thuần đã test (`protocol.py`, `faults/scheduler.py`) với deploy/SSH/ml-service.
KHÔNG chứa logic tính điểm — mọi định nghĩa ăn điểm nằm ở module thuần có test. Import `requests`
và `paramiko` bên trong hàm (như collector/loadgen) để module import được ở máy chưa cài chúng;
toàn bộ file có `# pragma: no cover` vì chỉ chạy với VPS + app thật.

Chạy:
    python experiments/run_experiment.py --scenario memory_leak --repeat 1 --vps 1 \
        --app-url http://<vps>:<port> --ml-url http://127.0.0.1:8000 --deployment-id 42

An toàn: script này CHỈ điều phối; nó không tự deploy/xoá gì trên VPS ngoài các bước docs/07 mục 7
và luôn tắt fault + dừng load-gen ở teardown. Không chạy khi đã có experiment_run status='running'
cho cùng (scenario, repeat) — người gọi kiểm tra trước (CLAUDE.md mục 9).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from faults.scheduler import apply_plan, plan_fault, reset_fault
from protocol import (
    clock_offset_ms,
    clock_skew_too_large,
    enough_train_samples,
    phase_schedule,
)


def _log(step: str, message: str) -> None:  # pragma: no cover
    print(f"[{time.strftime('%H:%M:%S')}] {step}: {message}", flush=True)


def measure_clock_offset_ms(ssh_host: str, ssh_user: str, ssh_port: int) -> int:  # pragma: no cover
    """docs/07 mục 3 bước 2: so `date +%s%3N` trên VPS với time.time()*1000 local."""
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ssh_host, port=ssh_port, username=ssh_user, timeout=10)
    try:
        local_ms = time.time() * 1000
        _stdin, stdout, _stderr = client.exec_command("date +%s%3N")
        vps_ms = float(stdout.read().decode().strip())
        return clock_offset_ms(vps_ms, local_ms)
    finally:
        client.close()


def wait_phase(seconds: float, label: str) -> None:  # pragma: no cover
    _log("WAIT", f"{label}: chờ {seconds/60:.0f} phút")
    time.sleep(seconds)


def post_json(url: str, payload: dict, timeout: float = 30.0) -> dict:  # pragma: no cover
    import requests

    response = requests.post(url, json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()


def run_once(args: argparse.Namespace) -> int:  # pragma: no cover
    """Chạy một run đầy đủ A→D. Trả 0 nếu completed, khác 0 nếu aborted."""
    # 1. Lệch đồng hồ (docs/07 mục 3).
    offset = measure_clock_offset_ms(args.ssh_host, args.ssh_user, args.ssh_port)
    _log("CLOCK", f"offset {offset}ms")
    if clock_skew_too_large(offset):
        _log("ABORT", f"clock_skew {offset}ms > 2000ms — sửa NTP rồi chạy lại")
        return 2

    # 2-4. (Deploy sạch / POST /reset / start load-gen) — thực hiện qua pipeline app + compose
    #      thí nghiệm. Ở đây gọi các lệnh đã có; giữ tường minh để người vận hành thấy từng bước.
    _log("RESET", "POST /reset ml-service")
    post_json(f"{args.ml_url}/reset", {"deployment_id": args.deployment_id})

    # 5. baseline_start = giờ VPS hiện tại (local + offset).
    baseline_start_ts = time.time() + offset / 1000.0
    _sched = phase_schedule(baseline_start_ts)
    _log("START", f"baseline_start_ts(vps)={baseline_start_ts:.0f}, fault ở +{45}min")

    # 6. Pha A 30' -> kiểm ≥180 mẫu -> POST /train.
    wait_phase(30 * 60, "A BASELINE_TRAIN")
    sample_count = args.get_sample_count()  # người gọi truyền hàm đếm mẫu (đọc DB/metrics)
    if not enough_train_samples(sample_count):
        _log("ABORT", f"insufficient_samples: {sample_count} < 90% của 180")
        return 3
    _log("TRAIN", f"POST /train với {sample_count} mẫu")
    post_json(f"{args.ml_url}/train", {"deployment_id": args.deployment_id})

    # 7. Pha B 15' (holdout).
    wait_phase(15 * 60, "B NORMAL_HOLDOUT")

    # 8. fault_start -> kích hoạt fault -> pha C 20'.
    _log("FAULT", f"fault_start_ts(vps)≈{time.time() + offset/1000.0:.0f}, scenario={args.scenario}")
    plan = plan_fault(args.scenario)
    apply_plan(args.app_url, plan)  # chạy đúng 20' theo lịch

    # 9. Tắt fault -> pha D 10'.
    reset_fault(args.app_url)
    _log("RECOVERY", "fault reset, chờ pha D")
    wait_phase(10 * 60, "D RECOVERY")

    _log("DONE", "run completed — chạy export_results.py để xuất CSV")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="OpsPilot experiment orchestrator (docs/07)")
    parser.add_argument("--scenario", required=True,
                        choices=["memory_leak", "cpu_spike", "error_burst", "slow_db",
                                 "latency_creep"])
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--vps", type=int, default=1)
    parser.add_argument("--app-url", required=True, help="URL app demo trên VPS")
    parser.add_argument("--ml-url", default="http://127.0.0.1:8000")
    parser.add_argument("--deployment-id", type=int, required=True)
    parser.add_argument("--ssh-host", required=True)
    parser.add_argument("--ssh-user", default="root")
    parser.add_argument("--ssh-port", type=int, default=22)
    return parser


if __name__ == "__main__":  # pragma: no cover
    _args = build_parser().parse_args()
    _log("INFO", "run_experiment cần hàm đếm mẫu từ DB; chạy qua wrapper của app, không trực tiếp.")
    raise SystemExit(
        "run_experiment.py là khung điều phối; tích hợp đếm mẫu + deploy do lớp app gọi. "
        "Xem docs/07 mục 7 và tk-s6."
    )
