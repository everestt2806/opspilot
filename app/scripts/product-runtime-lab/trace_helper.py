"""Observe real target exceptions without replacing commands or recording payloads."""

from __future__ import annotations

import json
import os
import traceback
from functools import wraps
from pathlib import Path

import target_guarded_ssh_helper as helper
import target_product_runtime as runtime


def observe(label, function):
    @wraps(function)
    def call(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except Exception as error:
            record = {
                "site": label,
                "type": type(error).__name__,
                "frames": [
                    {"file": Path(frame.filename).name, "line": frame.lineno}
                    for frame in traceback.extract_tb(error.__traceback__)
                ],
            }
            if label == "_step_prepare" and args[0].previous_collector is not None:
                before = args[0].previous_collector
                after = args[0].commands.inspect("container", before["Id"])
                record["collector_running"] = after.get("State", {}).get("Running")
                record["changed_fields"] = [
                    part + "." + key
                    for part in ("Config", "HostConfig")
                    for key in set(before.get(part, {})) | set(after.get(part, {}))
                    if before.get(part, {}).get(key) != after.get(part, {}).get(key)
                ]
                record["mount_order_changed"] = [
                    mount.get("Destination") for mount in before.get("Mounts", [])
                ] != [mount.get("Destination") for mount in after.get("Mounts", [])]
            path = Path(__file__).parent / "trace.jsonl"
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, "a", encoding="utf-8") as stream:
                stream.write(json.dumps(record) + "\n")
            raise

    return call


for name in [
    "configure",
    "start_step",
    "poll",
    "_step_prepare",
    "_step_activate",
    "_step_health",
    "_step_rollback",
    "seal",
]:
    setattr(
        runtime.ProductRuntime,
        name,
        observe(name, getattr(runtime.ProductRuntime, name)),
    )
runtime.DockerCommands.run = observe("docker", runtime.DockerCommands.run)
runtime._config_hash = observe("config_hash", runtime._config_hash)

if __name__ == "__main__":
    raise SystemExit(helper.main())
