"""Nhãn ground-truth + trạng thái triggered (TK-S6, docs/07 mục 5).

TÁCH RIÊNG và THUẦN có chủ đích: đây là định nghĩa ăn điểm của đồ án, phải test được độc lập
và giải thích được trước hội đồng. Mọi mốc thời gian tính theo đồng hồ VPS (giây epoch hoặc
cùng một hệ quy chiếu — caller quy đổi trước khi gọi).

Định nghĩa nhãn (docs/07 mục 5), đơn vị = 1 mẫu:
    NORMAL   nếu ts ∈ pha B (holdout)                     -> vùng đo False Positive
    ANOMALY  nếu ts ∈ [fault_start + grace, fault_end]    -> vùng đo True Positive
    EXCLUDED nếu ts ∈ pha A, pha D, hoặc [fault_start, fault_start+grace)

Dự đoán "triggered" của một phương pháp tại mẫu i = đã có đủ `consecutive` mẫu LIÊN TIẾP vượt
ngưỡng tính đến i. Cùng một quy tắc cho cả 5 phương pháp — điều kiện để so sánh công bằng.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Label(str, Enum):
    NORMAL = "NORMAL"
    ANOMALY = "ANOMALY"
    EXCLUDED = "EXCLUDED"


@dataclass(frozen=True)
class RunWindows:
    """Các mốc thời gian của một run, TẤT CẢ theo đồng hồ VPS (giây)."""

    holdout_start_ts: float   # đầu pha B
    fault_start_ts: float     # đầu pha C (bật fault)
    fault_end_ts: float       # cuối pha C (tắt fault)
    grace_s: float = 60.0     # docs/07: 60s = 6 mẫu


def label_sample(ts: float, windows: RunWindows) -> Label:
    """Nhãn của 1 mẫu theo ts (đồng hồ VPS). Xem định nghĩa chốt docs/07 mục 5."""
    if windows.holdout_start_ts <= ts < windows.fault_start_ts:
        return Label.NORMAL
    anomaly_start = windows.fault_start_ts + windows.grace_s
    if anomaly_start <= ts <= windows.fault_end_ts:
        return Label.ANOMALY
    # pha A (trước holdout), grace [fault_start, fault_start+grace), pha D (sau fault_end).
    return Label.EXCLUDED


def label_series(timestamps: list[float], windows: RunWindows) -> list[Label]:
    return [label_sample(ts, windows) for ts in timestamps]


def triggered_series(above_threshold: list[bool], consecutive: int) -> list[bool]:
    """Chuyển chuỗi cờ vượt-ngưỡng thành chuỗi trạng thái triggered.

    triggered tại i = có đủ `consecutive` mẫu liên tiếp vượt ngưỡng kết thúc tại i (bao gồm i).
    Một khi chuỗi liên tiếp bị đứt (gặp False), bộ đếm reset. Đây là cách áp dụng đồng nhất cho
    cả rule (consecutive=3) và ML (consecutive=2) — docs/07 mục 5.
    """
    if consecutive < 1:
        raise ValueError("consecutive phải >= 1")
    result: list[bool] = []
    streak = 0
    for flag in above_threshold:
        streak = streak + 1 if flag else 0
        result.append(streak >= consecutive)
    return result
