"""Lịch tác động fault cho pha C (TK-S6, docs/07 mục 6).

TÁCH THUẦN có chủ đích: `plan_fault()` chỉ SINH danh sách hành động theo thời gian (offset giây
so với fault_start) — không gọi mạng. Runner (`apply_plan`, có `# pragma: no cover`) mới bắn HTTP
tới `/debug/*` của app demo. Nhờ vậy lịch fault test được tái lập 100% mà không cần app thật.

Năm kịch bản (docs/07 mục 6), pha C = 20 phút = 1200s:
  memory_leak   GET /debug/leak?mb=5      mỗi 10s        (đối tượng: tăng dần tới trần 512MB)
  cpu_spike     GET /debug/cpu?ms=x       x: 20→400,  +20ms/phút
  error_burst   GET /debug/error-rate?p=0.3  MỘT lần, đột ngột ở phút 0
  slow_db       GET /debug/slow-db?sec=x  x: 0.05→1.5, ramp tuyến tính mỗi phút
  latency_creep GET /debug/latency?ms=x   x: +50ms/phút, trần 2500  (xem GHI CHÚ dưới)

GHI CHÚ latency_creep (chốt trước pilot, DECISIONS.md 2026-10-01): giữ đúng lịch +50ms/phút
(trần 2500ms). Lịch này tạo tối đa khoảng 1.000 ms delay bổ sung ở cuối pha; việc latency quan sát
vượt 2.000 ms và ML có phát hiện sớm hay không là kết quả cần đo, không khẳng định trước.
"""

from __future__ import annotations

from dataclasses import dataclass, field

FAULT_DURATION_S = 1200  # pha C = 20 phút (docs/07 mục 4)


@dataclass(frozen=True)
class FaultAction:
    """Một tác động: bắn `GET {path}` tại `offset_s` giây sau fault_start."""

    offset_s: int
    path: str
    note: str = ""


@dataclass(frozen=True)
class FaultPlan:
    scenario: str
    actions: tuple[FaultAction, ...]
    params: dict = field(default_factory=dict)


def _ramp_per_minute(
    endpoint: str, query_key: str, start: float, end: float, minutes: int, as_int: bool
) -> list[FaultAction]:
    """Ramp tuyến tính `start`→`end` qua `minutes` bước, mỗi bước cách nhau 60s.

    Bước i (0..minutes-1) tại offset i*60, giá trị = start + (end-start)*i/(minutes-1).
    minutes=1 -> chỉ 1 bước tại 0 với giá trị start.
    """
    actions: list[FaultAction] = []
    for i in range(minutes):
        frac = i / (minutes - 1) if minutes > 1 else 0.0
        value = start + (end - start) * frac
        value = round(value) if as_int else round(value, 4)
        actions.append(
            FaultAction(
                offset_s=i * 60,
                path=f"{endpoint}?{query_key}={value}",
                note=f"phút {i}",
            )
        )
    return actions


def plan_fault(scenario: str, duration_s: int = FAULT_DURATION_S) -> FaultPlan:
    """Sinh lịch tác động cho một scenario. Thuần, không I/O. Xác định theo scenario + duration."""
    minutes = max(1, duration_s // 60)

    if scenario == "memory_leak":
        # mb=5 mỗi 10s suốt pha C -> duration_s/10 lần, tổng ~ (duration/10)*5 MB.
        actions = tuple(
            FaultAction(offset_s=t, path="/debug/leak?mb=5", note=f"+5MB @ {t}s")
            for t in range(0, duration_s, 10)
        )
        return FaultPlan(
            scenario,
            actions,
            {
                "mb_per_call": 5,
                "interval_s": 10,
                "calls": len(actions),
                "total_mb_requested": len(actions) * 5,
            },
        )

    if scenario == "cpu_spike":
        actions = tuple(
            _ramp_per_minute("/debug/cpu", "ms", 20, 400, minutes, as_int=True)
        )
        return FaultPlan(
            scenario, actions, {"ms_start": 20, "ms_end": 400, "step_per_min": 20}
        )

    if scenario == "error_burst":
        # Đột ngột: bật p=0.3 một lần ở phút 0, giữ nguyên suốt pha C.
        actions = (
            FaultAction(
                offset_s=0, path="/debug/error-rate?p=0.3", note="đột ngột p=0.3"
            ),
        )
        return FaultPlan(scenario, actions, {"p": 0.3, "mode": "abrupt"})

    if scenario == "slow_db":
        actions = tuple(
            _ramp_per_minute("/debug/slow-db", "sec", 0.05, 1.5, minutes, as_int=False)
        )
        return FaultPlan(
            scenario, actions, {"sec_start": 0.05, "sec_end": 1.5, "ramp": "per_minute"}
        )

    if scenario == "latency_creep":
        # +50ms mỗi phút: phút i -> 50*(i+1), trần 2500 (server cũng clamp). Xem GHI CHÚ đầu file.
        actions = tuple(
            FaultAction(
                offset_s=i * 60,
                path=f"/debug/latency?ms={min(50 * (i + 1), 2500)}",
                note=f"phút {i}",
            )
            for i in range(minutes)
        )
        return FaultPlan(scenario, actions, {"ms_per_min": 50, "ms_max": 2500})

    raise ValueError(f"scenario không hợp lệ: {scenario!r}")


def apply_plan(
    app_base_url: str, plan: FaultPlan, sleep_fn=None, now_fn=None
) -> None:  # pragma: no cover
    """Bắn lịch fault theo thời gian thực tới app demo. Chỉ chạy trong run thật (cần requests + app)."""
    import time

    import requests

    sleep_fn = sleep_fn or time.sleep
    now_fn = now_fn or time.monotonic
    started = now_fn()
    for action in plan.actions:
        target = started + action.offset_s
        while now_fn() < target:
            sleep_fn(min(1.0, target - now_fn()))
        try:
            requests.get(f"{app_base_url.rstrip('/')}{action.path}", timeout=5)
        except Exception as exc:  # noqa: BLE001
            print(f"fault action lỗi ({action.path}): {exc}", flush=True)


def reset_fault(app_base_url: str) -> bool:  # pragma: no cover
    """Tắt mọi hiệu ứng fault (POST /debug/reset). Gọi ở cuối pha C."""
    import requests

    try:
        response = requests.post(f"{app_base_url.rstrip('/')}/debug/reset", timeout=5)
        return response.status_code == 200
    except Exception:  # noqa: BLE001
        return False
