from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


COLLECTOR_VERSION = "1.0.0"
METRIC_FIELDS = (
    "seq",
    "ts",
    "cpu_pct",
    "mem_mb",
    "mem_pct",
    "mem_limit_mb",
    "latency_ms",
    "http_error_rate",
    "db_response_ms",
    "host_cpu_pct",
    "host_mem_pct",
    "container_up",
    "collector_version",
)


@dataclass(frozen=True)
class Config:
    interval_s: float = 10.0
    app_container_name: str = ""
    app_url: str = ""
    probe_timeout_s: float = 5.0
    error_window_s: float = 60.0
    db_dsn: str = ""
    metrics_dir: Path = Path("/var/metrics")
    max_file_mb: float = 50.0

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            interval_s=_env_float("COLLECT_INTERVAL_S", 10.0),
            app_container_name=os.getenv("APP_CONTAINER_NAME", ""),
            app_url=os.getenv("APP_URL", ""),
            probe_timeout_s=_env_float("PROBE_TIMEOUT_S", 5.0),
            error_window_s=_env_float("ERROR_WINDOW_S", 60.0),
            db_dsn=os.getenv("DB_DSN", ""),
            metrics_dir=Path(os.getenv("METRICS_DIR", "/var/metrics")),
            max_file_mb=_env_float("MAX_FILE_MB", 50.0),
        )


def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, str(default))))
    except ValueError:
        return default


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_percent(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.strip().rstrip("%"))
    except ValueError:
        return None


def parse_memory_mb(value: str | None) -> float | None:
    """Parse a Docker memory value such as ``210.5MiB`` into MB."""
    if not value:
        return None
    text = value.strip()
    units = (
        ("GiB", 1024.0),
        ("GIB", 1024.0),
        ("GB", 1000.0),
        ("MiB", 1.0),
        ("MIB", 1.0),
        ("MB", 1.0),
        ("KiB", 1 / 1024),
        ("KB", 1 / 1000),
        ("B", 1 / (1024 * 1024)),
    )
    for unit, factor in units:
        if text.upper().endswith(unit.upper()):
            try:
                return float(text[: -len(unit)].strip()) * factor
            except ValueError:
                return None
    try:
        return float(text) / (1024 * 1024)
    except ValueError:
        return None


def parse_docker_stats(raw: str) -> dict[str, float] | None:
    try:
        payload: dict[str, Any] = json.loads(raw)
        if not isinstance(payload, dict):
            return None
        usage = str(payload.get("MemUsage", "")).split("/", 1)
        memory = parse_memory_mb(usage[0]) if usage else None
        limit = parse_memory_mb(usage[1]) if len(usage) == 2 else None
        cpu = parse_percent(str(payload.get("CPUPerc", "")))
        mem_pct = parse_percent(str(payload.get("MemPerc", "")))
        if cpu is None and memory is None and mem_pct is None:
            return None
        return {
            "cpu_pct": cpu,
            "mem_mb": memory,
            "mem_pct": mem_pct,
            "mem_limit_mb": limit,
        }
    except (TypeError, json.JSONDecodeError):
        return None


def read_docker_stats(container_name: str) -> dict[str, float] | None:
    if not container_name:
        return None
    try:
        result = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{json .}}", container_name],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return parse_docker_stats(result.stdout.strip())


def probe_http(url: str, timeout_s: float) -> tuple[float | None, int | None]:
    if not url:
        return None, None
    try:
        import requests

        started = time.perf_counter()
        response = requests.get(url, timeout=timeout_s)
        latency_ms = (time.perf_counter() - started) * 1000
        return latency_ms, response.status_code
    except Exception:
        return None, None


def probe_db(dsn: str, timeout_s: float) -> float | None:
    if not dsn:
        return None
    try:
        import psycopg2

        started = time.perf_counter()
        with psycopg2.connect(dsn, connect_timeout=max(1, int(timeout_s))) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        return (time.perf_counter() - started) * 1000
    except Exception:
        return None


def read_host_metrics() -> tuple[float | None, float | None]:
    """Return best-effort host CPU and memory percentages on Linux."""
    try:
        load_1m = float(Path("/proc/loadavg").read_text(encoding="ascii").split()[0])
        host_cpu = min(100.0, load_1m / max(1, os.cpu_count() or 1) * 100)
    except (OSError, ValueError, IndexError):
        host_cpu = None
    try:
        values: dict[str, float] = {}
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            key, raw = line.split(":", 1)
            values[key] = float(raw.strip().split()[0])
        total = values.get("MemTotal")
        available = values.get("MemAvailable")
        host_mem = (1 - available / total) * 100 if total and available is not None else None
    except (OSError, ValueError, IndexError):
        host_mem = None
    return host_cpu, host_mem


def read_last_seq(metrics_path: Path) -> int:
    if not metrics_path.exists():
        return 0
    try:
        lines = metrics_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0
    for line in reversed(lines):
        try:
            sequence = int(json.loads(line).get("seq", 0))
            if sequence >= 1:
                return sequence
        except (ValueError, TypeError, json.JSONDecodeError):
            continue
    return 0


def rotate_if_needed(metrics_path: Path, max_file_mb: float) -> None:
    if max_file_mb <= 0 or not metrics_path.exists():
        return
    if metrics_path.stat().st_size <= max_file_mb * 1024 * 1024:
        return
    rotated = metrics_path.with_name(f"{metrics_path.name}.1")
    try:
        metrics_path.replace(rotated)
    except OSError:
        return


def write_metric(metrics_dir: Path, metric: dict[str, Any], max_file_mb: float = 50.0) -> None:
    metrics_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = metrics_dir / "metrics.jsonl"
    latest_path = metrics_dir / "latest.json"
    rotate_if_needed(metrics_path, max_file_mb)
    payload = {field: metric.get(field) for field in METRIC_FIELDS}
    line = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    if len(line.encode("utf-8")) > 4096:
        raise ValueError("metric line exceeds 4KB contract limit")
    with metrics_path.open("a", encoding="utf-8") as stream:
        stream.write(line + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary = latest_path.with_name("latest.json.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        stream.write(line)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(latest_path)


def update_error_window(
    errors: deque[tuple[float, bool]], now: float, status_code: int | None, window_s: float
) -> float | None:
    """Đẩy kết quả probe vào cửa sổ trượt; probe fail hoặc 5xx tính là lỗi (chốt với B)."""
    errors.append((now, status_code is None or status_code >= 500))
    while errors and now - errors[0][0] > window_s:
        errors.popleft()
    return sum(item[1] for item in errors) / len(errors) if errors else None


def build_metric(seq: int, config: Config, errors: deque[tuple[float, bool]]) -> dict[str, Any]:
    stats = read_docker_stats(config.app_container_name)
    latency_ms, status_code = probe_http(config.app_url, config.probe_timeout_s)
    now = time.monotonic()
    error_rate = (
        update_error_window(errors, now, status_code, config.error_window_s)
        if config.app_url
        else None
    )
    host_cpu, host_mem = read_host_metrics()
    return {
        "seq": seq,
        "ts": utc_timestamp(),
        "cpu_pct": stats.get("cpu_pct") if stats else None,
        "mem_mb": stats.get("mem_mb") if stats else None,
        "mem_pct": stats.get("mem_pct") if stats else None,
        "mem_limit_mb": stats.get("mem_limit_mb") if stats else None,
        "latency_ms": latency_ms,
        "http_error_rate": error_rate,
        "db_response_ms": probe_db(config.db_dsn, config.probe_timeout_s),
        "host_cpu_pct": host_cpu,
        "host_mem_pct": host_mem,
        "container_up": int(stats is not None and (not config.app_url or status_code is not None)),
        "collector_version": COLLECTOR_VERSION,
    }


def run() -> None:
    config = Config.from_env()
    config.metrics_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = config.metrics_dir / "metrics.jsonl"
    sequence = read_last_seq(metrics_path) + 1
    errors: deque[tuple[float, bool]] = deque()
    stopping = False

    def request_stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, request_stop)

    while not stopping:
        started = time.perf_counter()
        try:
            write_metric(
                config.metrics_dir,
                build_metric(sequence, config, errors),
                config.max_file_mb,
            )
            sequence += 1
        except Exception as exc:  # collector must keep running after a bad probe or disk hiccup
            print(f"collector error: {exc}", flush=True)
        time.sleep(max(0.0, config.interval_s - (time.perf_counter() - started)))


if __name__ == "__main__":
    run()
