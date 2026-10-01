"""Phân tích kết quả thí nghiệm offline (docs/07 mục 9).

Chuỗi phân tích cho một run:
  score_sample.csv (method, ts_vps, above_threshold) --triggered_series--> triggered/method
  experiment_run.csv (fault_start/end, grace) --------label_series------> nhãn/mẫu
  -> confusion + detection_delay_s (từ metrics.py) cho từng method
Gộp 10 run: mean ± std + khoảng tin cậy 95% (t, n=10). Grace-sweep {0,30,60,120} (docs/07 mục 5).
Hỗ trợ cả mốc float epoch lẫn chuỗi ISO 8601 UTC theo schema.sql.
"""

from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    from labeling import RunWindows, label_series, triggered_series
    from metrics import confusion, detection_delay_s
except ImportError:
    from experiments.labeling import RunWindows, label_series, triggered_series
    from experiments.metrics import confusion, detection_delay_s

try:
    from manifest import LEGACY_PROTOCOL_DEFAULT
except ImportError:
    try:
        from experiments.manifest import LEGACY_PROTOCOL_DEFAULT
    except ImportError:
        LEGACY_PROTOCOL_DEFAULT = "legacy-pre-pilot"


GRACE_SWEEP_S = (0, 30, 60, 120)
METHODS = ("rule", "zscore_ewma", "iforest", "ocsvm", "ensemble")
# consecutive dùng chung: rule=3, ML=2 (docs/07 mục 5, monitor_setting mặc định).
CONSECUTIVE = {"rule": 3, "zscore_ewma": 2, "iforest": 2, "ocsvm": 2, "ensemble": 2}


@dataclass(frozen=True)
class MethodResult:
    method: str
    precision: float | None
    recall: float | None
    f1: float | None
    detection_delay_s: float | None  # None = censored (không phát hiện trong pha C)


def _parse_ts(value: str | float) -> float:
    """Đọc timestamp: hỗ trợ cả số (giây epoch) lẫn chuỗi ISO 8601 UTC."""
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    try:
        return float(text)
    except ValueError:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.timestamp()


def _to_float(value: str | float) -> float:
    return _parse_ts(value)


def analyze_run(
    score_rows: list[dict],
    fault_start_ts: float | str,
    fault_end_ts: float | str,
    holdout_start_ts: float | str,
    grace_s: float,
) -> list[MethodResult]:
    """Tính kết quả từng method cho MỘT run, tại một giá trị grace cụ thể. Thuần.

    `score_rows`: mỗi dòng score_sample.csv có khoá 'method','ts_vps'(float/ISO),'above_threshold'.
    Sắp theo ts_vps trước khi dựng chuỗi (triggered cần đúng thứ tự thời gian).
    """
    f_start = _parse_ts(fault_start_ts)
    f_end = _parse_ts(fault_end_ts)
    h_start = _parse_ts(holdout_start_ts)

    windows = RunWindows(
        holdout_start_ts=h_start,
        fault_start_ts=f_start,
        fault_end_ts=f_end,
        grace_s=grace_s,
    )
    results: list[MethodResult] = []
    for method in METHODS:
        rows = sorted(
            (r for r in score_rows if r["method"] == method),
            key=lambda r: _parse_ts(r["ts_vps"]),
        )
        if not rows:
            results.append(MethodResult(method, None, None, None, None))
            continue
        timestamps = [_parse_ts(r["ts_vps"]) for r in rows]
        above = [str(r["above_threshold"]) in ("1", "True", "true") for r in rows]
        labels = label_series(timestamps, windows)
        triggered = triggered_series(above, CONSECUTIVE[method])
        cm = confusion(labels, triggered)
        delay = detection_delay_s(timestamps, labels, triggered, f_start)
        results.append(MethodResult(method, cm.precision, cm.recall, cm.f1, delay))
    return results


@dataclass(frozen=True)
class Aggregate:
    n: int  # số run có giá trị (không tính None)
    mean: float | None
    std: float | None
    ci95_low: float | None
    ci95_high: float | None
    censored: int  # số run None (với detection delay = không phát hiện)


def aggregate(values: list[float | None]) -> Aggregate:
    """Gộp qua các run: mean ± std mẫu + CI 95% (phân phối t). None bị loại và đếm là censored.

    n<2 -> không có std/CI (trả None), vẫn trả mean nếu n>=1. docs/07 mục 9.1.
    """
    present = [v for v in values if v is not None]
    censored = len(values) - len(present)
    if not present:
        return Aggregate(
            n=0, mean=None, std=None, ci95_low=None, ci95_high=None, censored=censored
        )
    n = len(present)
    mean = sum(present) / n
    if n < 2:
        return Aggregate(
            n=n, mean=mean, std=None, ci95_low=None, ci95_high=None, censored=censored
        )
    variance = sum((x - mean) ** 2 for x in present) / (n - 1)
    std = math.sqrt(variance)
    from scipy import stats  # có sẵn trong venv; chỉ dùng để lấy t critical

    t_crit = float(stats.t.ppf(0.975, df=n - 1))
    margin = t_crit * std / math.sqrt(n)
    return Aggregate(
        n=n,
        mean=mean,
        std=std,
        ci95_low=mean - margin,
        ci95_high=mean + margin,
        censored=censored,
    )


def read_score_csv(path: Path) -> list[dict]:
    """Đọc score_sample.csv -> list dict. Chỉ giữ cột cần cho phân tích."""
    with path.open(newline="", encoding="utf-8") as stream:
        return [
            {
                "method": row["method"],
                "ts_vps": row["ts_vps"],
                "above_threshold": row["above_threshold"],
            }
            for row in csv.DictReader(stream)
        ]


def read_run_meta(path: Path) -> dict:
    """Đọc experiment_run.csv (1 dòng) -> dict các mốc thời gian cần cho phân tích."""
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    if not rows:
        raise ValueError(f"{path} rỗng")
    return rows[0]


def _fmt(value: float | None, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def main_table(
    run_dirs: list[Path], grace_s: float = 60.0
) -> str:  # pragma: no cover - I/O ráp nối
    """Ráp bảng chính Markdown (docs/07 mục 9.1) từ nhiều thư mục run. Mỗi ô mean±std [CI].

    docs/07 & TK-S6 P2b-3:
    Lọc status: chỉ phân tích các run có status='completed'. Bỏ qua run aborted/running
    trước khi đọc score_sample.csv hoặc gọi analyze_run(). Run aborted được giữ làm
    dữ liệu vận hành riêng biệt.
    """
    per_method: dict[str, dict[str, list]] = {
        m: {"f1": [], "precision": [], "recall": [], "delay": []} for m in METHODS
    }
    for run_dir in run_dirs:
        meta = read_run_meta(run_dir / "experiment_run.csv")
        if meta.get("status") != "completed":
            continue

        scores = read_score_csv(run_dir / "score_sample.csv")
        results = analyze_run(
            scores,
            fault_start_ts=meta["fault_start_ts"],
            fault_end_ts=meta["fault_end_ts"],
            holdout_start_ts=meta["train_at_ts"],
            grace_s=grace_s,
        )
        for r in results:
            per_method[r.method]["f1"].append(r.f1)
            per_method[r.method]["precision"].append(r.precision)
            per_method[r.method]["recall"].append(r.recall)
            per_method[r.method]["delay"].append(r.detection_delay_s)

    lines = [
        "| Method | Precision | Recall | F1 | Delay (s) | #censored |",
        "|---|---|---|---|---|---|",
    ]
    for method in METHODS:
        p = aggregate(per_method[method]["precision"])
        rec = aggregate(per_method[method]["recall"])
        f1 = aggregate(per_method[method]["f1"])
        d = aggregate(per_method[method]["delay"])
        lines.append(
            f"| {method} | {_fmt(p.mean)} | {_fmt(rec.mean)} | {_fmt(f1.mean)} "
            f"| {_fmt(d.mean, 1)} | {d.censored} |"
        )
    return "\n".join(lines)


@dataclass(frozen=True)
class OperationalTelemetry:
    total_runs: int
    completed_runs: int
    aborted_runs: int
    first_attempt_success_count: int
    retry_success_count: int
    abort_reasons: dict[str, int]
    attempts_distribution: dict[int, int]


def collect_operational_telemetry(run_dirs: list[Path]) -> OperationalTelemetry:
    """Thu thập dữ liệu vận hành từ danh sách run_dirs: tách bạch run completed và aborted."""
    total = len(run_dirs)
    completed = 0
    aborted = 0
    first_attempt_success = 0
    retry_success = 0
    abort_reasons: dict[str, int] = defaultdict(int)
    attempts_distribution: dict[int, int] = defaultdict(int)

    for run_dir in run_dirs:
        meta_file = run_dir / "experiment_run.csv"
        if not meta_file.exists():
            continue
        meta = read_run_meta(meta_file)
        status = meta.get("status", "")
        att_str = meta.get("attempt_index", "1")
        try:
            attempt_idx = int(att_str) if att_str else 1
        except ValueError:
            attempt_idx = 1
        attempts_distribution[attempt_idx] += 1

        if status == "completed":
            completed += 1
            if attempt_idx == 1:
                first_attempt_success += 1
            else:
                retry_success += 1
        elif status == "aborted":
            aborted += 1
            reason = meta.get("abort_reason") or "unspecified"
            abort_reasons[reason] += 1

    return OperationalTelemetry(
        total_runs=total,
        completed_runs=completed,
        aborted_runs=aborted,
        first_attempt_success_count=first_attempt_success,
        retry_success_count=retry_success,
        abort_reasons=dict(abort_reasons),
        attempts_distribution=dict(attempts_distribution),
    )


def operational_table(run_dirs: list[Path]) -> str:
    """Tạo bảng Markdown báo cáo độ ổn định vận hành và hạ tầng từ các run (gồm cả aborted)."""
    telemetry = collect_operational_telemetry(run_dirs)
    lines = [
        "| Metric | Value |",
        "|---|---|",
        f"| Total Runs Exported | {telemetry.total_runs} |",
        f"| Completed Runs | {telemetry.completed_runs} |",
        f"| Aborted Runs | {telemetry.aborted_runs} |",
        f"| First-Attempt Success | {telemetry.first_attempt_success_count} |",
        f"| Retry Success (Att 2-3) | {telemetry.retry_success_count} |",
    ]
    if telemetry.abort_reasons:
        reasons_str = "; ".join(f"{r}: {c}" for r, c in telemetry.abort_reasons.items())
        lines.append(f"| Abort Reasons Breakdown | {reasons_str} |")
    return "\n".join(lines)


def find_run_dirs(results_root: Path) -> list[Path]:  # pragma: no cover - quét thư mục
    """Mọi thư mục con có đủ experiment_run.csv + score_sample.csv dưới results_root."""
    return sorted(
        d
        for d in results_root.rglob("run_*")
        if (d / "experiment_run.csv").exists() and (d / "score_sample.csv").exists()
    )


# --- Khả năng tương thích ngược từ worktree ban đầu (đọc meta.json offline) ---


def _number(value: str | float | None) -> float | None:
    if value in (None, "", "null"):
        return None
    try:
        return _parse_ts(value)
    except Exception:  # noqa: BLE001
        return None


def load_run(
    directory: Path,
) -> tuple[dict[str, Any], list[dict[str, str]], list[dict[str, str]]]:
    manifest = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    if not manifest.get("protocol_version"):
        manifest["protocol_version"] = LEGACY_PROTOCOL_DEFAULT
    with (directory / "metric_sample.csv").open(newline="", encoding="utf-8") as handle:
        metrics = list(csv.DictReader(handle))
    with (directory / "score_sample.csv").open(newline="", encoding="utf-8") as handle:
        scores = list(csv.DictReader(handle))
    return manifest, metrics, scores


def summarize(directory: Path, grace_s: int = 60) -> list[dict[str, Any]]:
    manifest, _metrics, scores = load_run(directory)
    phase = {"scenario": manifest.get("scenario", directory.name), "grace_s": grace_s}
    fault_start = _number(manifest.get("fault_start_epoch_s"))
    fault_end = _number(manifest.get("fault_end_epoch_s"))
    if fault_start is None or fault_end is None:
        return []
    method_flags: dict[str, list[tuple[float, bool]]] = defaultdict(list)
    for row in scores:
        ts = _number(row.get("ts_epoch_s"))
        if ts is None:
            continue
        method = row.get("method", "")
        score = _number(row.get("score"))
        triggered = row.get("above_threshold") in {"1", "true", "True"} or (
            score is not None and score > 0.7
        )
        method_flags[method].append((ts, triggered))

    rows: list[dict[str, Any]] = []
    anomaly_start = fault_start + grace_s
    for method in METHODS:
        tp = fp = fn = tn = 0
        first_anomaly: float | None = None
        for ts, triggered in method_flags.get(method, []):
            normal = ts < fault_start or ts > fault_end
            excluded = fault_start <= ts < anomaly_start
            if excluded:
                continue
            anomaly = anomaly_start <= ts <= fault_end
            if anomaly and triggered:
                tp += 1
                first_anomaly = ts if first_anomaly is None else min(first_anomaly, ts)
            elif anomaly:
                fn += 1
            elif normal and triggered:
                fp += 1
            elif normal:
                tn += 1
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        rows.append(
            {
                **phase,
                "method": method,
                "tp": tp,
                "fp": fp,
                "fn": fn,
                "tn": tn,
                "precision": precision,
                "recall": recall,
                "f1": (
                    2 * precision * recall / (precision + recall)
                    if precision + recall
                    else 0.0
                ),
                "detection_delay_s": (
                    None if first_anomaly is None else first_anomaly - fault_start
                ),
            }
        )
    return rows


if (
    __name__ == "__main__"
):  # pragma: no cover - CLI mỏng, logic đã test qua main_table/analyze_run
    import argparse
    import sys

    # Console Windows mặc định cp1252 không in được tiếng Việt -> ép UTF-8 (Python 3.7+).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="Phân tích kết quả thí nghiệm (docs/07 mục 9)"
    )
    parser.add_argument(
        "results_root", help="Thư mục experiments/results/ (hoặc 1 thư mục run)"
    )
    parser.add_argument(
        "--grace", type=float, default=60.0, help="detection grace (giây)"
    )
    args = parser.parse_args()

    root = Path(args.results_root)
    run_dirs = find_run_dirs(root)
    if not run_dirs and (root / "experiment_run.csv").exists():
        run_dirs = [root]  # cho phép trỏ thẳng 1 thư mục run
    if not run_dirs:
        raise SystemExit(f"Không tìm thấy thư mục run nào dưới {root}")

    print(
        f"# Bảng chính — {len(run_dirs)} run, grace={args.grace:.0f}s (docs/07 mục 9.1)\n"
    )
    print(main_table(run_dirs, grace_s=args.grace))
    print("\n## Grace-sweep (docs/07 mục 5)")
    for grace_val in GRACE_SWEEP_S:
        print(f"\n### grace = {grace_val}s\n")
        print(main_table(run_dirs, grace_s=float(grace_val)))
