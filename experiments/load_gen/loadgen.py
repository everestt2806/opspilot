"""Load generator cho thí nghiệm OpsPilot (TK-S6, docs/07 mục 2).

Chạy trong container TRÊN VPS (không phải laptop) để jitter internet không lẫn vào
`latency_ms`. Bắn traffic cố định 5 req/s, mix 70% GET /items · 20% GET /items/:id ·
10% POST /items, seed 42. Chạy liên tục suốt pha A→D, cường độ không đổi.

Vá data-path `http_error_rate` (docs/07 mục 2, ghi chú rà soát 28/07): load generator
công bố bộ đếm request/5xx theo cửa sổ 60s ra file JSON ghi nguyên tử; collector đọc file
đó để tính error rate thật thay cho ước lượng từ 1 probe/10s. Chỉ ghi file — không mở port,
đúng quy tắc "không mở thêm port trên VPS" (CLAUDE.md mục 3).

Giữ tối thiểu như collector: chỉ dùng `requests` (dependency đã duyệt experiments/, docs/09).
Bảo lưu toàn bộ giới hạn an toàn: MAX_RPS=50.0, MAX_DURATION_S=30 phút, kiểm tra target lab,
và hỗ trợ kill-switch bằng file `loadgen.stop`.
"""

from __future__ import annotations

import collections
import ipaddress
import json
import os
import random
import signal
import socket
import threading
import time
import urllib.parse
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LOADGEN_VERSION = "1.0.0"

# Giới hạn an toàn (không phải công cụ DDoS)
MAX_RPS = 50.0
DEFAULT_MAX_DURATION_S = 30 * 60.0  # 1800.0s (30 phút mặc định)
PILOT_MAX_DURATION_S = 75 * 60.0  # 4500.0s (75 phút cho pilot tường minh)
MAX_DURATION_S = int(DEFAULT_MAX_DURATION_S)  # Giữ tương thích ngược

# Mix cố định (docs/07): cộng dồn để chọn theo một lần random().
# 0.00–0.70 GET list · 0.70–0.90 GET detail · 0.90–1.00 POST create.
_MIX_LIST = 0.70
_MIX_DETAIL = 0.90  # 0.70 + 0.20


@dataclass
class Stats:
    total: int = 0
    errors: int = 0
    status: collections.Counter[int] | None = None

    def __post_init__(self) -> None:
        self.status = collections.Counter()

    def record(self, status: int) -> None:
        self.total += 1
        if self.status is not None:
            self.status[status] += 1
        if status >= 500:
            self.errors += 1

    def payload(self) -> dict[str, object]:
        return {
            "total": self.total,
            "errors": self.errors,
            "error_rate": self.errors / self.total if self.total else 0.0,
            "status": dict(self.status) if self.status is not None else {},
        }


def _is_private_or_loopback(host: str) -> bool:
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False
    return all(
        ipaddress.ip_address(item[4][0]).is_private
        or ipaddress.ip_address(item[4][0]).is_loopback
        for item in addresses
    )


def validate_target(
    url: str, allowlist: set[str] | tuple[str, ...] | None = None
) -> tuple[str, int]:
    """Bắt buộc kiểm tra target trước khi chạy. Từ chối host public không nằm trong allowlist."""
    allowed = set(allowlist) if allowlist else set()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("target phải là URL http://host:port trong lab")
    host = parsed.hostname
    if host not in allowed and not _is_private_or_loopback(host):
        raise ValueError(
            "target public chưa nằm trong allowlist; refuse để tránh tải ngoài phạm vi"
        )
    return host, parsed.port or (443 if parsed.scheme == "https" else 80)


@dataclass(frozen=True)
class Config:
    app_url: str = ""  # ví dụ http://app:3000 (trong docker network của run)
    rate_rps: float = 5.0  # request/giây (docs/07)
    counter_window_s: float = 60.0  # cửa sổ trượt cho http_error_rate
    counter_path: Path = Path("/var/metrics/loadgen_counter.json")
    detail_max_id: int = 1000  # seed 1000 bản ghi (server.js SEED_COUNT)
    random_state: int = 42
    request_timeout_s: float = 5.0
    duration_s: float = float(DEFAULT_MAX_DURATION_S)
    stop_file: Path = Path("loadgen.stop")
    allow_hosts: tuple[str, ...] = ("localhost", "127.0.0.1", "::1", "app")
    allow_pilot_4500: bool = False

    def __post_init__(self) -> None:
        max_limit = (
            PILOT_MAX_DURATION_S if self.allow_pilot_4500 else DEFAULT_MAX_DURATION_S
        )
        effective = (
            min(self.duration_s, float(max_limit))
            if self.duration_s > 0
            else float(max_limit)
        )
        object.__setattr__(self, "duration_s", effective)

    @classmethod
    def from_env(cls) -> Config:
        rate = _env_float("LOADGEN_RATE_RPS", 5.0)
        rate = min(rate, MAX_RPS)
        allow_pilot = os.getenv("LOADGEN_PILOT_4500", "").lower() in (
            "true",
            "1",
            "yes",
        )
        max_limit = PILOT_MAX_DURATION_S if allow_pilot else DEFAULT_MAX_DURATION_S
        raw_duration = _env_float("LOADGEN_DURATION_S", float(DEFAULT_MAX_DURATION_S))
        duration = (
            min(raw_duration, float(max_limit))
            if raw_duration > 0
            else float(max_limit)
        )
        allow_env = os.getenv(
            "LOADGEN_ALLOW_HOSTS", os.getenv("LOADGEN_ALLOW_HOST", "")
        )
        hosts = {"localhost", "127.0.0.1", "::1", "app"}
        if allow_env:
            hosts.update(h.strip() for h in allow_env.split(",") if h.strip())
        return cls(
            app_url=os.getenv("APP_URL", "").rstrip("/"),
            rate_rps=rate,
            counter_window_s=_env_float("LOADGEN_WINDOW_S", 60.0),
            counter_path=Path(
                os.getenv("LOADGEN_COUNTER_PATH", "/var/metrics/loadgen_counter.json")
            ),
            detail_max_id=int(_env_float("LOADGEN_DETAIL_MAX_ID", 1000.0)),
            random_state=int(_env_float("LOADGEN_RANDOM_STATE", 42.0)),
            request_timeout_s=_env_float("LOADGEN_TIMEOUT_S", 5.0),
            duration_s=duration,
            stop_file=Path(os.getenv("LOADGEN_STOP_FILE", "loadgen.stop")),
            allow_hosts=tuple(sorted(hosts)),
            allow_pilot_4500=allow_pilot,
        )


def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, str(default))))
    except ValueError:
        return default


def pick_request(
    rng: random.Random, detail_max_id: int
) -> tuple[str, str, dict[str, Any] | None]:
    """Chọn 1 request theo mix cố định. Trả (method, path, json_body|None).

    Thuần + nhận rng để test tái lập được với cùng seed.
    """
    roll = rng.random()
    if roll < _MIX_LIST:
        return "GET", "/items?limit=100&offset=0", None
    if roll < _MIX_DETAIL:
        item_id = rng.randint(1, max(1, detail_max_id))
        return "GET", f"/items/{item_id}", None
    suffix = rng.randint(1, 1_000_000)
    return "POST", "/items", {"name": f"loadgen-{suffix}"}


class Counter:
    """Bộ đếm request/5xx theo cửa sổ trượt, an toàn cho nhiều luồng.

    `snapshot()` trả tổng trong `window_s` gần nhất — đây là số collector đọc để tính
    `http_error_rate = errors_5xx / requests`.
    """

    def __init__(self, window_s: float) -> None:
        self._window_s = window_s
        self._events: deque[tuple[float, bool]] = deque()
        self._total_requests = 0
        self._total_errors = 0
        self._lock = threading.Lock()

    def record(self, now: float, is_error: bool) -> None:
        with self._lock:
            self._events.append((now, is_error))
            self._total_requests += 1
            if is_error:
                self._total_errors += 1
            self._evict(now)

    def _evict(self, now: float) -> None:
        while self._events and now - self._events[0][0] > self._window_s:
            self._events.popleft()

    def snapshot(self, now: float) -> dict[str, Any]:
        with self._lock:
            self._evict(now)
            requests = len(self._events)
            errors = sum(1 for _, is_error in self._events if is_error)
            return {
                "window_s": self._window_s,
                "requests": requests,
                "errors_5xx": errors,
                "error_rate": (errors / requests) if requests else None,
                "total_requests": self._total_requests,
                "total_errors_5xx": self._total_errors,
                "loadgen_version": LOADGEN_VERSION,
            }


def write_counter(counter_path: Path, payload: dict[str, Any], ts_iso: str) -> None:
    """Ghi nguyên tử bộ đếm ra file (tmp + replace) để collector không đọc phải file dở."""
    counter_path.parent.mkdir(parents=True, exist_ok=True)
    body = dict(payload)
    body["ts"] = ts_iso
    line = json.dumps(body, separators=(",", ":"), ensure_ascii=True)
    temporary = counter_path.with_name(counter_path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        stream.write(line)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(counter_path)


def _utc_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _send_one(
    session: Any, config: Config, method: str, path: str, body: dict[str, Any] | None
) -> bool:
    """Gửi 1 request, trả True nếu tính là lỗi (5xx hoặc kết nối hỏng)."""
    url = f"{config.app_url}{path}"
    try:
        if method == "POST":
            response = session.post(url, json=body, timeout=config.request_timeout_s)
        else:
            response = session.get(url, timeout=config.request_timeout_s)
        return bool(response.status_code >= 500)
    except Exception:  # noqa: BLE001
        return True


def run(config: Config | None = None) -> None:  # pragma: no cover - vòng lặp mạng
    import requests

    if config is None:
        config = Config.from_env()
    if not config.app_url:
        raise SystemExit("LOADGEN: thiếu APP_URL")

    # 1. Bắt buộc kiểm tra target trước khi loadgen chạy
    validate_target(config.app_url, config.allow_hosts)

    if config.rate_rps <= 0 or config.rate_rps > MAX_RPS:
        raise ValueError(f"rate_rps phải trong (0, {MAX_RPS}]")

    # 2. Giới hạn thời lượng: mặc định tối đa 1800s, chỉ cho phép mở tối đa 4500s khi bật pilot tường minh
    max_limit = (
        PILOT_MAX_DURATION_S if config.allow_pilot_4500 else DEFAULT_MAX_DURATION_S
    )
    effective_duration = (
        min(config.duration_s, float(max_limit))
        if config.duration_s > 0
        else float(max_limit)
    )
    stop_file = config.stop_file

    rng = random.Random(config.random_state)
    counter = Counter(config.counter_window_s)
    session = requests.Session()
    interval = 1.0 / config.rate_rps if config.rate_rps > 0 else 0.2
    stopping = False

    def request_stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, request_stop)

    deadline = time.monotonic() + effective_duration
    last_counter_write = 0.0

    # 3. Chạy có kiểm tra deadline và kill-switch file (loadgen.stop)
    while not stopping and time.monotonic() < deadline and not stop_file.exists():
        started = time.perf_counter()
        method, path, body = pick_request(rng, config.detail_max_id)
        is_error = _send_one(session, config, method, path, body)
        counter.record(time.monotonic(), is_error)

        # Ghi bộ đếm mỗi ~1s để collector (chu kỳ 10s) luôn có số mới.
        if started - last_counter_write >= 1.0:
            write_counter(
                config.counter_path, counter.snapshot(time.monotonic()), _utc_iso()
            )
            last_counter_write = started

        elapsed = time.perf_counter() - started
        time.sleep(max(0.0, interval - elapsed))

    # Ghi lần cuối khi dừng để số phản ánh trạng thái mới nhất.
    write_counter(config.counter_path, counter.snapshot(time.monotonic()), _utc_iso())


if __name__ == "__main__":  # pragma: no cover
    run()
