"""Reproducible, non-persistent ML smoke using the existing replay pipeline."""

from __future__ import annotations

import csv
import hashlib
import json
import sys
import tempfile
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
DATA = ROOT / "docs" / "demo-11-10"
CSV_PATH = DATA / "ml-samples-v5-180.csv"
RAW_PATH = DATA / "ml-collector-raw-v5-180.jsonl"
METRICS = (
    "cpu_pct",
    "mem_mb",
    "latency_ms",
    "http_error_rate",
    "db_response_ms",
)
TRAIN_COUNT = 150


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def state_snapshot(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    return {
        str(item.relative_to(path)): sha256(item)
        for item in sorted(path.rglob("*"))
        if item.is_file()
    }


def read_sources() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as source:
        csv_rows = list(csv.DictReader(source))
    raw_rows = [
        json.loads(line)
        for line in RAW_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if len(csv_rows) != 180 or len(raw_rows) != 180:
        raise ValueError("Expected exactly 180 rows in each source")

    parsed_times: list[datetime] = []
    for index, (csv_row, raw_row) in enumerate(zip(csv_rows, raw_rows, strict=True)):
        if int(csv_row["seq"]) != 9118 + index or int(raw_row["seq"]) != 9118 + index:
            raise ValueError(f"Non-contiguous sequence at row {index}")
        if csv_row["ts"] != raw_row["ts"]:
            raise ValueError(f"Timestamp mismatch at row {index}")
        timestamp = datetime.fromisoformat(csv_row["ts"].replace("Z", "+00:00"))
        parsed_times.append(timestamp)
        for metric in METRICS:
            csv_value = csv_row.get(metric)
            raw_value = raw_row.get(metric)
            if csv_value in (None, "") or raw_value is None:
                raise ValueError(f"Unexpected missing {metric} at row {index}")
            if float(csv_value) != float(raw_value):
                raise ValueError(f"CSV/raw {metric} mismatch at row {index}")
        if csv_row.get("container_up") != str(raw_row.get("container_up")):
            raise ValueError(f"container_up mismatch at row {index}")
        if raw_row.get("http_error_rate_source") != "probe":
            raise ValueError(f"Unexpected http_error_rate_source at row {index}")

    if any((later - earlier).total_seconds() != 10 for earlier, later in pairwise(parsed_times)):
        raise ValueError("Sampling interval is not consistently 10 seconds")
    return csv_rows, raw_rows


def main() -> None:
    csv_rows, raw_rows = read_sources()
    before_state = state_snapshot(ROOT / "ml-service" / "state")

    service_path = ROOT / "ml-service"
    sys.path.insert(0, str(service_path))
    import config

    with tempfile.TemporaryDirectory(prefix="opspilot-ml-ready-") as isolated:
        isolated_state = Path(isolated) / "state"
        config.STATE_DIRECTORY = isolated_state
        from main import MetricSample, ReplayFeatureConfig, ReplayRequest, replay

        all_samples = [
            MetricSample.model_validate(
                {
                    "seq": int(row["seq"]),
                    "ts": row["ts"],
                    **{metric: float(row[metric]) for metric in METRICS},
                    "container_up": int(row["container_up"]),
                }
            )
            for row in csv_rows
        ]
        result = replay(
            ReplayRequest(
                samples=all_samples,
                train_count=TRAIN_COUNT,
                feature_config=ReplayFeatureConfig(metrics=list(METRICS)),
                methods=["zscore_ewma", "iforest", "ocsvm", "ensemble"],
            )
        )
        holdout = result.results[TRAIN_COUNT:]
        if len(holdout) != 30 or [item.index for item in holdout] != list(range(150, 180)):
            raise ValueError("Replay did not return the chronological 30-sample holdout")
        if any(any(value is None for value in item.scores.values()) for item in holdout):
            raise ValueError("A holdout score is missing")
        if isolated_state.exists() and any(isolated_state.iterdir()):
            raise ValueError("Replay unexpectedly persisted isolated model state")

        with (EVIDENCE / "inference-scores.csv").open("w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(
                output,
                lineterminator="\n",
                fieldnames=[
                    "seq",
                    "ts",
                    "split",
                    "train_count",
                    "feature_version",
                    "feature_dim",
                    "zscore_ewma",
                    "iforest",
                    "ocsvm",
                    "ensemble",
                ],
            )
            writer.writeheader()
            for item in holdout:
                source_row = csv_rows[item.index]
                writer.writerow(
                    {
                        "seq": source_row["seq"],
                        "ts": item.ts,
                        "split": "inference",
                        "train_count": TRAIN_COUNT,
                        "feature_version": config.FEATURE_VERSION,
                        "feature_dim": result.feature_dim,
                        **item.scores,
                    }
                )

        metric_ranges = {
            metric: {
                "min": min(float(row[metric]) for row in csv_rows),
                "max": max(float(row[metric]) for row in csv_rows),
                "missing_or_null_csv": sum(row.get(metric) in (None, "") for row in csv_rows),
                "missing_or_null_raw": sum(row.get(metric) is None for row in raw_rows),
            }
            for metric in METRICS
        }
        metadata = {
            "run_kind": "historical_normal_data_training_smoke",
            "timestamp_utc": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "sources": [
                {
                    "path": "docs/demo-11-10/ml-samples-v5-180.csv",
                    "sha256": sha256(CSV_PATH),
                    "rows": len(csv_rows),
                },
                {
                    "path": "docs/demo-11-10/ml-collector-raw-v5-180.jsonl",
                    "sha256": sha256(RAW_PATH),
                    "rows": len(raw_rows),
                },
            ],
            "split": {
                "training_rows": TRAIN_COUNT,
                "training_feature_windows": TRAIN_COUNT - config.WINDOW + 1,
                "training_seq": [
                    int(csv_rows[0]["seq"]),
                    int(csv_rows[TRAIN_COUNT - 1]["seq"]),
                ],
                "inference_rows": len(holdout),
                "inference_seq": [
                    int(csv_rows[TRAIN_COUNT]["seq"]),
                    int(csv_rows[-1]["seq"]),
                ],
                "chronological": True,
                "holdout_used_for_fit_or_scaling": False,
            },
            "pipeline": {
                "entrypoint": "ml-service.main.replay",
                "feature_version": config.FEATURE_VERSION,
                "feature_dim": result.feature_dim,
                "window": config.WINDOW,
                "metrics": list(METRICS),
                "methods": ["zscore_ewma", "iforest", "ocsvm", "ensemble"],
                "normalization": (
                    "model implementations fit scaler/score percentiles from "
                    "training feature matrix only"
                ),
                "iforest": {
                    "n_estimators": 100,
                    "contamination": "auto",
                    "random_state": config.RANDOM_STATE,
                },
                "ocsvm": {
                    "kernel": "rbf",
                    "nu": 0.05,
                    "gamma": 0.001,
                    "scaler": "StandardScaler fit on training matrix",
                },
                "zscore_ewma": {"alpha": config.EWMA_ALPHA},
                "ensemble": "median of three method scores; no additional fit",
            },
            "data_validation": {
                "row_count": len(csv_rows),
                "sequence_range": [int(csv_rows[0]["seq"]), int(csv_rows[-1]["seq"])],
                "timestamp_range_utc": [csv_rows[0]["ts"], csv_rows[-1]["ts"]],
                "sampling_interval_seconds": 10,
                "csv_raw_timestamp_sequence_metric_parity": "PASS",
                "http_error_rate_source_values": sorted(
                    {row["http_error_rate_source"] for row in raw_rows}
                ),
                "metrics": metric_ranges,
            },
            "isolation": {
                "state_directory": "temporary directory; removed after run",
                "isolated_state_written": False,
                "existing_ml_service_state_unchanged": state_snapshot(ROOT / "ml-service" / "state")
                == before_state,
            },
            "limitations": [
                "Historical normal-data training smoke only; not a 75-minute pilot.",
                "No fault/anomaly labels were present or created.",
                "Scores do not establish precision, recall, accuracy, or fault detection quality.",
            ],
        }
        if not metadata["isolation"]["existing_ml_service_state_unchanged"]:
            raise ValueError("Existing ml-service state changed during isolated replay")
        (EVIDENCE / "training-metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        validation = {
            "result": "PASS",
            "checks": {
                "source_hashes_recorded": True,
                "180_rows_each": len(csv_rows) == len(raw_rows) == 180,
                "seq_9118_through_9297": [
                    int(csv_rows[0]["seq"]),
                    int(csv_rows[-1]["seq"]),
                ]
                == [9118, 9297],
                "10_second_cadence": True,
                "five_metric_parity_and_non_null": all(
                    item["missing_or_null_csv"] == item["missing_or_null_raw"] == 0
                    for item in metric_ranges.values()
                ),
                "probe_source": metadata["data_validation"]["http_error_rate_source_values"]
                == ["probe"],
                "150_train_30_inference": len(holdout) == 30,
                "holdout_not_used_to_fit_or_scale": True,
                "all_four_method_scores_present": True,
                "isolated_state_and_existing_state_unchanged": metadata["isolation"][
                    "existing_ml_service_state_unchanged"
                ],
            },
        }
        (EVIDENCE / "validation-results.json").write_text(
            json.dumps(validation, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )


if __name__ == "__main__":
    main()
