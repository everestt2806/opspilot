"""Explicit Windows development gate; password goes only through hidden stdin."""

import getpass
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[3]
    if sys.argv[1:] == ["--upgrade"]:
        payload = {
            "host": "167.71.202.116",
            "port": 22,
            "username": "root",
            "host_fingerprint": "SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E",
            "password": getpass.getpass("Development VPS credential (hidden): "),
        }
        command = [
            "node",
            str(root / "app/scripts/controller-upgrade-live.mjs"),
            "--confirm-development-controller-upgrade",
        ]
        data = json.dumps(payload).encode()
        payload["password"] = ""
    elif (
        len(sys.argv) == 3
        and sys.argv[1] in ("--inspect", "--recover")
        and re.fullmatch(r"[a-f0-9]{16}", sys.argv[2])
    ):
        command = [
            "node",
            str(root / "app/scripts/controller-upgrade-live-recover.mjs"),
            sys.argv[2],
            sys.argv[1],
        ]
        data = b""
    else:
        raise RuntimeError("EXPLICIT_DEVELOPMENT_GATE_REQUIRED")
    environment = os.environ.copy()
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    return subprocess.run(
        command, input=data, cwd=root, env=environment, check=False
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
