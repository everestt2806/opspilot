#!/usr/bin/env python3
"""Exercise predecessor 0.1.0 hidden resources and locked file upgrade safety in a private namespace."""
from pathlib import Path
import ctypes
from ctypes import wintypes
import hashlib
import json
import subprocess
import time
import winreg
import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description="Test legacy 0.1.0 hidden and locked file behavior during upgrade")
    parser.add_argument("--fixture", required=True, help="Path to upgrade lab fixture directory containing plan.json")
    parser.add_argument("--mode", default="resources", choices=["resources", "executable"], help="Target root to hide and lock")
    parser.add_argument("--out-dir", default=None, help="Output directory for test execution and results")
    args = parser.parse_args()

    fixture_dir = Path(args.fixture).resolve()
    assert fixture_dir.exists(), f"Fixture directory {fixture_dir} does not exist"
    assert (fixture_dir / ".owner").exists(), f"Missing .owner in {fixture_dir}"
    assert (fixture_dir / "plan.json").exists(), f"Missing plan.json in {fixture_dir}"

    plan = json.loads((fixture_dir / "plan.json").read_text(encoding="utf-8"))
    guid = plan["guid"]
    assert len(guid) == 36 and all(c in "0123456789abcdef-" for c in guid)

    def get_registry_keys():
        res = []
        for k in [rf"Software\{guid}", rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{guid}"]:
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, k):
                    res.append(k)
            except FileNotFoundError:
                pass
        return res

    assert not get_registry_keys(), f"LEGACY_FIXTURE_NAMESPACE_ALREADY_IN_USE: {guid}"

    out_base = Path(args.out_dir).resolve() if args.out_dir else (fixture_dir / f"legacy-hidden-{args.mode}-busy")
    out_base.mkdir(parents=True, exist_ok=True)
    (out_base / ".owner").write_text(f"legacy-hidden-{args.mode}-busy", encoding="utf-8")

    install = out_base / "install/OpsPilot"
    assert install.resolve().is_relative_to(out_base.resolve())
    if install.exists():
        import shutil
        shutil.rmtree(install, ignore_errors=True)

    def run_setup(file_path, label, timeout=300):
        start = time.monotonic()
        p = subprocess.Popen([str(file_path), "/S", f"/D={install}"], cwd=out_base,
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             creationflags=subprocess.CREATE_NO_WINDOW)
        timed_out = False
        try:
            stdout, stderr = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            if p.poll() is None:
                subprocess.run(["taskkill.exe", "/PID", str(p.pid), "/T", "/F"], capture_output=True,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            stdout, stderr = p.communicate(timeout=30)
        (out_base / f"{label}.stdout.log").write_bytes(stdout)
        (out_base / f"{label}.stderr.log").write_bytes(stderr)
        return {
            "exit_code": p.returncode,
            "timed_out": timed_out,
            "duration_seconds": round(time.monotonic() - start, 2)
        }

    r = {
        "source_commit": plan.get("source_commit"),
        "versions": ["0.1.0", "0.2.0"],
        "mode": args.mode,
        "case": f"legacy-hidden-{args.mode}-native-lock"
    }

    # Step 1: Install 0.1.0 predecessor
    old_installer = Path(plan["payloads"][0]["installer"])
    print(f"[*] Step 1: Installing predecessor 0.1.0 into {install}...")
    r["old_install"] = run_setup(old_installer, "old-install")
    assert r["old_install"]["exit_code"] == 0 and not r["old_install"]["timed_out"], "Old install failed"

    exe = install / plan["executable_name"]
    assert exe.is_file(), "Executable missing after old install"
    exe_hash = hashlib.file_digest(exe.open("rb"), "sha256").hexdigest()
    assert exe_hash == plan["payloads"][0]["exe"], "Executable hash mismatch"

    inventory = {
        p.relative_to(install).as_posix(): (p.stat().st_size, hashlib.file_digest(p.open("rb"), "sha256").hexdigest())
        for p in install.rglob("*") if p.is_file()
    }
    uninstallers = list(install.glob("Uninstall *.exe"))
    assert len(uninstallers) == 1, "Expected 1 uninstaller"
    control_uninstaller = out_base / "control-uninstaller.exe"
    control_uninstaller.write_bytes(uninstallers[0].read_bytes())
    print(f"[+] 0.1.0 installed successfully: {len(inventory)} files")

    # Step 2: Set hidden attribute & acquire lock
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetFileAttributesW.argtypes = [wintypes.LPCWSTR]
    kernel.GetFileAttributesW.restype = wintypes.DWORD
    kernel.SetFileAttributesW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD]
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]

    hidden_root = install / "resources" if args.mode == "resources" else exe
    locked_file = install / "resources/app.asar" if args.mode == "resources" else exe
    attributes = kernel.GetFileAttributesW(str(hidden_root))
    assert attributes != 0xFFFFFFFF
    assert kernel.SetFileAttributesW(str(hidden_root), attributes | 2), "Failed to set hidden attribute"
    print(f"[*] Set Hidden attribute on: {hidden_root}")

    handle = kernel.CreateFileW(str(locked_file), 0x80000000, 1, None, 3, 128, None)
    assert handle not in [None, ctypes.c_void_p(-1).value], f"CreateFileW lock failed: {ctypes.get_last_error()}"
    print(f"[*] Acquired native read lock on: {locked_file}")

    # Step 3: Run new installer (0.2.0)
    new_installer = Path(plan["payloads"][1]["installer"])
    try:
        print(f"[*] Running 0.2.0 installer with lock active...")
        r["new_install"] = run_setup(new_installer, "new-install", timeout=240)
        print(f"[+] New installer exit code: {r['new_install']['exit_code']} (duration: {r['new_install']['duration_seconds']}s)")

        missing, changed = [], []
        for relative, (size, digest) in inventory.items():
            p = install / relative
            if not p.is_file():
                missing.append(relative)
            elif p.stat().st_size != size or hashlib.file_digest(p.open("rb"), "sha256").hexdigest() != digest:
                changed.append(relative)

        r["initial_files"] = len(inventory)
        r["missing_files"] = len(missing)
        r["changed_files"] = len(changed)
        r["missing_sample"] = missing[:10]
        r["old_executable_preserved"] = exe.is_file() and hashlib.file_digest(exe.open("rb"), "sha256").hexdigest() == plan["payloads"][0]["exe"]
        asar = install / "resources/app.asar"
        digest = hashlib.file_digest(asar.open("rb"), "sha256").hexdigest() if asar.is_file() else None
        r["old_asar_preserved"] = (digest == plan["payloads"][0]["asar"])
        r["new_asar_matches_target"] = (digest == plan["payloads"][1]["asar"])
        r["registry_count_after"] = len(get_registry_keys())
        r["backup_exists"] = install.with_name(install.name + "_b").exists()
        
        # Test assertion:
        # Installer MUST fail (exit != 0), old payload and registry MUST be preserved 100%
        r["pass"] = (
            r["new_install"]["exit_code"] != 0 and
            not r["new_install"]["timed_out"] and
            len(missing) == 0 and
            len(changed) == 0 and
            r["registry_count_after"] == 2
        )
    finally:
        kernel.CloseHandle(handle)
        print("[*] Released native lock handle")
        if hidden_root.exists():
            kernel.SetFileAttributesW(str(hidden_root), attributes)

    (out_base / "result.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
    print(f"\nResult: {'PASS' if r['pass'] else 'FAIL'}")
    print(f"  Installer exit code: {r['new_install']['exit_code']} (expected != 0)")
    print(f"  Missing files: {len(missing)}")
    print(f"  Changed files: {len(changed)}")
    print(f"  Old ASAR preserved: {r['old_asar_preserved']}")
    print(f"  Registry count after: {r['registry_count_after']} (expected 2)")
    print(f"  Backup directory exists: {r['backup_exists']}")

    # Clean up fixture
    print(f"[*] Cleaning up installation fixture...")
    argv = subprocess.list2cmdline([str(control_uninstaller), "/S"]) + f" _?={install}"
    p_clean = subprocess.run(argv, cwd=out_base, capture_output=True, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
    (out_base / "cleanup.stdout.log").write_bytes(p_clean.stdout)
    (out_base / "cleanup.stderr.log").write_bytes(p_clean.stderr)
    r["cleanup"] = {
        "uninstaller_exit_code": p_clean.returncode,
        "registry_count": len(get_registry_keys()),
        "fixture_retained_for_diagnostics": install.exists()
    }
    (out_base / "result.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
    print(f"[+] Cleanup exit code: {p_clean.returncode}, remaining registry: {r['cleanup']['registry_count']}")

    if not r["pass"]:
        sys.exit(1)
    print(f"\n[+] LEGACY LOCKED HIDDEN PROBE ({args.mode}) PASSED SUCCESSFULLY.")

if __name__ == "__main__":
    main()
