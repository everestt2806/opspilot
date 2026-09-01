import json
import subprocess
import sys
import time
from collections import deque
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collect import (
    METRIC_FIELDS,
    Config,
    build_metric,
    parse_docker_stats,
    parse_memory_mb,
    probe_http,
    read_docker_stats,
    read_last_seq,
    update_error_window,
    write_metric,
)


def test_parse_docker_stats_json():
    stats = parse_docker_stats(
        '{"CPUPerc":"12.34%","MemUsage":"210.5MiB / 1GiB","MemPerc":"20.56%"}'
    )

    assert stats == {
        "cpu_pct": 12.34,
        "mem_mb": 210.5,
        "mem_pct": 20.56,
        "mem_limit_mb": 1024.0,
    }


def test_write_metric_keeps_jsonl_and_latest_in_sync(tmp_path):
    metric = {
        "seq": 1,
        "ts": "2026-08-12T00:00:00.000Z",
        "cpu_pct": None,
        "mem_mb": None,
        "mem_pct": None,
        "mem_limit_mb": None,
        "latency_ms": 12.5,
        "http_error_rate": 0.0,
        "db_response_ms": None,
        "host_cpu_pct": 4.0,
        "host_mem_pct": 38.0,
        "container_up": 1,
        "collector_version": "1.0.0",
    }

    write_metric(tmp_path, metric)
    line = (tmp_path / "metrics.jsonl").read_text(encoding="utf-8").splitlines()[0]
    latest = (tmp_path / "latest.json").read_text(encoding="utf-8")

    assert json.loads(line) == json.loads(latest)
    assert list(json.loads(line)) == list(METRIC_FIELDS)
    assert len(line.encode("utf-8")) <= 4096


def test_read_last_seq_ignores_corrupt_trailing_line(tmp_path):
    path = tmp_path / "metrics.jsonl"
    path.write_text('{"seq":7}\nnot-json\n', encoding="utf-8")

    assert read_last_seq(path) == 7


def test_parse_memory_mb_units():
    assert parse_memory_mb("210.5MiB") == 210.5
    assert parse_memory_mb("1GiB") == 1024.0
    assert parse_memory_mb("512KiB") == 0.5
    assert parse_memory_mb("300MB") == 300.0
    assert parse_memory_mb("") is None
    assert parse_memory_mb("garbage") is None


def test_parse_docker_stats_bad_inputs():
    assert parse_docker_stats("") is None
    assert parse_docker_stats("not-json") is None
    assert parse_docker_stats('{"CPUPerc":"2.5%"}') == {
        "cpu_pct": 2.5,
        "mem_mb": None,
        "mem_pct": None,
        "mem_limit_mb": None,
    }


def test_read_docker_stats_success(monkeypatch):
    def fake_run(command, **kwargs):
        assert command[-1] == "app"
        return SimpleNamespace(
            returncode=0,
            stdout='{"CPUPerc":"1.50%","MemUsage":"128MiB / 512MiB","MemPerc":"25.00%"}',
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert read_docker_stats("app") == {
        "cpu_pct": 1.5,
        "mem_mb": 128.0,
        "mem_pct": 25.0,
        "mem_limit_mb": 512.0,
    }


def test_read_docker_stats_nonzero_exit(monkeypatch):
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=1, stdout="")
    )
    assert read_docker_stats("app") is None


def test_read_docker_stats_docker_missing(monkeypatch):
    def boom(*a, **k):
        raise OSError("docker not installed")

    monkeypatch.setattr(subprocess, "run", boom)
    assert read_docker_stats("app") is None


def test_read_docker_stats_empty_name():
    assert read_docker_stats("") is None


def test_probe_http_success(monkeypatch):
    class Response:
        status_code = 200

    monkeypatch.setitem(
        sys.modules, "requests", SimpleNamespace(get=lambda url, timeout: Response())
    )
    latency, status = probe_http("http://app:3000/health", 5.0)
    assert status == 200
    assert isinstance(latency, float) and latency >= 0


def test_probe_http_server_error(monkeypatch):
    monkeypatch.setitem(
        sys.modules,
        "requests",
        SimpleNamespace(get=lambda url, timeout: SimpleNamespace(status_code=500)),
    )
    latency, status = probe_http("http://app:3000/health", 5.0)
    assert status == 500
    assert latency is not None


def test_probe_http_timeout(monkeypatch):
    def raise_timeout(url, timeout):
        raise TimeoutError("timed out")

    monkeypatch.setitem(sys.modules, "requests", SimpleNamespace(get=raise_timeout))
    assert probe_http("http://app:3000/health", 5.0) == (None, None)


def test_probe_http_connection_error(monkeypatch):
    def raise_refused(url, timeout):
        raise ConnectionError("refused")

    monkeypatch.setitem(sys.modules, "requests", SimpleNamespace(get=raise_refused))
    assert probe_http("http://app:3000/health", 5.0) == (None, None)


def test_probe_http_empty_url():
    assert probe_http("", 5.0) == (None, None)


def test_update_error_window_counts_5xx_and_failures():
    errors: deque = deque()
    assert update_error_window(errors, now=10.0, status_code=200, window_s=60.0) == 0.0
    assert update_error_window(errors, now=20.0, status_code=500, window_s=60.0) == 0.5
    assert update_error_window(errors, now=30.0, status_code=None, window_s=60.0) == 2 / 3


def test_update_error_window_expires_old_entries():
    errors: deque = deque()
    update_error_window(errors, now=10.0, status_code=500, window_s=60.0)
    assert update_error_window(errors, now=71.0, status_code=200, window_s=60.0) == 0.0


def test_build_metric_assembles_line(monkeypatch):
    config = Config(app_container_name="app", app_url="http://app:3000/health")
    monkeypatch.setattr(
        "collect.read_docker_stats",
        lambda name: {"cpu_pct": 10.0, "mem_mb": 64.0, "mem_pct": 50.0, "mem_limit_mb": 128.0},
    )
    monkeypatch.setattr("collect.probe_http", lambda url, timeout: (12.5, 200))
    monkeypatch.setattr("collect.read_host_metrics", lambda: (1.5, 20.0))

    metric = build_metric(3, config, deque())
    assert metric["seq"] == 3
    assert metric["ts"].endswith("Z")
    assert metric["cpu_pct"] == 10.0
    assert metric["mem_mb"] == 64.0
    assert metric["latency_ms"] == 12.5
    assert metric["http_error_rate"] == 0.0
    assert metric["host_cpu_pct"] == 1.5
    assert metric["host_mem_pct"] == 20.0
    assert metric["container_up"] == 1
    assert metric["db_response_ms"] is None
    assert metric["collector_version"] == "1.0.0"


def test_build_metric_probe_fail_marks_container_down(monkeypatch):
    config = Config(app_container_name="app", app_url="http://app:3000/health")
    monkeypatch.setattr(
        "collect.read_docker_stats",
        lambda name: {"cpu_pct": None, "mem_mb": None, "mem_pct": None, "mem_limit_mb": None},
    )
    monkeypatch.setattr("collect.probe_http", lambda url, timeout: (None, None))
    monkeypatch.setattr("collect.read_host_metrics", lambda: (None, None))

    metric = build_metric(4, config, deque())
    assert metric["latency_ms"] is None
    assert metric["container_up"] == 0
    assert metric["http_error_rate"] == 1.0


def test_build_metric_container_down_when_stats_missing(monkeypatch):
    config = Config(app_container_name="app", app_url="http://app:3000/health")
    monkeypatch.setattr("collect.read_docker_stats", lambda name: None)
    monkeypatch.setattr("collect.probe_http", lambda url, timeout: (12.5, 200))
    monkeypatch.setattr("collect.read_host_metrics", lambda: (None, None))

    metric = build_metric(5, config, deque())
    assert metric["cpu_pct"] is None
    assert metric["mem_mb"] is None
    assert metric["container_up"] == 0


def test_build_metric_no_app_url_keeps_null_error_rate(monkeypatch):
    config = Config(app_container_name="app", app_url="")
    monkeypatch.setattr(
        "collect.read_docker_stats",
        lambda name: {"cpu_pct": None, "mem_mb": None, "mem_pct": None, "mem_limit_mb": None},
    )
    monkeypatch.setattr("collect.read_host_metrics", lambda: (None, None))

    metric = build_metric(6, config, deque())
    assert metric["http_error_rate"] is None
    assert metric["container_up"] == 1


def test_build_metric_error_window_expires(monkeypatch):
    config = Config(
        app_container_name="app", app_url="http://app:3000/health", error_window_s=60.0
    )
    monkeypatch.setattr(
        "collect.read_docker_stats",
        lambda name: {"cpu_pct": 1.0, "mem_mb": 1.0, "mem_pct": 1.0, "mem_limit_mb": 1.0},
    )
    monkeypatch.setattr("collect.read_host_metrics", lambda: (None, None))
    clock = iter([10.0, 71.0])
    monkeypatch.setattr(time, "monotonic", lambda: next(clock))
    probe_result = iter([(1.0, 500), (1.0, 200)])
    monkeypatch.setattr("collect.probe_http", lambda url, timeout: next(probe_result))

    errors: deque = deque()
    first = build_metric(1, config, errors)
    second = build_metric(2, config, errors)
    assert first["http_error_rate"] == 1.0
    assert second["http_error_rate"] == 0.0
