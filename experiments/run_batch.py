"""Batch orchestrator for the 50 official OpsPilot ML runs (5 scenarios x 10 repeats).

Enables deterministic sharding across 2 identical VPSs (~34.5h per VPS instead
of ~69h sequential), resume from SQLite by skipping already completed runs, and
mandatory preflight gating before starting live runs. Never modifies protocol
durations, thresholds, or fault schedules.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_EXPERIMENTS_DIR = str(Path(__file__).resolve().parent)
if _EXPERIMENTS_DIR not in sys.path:
    sys.path.insert(0, _EXPERIMENTS_DIR)

from experiments.analyze import cli_main as analyze_cli_main
from experiments.preflight import run_preflight, write_report
from experiments.run_experiment import run_experiment

logger = logging.getLogger(__name__)

PROTOCOL_SCENARIOS: tuple[str, ...] = (
    "memory_leak",
    "cpu_spike",
    "error_burst",
    "slow_db",
    "latency_creep",
)
PROTOCOL_REPEATS = 10


@dataclass(frozen=True)
class RunSpec:
    scenario: str
    repeat_index: int


def build_batch_plan(
    scenarios: tuple[str, ...] = PROTOCOL_SCENARIOS,
    repeats: int = PROTOCOL_REPEATS,
    shard_index: int = 1,
    shard_total: int = 1,
) -> list[RunSpec]:
    """Builds a balanced deterministic run plan partitioned by shard (1-based index)."""
    if shard_total < 1 or shard_index < 1 or shard_index > shard_total:
        raise ValueError("shard_index must satisfy 1 <= shard_index <= shard_total")
    if repeats < 1:
        raise ValueError("repeats must be >= 1")

    all_specs = [
        RunSpec(scenario=scenario, repeat_index=repeat_idx)
        for repeat_idx in range(1, repeats + 1)
        for scenario in scenarios
    ]
    return [
        spec
        for idx, spec in enumerate(all_specs)
        if (idx % shard_total) == (shard_index - 1)
    ]


def completed_runs_from_db(db_path: str | Path) -> set[tuple[str, int]]:
    """Reads only (scenario, repeat_index) for completed runs; never queries credentials."""
    path = Path(db_path)
    if not path.exists():
        return set()
    conn = sqlite3.connect(str(path))
    try:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='experiment_run'"
        ).fetchone()
        if not has_table:
            return set()
        rows = conn.execute(
            "SELECT DISTINCT scenario, repeat_index FROM experiment_run WHERE status = 'completed'"
        ).fetchall()
        return {(str(row[0]), int(row[1])) for row in rows}
    finally:
        conn.close()


def pending_runs(
    plan: list[RunSpec],
    completed: set[tuple[str, int]],
) -> list[RunSpec]:
    """Filters out runs that already reached status='completed'."""
    return [
        spec for spec in plan if (spec.scenario, spec.repeat_index) not in completed
    ]


def _preflight_allows_batch(report: dict[str, Any]) -> bool:
    """Allows single-VPS batch when every gate passes except placeholder PROTOCOL_PROVIDER_PAIR."""
    if report.get("overall") == "PASS":
        return True
    gates = report.get("gates")
    if not isinstance(gates, list) or len(gates) == 0:
        return False
    return all(
        gate.get("status") == "PASS" or gate.get("name") == "PROTOCOL_PROVIDER_PAIR"
        for gate in gates
    )


def execute_batch(args: argparse.Namespace) -> dict[str, Any]:
    """Runs preflight, executes pending shard runs sequentially, and summarizes results."""
    scenarios = tuple(args.scenarios) if args.scenarios else PROTOCOL_SCENARIOS
    plan = build_batch_plan(
        scenarios=scenarios,
        repeats=args.repeats,
        shard_index=args.shard_index,
        shard_total=args.shard_total,
    )
    completed = completed_runs_from_db(args.db_path)
    todo = pending_runs(plan, completed)

    summary: dict[str, Any] = {
        "shard": f"{args.shard_index}/{args.shard_total}",
        "planned_total": len(plan),
        "already_completed": len(plan) - len(todo),
        "pending_count": len(todo),
        "runs": [
            {"scenario": spec.scenario, "repeat": spec.repeat_index}
            for spec in todo
        ],
    }
    if args.dry_run:
        summary["status"] = "DRY_RUN"
        return summary

    if not args.skip_preflight:
        report = run_preflight(
            db_path=args.db_path,
            vps_id=args.vps_id,
            app_id=args.app_id,
            ml_url=args.ml_url,
            ssh_key_file=args.ssh_key_file,
        )
        write_report(report, args.preflight_report)
        if not _preflight_allows_batch(report):
            summary["status"] = "BLOCKED_PREFLIGHT"
            summary["preflight"] = report
            return summary

    executed: list[dict[str, Any]] = []
    for spec in todo:
        logger.info(
            "Starting run scenario=%s repeat=%d (vps_id=%d)",
            spec.scenario,
            spec.repeat_index,
            args.vps_id,
        )
        result = run_experiment(
            scenario=spec.scenario,
            repeat_index=spec.repeat_index,
            vps_id=args.vps_id,
            db_path=args.db_path,
            app_name=args.app_name,
            source_path=args.source_path,
            app_url=args.app_url,
            ml_url=args.ml_url,
            max_attempts=args.max_attempts,
            allow_pilot_4500=args.allow_pilot_4500,
            ssh_key_file=args.ssh_key_file,
        )
        executed.append(
            {
                "scenario": spec.scenario,
                "repeat": spec.repeat_index,
                "status": result.status,
                "run_id": result.run_id,
                "attempt": result.attempt_index,
                "abort_reason": result.abort_reason,
            }
        )
        if result.status != "completed" and args.stop_on_failure:
            summary["status"] = "STOPPED_ON_FAILURE"
            summary["executed"] = executed
            return summary

    summary["executed"] = executed
    failed = [item for item in executed if item["status"] != "completed"]
    summary["status"] = "PARTIAL_OR_FAILED" if failed else "COMPLETED"

    if args.results_root and Path(args.results_root).exists():
        buf = io.StringIO()
        try:
            analyze_cli_main([str(args.results_root)], stdout=buf)
            summary["analysis_markdown"] = buf.getvalue()
        except SystemExit:
            pass
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Sharded batch runner for OpsPilot 50 formal ML runs"
    )
    parser.add_argument("--db-path", required=True, help="Path to SQLite database")
    parser.add_argument("--vps-id", type=int, default=1, help="Target VPS id in SQLite")
    parser.add_argument("--app-id", type=int, default=None, help="Optional app id for preflight")
    parser.add_argument("--app-name", default="express-api", help="Demo app name")
    parser.add_argument(
        "--source-path", default="demo-apps/express-api", help="Path to demo app source"
    )
    parser.add_argument("--app-url", required=True, help="Target demo app HTTP URL")
    parser.add_argument("--ml-url", default="http://127.0.0.1:8765", help="ML service URL")
    parser.add_argument("--ssh-key-file", default=None, help="Path to temporary SSH key file")
    parser.add_argument("--repeats", type=int, default=PROTOCOL_REPEATS, help="Repeats per scenario")
    parser.add_argument(
        "--scenarios",
        nargs="+",
        choices=list(PROTOCOL_SCENARIOS),
        default=None,
        help="Optional subset of scenarios",
    )
    parser.add_argument("--shard-index", type=int, default=1, help="1-based shard index")
    parser.add_argument("--shard-total", type=int, default=1, help="Total parallel shards")
    parser.add_argument("--max-attempts", type=int, default=3, help="Max attempts per run (1..3)")
    parser.add_argument(
        "--allow-pilot-4500",
        action="store_true",
        help="Confirm full 4500s (75 min) run duration per run",
    )
    parser.add_argument("--skip-preflight", action="store_true", help="Skip initial preflight")
    parser.add_argument("--stop-on-failure", action="store_true", help="Halt batch on failed run")
    parser.add_argument("--dry-run", action="store_true", help="Print sharded run plan only")
    parser.add_argument(
        "--preflight-report",
        default="experiments/results/batch-preflight.json",
        help="Output path for preflight JSON",
    )
    parser.add_argument(
        "--results-root",
        default="experiments/results",
        help="Results root for optional end-of-batch analyze summary",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    summary = execute_batch(args)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["status"] in {"DRY_RUN", "COMPLETED"} else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
