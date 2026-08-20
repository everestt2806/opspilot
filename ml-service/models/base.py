"""Interface chung cho 3 detector Tier 1: fit(X) rồi score(X) -> 0..1.

Score phải được chuẩn hoá bằng hằng số của tập train; object sau khi fit mang theo
hằng số đó nên pickle cả object vào state là đủ.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np


class Detector(ABC):
    """Mọi detector trong ml-service/models/ cài đặt interface này."""

    name: str = "detector"

    @abstractmethod
    def fit(self, features: np.ndarray) -> Detector:
        """Huấn luyện trên ma trận (n_samples, dim); trả về chính nó để nối chuỗi."""

    @abstractmethod
    def score(self, features: np.ndarray) -> np.ndarray:
        """Score bất thường đã chuẩn hoá 0..1, shape (n_samples,)."""


def minmax_by_train_percentiles(
    raw_scores: np.ndarray,
    low: float,
    high: float,
) -> np.ndarray:
    """Min-max theo phân vị p1/p99 của tập train — p99 để outlier không kéo giãn thang đo."""
    span = high - low
    if span < 1e-12:
        return np.zeros_like(raw_scores, dtype=float)
    return np.clip((raw_scores - low) / span, 0.0, 1.0)
