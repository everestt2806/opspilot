"""Lab Windows bảo toàn state trước uninstall; bytes tổng hợp không bị unpickle."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "app/scripts/legacy-ml-upgrade.ps1"
POLICY = ROOT / "app/resources/legacy-ml-policy.json"


def main() -> int:
    if sys.platform != "win32" or sys.argv[1:] != ["--run"]:
        print(
            json.dumps({"status": "REJECTED", "error": "EXPLICIT_WINDOWS_LAB_REQUIRED"})
        )
        return 2
    parent = ROOT / "app/.out-scripts/legacy-ml-upgrade-lab"
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="case-", dir=parent)).resolve()
    (directory / ".owner").write_text(directory.name, encoding="utf-8")
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    shell = (
        Path(os.environ["SystemRoot"])
        / "System32/WindowsPowerShell/v1.0/powershell.exe"
    )
    checks = []

    def fixture(case_name):
        base = directory / case_name
        install = base / "Bản cài cũ"
        profile = base / "Dữ liệu người dùng"
        service = install / "resources/ml-service"
        service.mkdir(parents=True)
        for name, expected in policy["source_sha256"].items():
            data = subprocess.check_output(
                ["git", "show", f"{policy['source_commit']}:ml-service/{name}"],
                cwd=ROOT,
            )
            assert hashlib.sha256(data).hexdigest() == expected
            path = service / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        for package, version in policy["packages"].items():
            path = (
                service
                / f".venv/Lib/site-packages/{package}-{version}.dist-info/METADATA"
            )
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"Name: {package}\nVersion: {version}\n", encoding="utf-8")
        state = service / "state/900003"
        state.mkdir(parents=True)
        (state / "state.pkl").write_bytes(b"SYNTHETIC_OPAQUE_BYTES_NEVER_DESERIALIZED")
        (state / "meta.json").write_text(
            json.dumps(
                {
                    "feature_version": policy["feature_version"],
                    "train_sample_count": 180,
                }
            ),
            encoding="utf-8",
        )
        return install, profile, service, state

    def run(install, profile, expected, code=0):
        result = subprocess.run(
            [
                str(shell),
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(SCRIPT),
                "-InstallationDirectory",
                str(install),
                "-UserDataDirectory",
                str(profile),
                "-ExecutableName",
                "OpsPilot.exe",
                "-PolicyFile",
                str(POLICY),
            ],
            cwd=directory,
            capture_output=True,
            timeout=45,
            check=False,
        )
        assert result.returncode == code, (
            result.returncode,
            result.stdout[-500:].decode(errors="replace"),
        )
        payload = json.loads(result.stdout.decode("utf-8-sig").strip())
        assert payload.get("outcome", payload.get("error")) == expected, payload
        assert not result.stderr, "RAW_STDERR_UNEXPECTED"
        checks.append(expected)

    install, profile, service, state = fixture("positive")
    original = {p.name: p.read_bytes() for p in state.iterdir()}
    run(install, profile, "PRESERVED")
    assert {
        p.name: p.read_bytes() for p in (profile / "ml-state/900003").iterdir()
    } == original
    assert {p.name: p.read_bytes() for p in state.iterdir()} == original
    run(install, profile, "ALREADY_PRESERVED")
    (profile / "ml-state/900003/state.pkl").write_bytes(b"OTHER_CURRENT_MODEL")
    run(install, profile, "UPGRADE_MODEL_CONFLICT_KEEP_OLD_INSTALLATION", 2)
    assert (
        profile / "ml-state/900003/state.pkl"
    ).read_bytes() == b"OTHER_CURRENT_MODEL"
    for name, edit, expected in [
        (
            "source",
            lambda s, t: (s / "main.py").write_text("CHANGED", encoding="utf-8"),
            "UPGRADE_LEGACY_SOURCE_UNVERIFIED",
        ),
        (
            "partial",
            lambda s, t: (t / "meta.json").unlink(),
            "UPGRADE_INCOMPLETE_STATE",
        ),
        (
            "metadata",
            lambda s, t: (t / "meta.json").write_text("{}", encoding="utf-8"),
            "UPGRADE_MODEL_METADATA_REJECTED",
        ),
        (
            "extra",
            lambda s, t: (t / "partial.tmp").write_text("INCOMPLETE", encoding="utf-8"),
            "UPGRADE_INCOMPLETE_STATE",
        ),
        (
            "library",
            lambda s, t: next(
                s.glob(".venv/Lib/site-packages/numpy-*/METADATA")
            ).write_text("Version: 0.0.0\n", encoding="utf-8"),
            "UPGRADE_LEGACY_LIBRARY_UNVERIFIED",
        ),
    ]:
        install, profile, service, state = fixture(name)
        edit(service, state)
        run(install, profile, expected, 2)
        assert not profile.exists()
    install, profile, service, state = fixture("missing")
    shutil.rmtree(state.parent)
    run(install, profile, "NO_LEGACY_STATE")
    state.parent.mkdir()
    run(install, profile, "EMPTY_LEGACY_STATE")
    install, profile, service, state = fixture("junction")
    outside = directory / "outside-preserved"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("PRESERVE", encoding="utf-8")
    shellcode = f"New-Item -ItemType Junction -Path '{str(profile).replace(chr(39), chr(39) * 2)}' -Target '{str(outside).replace(chr(39), chr(39) * 2)}' | Out-Null"
    subprocess.run(
        [str(shell), "-NoProfile", "-Command", shellcode],
        check=True,
        capture_output=True,
    )
    run(install, profile, "UPGRADE_LINK_REJECTED", 2)
    assert sentinel.read_text(encoding="utf-8") == "PRESERVE"
    os.rmdir(profile)
    install, profile, service, state = fixture("oversize")
    with (state / "state.pkl").open("wb") as stream:
        stream.seek(134217728)
        stream.write(b"X")
    run(install, profile, "UPGRADE_FILE_LIMIT", 2)
    assert not profile.exists()
    run(install, install / "nested-profile", "UPGRADE_SEPARATE_PROFILE_REQUIRED", 2)
    install, profile, service, state = fixture("running")
    executable = install / "OpsPilot.exe"
    shutil.copyfile(Path(os.environ["SystemRoot"]) / "System32/cmd.exe", executable)
    sleeper = subprocess.Popen(
        [
            str(executable),
            "/c",
            str(shell),
            "-NoProfile",
            "-Command",
            "Start-Sleep -Seconds 60",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        run(install, profile, "UPGRADE_CLOSE_OLD_APP_FIRST", 2)
        assert not profile.exists()
    finally:
        subprocess.run(
            [
                str(Path(os.environ["SystemRoot"]) / "System32/taskkill.exe"),
                "/PID",
                str(sleeper.pid),
                "/T",
                "/F",
            ],
            check=False,
            capture_output=True,
        )
        sleeper.wait(timeout=10)
    assert directory.parent == parent.resolve()
    assert (directory / ".owner").read_text(encoding="utf-8") == directory.name
    for child in directory.iterdir():
        if child.is_dir():
            assert child.resolve().parent == directory and not child.is_symlink()
            shutil.rmtree(child)
    result = {
        "status": "PASS",
        "checks": checks,
        "record": directory.name,
        "synthetic_bytes_only": True,
        "production_database_used": False,
        "private_fixture_removed": True,
    }
    (directory / "result.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
