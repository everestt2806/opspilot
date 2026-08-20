"""Ensemble voting — không train gì thêm.

score = trung vị 3 score con. above_threshold = cờ của >=2/3 method con vượt ngưỡng
(ADR-008) — tính từ cờ, KHÔNG phải từ việc so score ensemble với ngưỡng.
"""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np

_CHILD_METHODS = ("zscore_ewma", "iforest", "ocsvm")


def ensemble_score(scores_by_method: Mapping[str, np.ndarray]) -> np.ndarray:
    """Trung vị 3 score con; thiếu method nào thì tính trên số có sẵn."""
    child_scores = [
        np.asarray(scores_by_method[m], dtype=float)
        for m in _CHILD_METHODS
        if m in scores_by_method
    ]
    if not child_scores:
        raise ValueError("ensemble_score: không có score của method con nào")
    stack = np.vstack(child_scores)
    return np.median(stack, axis=0)


def ensemble_above_threshold(
    flags_by_method: Mapping[str, np.ndarray], threshold: float
) -> np.ndarray:
    """Cờ ensemble: >=2/3 method con có score > threshold (mỗi mẫu)."""
    child_flags = [
        np.asarray(flags_by_method[m] > threshold, dtype=bool)
        for m in _CHILD_METHODS
        if m in flags_by_method
    ]
    if len(child_flags) < 2:
        raise ValueError("ensemble_above_threshold: cần ít nhất 2 method con")
    trigger_count = np.sum(np.vstack(child_flags), axis=0)
    return trigger_count >= 2
