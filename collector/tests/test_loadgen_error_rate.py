from __future__ import annotations

import json
import sys
import time
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collect import Config, build_metric, read_loadgen_error_rate


def _write_counter(path: Path, payload: dict, ts: str | None) -> None:
    body = dict(payload)
    if ts is not None:
        body["ts"] = ts
    path.write_text(json.dumps(body), encoding="utf-8")


def _iso_now(offset_s: float = 0.0) -> str:
    from datetime import datetime, timezone

    stamp = datetime.now(timezone.utc).timestamp() + offset_s
    return (
        datetime.fromtimestamp(stamp, tz=timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def test_valid_fresh_counter(tmp_path):
    counter = tmp_path / "loadgen_counter.json"
    _write_counter(counter, {"requests": 100, "errors_5xx": 5}, _iso_now())
    rate, requests = read_loadgen_error_rate(str(counter), time.time(), 30.0)
    assert rate == 0.05
    assert requests == 100


def test_stale_counter_rejected(tmp_path):
    counter = tmp_path / "loadgen_counter.json"
    _write_counter(counter, {"requests": 100, "errors_5xx": 5}, _iso_now(offset_s=-120))
    rate, requests = read_loadgen_error_rate(str(counter), time.time(), 30.0)
    assert rate is None
    assert requests is None


def test_missing_file_returns_none():
    rate, requests = read_loadgen_error_rate("/nonexistent/loadgen_counter.json", time.time(), 30.0)
    assert rate is None
    assert requests is None


def test_corrupt_json_returns_none(tmp_path):
    counter = tmp_path / "loadgen_counter.json"
    counter.write_text("{not valid json", encoding="utf-8")
    rate, requests = read_loadgen_error_rate(str(counter), time.time(), 30.0)
    assert rate is None
    assert requests is None


def test_zero_requests_returns_none(tmp_path):
    counter = tmp_path / "loadgen_counter.json"
    _write_counter(counter, {"requests": 0, "errors_5xx": 0}, _iso_now())
    rate, requests = read_loadgen_error_rate(str(counter), time.time(), 30.0)
    assert rate is None
    assert requests is None


def test_empty_path_returns_none():
    rate, requests = read_loadgen_error_rate("", time.time(), 30.0)
    assert rate is None
    assert requests is None


def test_non_int_counts_returns_none(tmp_path):
    counter = tmp_path / "loadgen_counter.json"
    _write_counter(counter, {"requests": "100", "errors_5xx": 5}, _iso_now())
    rate, requests = read_loadgen_error_rate(str(counter), time.time(), 30.0)
    assert rate is None
    assert requests is None


def test_build_metric_uses_loadgen_source(tmp_path):
    counter = tmp_path / "loadgen_counter.json"
    _write_counter(counter, {"requests": 200, "errors_5xx": 10}, _iso_now())
    config = Config(app_url="", loadgen_counter_path=str(counter), loadgen_max_age_s=30.0)
    metric = build_metric(1, config, deque())
    assert metric["http_error_rate"] == 0.05
    assert metric["http_error_rate_source"] == "loadgen"
    assert metric["loadgen_requests"] == 200


def test_build_metric_falls_back_when_no_loadgen(tmp_path):
    config = Config(app_url="", loadgen_counter_path="", loadgen_max_age_s=30.0)
    metric = build_metric(1, config, deque())
    # Không có app_url và không có loadgen -> nguồn None, không có số loadgen.
    assert metric["http_error_rate_source"] is None
    assert metric["loadgen_requests"] is None
