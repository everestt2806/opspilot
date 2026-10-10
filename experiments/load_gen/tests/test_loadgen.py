import json
import random
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from loadgen import (
    MAX_DURATION_S,
    Config,
    Counter,
    pick_request,
    run,
    validate_target,
    write_counter,
)


def test_mix_distribution_70_20_10():
    rng = random.Random(42)
    counts = {"list": 0, "detail": 0, "create": 0}
    n = 100_000
    for _ in range(n):
        method, path, _body = pick_request(rng, 1000)
        if method == "GET" and path.startswith("/items?"):
            counts["list"] += 1
        elif method == "GET" and path.startswith("/items/"):
            counts["detail"] += 1
        elif method == "POST":
            counts["create"] += 1
        else:  # pragma: no cover
            raise AssertionError(f"request lạ: {method} {path}")
    assert abs(counts["list"] / n - 0.70) < 0.01
    assert abs(counts["detail"] / n - 0.20) < 0.01
    assert abs(counts["create"] / n - 0.10) < 0.01


def test_pick_request_deterministic_same_seed():
    a = [pick_request(random.Random(42), 1000) for _ in range(50)]
    b = [pick_request(random.Random(42), 1000) for _ in range(50)]
    assert a == b


def test_detail_id_in_range():
    rng = random.Random(7)
    for _ in range(5000):
        method, path, _ = pick_request(rng, 1000)
        if method == "GET" and path.startswith("/items/"):
            item_id = int(path.rsplit("/", 1)[1])
            assert 1 <= item_id <= 1000


def test_post_body_has_name():
    rng = random.Random(1)
    seen_post = False
    for _ in range(2000):
        method, _path, body = pick_request(rng, 1000)
        if method == "POST":
            seen_post = True
            assert body is not None and isinstance(body["name"], str) and body["name"]
    assert seen_post


def test_counter_sliding_window_error_rate():
    counter = Counter(window_s=60.0)
    # 10 request tại t=0..9, trong đó 3 lỗi -> rate 0.3 khi cửa sổ còn giữ hết.
    for i in range(10):
        counter.record(now=float(i), is_error=(i < 3))
    snap = counter.snapshot(now=9.0)
    assert snap["requests"] == 10
    assert snap["errors_5xx"] == 3
    assert abs(snap["error_rate"] - 0.3) < 1e-9


def test_counter_evicts_old_events():
    counter = Counter(window_s=60.0)
    counter.record(now=0.0, is_error=True)  # sẽ bị đẩy ra
    counter.record(now=100.0, is_error=False)  # còn trong cửa sổ tại t=100
    snap = counter.snapshot(now=100.0)
    assert snap["requests"] == 1
    assert snap["errors_5xx"] == 0
    assert snap["error_rate"] == 0.0
    # tổng cộng dồn vẫn đếm cả 2
    assert snap["total_requests"] == 2
    assert snap["total_errors_5xx"] == 1


def test_counter_empty_window_rate_none():
    counter = Counter(window_s=60.0)
    counter.record(now=0.0, is_error=True)
    snap = counter.snapshot(now=1000.0)  # quá cửa sổ -> rỗng
    assert snap["requests"] == 0
    assert snap["error_rate"] is None


def test_write_counter_atomic_valid_json(tmp_path):
    target = tmp_path / "loadgen_counter.json"
    counter = Counter(window_s=60.0)
    counter.record(now=0.0, is_error=True)
    write_counter(target, counter.snapshot(now=0.0), "2026-09-19T10:00:00Z")
    assert target.exists()
    assert not (tmp_path / "loadgen_counter.json.tmp").exists()
    payload = json.loads(target.read_text(encoding="utf-8"))
    assert payload["requests"] == 1
    assert payload["errors_5xx"] == 1
    assert payload["ts"] == "2026-09-19T10:00:00Z"


def test_config_from_env(monkeypatch):
    monkeypatch.setenv("APP_URL", "http://app:3000/")
    monkeypatch.setenv("LOADGEN_RATE_RPS", "5")
    monkeypatch.setenv("LOADGEN_RANDOM_STATE", "42")
    config = Config.from_env()
    assert config.app_url == "http://app:3000"  # bỏ dấu / cuối
    assert config.rate_rps == 5.0
    assert config.random_state == 42
    assert config.duration_s == float(MAX_DURATION_S)


def test_config_caps_duration_to_max(monkeypatch):
    monkeypatch.setenv("LOADGEN_DURATION_S", "99999")
    config = Config.from_env()
    assert config.duration_s == float(MAX_DURATION_S)


def test_validate_target_safety():
    # Loopback / internal allowed
    host, port = validate_target(
        "http://127.0.0.1:3000", ("localhost", "127.0.0.1", "app")
    )
    assert host == "127.0.0.1"
    assert port == 3000

    host, port = validate_target("http://app:8080", ("app",))
    assert host == "app"
    assert port == 8080

    # Public unallowed host must be rejected
    with pytest.raises(ValueError, match="target public chưa nằm trong allowlist"):
        validate_target("http://example.com:80", ("app", "localhost"))


def test_run_validates_target_and_respects_kill_switch(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "requests", MagicMock())
    stop_file = tmp_path / "loadgen.stop"
    stop_file.touch()  # Trigger kill switch immediately
    counter_path = tmp_path / "counter.json"

    # Must raise if public unallowed target
    with pytest.raises(ValueError, match="target public chưa nằm trong allowlist"):
        config_bad = Config(
            app_url="http://example.com:8080",
            allow_hosts=("app", "localhost"),
            stop_file=stop_file,
            counter_path=counter_path,
        )
        run(config_bad)

    # Valid target with kill switch -> stops gracefully without loop
    config_ok = Config(
        app_url="http://127.0.0.1:3000",
        allow_hosts=("127.0.0.1", "localhost"),
        stop_file=stop_file,
        counter_path=counter_path,
    )
    run(config_ok)
    assert counter_path.exists()


def test_config_pilot_duration_from_env(monkeypatch):
    monkeypatch.setenv("LOADGEN_PILOT_4500", "true")
    monkeypatch.setenv("LOADGEN_DURATION_S", "4500")
    config = Config.from_env()
    assert config.duration_s == 4500.0
    assert config.allow_pilot_4500 is True


def test_config_pilot_duration_caps_at_4500(monkeypatch):
    monkeypatch.setenv("LOADGEN_PILOT_4500", "true")
    monkeypatch.setenv("LOADGEN_DURATION_S", "99999")
    config = Config.from_env()
    assert config.duration_s == 4500.0


def test_config_direct_instantiation_caps_without_pilot():
    # Trực tiếp khởi tạo mà không có allow_pilot_4500: bị cap về 1800.0s
    config = Config(duration_s=4500.0, allow_pilot_4500=False)
    assert config.duration_s == 1800.0

    # Khi bật allow_pilot_4500=True: cho phép tới 4500.0s và cap ở 4500.0s
    config2 = Config(duration_s=5000.0, allow_pilot_4500=True)
    assert config2.duration_s == 4500.0
