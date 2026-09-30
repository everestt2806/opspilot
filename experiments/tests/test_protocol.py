from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from protocol import (
    PHASE_A_S,
    PHASE_B_S,
    PHASE_C_S,
    check_integrity,
    clock_offset_ms,
    clock_skew_too_large,
    enough_train_samples,
    max_gap_s,
    phase_schedule,
    theoretical_sample_count,
    vps_now_ms,
)


def test_clock_offset_positive_when_vps_ahead():
    assert clock_offset_ms(1_000_500, 1_000_000) == 500


def test_clock_skew_threshold():
    assert clock_skew_too_large(2001) is True
    assert clock_skew_too_large(2000) is False
    assert clock_skew_too_large(-2500) is True


def test_vps_now_applies_offset():
    assert vps_now_ms(1_000_000, 500) == 1_000_500


def test_phase_schedule_boundaries():
    sched = phase_schedule(1000.0)
    assert sched.train_at_ts == 1000.0 + PHASE_A_S
    assert sched.holdout_start_ts == sched.train_at_ts          # B ngay sau train
    assert sched.fault_start_ts == sched.holdout_start_ts + PHASE_B_S
    assert sched.fault_end_ts == sched.fault_start_ts + PHASE_C_S
    assert sched.run_end_ts == sched.fault_end_ts + 10 * 60
    # tổng thời lượng đo = 75 phút
    assert sched.run_end_ts - sched.baseline_start_ts == 75 * 60


def test_theoretical_sample_count():
    assert theoretical_sample_count(10) == (75 * 60) // 10  # 450


def test_enough_train_samples_10pct_tolerance():
    assert enough_train_samples(180) is True
    assert enough_train_samples(162) is True          # đúng 90%
    assert enough_train_samples(161) is False         # dưới 90%


def test_max_gap():
    assert max_gap_s([]) == 0.0
    assert max_gap_s([100.0]) == 0.0
    assert max_gap_s([0.0, 10.0, 25.0, 30.0]) == 15.0
    # không phụ thuộc thứ tự đầu vào
    assert max_gap_s([30.0, 0.0, 10.0, 25.0]) == 15.0


def test_integrity_all_pass():
    report = check_integrity(
        sample_count=450,
        metric_timestamps=[i * 10.0 for i in range(450)],
        scores_per_sample=[5] * 450,
        non_null_scores_in_bcd=True,
    )
    assert report.ok is True
    assert report.reasons == ()


def test_integrity_flags_low_sample_count():
    report = check_integrity(
        sample_count=100,  # << 90% của 450
        metric_timestamps=[i * 10.0 for i in range(100)],
        scores_per_sample=[5] * 100,
        non_null_scores_in_bcd=True,
    )
    assert report.ok is False
    assert report.sample_count_ok is False
    assert any("thiếu mẫu" in r for r in report.reasons)


def test_integrity_flags_large_gap():
    ts = [i * 10.0 for i in range(50)] + [50 * 10.0 + 200.0]  # nhảy 200s > 120s
    report = check_integrity(
        sample_count=460,
        metric_timestamps=ts,
        scores_per_sample=[5] * 51,
        non_null_scores_in_bcd=True,
    )
    assert report.no_large_gap_ok is False
    assert report.ok is False


def test_integrity_flags_missing_score_method():
    report = check_integrity(
        sample_count=450,
        metric_timestamps=[i * 10.0 for i in range(450)],
        scores_per_sample=[5] * 449 + [4],  # 1 mẫu chỉ 4 method
        non_null_scores_in_bcd=True,
    )
    assert report.five_methods_ok is False
    assert report.ok is False


def test_integrity_flags_null_scores():
    report = check_integrity(
        sample_count=450,
        metric_timestamps=[i * 10.0 for i in range(450)],
        scores_per_sample=[5] * 450,
        non_null_scores_in_bcd=False,  # train thất bại
    )
    assert report.scores_complete_ok is False
    assert report.ok is False
