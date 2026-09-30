"""Phần thuần của orchestrator thí nghiệm (TK-S6, docs/07 mục 3,4,7).

Mọi thứ ở đây KHÔNG chạm mạng/SSH/DB nên test được độc lập: lệch đồng hồ, mốc các pha A-D,
và bốn kiểm tra toàn vẹn sau run (docs/07 mục 7). `run_experiment.py` gọi các hàm này rồi lo
phần I/O (ssh, deploy, POST /train, load-gen).

Cấu trúc run (docs/07 mục 4), tính từ baseline_start (đồng hồ VPS, giây epoch):
    A BASELINE_TRAIN  30' = 180 mẫu   -> POST /train ở cuối A
    B NORMAL_HOLDOUT  15' =  90 mẫu   -> vùng False Positive
    C FAULT           20' = 120 mẫu   -> vùng True Positive
    D RECOVERY        10' =  60 mẫu   -> loại khỏi đánh giá
Tổng 75' đo ~ 450 mẫu lý thuyết ở chu kỳ 10s (khớp manifest.py).
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

PHASE_A_S = 30 * 60
PHASE_B_S = 15 * 60
PHASE_C_S = 20 * 60
PHASE_D_S = 10 * 60
INTERVAL_S = 10
CLOCK_SKEW_ABORT_MS = 2000  # docs/07 mục 3: |offset|>2s -> huỷ run
MIN_TRAIN_SAMPLES = 180  # docs/07 mục 7 bước 6
MAX_GAP_S = 120  # docs/07 mục 7: không khoảng trống >2 phút


def clock_offset_ms(vps_epoch_ms: float, local_epoch_ms: float) -> int:
    """Lệch đồng hồ = VPS − local (ms). Dương = VPS nhanh hơn (docs/07 mục 3 bước 2)."""
    return round(vps_epoch_ms - local_epoch_ms)


def clock_skew_too_large(
    offset_ms: float, limit_ms: float = CLOCK_SKEW_ABORT_MS
) -> bool:
    """True nếu |offset| vượt ngưỡng huỷ run (docs/07 mục 3 bước 4)."""
    return abs(offset_ms) > limit_ms


def vps_now_ms(local_epoch_ms: float, offset_ms: float) -> float:
    """Quy đổi thời điểm local sang đồng hồ VPS bằng offset đã đo."""
    return local_epoch_ms + offset_ms


@dataclass(frozen=True)
class PhaseSchedule:
    """Mốc các pha theo đồng hồ VPS (giây epoch)."""

    baseline_start_ts: float
    train_at_ts: float
    holdout_start_ts: float
    fault_start_ts: float
    fault_end_ts: float
    run_end_ts: float


def phase_schedule(baseline_start_ts: float) -> PhaseSchedule:
    """Tính mốc 5 pha từ baseline_start (docs/07 mục 4). train ở cuối A = đầu B."""
    train_at = baseline_start_ts + PHASE_A_S
    holdout_start = train_at  # pha B bắt đầu ngay sau train
    fault_start = holdout_start + PHASE_B_S
    fault_end = fault_start + PHASE_C_S
    run_end = fault_end + PHASE_D_S
    return PhaseSchedule(
        baseline_start_ts=baseline_start_ts,
        train_at_ts=train_at,
        holdout_start_ts=holdout_start,
        fault_start_ts=fault_start,
        fault_end_ts=fault_end,
        run_end_ts=run_end,
    )


def theoretical_sample_count(interval_s: int = INTERVAL_S) -> int:
    """Số mẫu lý thuyết cho toàn run 75' đo ở chu kỳ interval_s (450 mẫu cho 75' ở 10s)."""
    total_s = PHASE_A_S + PHASE_B_S + PHASE_C_S + PHASE_D_S
    return total_s // interval_s


def enough_train_samples(actual: int, minimum: int = MIN_TRAIN_SAMPLES) -> bool:
    """docs/07 mục 7 bước 6: cần ≥180 mẫu pha A; thiếu >10% -> huỷ (insufficient_samples)."""
    return actual >= minimum * 0.9


def max_gap_s(timestamps: list[float]) -> float:
    """Khoảng trống lớn nhất giữa 2 mẫu liên tiếp (giây). List rỗng/1 phần tử -> 0."""
    if len(timestamps) < 2:
        return 0.0
    ordered = sorted(timestamps)
    return max(b - a for a, b in itertools.pairwise(ordered))


@dataclass(frozen=True)
class IntegrityReport:
    ok: bool
    sample_count_ok: bool
    no_large_gap_ok: bool
    scores_complete_ok: bool
    five_methods_ok: bool
    reasons: tuple[str, ...]


def check_integrity(
    sample_count: int,
    metric_timestamps: list[float],
    scores_per_sample: list[int],
    non_null_scores_in_bcd: bool,
    interval_s: int = INTERVAL_S,
) -> IntegrityReport:
    """Bốn kiểm tra toàn vẹn sau run (docs/07 mục 7).

    - sample_count ≥ 90% lý thuyết;
    - không khoảng trống >2 phút;
    - mỗi metric_sample có ĐÚNG 5 score_sample (`scores_per_sample` là list số method/mẫu);
    - score khác null cho toàn pha B/C/D (`non_null_scores_in_bcd`).
    """
    reasons: list[str] = []
    theoretical = theoretical_sample_count(interval_s)
    sample_count_ok = sample_count >= theoretical * 0.9
    if not sample_count_ok:
        reasons.append(f"thiếu mẫu: {sample_count} < 90% của {theoretical}")

    gap = max_gap_s(metric_timestamps)
    no_large_gap_ok = gap <= MAX_GAP_S
    if not no_large_gap_ok:
        reasons.append(f"khoảng trống {gap:.0f}s > {MAX_GAP_S}s")

    five_methods_ok = (
        all(n == 5 for n in scores_per_sample) if scores_per_sample else False
    )
    if not five_methods_ok:
        bad = [n for n in scores_per_sample if n != 5]
        reasons.append(
            f"có mẫu không đủ 5 score_sample: {bad[:5]}"
            if bad
            else "không có score_sample"
        )

    scores_complete_ok = bool(non_null_scores_in_bcd)
    if not scores_complete_ok:
        reasons.append("còn score=null ở pha B/C/D (train thất bại?)")

    ok = sample_count_ok and no_large_gap_ok and five_methods_ok and scores_complete_ok
    return IntegrityReport(
        ok=ok,
        sample_count_ok=sample_count_ok,
        no_large_gap_ok=no_large_gap_ok,
        scores_complete_ok=scores_complete_ok,
        five_methods_ok=five_methods_ok,
        reasons=tuple(reasons),
    )
