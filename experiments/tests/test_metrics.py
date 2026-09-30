from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from labeling import Label
from metrics import Confusion, confusion, detection_delay_s


def test_confusion_counts():
    labels = [Label.ANOMALY, Label.ANOMALY, Label.NORMAL, Label.NORMAL]
    triggered = [True, False, True, False]
    cm = confusion(labels, triggered)
    assert (cm.tp, cm.fn, cm.fp, cm.tn) == (1, 1, 1, 1)


def test_confusion_skips_excluded():
    labels = [Label.EXCLUDED, Label.ANOMALY, Label.EXCLUDED, Label.NORMAL]
    triggered = [True, True, True, False]  # 2 mẫu EXCLUDED phải bị bỏ qua
    cm = confusion(labels, triggered)
    assert (cm.tp, cm.fn, cm.fp, cm.tn) == (1, 0, 0, 1)


def test_confusion_length_mismatch_raises():
    import pytest

    with pytest.raises(ValueError):
        confusion([Label.NORMAL], [True, False])


def test_precision_recall_f1():
    cm = Confusion(tp=8, fp=2, fn=2, tn=88)
    assert cm.precision == 0.8
    assert cm.recall == 0.8
    assert abs(cm.f1 - 0.8) < 1e-9


def test_precision_none_on_zero_denominator():
    cm = Confusion(tp=0, fp=0, fn=5, tn=10)
    assert cm.precision is None  # TP+FP = 0
    assert cm.recall == 0.0
    assert cm.f1 is None  # precision None -> f1 None


def test_recall_none_when_no_positives():
    cm = Confusion(tp=0, fp=3, fn=0, tn=10)
    assert cm.recall is None  # TP+FN = 0
    assert cm.precision == 0.0
    assert cm.f1 is None


def test_detection_delay_first_triggered_in_anomaly():
    timestamps = [2000.0, 2060.0, 2070.0, 2080.0]
    labels = [Label.EXCLUDED, Label.ANOMALY, Label.ANOMALY, Label.ANOMALY]
    triggered = [True, False, True, True]  # cờ ở EXCLUDED không tính
    delay = detection_delay_s(timestamps, labels, triggered, fault_start_ts=2000.0)
    assert delay == 70.0  # 2070 - 2000


def test_detection_delay_censored_returns_none():
    timestamps = [2060.0, 2070.0]
    labels = [Label.ANOMALY, Label.ANOMALY]
    triggered = [False, False]  # không bao giờ triggered trong ANOMALY
    delay = detection_delay_s(timestamps, labels, triggered, fault_start_ts=2000.0)
    assert delay is None  # censored — KHÔNG điền 1200s


def test_detection_delay_length_mismatch_raises():
    import pytest

    with pytest.raises(ValueError):
        detection_delay_s([1.0], [Label.ANOMALY], [True, False], fault_start_ts=0.0)
