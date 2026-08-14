import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collect import METRIC_FIELDS, parse_docker_stats, read_last_seq, write_metric


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
