"""Unit test cho features.py — trái tim của phần nghiên cứu (brief m07)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np

from features import FeatureConfig, build_matrix, build_vector, detect_dropped_metrics
from scripts.gen_fake_series import make_series


def _window_values(metric: str, values: list[float | None], interval_s: int = 10) -> list[dict]:
    start = datetime(2026, 8, 20, 0, 0, tzinfo=UTC)
    all_metrics = ("cpu_pct", "mem_mb", "latency_ms", "http_error_rate", "db_response_ms")
    rows = []
    for i, value in enumerate(values):
        row = {m: None for m in all_metrics}
        row[metric] = value
        timestamp = (start + timedelta(seconds=i * interval_s)).isoformat(timespec="seconds")
        row["ts"] = timestamp.replace("+00:00", "Z")
        rows.append(row)
    return rows


def _one_metric_config(metric: str) -> FeatureConfig:
    return FeatureConfig(metrics=(metric,), window=4)


def test_slope_chuoi_tang_tuyen_tinh_dung_gia_tri_ly_thuyet() -> None:
    x_minutes = [i * 10 / 60.0 for i in range(20)]
    values = [2.0 * x for x in x_minutes]
    window = _window_values("mem_mb", values)
    vector = build_vector(window, FeatureConfig(metrics=("mem_mb",), window=20))
    assert vector is not None
    slope = vector[3]
    assert abs(slope - 2.0) < 1e-6


def test_slope_chuoi_hang_bang_0_std_bang_0() -> None:
    window = _window_values("cpu_pct", [5.0] * 20)
    vector = build_vector(window, FeatureConfig(metrics=("cpu_pct",), window=20))
    assert vector is not None
    assert vector[0] == 5.0
    assert vector[1] == 5.0
    assert vector[2] == 0.0
    assert abs(vector[3]) < 1e-9


def test_cua_so_chua_du_20_mau_tra_none() -> None:
    config = FeatureConfig(metrics=("cpu_pct",))
    assert build_vector(_window_values("cpu_pct", [1.0] * 19), config) is None
    matrix = build_matrix(_window_values("cpu_pct", [1.0] * 10), config)
    assert matrix.shape == (0, config.feature_dim)


def test_null_giua_chuoi_khong_sinh_nan() -> None:
    values: list[float | None] = [1.0, None, None, 3.0, 4.0] + [5.0] * 15
    window = _window_values("mem_mb", values)
    vector = build_vector(window, FeatureConfig(metrics=("mem_mb",), window=20))
    assert vector is not None
    assert np.all(np.isfinite(vector))


def test_vector_20_chieu_va_thu_tu_chieu_on_dinh() -> None:
    config = FeatureConfig(window=20)
    first = build_vector(make_series("normal", n=20), config)
    second = build_vector(make_series("normal", n=20), config)
    assert first is not None and second is not None
    assert first.shape == (20,)
    names = config.feature_names()
    assert names[:4] == ["cpu_pct.value", "cpu_pct.mean", "cpu_pct.std", "cpu_pct.slope"]
    expected_tail = [
        "db_response_ms.value",
        "db_response_ms.mean",
        "db_response_ms.std",
        "db_response_ms.slope",
    ]
    assert names[16:] == expected_tail
    assert np.allclose(first, second)


def test_gia_tri_mean_std_slope_tinh_tay() -> None:
    window = _window_values("cpu_pct", [2.0, 4.0, 6.0, 8.0])
    vector = build_vector(window, _one_metric_config("cpu_pct"))
    assert vector is not None
    assert vector.shape == (4,)
    assert vector[0] == 8.0
    assert vector[1] == 5.0
    assert abs(vector[2] - np.sqrt(5.0)) < 1e-9
    assert abs(vector[3] - 12.0) < 1e-9  # 2 don vi / mau = 12 don vi / phut


def test_detect_dropped_metrics() -> None:
    rows = make_series("normal", n=30)
    for row in rows:
        row["db_response_ms"] = None
    metrics = ("cpu_pct", "mem_mb", "latency_ms", "http_error_rate", "db_response_ms")
    assert detect_dropped_metrics(rows, metrics) == ["db_response_ms"]
    assert detect_dropped_metrics(make_series("normal", n=30), metrics) == []
