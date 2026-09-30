from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from faults.scheduler import FAULT_DURATION_S, plan_fault


def test_memory_leak_every_10s():
    plan = plan_fault("memory_leak")
    assert plan.scenario == "memory_leak"
    assert len(plan.actions) == FAULT_DURATION_S // 10  # 120 lần trong 1200s
    assert all(a.path == "/debug/leak?mb=5" for a in plan.actions)
    assert plan.actions[0].offset_s == 0
    assert plan.actions[1].offset_s == 10
    assert plan.actions[-1].offset_s == FAULT_DURATION_S - 10
    assert plan.params["total_mb_requested"] == 120 * 5


def test_cpu_spike_ramps_20_to_400():
    plan = plan_fault("cpu_spike")
    assert len(plan.actions) == 20  # 20 phút
    assert plan.actions[0].path == "/debug/cpu?ms=20"
    assert plan.actions[-1].path == "/debug/cpu?ms=400"
    # bước cách nhau đúng 60s
    assert [a.offset_s for a in plan.actions[:3]] == [0, 60, 120]
    # tăng dần đều
    values = [int(a.path.split("=")[1]) for a in plan.actions]
    assert values == sorted(values)


def test_error_burst_single_abrupt():
    plan = plan_fault("error_burst")
    assert len(plan.actions) == 1
    assert plan.actions[0].offset_s == 0
    assert plan.actions[0].path == "/debug/error-rate?p=0.3"
    assert plan.params["mode"] == "abrupt"


def test_slow_db_ramps_005_to_15():
    plan = plan_fault("slow_db")
    assert len(plan.actions) == 20
    assert plan.actions[0].path == "/debug/slow-db?sec=0.05"
    assert plan.actions[-1].path == "/debug/slow-db?sec=1.5"


def test_latency_creep_50ms_per_min_capped():
    plan = plan_fault("latency_creep")
    assert len(plan.actions) == 20
    assert plan.actions[0].path == "/debug/latency?ms=50"    # phút 0 -> 50
    assert plan.actions[1].path == "/debug/latency?ms=100"
    # phút 19 -> 50*20 = 1000 (không chạm trần 2500 trong 20')
    assert plan.actions[-1].path == "/debug/latency?ms=1000"


def test_latency_creep_cap_applies_for_long_duration():
    # duration dài giả định để chạm trần 2500: phút 49 -> 2500, phút 50 -> vẫn 2500.
    plan = plan_fault("latency_creep", duration_s=60 * 60)  # 60 phút
    values = [int(a.path.split("=")[1]) for a in plan.actions]
    assert max(values) == 2500
    assert values[49] == 2500  # 50*50 = 2500


def test_shorter_duration_scales_leak_calls():
    plan = plan_fault("memory_leak", duration_s=100)
    assert len(plan.actions) == 10  # 100/10


def test_invalid_scenario_raises():
    with pytest.raises(ValueError):
        plan_fault("khong_ton_tai")


def test_apply_plan_fires_in_order_with_fake_clock():
    # apply_plan có pragma no cover, nhưng vẫn kiểm được thứ tự bằng đồng hồ giả + monkeypatch requests.
    import faults.scheduler as sched

    calls: list[str] = []

    class _FakeResp:
        status_code = 200

    class _FakeRequests:
        @staticmethod
        def get(url, timeout=5):
            calls.append(url)
            return _FakeResp()

    # đồng hồ giả nhảy đủ xa để mọi action tới hạn ngay
    fake_now = {"t": 0.0}

    def now_fn():
        return fake_now["t"]

    def sleep_fn(_seconds):
        fake_now["t"] += 10_000  # nhảy lớn để vượt mọi offset

    import sys as _sys

    _sys.modules_backup = _sys.modules.get("requests")
    _sys.modules["requests"] = _FakeRequests()
    try:
        plan = plan_fault("cpu_spike")
        sched.apply_plan("http://app:3000", plan, sleep_fn=sleep_fn, now_fn=now_fn)
    finally:
        if _sys.modules_backup is None:
            _sys.modules.pop("requests", None)
        else:
            _sys.modules["requests"] = _sys.modules_backup

    assert len(calls) == 20
    assert calls[0].endswith("/debug/cpu?ms=20")
    assert calls[-1].endswith("/debug/cpu?ms=400")
