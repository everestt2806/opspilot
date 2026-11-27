"""Crash the real lab helper only after a selected durable write; never forge replies."""

from __future__ import annotations

import json
import os
from pathlib import Path

import target_guarded_ssh_helper as helper
import target_product_runtime as runtime

ROOT = Path(__file__).parent
SPEC = json.loads((ROOT / "recovery-fault.json").read_text())
original_write = runtime._write_private
original_marker = runtime._write_marker_atomic


def crash_once():
    marker = ROOT / "recovery-fault-fired"
    try:
        descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    os.close(descriptor)
    os._exit(86)


def write(path, value):
    original_write(path, value)
    expected = (
        f"deployment-{SPEC['deployment_id']}.json"
        if SPEC["scenario"] == "after-seal"
        else f"settled-{SPEC['deployment_id']}.json"
    )
    if SPEC["scenario"] in {"after-seal", "after-ack"} and path.name == expected:
        crash_once()


def marker(path, value):
    original_marker(path, value)
    if (
        SPEC["scenario"] == "after-idle"
        and value.get("execution_state") == "idle"
        and value.get("last_attempt_id") == SPEC["attempt_id"]
    ):
        crash_once()


runtime._write_private = write
runtime._write_marker_atomic = marker

if __name__ == "__main__":
    raise SystemExit(helper.main())
