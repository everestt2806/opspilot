from __future__ import annotations

import sqlite3
from pathlib import Path
from types import SimpleNamespace

from experiments.run_batch import (
    PROTOCOL_SCENARIOS,
    RunSpec,
    build_batch_plan,
    completed_runs_from_db,
    execute_batch,
    pending_runs,
)


def test_build_batch_plan_shards_all_50_runs_cleanly_without_overlap() -> None:
    shard1 = build_batch_plan(shard_index=1, shard_total=2)
    shard2 = build_batch_plan(shard_index=2, shard_total=2)

    assert len(shard1) == 25
    assert len(shard2) == 25
    pairs1 = {(s.scenario, s.repeat_index) for s in shard1}
    pairs2 = {(s.scenario, s.repeat_index) for s in shard2}
    assert pairs1.isdisjoint(pairs2)
    assert len(pairs1 | pairs2) == 50
    for scenario in PROTOCOL_SCENARIOS:
        assert sum(1 for s in shard1 + shard2 if s.scenario == scenario) == 10


def test_pending_runs_skips_only_completed_runs_from_sqlite(tmp_path: Path) -> None:
    db_path = tmp_path / "opspilot.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE experiment_run (
            id INTEGER PRIMARY KEY,
            scenario TEXT NOT NULL,
            repeat_index INTEGER NOT NULL,
            status TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "INSERT INTO experiment_run (scenario, repeat_index, status) VALUES ('memory_leak', 1, 'completed')"
    )
    conn.execute(
        "INSERT INTO experiment_run (scenario, repeat_index, status) VALUES ('cpu_spike', 1, 'aborted')"
    )
    conn.commit()
    conn.close()

    completed = completed_runs_from_db(db_path)
    assert completed == {("memory_leak", 1)}

    plan = [
        RunSpec("memory_leak", 1),
        RunSpec("cpu_spike", 1),
        RunSpec("error_burst", 1),
    ]
    assert pending_runs(plan, completed) == [
        RunSpec("cpu_spike", 1),
        RunSpec("error_burst", 1),
    ]


def test_execute_batch_dry_run_never_touches_preflight_or_ssh(tmp_path: Path) -> None:
    args = SimpleNamespace(
        db_path=str(tmp_path / "missing.db"),
        vps_id=1,
        app_id=None,
        app_name="express-api",
        source_path="demo-apps/express-api",
        app_url="http://127.0.0.1:30000",
        ml_url="http://127.0.0.1:8765",
        ssh_key_file=None,
        repeats=2,
        scenarios=None,
        shard_index=1,
        shard_total=2,
        max_attempts=3,
        allow_pilot_4500=True,
        skip_preflight=False,
        stop_on_failure=True,
        dry_run=True,
        preflight_report=str(tmp_path / "preflight.json"),
        results_root=None,
    )
    result = execute_batch(args)
    assert result["status"] == "DRY_RUN"
    assert result["planned_total"] == 5
    assert result["pending_count"] == 5
