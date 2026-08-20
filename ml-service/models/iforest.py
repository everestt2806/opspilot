"""Isolation Forest — score = -decision_function chuẩn hoá min-max theo p1/p99 tập train."""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import IsolationForest

from config import NORM_HIGH_PERCENTILE, NORM_LOW_PERCENTILE, RANDOM_STATE
from models.base import Detector, minmax_by_train_percentiles


class IsolationForestDetector(Detector):
    name = "iforest"

    def __init__(
        self,
        n_estimators: int = 100,
        contamination: str = "auto",
        random_state: int = RANDOM_STATE,
    ) -> None:
        self.model = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=random_state,
        )
        self.low_: float | None = None
        self.high_: float | None = None

    def fit(self, features: np.ndarray) -> IsolationForestDetector:
        if features.shape[0] < 2:
            raise ValueError("iforest fit: cần ít nhất 2 mẫu")
        self.model.fit(features)
        raw_train = -self.model.decision_function(features)
        self.low_ = float(np.percentile(raw_train, NORM_LOW_PERCENTILE))
        self.high_ = float(np.percentile(raw_train, NORM_HIGH_PERCENTILE))
        return self

    def score(self, features: np.ndarray) -> np.ndarray:
        if self.low_ is None or self.high_ is None:
            raise ValueError("iforest chưa fit")
        raw = -self.model.decision_function(features)
        return minmax_by_train_percentiles(raw, self.low_, self.high_)
