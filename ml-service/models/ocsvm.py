"""One-Class SVM — StandardScaler bắt buộc trước khi fit; chuẩn hoá score như iforest.

gamma=0.001 thay cho 'scale' (1/20): đo 80 seeds trên dữ liệu giả, 'scale' cho ~71% mẫu
bình thường unseen chạm trần 1.0 (kernel quá khít trong không gian 20 chiều, 201 mẫu),
0.001 hạ còn ~40% mà anomaly rõ vẫn 1.0. Xem DECISIONS.md (20/08).
"""

from __future__ import annotations

import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM

from config import NORM_HIGH_PERCENTILE, NORM_LOW_PERCENTILE
from models.base import Detector, minmax_by_train_percentiles


class OneClassSvmDetector(Detector):
    name = "ocsvm"

    def __init__(self, kernel: str = "rbf", nu: float = 0.05, gamma: float = 0.001) -> None:
        self.scaler = StandardScaler()
        self.model = OneClassSVM(kernel=kernel, nu=nu, gamma=gamma)
        self.low_: float | None = None
        self.high_: float | None = None

    def fit(self, features: np.ndarray) -> OneClassSvmDetector:
        if features.shape[0] < 2:
            raise ValueError("ocsvm fit: cần ít nhất 2 mẫu")
        scaled = self.scaler.fit_transform(features)
        self.model.fit(scaled)
        raw_train = -self.model.decision_function(scaled)
        self.low_ = float(np.percentile(raw_train, NORM_LOW_PERCENTILE))
        self.high_ = float(np.percentile(raw_train, NORM_HIGH_PERCENTILE))
        return self

    def score(self, features: np.ndarray) -> np.ndarray:
        if self.low_ is None or self.high_ is None:
            raise ValueError("ocsvm chưa fit")
        scaled = self.scaler.transform(features)
        raw = -self.model.decision_function(scaled)
        return minmax_by_train_percentiles(raw, self.low_, self.high_)
