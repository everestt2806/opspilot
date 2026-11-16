"""Explicit private fixture provisioning/cleanup, never used by product reads."""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path


def fixed(args):
    result = subprocess.run(args, capture_output=True, timeout=60, check=False)
    if result.returncode:
        raise AssertionError("PRIVATE_FIXTURE_COMMAND_FAILED")
    return result.stdout.decode().strip()


def main():
    assert sys.platform == "linux" and os.geteuid() == 0
    assert sys.argv[1:] in [["setup"], ["snapshot"], ["cleanup"]]
    packet = json.loads(sys.stdin.buffer.read(32769))
    assert re.fullmatch(r"[a-f0-9]{12}", packet["nonce"])
    root = Path(packet["root"])
    assert root.is_absolute() and root.resolve() == root
    assert root.parent.parent.name.startswith("opspilot-pg-selection-")
    assert str(root).startswith("/tmp/opspilot-pg-selection-")
    helpers = root / "helpers"
    for name, pin in [
        (
            "target_execution_guard",
            "3cadd020a5cfc5a784bd4c62fc7b887ea62b0094a921fc30a8177622090b222f",
        ),
        (
            "target_product_runtime",
            "95cc98a0fe3692193e66f034ac8bdb8a0e7541e9ee4c5c75b472e18ed37fc343",
        ),
    ]:
        path = helpers / (name + ".py")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == pin
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    runtime = module
    actor = runtime.ManagedPostgres(
        root / "state",
        base64.b64decode(packet["key"], validate=True),
        packet["identity"],
        packet["credentials"],
        runtime.DockerCommands(),
        lambda: None,
    )
    network = "opspilot-pg-bridge-" + packet["nonce"]
    if sys.argv[1] == "cleanup":
        for kind, name in [("container", actor.name), ("volume", actor.volume)]:
            found = subprocess.run(
                ["docker", kind, "inspect", name],
                capture_output=True,
                timeout=10,
                check=False,
            )
            if found.returncode:
                continue
            item = json.loads(found.stdout)[0]
            labels = (
                item["Config"].get("Labels")
                if kind == "container"
                else item.get("Labels")
            )
            assert {
                k: v for k, v in (labels or {}).items() if k.startswith("opspilot.")
            } == actor.labels
            if kind == "container":
                assert item["Name"] == "/" + actor.name
                assert any(m.get("Name") == actor.volume for m in item["Mounts"])
                fixed(["docker", "rm", "-f", item["Id"]])
            else:
                assert item["Name"] == actor.volume
                fixed(["docker", "volume", "rm", actor.volume])
        found = subprocess.run(
            ["docker", "network", "inspect", network],
            capture_output=True,
            timeout=10,
            check=False,
        )
        if found.returncode == 0:
            item = json.loads(found.stdout)[0]
            assert item["Name"] == network and not item["Containers"]
            assert item["Labels"].get("opspilot.inspection_lab") == packet["nonce"]
            fixed(["docker", "network", "rm", network])
        print(json.dumps({"private_cleanup": True}))
        return
    if sys.argv[1] == "setup":
        assert fixed(["docker", "info", "--format", "{{.OSType}}"]) == "linux"
        fixed(
            [
                "docker",
                "network",
                "create",
                "--label",
                "opspilot.inspection_lab=" + packet["nonce"],
                "--label",
                "opspilot.controller_id=" + packet["identity"]["controller_id"],
                "--label",
                "opspilot.app_id=" + str(packet["identity"]["app_id"]),
                "--label",
                "opspilot.ownership_generation="
                + str(packet["identity"]["ownership_generation"]),
                network,
            ]
        )
        actor.ensure(network)
        actor._psql(
            False,
            "CREATE TABLE sample(id int PRIMARY KEY,marker text); INSERT INTO sample VALUES(1,'controller-bridge')",
            capture=False,
        )
    print(
        json.dumps(
            {
                "instance": actor.inspect_ready(),
                "rows": actor._psql(
                    False, "SELECT id::text||':'||marker FROM sample ORDER BY id"
                ),
                "journal": hashlib.sha256(
                    (actor.directory / "resource.json").read_bytes()
                ).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 -- fixture credentials/SQL/stderr never escape terminal boundary.
        print(
            json.dumps(
                {
                    "fixture_failure_lines": [
                        frame.lineno
                        for frame in traceback.extract_tb(sys.exc_info()[2])
                    ]
                }
            ),
            file=sys.stderr,
        )
        raise SystemExit("PRIVATE_POSTGRES_INSPECTION_FIXTURE_FAILED") from None
