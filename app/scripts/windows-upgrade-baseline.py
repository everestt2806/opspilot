"""Dựng source Git tiền nhiệm trong thư mục riêng, không sửa checkout hiện tại."""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    if sys.platform != "win32" or sys.argv[1:] != ["--build"]:
        print(
            json.dumps(
                {
                    "status": "REJECTED",
                    "error": "EXPLICIT_WINDOWS_BASELINE_BUILD_REQUIRED",
                }
            )
        )
        return 2
    parent = ROOT / "app/.out-scripts/windows-upgrade-baseline"
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="build-", dir=parent)).resolve()
    policy = json.loads(
        (ROOT / "app/resources/legacy-ml-policy.json").read_text(encoding="utf-8")
    )
    commit = policy["source_commit"]
    archive = subprocess.check_output(
        [
            "git",
            "archive",
            "--format=zip",
            commit,
            "app",
            "docs/contracts",
            "ml-service",
            "templates",
            "collector",
        ],
        cwd=ROOT,
    )
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        for item in source.infolist():
            target = (directory / item.filename).resolve()
            assert target.is_relative_to(directory)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read(item))
    # Dùng dependency đã duyệt, không cài mới hoặc coi đây là máy Windows sạch.
    shell = (
        Path(os.environ["SystemRoot"])
        / "System32/WindowsPowerShell/v1.0/powershell.exe"
    )
    modules = directory / "app/node_modules"
    command = f"New-Item -ItemType Junction -Path '{modules}' -Target '{ROOT / 'app/node_modules'}' | Out-Null"
    subprocess.run([str(shell), "-NoProfile", "-Command", command], check=True)
    shutil.copytree(
        ROOT / "app/resources/controller-releases",
        directory / "app/resources/controller-releases",
    )
    # Giữ đúng venv redirector/base prefix cũ; không sửa Main/config để giả portable.
    legacy = directory / "ml-service/.venv"
    (legacy / "Scripts").mkdir(parents=True)
    for name in ["Scripts/python.exe", "pyvenv.cfg"]:
        shutil.copyfile(ROOT / "ml-service/.venv" / name, legacy / name)
    shutil.copytree(
        ROOT / "app/resources/ml-runtime/Lib/site-packages",
        legacy / "Lib/site-packages",
    )
    environment = os.environ.copy()
    node = ROOT / ".tools/node22/node.exe"
    # Caller đã nạp Node22 bằng enter-node22.ps1.
    node = Path(shutil.which("node.exe") or node)
    assert subprocess.check_output([str(node), "--version"]).decode().startswith("v22.")
    tool = ROOT / "app/node_modules/electron-vite/bin/electron-vite.js"
    subprocess.run(
        [str(node), str(tool), "build"],
        cwd=directory / "app",
        env=environment,
        check=True,
    )
    cli = ROOT / "app/node_modules/electron-builder/cli.js"
    subprocess.run(
        [
            str(node),
            str(cli),
            "--dir",
            "--win",
            "--x64",
            "--publish",
            "never",
            "--config.directories.output=" + str(directory / "package"),
        ],
        cwd=directory / "app",
        env=environment,
        check=True,
    )
    result = {
        "status": "PASS",
        "source_commit": commit,
        "version": "0.1.0",
        "record": directory.name,
        "artifact": str(directory / "package/win-unpacked"),
        "same_approved_dependencies": True,
        "venv_base_prefix_still_required": True,
    }
    (directory / "result.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
