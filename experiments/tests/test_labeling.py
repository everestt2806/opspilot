from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from labeling import Label, RunWindows, label_sample, label_series, triggered_series

# Mốc thời gian giả lập (giây epoch tương đối): holdout bắt đầu 1000, fault 2000..3200, grace 60.
WINDOWS = RunWindows(
    holdout_start_ts=1000.0,
    fault_start_ts=2000.0,
    fault_end_ts=3200.0,
    grace_s=60.0,
)


def test_before_holdout_excluded():
    assert label_sample(500.0, WINDOWS) is Label.EXCLUDED


def test_holdout_is_normal():
    assert label_sample(1000.0, WINDOWS) is Label.NORMAL
    assert label_sample(1999.0, WINDOWS) is Label.NORMAL


def test_fault_start_is_normal_boundary_exclusive():
    # ts == fault_start_ts kết thúc vùng NORMAL (nửa mở), thuộc grace -> EXCLUDED.
    assert label_sample(2000.0, WINDOWS) is Label.EXCLUDED


def test_grace_window_excluded():
    # [fault_start, fault_start + grace) = [2000, 2060) -> EXCLUDED.
    assert label_sample(2000.0, WINDOWS) is Label.EXCLUDED
    assert label_sample(2059.0, WINDOWS) is Label.EXCLUDED


def test_anomaly_after_grace():
    # [2060, 3200] -> ANOMALY (bao gồm hai đầu).
    assert label_sample(2060.0, WINDOWS) is Label.ANOMALY
    assert label_sample(3200.0, WINDOWS) is Label.ANOMALY


def test_after_fault_end_excluded():
    assert label_sample(3200.1, WINDOWS) is Label.EXCLUDED
    assert label_sample(9999.0, WINDOWS) is Label.EXCLUDED


def test_label_series_maps_each():
    series = label_series([500.0, 1500.0, 2030.0, 2500.0, 4000.0], WINDOWS)
    assert series == [
        Label.EXCLUDED,
        Label.NORMAL,
        Label.EXCLUDED,
        Label.ANOMALY,
        Label.EXCLUDED,
    ]


def test_triggered_needs_consecutive():
    # consecutive=3: chỉ True khi có đủ 3 cờ True liên tiếp.
    flags = [True, True, False, True, True, True, False]
    result = triggered_series(flags, consecutive=3)
    assert result == [False, False, False, False, False, True, False]


def test_triggered_resets_on_false():
    flags = [True, True, True, False, True, True, True]
    result = triggered_series(flags, consecutive=3)
    assert result == [False, False, True, False, False, False, True]


def test_triggered_consecutive_one_is_passthrough():
    flags = [False, True, False, True]
    assert triggered_series(flags, consecutive=1) == [False, True, False, True]


def test_triggered_invalid_consecutive():
    import pytest

    with pytest.raises(ValueError):
        triggered_series([True], consecutive=0)
