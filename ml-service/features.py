"""Feature pipeline M7: cửa sổ trượt 20 mẫu -> vector 20 chiều.

Thứ tự chiều là hợp đồng: với mỗi metric theo thứ tự trong `FeatureConfig.metrics`,
ghép [value, mean, std, slope] (bỏ thành phần bị tắt bằng cờ use_*). Đổi thứ tự =
bug khó phát hiện, test phải khoá chặt.

slope tính trên trục thời gian thật (giây -> phút) để không phụ thuộc chu kỳ lấy mẫu;
ts hỏng hoặc trùng nhau thì lùi về chu kỳ mặc định 10 giây.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import numpy as np

from config import COLLECT_INTERVAL_S, METRICS, WINDOW


@dataclass(frozen=True)
class FeatureConfig:
    """Cấu hình các thành phần feature — cho phép /replay chạy ablation không cần code riêng."""

    use_slope: bool = True
    use_mean: bool = True
    use_std: bool = True
    window: int = WINDOW
    metrics: tuple[str, ...] = field(default_factory=lambda: tuple(METRICS))

    @property
    def feature_dim(self) -> int:
        per_metric = int(self.use_mean) + int(self.use_std) + int(self.use_slope) + 1
        return len(self.metrics) * per_metric

    def feature_names(self) -> list[str]:
        names = ["value"]
        if self.use_mean:
            names.append("mean")
        if self.use_std:
            names.append("std")
        if self.use_slope:
            names.append("slope")
        return [f"{metric}.{name}" for metric in self.metrics for name in names]


def _to_epoch_ms(ts: str) -> float | None:
    try:
        value = ts[:-1] + "+00:00" if ts.endswith("Z") else ts
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.timestamp() * 1000.0
    except (ValueError, TypeError):
        return None


def _time_axis_minutes(samples: list[dict[str, Any]]) -> tuple[np.ndarray, bool]:
    """Trục thời gian (phút) của cửa sổ; ts có thể đo được thì dùng ts, không thì 10s/mẫu."""
    epochs = [_to_epoch_ms(s.get("ts", "")) for s in samples]
    if all(e is not None for e in epochs):
        first = epochs[0]
        if first is not None and any(e != first for e in epochs):
            return np.asarray([(e - first) / 60000.0 for e in epochs], dtype=float), True
    n = len(samples)
    return np.arange(n, dtype=float) * (COLLECT_INTERVAL_S / 60.0), False


def _series_with_fill(samples: list[dict[str, Any]], metric: str) -> np.ndarray:
    """Dãy giá trị một metric với forward fill; null trước giá trị đầu thì 0."""
    values: list[float] = []
    last: float | None = None
    for sample in samples:
        raw = sample.get(metric)
        if raw is None:
            values.append(0.0 if last is None else float(last))
        else:
            last = float(raw)
            values.append(last)
    return np.asarray(values, dtype=float)


def detect_dropped_metrics(samples: list[dict[str, Any]], metrics: tuple[str, ...]) -> list[str]:
    """Metric nào null toàn bộ tập train -> loại khỏi vector, ghi vào warnings của /train."""
    dropped: list[str] = []
    for metric in metrics:
        if all(sample.get(metric) is None for sample in samples):
            dropped.append(metric)
    return dropped


def _slope(values: np.ndarray, axis_minutes: np.ndarray) -> float:
    if values.size < 2:
        return 0.0
    return float(np.polyfit(axis_minutes, values, 1)[0])


def build_vector(window: list[dict[str, Any]], config: FeatureConfig) -> np.ndarray | None:
    """Vector feature cho một cửa sổ; chưa đủ `config.window` mẫu -> None (không phải vector 0)."""
    if len(window) < config.window:
        return None
    axis, _ = _time_axis_minutes(window)
    parts: list[np.ndarray] = []
    for metric in config.metrics:
        values = _series_with_fill(window, metric)
        parts.append(np.asarray([values[-1]]))
        if config.use_mean:
            parts.append(np.asarray([float(np.mean(values))]))
        if config.use_std:
            parts.append(np.asarray([float(np.std(values))]))
        if config.use_slope:
            parts.append(np.asarray([_slope(values, axis)]))
    vector = np.concatenate(parts)
    if np.any(np.isnan(vector)):
        vector = np.nan_to_num(vector, nan=0.0)
    return vector


def build_matrix(samples: list[dict[str, Any]], config: FeatureConfig) -> np.ndarray:
    """Ma trận (n - window + 1, dim) cho train; thiếu mẫu -> ma trận (0, dim)."""
    dim = config.feature_dim
    if len(samples) < config.window:
        return np.empty((0, dim), dtype=float)
    rows = [
        build_vector(samples[i : i + config.window], config)
        for i in range(len(samples) - config.window + 1)
    ]
    return np.vstack(rows)


def score_detail(vector: np.ndarray, z_scores: np.ndarray, config: FeatureConfig) -> dict[str, Any]:
    """Giải thích ngắn cho UI/detail_json: chiều nào đóng góp nhiều nhất (từ zscore_ewma)."""
    index = int(np.argmax(np.abs(z_scores)))
    names = config.feature_names()
    if index >= len(names):
        return {}
    metric, feature = names[index].split(".", 1)
    return {"top_metric": metric, "top_feature": feature, "contribution": float(z_scores[index])}
