"""Z-score trên EWMA từng chiều.

mean/var chạy EWMA alpha=0.3 theo từng chiều; z = |x - mean| / std; score = sigmoid(max_z/3 - 1)
rồi kẹp [0,1]. max_z lấy trên mọi chiều nên chỉ cần một chiều cháy là score nhảy.

EWMA tiếp tục cập nhật online trong lúc inference (ingest/replay gọi `update` SAU khi
chấm điểm) — chấm điểm trước rồi mới update để anomaly không bị nuốt vào mean.
"""

from __future__ import annotations

import numpy as np

from config import EWMA_ALPHA
from models.base import Detector

_EPS = 1e-6


class ZScoreEwma(Detector):
    name = "zscore_ewma"

    def __init__(self, alpha: float = EWMA_ALPHA) -> None:
        self.alpha = alpha
        self.mean_: np.ndarray | None = None
        self.var_: np.ndarray | None = None

    def fit(self, features: np.ndarray) -> ZScoreEwma:
        if features.shape[0] == 0:
            raise ValueError("zscore_ewma fit: tập train rỗng")
        mean = features[0].astype(float).copy()
        var = np.zeros(features.shape[1], dtype=float)
        for row in features[1:]:
            diff = row - mean
            mean = mean + self.alpha * diff
            var = (1.0 - self.alpha) * var + self.alpha * diff * diff
        self.mean_ = mean
        self.var_ = var
        return self

    def update(self, features: np.ndarray) -> None:
        """Cập nhật online trạng thái EWMA bằng (các) mẫu vừa chấm điểm xong."""
        if self.mean_ is None or self.var_ is None:
            raise ValueError("zscore_ewma chưa fit")
        for row in np.atleast_2d(features):
            diff = row - self.mean_
            self.mean_ = self.mean_ + self.alpha * diff
            self.var_ = (1.0 - self.alpha) * self.var_ + self.alpha * diff * diff

    def z_per_dimension(self, features: np.ndarray) -> np.ndarray:
        """|x - mean| / std từng chiều — dùng cho score lẫn detail (top_metric/top_feature)."""
        if self.mean_ is None or self.var_ is None:
            raise ValueError("zscore_ewma chưa fit")
        return np.abs(features - self.mean_) / np.sqrt(self.var_ + _EPS)

    def score(self, features: np.ndarray) -> np.ndarray:
        z = np.asarray(features, dtype=float)
        z = self.z_per_dimension(z)
        max_z = z.max(axis=1)
        raw = 1.0 / (1.0 + np.exp(-(max_z / 3.0 - 1.0)))
        return np.clip(raw, 0.0, 1.0)
