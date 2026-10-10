"""Chỉ số đánh giá phát hiện: P/R/F1 + detection delay (TK-S6, docs/07 mục 5).

Thuần, đầu vào là các list Python — test không cần CSV/DB. Cặp đôi với `labeling.py`:
`labeling` cho nhãn + trạng thái triggered, `metrics` cho con số.

Quy ước (docs/07 mục 5):
- Chỉ tính TP/FP/FN/TN trên mẫu có nhãn NORMAL hoặc ANOMALY; mẫu EXCLUDED bỏ qua hoàn toàn.
- Precision = TP/(TP+FP), Recall = TP/(TP+FN), F1 = 2PR/(P+R). Mẫu số 0 -> None (không định nghĩa).
- Detection delay = ts mẫu triggered ĐẦU TIÊN trong vùng ANOMALY − fault_start (giây).
  Không triggered lần nào trong vùng ANOMALY -> None (CENSORED), KHÔNG điền 1200s.
"""

from __future__ import annotations

from dataclasses import dataclass

from labeling import Label


@dataclass(frozen=True)
class Confusion:
    tp: int
    fp: int
    fn: int
    tn: int

    @property
    def precision(self) -> float | None:
        denom = self.tp + self.fp
        return self.tp / denom if denom else None

    @property
    def recall(self) -> float | None:
        denom = self.tp + self.fn
        return self.tp / denom if denom else None

    @property
    def f1(self) -> float | None:
        p, r = self.precision, self.recall
        if p is None or r is None or (p + r) == 0:
            return None
        return 2 * p * r / (p + r)


def confusion(labels: list[Label], triggered: list[bool]) -> Confusion:
    """Ma trận nhầm lẫn trên các mẫu NORMAL/ANOMALY (EXCLUDED bỏ qua)."""
    if len(labels) != len(triggered):
        raise ValueError("labels và triggered phải cùng độ dài")
    tp = fp = fn = tn = 0
    for label, fired in zip(labels, triggered):
        if label is Label.ANOMALY:
            if fired:
                tp += 1
            else:
                fn += 1
        elif label is Label.NORMAL:
            if fired:
                fp += 1
            else:
                tn += 1
        # EXCLUDED: không tính
    return Confusion(tp=tp, fp=fp, fn=fn, tn=tn)


def detection_delay_s(
    timestamps: list[float],
    labels: list[Label],
    triggered: list[bool],
    fault_start_ts: float,
) -> float | None:
    """Trễ phát hiện (giây) = ts mẫu triggered đầu tiên trong vùng ANOMALY − fault_start.

    Trả None nếu không có mẫu triggered nào trong vùng ANOMALY (censored — báo cáo riêng,
    không nhồi số). docs/07 mục 5.
    """
    if not (len(timestamps) == len(labels) == len(triggered)):
        raise ValueError("timestamps, labels, triggered phải cùng độ dài")
    for ts, label, fired in zip(timestamps, labels, triggered):
        if label is Label.ANOMALY and fired:
            return ts - fault_start_ts
    return None
