from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analyze import (
    METHODS,
    Aggregate,
    aggregate,
    analyze_run,
    main_table,
    read_run_meta,
    read_score_csv,
)
from export_results import export_run, run_dir_for


def _score_rows(method: str, series: list[tuple[float, bool]]) -> list[dict]:
    return [
        {"method": method, "ts_vps": str(ts), "above_threshold": "1" if hi else "0"}
        for ts, hi in series
    ]


# Mốc: holdout 1000, fault 2000..3200, grace 60 -> ANOMALY từ 2060.
HOLDOUT, FAULT_START, FAULT_END = 1000.0, 2000.0, 3200.0


def test_analyze_run_perfect_detection_for_one_method():
    # ensemble (consecutive=2): 2 mẫu liên tiếp above trong vùng ANOMALY -> triggered.
    rows = _score_rows(
        "ensemble",
        [
            (1500.0, False),  # NORMAL, yên -> TN
            (2100.0, True),  # ANOMALY
            (2110.0, True),  # ANOMALY, đủ 2 liên tiếp -> triggered (TP)
            (2120.0, True),  # TP
        ],
    )
    results = {r.method: r for r in analyze_run(rows, FAULT_START, FAULT_END, HOLDOUT, 60.0)}
    ens = results["ensemble"]
    # 3 mẫu ANOMALY: 2100 streak=1 (chưa đủ 2 -> FN), 2110 & 2120 triggered (TP) -> recall 2/3.
    # Đây là cơ chế consecutive đúng: mẫu ANOMALY đầu tiên luôn là FN nếu consecutive>=2.
    assert abs(ens.recall - 2 / 3) < 1e-9
    assert ens.precision == 1.0  # không FP ở NORMAL
    # detection delay = mẫu triggered đầu tiên (2110) - fault_start (2000) = 110
    assert ens.detection_delay_s == 110.0


def test_analyze_run_censored_when_never_triggered():
    rows = _score_rows("iforest", [(2100.0, False), (2200.0, True), (3000.0, False)])
    # iforest consecutive=2 nhưng không có 2 True liên tiếp -> không bao giờ triggered
    results = {r.method: r for r in analyze_run(rows, FAULT_START, FAULT_END, HOLDOUT, 60.0)}
    assert results["iforest"].detection_delay_s is None  # censored
    assert results["iforest"].recall == 0.0


def test_analyze_run_missing_method_returns_none():
    rows = _score_rows("rule", [(2100.0, True), (2110.0, True), (2120.0, True)])
    results = {r.method: r for r in analyze_run(rows, FAULT_START, FAULT_END, HOLDOUT, 60.0)}
    # các method khác không có dòng -> toàn None
    assert results["ocsvm"].precision is None
    assert results["ocsvm"].detection_delay_s is None
    # rule có dữ liệu
    assert results["rule"].recall is not None


def test_analyze_run_covers_all_five_methods():
    results = analyze_run([], FAULT_START, FAULT_END, HOLDOUT, 60.0)
    assert {r.method for r in results} == set(METHODS)
    assert len(results) == 5


def test_grace_changes_labels():
    # 1 mẫu tại 2030 (trong grace 60 -> EXCLUDED; nhưng grace 0 -> ANOMALY).
    rows = _score_rows("rule", [(2030.0, True), (2040.0, True), (2050.0, True)])
    res60 = {r.method: r for r in analyze_run(rows, FAULT_START, FAULT_END, HOLDOUT, 60.0)}["rule"]
    res0 = {r.method: r for r in analyze_run(rows, FAULT_START, FAULT_END, HOLDOUT, 0.0)}["rule"]
    # grace 60: cả 3 mẫu EXCLUDED -> không TP/FN -> recall None
    assert res60.recall is None
    # grace 0: 3 mẫu ANOMALY, rule consecutive=3 -> mẫu thứ 3 triggered -> có TP
    assert res0.recall is not None and res0.recall > 0


def test_aggregate_mean_std_ci():
    agg = aggregate([0.8, 0.9, 0.7, 0.85, 0.75])
    assert agg.n == 5
    assert abs(agg.mean - 0.8) < 1e-9
    assert agg.std is not None and agg.std > 0
    assert agg.ci95_low < agg.mean < agg.ci95_high
    assert agg.censored == 0


def test_aggregate_counts_censored_none():
    agg = aggregate([100.0, None, 200.0, None])
    assert agg.n == 2
    assert agg.censored == 2
    assert agg.mean == 150.0


def test_aggregate_all_none():
    agg = aggregate([None, None])
    assert agg == Aggregate(n=0, mean=None, std=None, ci95_low=None, ci95_high=None, censored=2)


def test_aggregate_single_value_no_ci():
    agg = aggregate([0.5])
    assert agg.n == 1
    assert agg.mean == 0.5
    assert agg.std is None
    assert agg.ci95_low is None


def test_read_csv_roundtrip(tmp_path):
    score = tmp_path / "score_sample.csv"
    score.write_text(
        "method,ts_vps,above_threshold,extra\n"
        "ensemble,2100.0,1,ignored\n"
        "rule,2100.0,0,ignored\n",
        encoding="utf-8",
    )
    rows = read_score_csv(score)
    assert len(rows) == 2
    assert rows[0]["method"] == "ensemble"
    assert set(rows[0].keys()) == {"method", "ts_vps", "above_threshold"}

    meta = tmp_path / "experiment_run.csv"
    meta.write_text(
        "scenario,fault_start_ts,fault_end_ts,train_at_ts\n"
        "memory_leak,2000.0,3200.0,1000.0\n",
        encoding="utf-8",
    )
    m = read_run_meta(meta)
    assert m["scenario"] == "memory_leak"
    assert float(m["fault_start_ts"]) == 2000.0


def test_export_results_to_analyze_roundtrip_iso_utc(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.executescript("""
    CREATE TABLE experiment_run (
      id INTEGER PRIMARY KEY, scenario TEXT, repeat_index INTEGER, deployment_id INTEGER,
      vps_id INTEGER, baseline_start_ts TEXT, train_at_ts TEXT, fault_start_ts TEXT,
      fault_end_ts TEXT, run_end_ts TEXT, clock_offset_ms INTEGER, detection_grace_s INTEGER,
      train_sample_count INTEGER, fault_params_json TEXT, status TEXT, abort_reason TEXT
    );
    CREATE TABLE metric_sample (
      id INTEGER PRIMARY KEY, deployment_id INTEGER, seq INTEGER, ts_vps TEXT, ts_local TEXT,
      cpu_pct REAL, mem_mb REAL, mem_pct REAL, mem_limit_mb REAL, latency_ms REAL,
      http_error_rate REAL, db_response_ms REAL, container_up INTEGER, host_cpu_pct REAL,
      host_mem_pct REAL
    );
    CREATE TABLE score_sample (
      id INTEGER PRIMARY KEY, metric_sample_id INTEGER, deployment_id INTEGER, ts_vps TEXT,
      method TEXT, score REAL, above_threshold INTEGER, detail_json TEXT
    );
    CREATE TABLE alert (
      id INTEGER PRIMARY KEY, deployment_id INTEGER, metric_sample_id INTEGER, method TEXT,
      ts_vps TEXT, ts_resolved TEXT, peak_score REAL, label TEXT, acted TEXT,
      experiment_run_id INTEGER
    );
    """)

    conn.execute(
        "INSERT INTO experiment_run (id, scenario, repeat_index, deployment_id, vps_id, "
        "baseline_start_ts, train_at_ts, fault_start_ts, fault_end_ts, run_end_ts, "
        "clock_offset_ms, detection_grace_s, status) "
        "VALUES (1, 'cpu_spike', 1, 10, 1, '2026-09-19T10:00:00Z', '2026-09-19T10:30:00Z', "
        "'2026-09-19T10:45:00Z', '2026-09-19T11:05:00Z', '2026-09-19T11:15:00Z', 50, 60, "
        "'completed')"
    )

    timestamps = [
        "2026-09-19T10:35:00Z",  # NORMAL (holdout)
        "2026-09-19T10:45:30Z",  # EXCLUDED (in grace 60s)
        "2026-09-19T10:47:00Z",  # ANOMALY
        "2026-09-19T10:47:10Z",  # ANOMALY
    ]
    for seq, ts in enumerate(timestamps, start=1):
        conn.execute(
            "INSERT INTO metric_sample (id, deployment_id, seq, ts_vps, ts_local, cpu_pct, "
            "container_up) VALUES (?, 10, ?, ?, ?, 80.0, 1)",
            (seq, seq, ts, ts),
        )
        for method in METHODS:
            above = 1 if seq >= 3 else 0
            conn.execute(
                "INSERT INTO score_sample (metric_sample_id, deployment_id, ts_vps, method, "
                "score, above_threshold) VALUES (?, 10, ?, ?, 0.85, ?)",
                (seq, ts, method, above),
            )
    conn.commit()

    out_dir = run_dir_for(tmp_path, "cpu_spike", 1)
    counts = export_run(conn, run_id=1, out_dir=out_dir)
    assert counts["metric_sample"] == 4
    assert counts["score_sample"] == 20

    table = main_table([out_dir], grace_s=60.0)
    assert "| Method | Precision | Recall | F1 | Delay (s) | #censored |" in table
    for method in METHODS:
        assert f"| {method} |" in table
