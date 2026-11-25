#!/usr/bin/env python3
"""Exercise predecessor 0.1.0 hidden resources and locked file upgrade safety in a private namespace."""
import sys
import os
from pathlib import Path
import ctypes
from ctypes import wintypes
import hashlib
import json
import subprocess
import time
import threading
import winreg
import argparse

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def run_guard_tests(fixture_path):
    print("[*] Running Negative Guard Tests for windows-legacy-locked-probe...")
    import tempfile
    
    # Negative Test 1: Foreign owner in output directory
    with tempfile.TemporaryDirectory() as td:
        fake_out = Path(td) / "foreign_out"
        fake_out.mkdir()
        (fake_out / ".owner").write_text("foreign-agent-owner", encoding="utf-8")
        sentinel = fake_out / "sentinel.txt"
        sentinel.write_text("FOREIGN_DATA_PRESERVED\n", encoding="utf-8")
        
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--fixture", str(fixture_path), "--out-dir", str(fake_out)],
            capture_output=True, text=True, encoding="utf-8"
        )
        assert proc.returncode != 0, "Probe must reject foreign output directory"
        assert sentinel.read_text(encoding="utf-8") == "FOREIGN_DATA_PRESERVED\n", "Sentinel file must not be modified"
        assert (fake_out / ".owner").read_text(encoding="utf-8") == "foreign-agent-owner", "Owner must not be overwritten"
        print("  ✓ Guard 1: Foreign output owner rejected, sentinel preserved")

    # Negative Test 2: Invalid fixture with missing .owner
    with tempfile.TemporaryDirectory() as td:
        fake_fix = Path(td) / "fake_fixture"
        fake_fix.mkdir()
        (fake_fix / "plan.json").write_text("{}", encoding="utf-8")
        
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--fixture", str(fake_fix)],
            capture_output=True, text=True, encoding="utf-8"
        )
        assert proc.returncode != 0, "Probe must reject fixture with missing .owner"
        print("  ✓ Guard 2: Missing fixture .owner rejected")

    # Negative Test 3: Fixture with missing installer file
    with tempfile.TemporaryDirectory() as td:
        fake_fix = Path(td) / "fake_fixture"
        fake_fix.mkdir()
        (fake_fix / ".owner").write_text(fake_fix.name, encoding="utf-8")
        bad_plan = {
            "guid": "11111111-2222-3333-4444-555555555555",
            "payloads": [{"installer": str(fake_fix / "nonexistent-setup.exe"), "installer_sha256": "0" * 64}]
        }
        (fake_fix / "plan.json").write_text(json.dumps(bad_plan), encoding="utf-8")
        
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--fixture", str(fake_fix)],
            capture_output=True, text=True, encoding="utf-8"
        )
        assert proc.returncode != 0, "Probe must reject fixture with nonexistent installer"
        print("  ✓ Guard 3: Nonexistent installer rejected before execution")

    print("[+] All negative guard tests PASSED successfully.")

def main():
    parser = argparse.ArgumentParser(description="Test legacy 0.1.0 hidden and locked file behavior during upgrade")
    parser.add_argument("--fixture", required=True, help="Path to upgrade lab fixture directory containing plan.json")
    parser.add_argument("--mode", default="resources", choices=["resources", "executable", "cleanup-fault", "pending-fresh-install"], help="Target mode to exercise")
    parser.add_argument("--out-dir", default=None, help="Output directory for test execution and results")
    parser.add_argument("--test-guards", action="store_true", help="Run negative self-tests on probe guards")
    args = parser.parse_args()

    fixture_dir = Path(args.fixture).resolve()
    if args.test_guards:
        run_guard_tests(fixture_dir)
        return

    # 1. Validate Fixture Path & Scope
    assert fixture_dir.exists(), f"Fixture directory {fixture_dir} does not exist"
    assert not fixture_dir.is_symlink(), f"Fixture directory {fixture_dir} must not be a symlink"
    
    owner_file = fixture_dir / ".owner"
    assert owner_file.exists(), f"Missing .owner in {fixture_dir}"
    fixture_owner = owner_file.read_text(encoding="utf-8").strip()
    assert fixture_owner == fixture_dir.name, f"Fixture owner mismatch: {fixture_owner} != {fixture_dir.name}"

    plan_file = fixture_dir / "plan.json"
    assert plan_file.exists(), f"Missing plan.json in {fixture_dir}"
    plan = json.loads(plan_file.read_text(encoding="utf-8"))

    # 2. Validate GUID & Payloads Provenance
    guid = plan.get("guid")
    assert guid and len(guid) == 36 and all(c in "0123456789abcdef-" for c in guid), f"Invalid GUID: {guid}"
    
    payloads = plan.get("payloads", [])
    assert len(payloads) >= 2, f"Plan must contain at least 2 payloads, found {len(payloads)}"
    for idx, payload in enumerate(payloads):
        p_inst = Path(payload["installer"]).resolve()
        assert p_inst.is_file(), f"Payload [{idx}] installer does not exist: {p_inst}"
        actual_hash = hashlib.file_digest(p_inst.open("rb"), "sha256").hexdigest()
        assert actual_hash == payload["installer_sha256"], f"Payload [{idx}] installer hash mismatch: {actual_hash} != {payload['installer_sha256']}"

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

    # 3. Validate & Prepare Output Directory
    expected_owner = f"legacy-hidden-{args.mode}-busy"
    if args.out_dir:
        out_base = Path(args.out_dir).resolve()
        assert not out_base.is_symlink(), f"Output directory {out_base} must not be a symlink"
        if out_base.exists():
            out_owner_file = out_base / ".owner"
            assert out_owner_file.exists(), f"Output directory {out_base} exists without .owner"
            out_owner = out_owner_file.read_text(encoding="utf-8").strip()
            assert out_owner == expected_owner, f"Output directory belongs to foreign owner: '{out_owner}' != '{expected_owner}'"
            assert not (out_base / "install").exists(), f"Output directory {out_base} already contains install directory; refusing to overwrite"
        else:
            out_base.mkdir(parents=True, exist_ok=True)
            (out_base / ".owner").write_text(expected_owner, encoding="utf-8")
    else:
        out_base = fixture_dir / expected_owner
        assert not out_base.exists(), f"Output directory {out_base} already exists; refusing to overwrite"
        out_base.mkdir(parents=True, exist_ok=False)
        (out_base / ".owner").write_text(expected_owner, encoding="utf-8")

    install = out_base / "install/OpsPilot"
    backup = install.with_name(install.name + "_b")
    assert install.resolve().is_relative_to(out_base.resolve())
    assert backup.resolve().is_relative_to(out_base.resolve())
    assert not install.exists() and not backup.exists()

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
        p.relative_to(install).as_posix(): hashlib.file_digest(p.open("rb"), "sha256").hexdigest()
        for p in install.rglob("*") if p.is_file()
    }
    uninstallers = list(install.glob("Uninstall *.exe"))
    assert len(uninstallers) == 1, "Expected 1 uninstaller"
    control_uninstaller = out_base / "control-uninstaller.exe"
    control_uninstaller.write_bytes(uninstallers[0].read_bytes())
    print(f"[+] 0.1.0 installed successfully: {len(inventory)} files")

    # Step 2: Handle locking based on mode
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetFileAttributesW.argtypes = [wintypes.LPCWSTR]
    kernel.GetFileAttributesW.restype = wintypes.DWORD
    kernel.SetFileAttributesW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD]
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]

    new_installer = Path(plan["payloads"][1]["installer"])

    if args.mode in ["resources", "executable"]:
        hidden_root = install / "resources" if args.mode == "resources" else exe
        locked_file = install / "resources/app.asar" if args.mode == "resources" else exe
        attributes = kernel.GetFileAttributesW(str(hidden_root))
        assert attributes != 0xFFFFFFFF
        assert kernel.SetFileAttributesW(str(hidden_root), attributes | 2), "Failed to set hidden attribute"
        print(f"[*] Set Hidden attribute on: {hidden_root}")

        handle = kernel.CreateFileW(str(locked_file), 0x80000000, 1, None, 3, 128, None)
        assert handle not in [None, ctypes.c_void_p(-1).value], f"CreateFileW lock failed: {ctypes.get_last_error()}"
        print(f"[*] Acquired native read lock on: {locked_file}")

        try:
            print(f"[*] Running 0.2.0 installer with lock active...")
            r["new_install"] = run_setup(new_installer, "new-install", timeout=240)
            print(f"[+] New installer exit code: {r['new_install']['exit_code']} (duration: {r['new_install']['duration_seconds']}s)")

            missing, changed = [], []
            for relative, digest in inventory.items():
                p = install / relative
                if not p.is_file():
                    missing.append(relative)
                elif hashlib.file_digest(p.open("rb"), "sha256").hexdigest() != digest:
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
            r["backup_exists"] = backup.exists()
            
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

    elif args.mode == "cleanup-fault":
        print("[*] Mode cleanup-fault: testing locked file in recovery backup during cleanup...")
        stop_event = threading.Event()
        locked_event = threading.Event()
        initial_handle = kernel.CreateFileW(str(exe), 0x80000000, 1, None, 3, 128, None)
        assert initial_handle not in [None, ctypes.c_void_p(-1).value]
        lock_state = {"initial_handle": initial_handle}

        def watch_backup():
            target = backup / plan["executable_name"]
            while not stop_event.is_set():
                if backup.exists() and lock_state.get("initial_handle"):
                    kernel.CloseHandle(lock_state.pop("initial_handle"))
                if target.is_file():
                    h = kernel.CreateFileW(str(target), 0x80000000, 1, None, 3, 128, None)
                    if h not in [None, ctypes.c_void_p(-1).value]:
                        lock_state["handle"] = h
                        locked_event.set()
                        return
                time.sleep(0.002)

        thread = threading.Thread(target=watch_backup, daemon=True)
        thread.start()
        try:
            print("[*] Phase 1: Running 0.2.0 installer with cleanup-fault watcher active...")
            r["new_install"] = run_setup(new_installer, "01-initial-upgrade", timeout=240)
            r["lock_acquired_in_backup"] = locked_event.is_set()
            print(f"[+] Initial upgrade exit code: {r['new_install']['exit_code']} (lock in backup: {locked_event.is_set()})")

            missing, corrupt = [], []
            installed, recovered = 0, 0
            for relative, digest in inventory.items():
                orig, rec = install / relative, backup / relative
                orig_ok = orig.is_file() and hashlib.file_digest(orig.open("rb"), "sha256").hexdigest() == digest
                rec_ok = rec.is_file() and hashlib.file_digest(rec.open("rb"), "sha256").hexdigest() == digest
                installed += int(orig_ok)
                recovered += int(rec_ok)
                if not orig_ok and not rec_ok:
                    (corrupt if orig.exists() or rec.exists() else missing).append(relative)

            target_asar = install / "resources/app.asar"
            target_committed = (
                target_asar.is_file() and
                hashlib.file_digest(target_asar.open("rb"), "sha256").hexdigest() == plan["payloads"][1]["asar"]
            )
            r["target_committed"] = target_committed
            retired_marker_present = (backup / ".retired").is_file()
            r["retired_marker_present_p1"] = retired_marker_present

            # Phase 2: Retry WHILE LOCK STILL HELD (DO NOT delete backup, DO NOT release lock)
            print("[*] Phase 2: Retrying full installer while retired backup lock is still held...")
            r["retry_locked"] = run_setup(new_installer, "02-retry-locked", timeout=120)
            print(f"[+] Retry while locked exit code: {r['retry_locked']['exit_code']} (expected != 0)")
            retired_marker_after_p2 = (backup / ".retired").is_file()
            r["retired_marker_preserved_p2"] = retired_marker_after_p2
            target_intact_p2 = (
                target_asar.is_file() and
                hashlib.file_digest(target_asar.open("rb"), "sha256").hexdigest() == plan["payloads"][1]["asar"]
            )
            r["target_intact_p2"] = target_intact_p2

            # Phase 3: Release lock handle, then retry full installer
            print("[*] Phase 3: Releasing lock handle and retrying full installer...")
            stop_event.set()
            thread.join(timeout=5)
            if lock_state.get("handle"):
                kernel.CloseHandle(lock_state.pop("handle"))
            if lock_state.get("initial_handle"):
                kernel.CloseHandle(lock_state.pop("initial_handle"))

            r["retry_unlocked"] = run_setup(new_installer, "03-retry-unlocked", timeout=240)
            print(f"[+] Retry after release exit code: {r['retry_unlocked']['exit_code']} (expected 0)")
            target_intact_p3 = (
                target_asar.is_file() and
                hashlib.file_digest(target_asar.open("rb"), "sha256").hexdigest() == plan["payloads"][1]["asar"]
            )
            r["target_intact_p3"] = target_intact_p3
            backup_cleaned_p3 = not backup.exists()
            r["backup_cleaned_p3"] = backup_cleaned_p3

            r.update(
                initial_files=len(inventory),
                preserved_at_install=installed,
                preserved_in_recovery=recovered,
                missing_across_both=len(missing),
                corrupt_across_both=len(corrupt),
                missing_sample=missing[:10],
                registry_count_after=len(get_registry_keys()),
                backup_exists=backup.exists()
            )

            r["pass"] = (
                locked_event.is_set() and
                r["new_install"]["exit_code"] == 0 and
                target_committed and
                retired_marker_present and
                r["retry_locked"]["exit_code"] != 0 and
                retired_marker_after_p2 and
                target_intact_p2 and
                r["retry_unlocked"]["exit_code"] == 0 and
                target_intact_p3 and
                len(missing) == 0 and
                len(corrupt) == 0
            )
        finally:
            stop_event.set()
            thread.join(timeout=5)
            if lock_state.get("handle"):
                kernel.CloseHandle(lock_state["handle"])
            if lock_state.get("initial_handle"):
                kernel.CloseHandle(lock_state["initial_handle"])

    elif args.mode == "pending-fresh-install":
        print("[*] Mode pending-fresh-install: testing pending unowned recovery retention during fresh install...")
        backup.mkdir(parents=True, exist_ok=True)
        marker_file = backup / "pending-recovery-marker.txt"
        marker_file.write_text("PENDING_RECOVERY_DATA_TO_PRESERVE\n", encoding="utf-8")
        marker_hash = hashlib.file_digest(marker_file.open("rb"), "sha256").hexdigest()
        print(f"[+] Created pending recovery marker at: {marker_file} (SHA256: {marker_hash})")

        print("[*] Running normal uninstall of predecessor 0.1.0...")
        argv_un = subprocess.list2cmdline([str(control_uninstaller), "/S"]) + f" _?={install}"
        p_un = subprocess.run(argv_un, cwd=out_base, capture_output=True, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
        (out_base / "normal-uninstall.stdout.log").write_bytes(p_un.stdout)
        (out_base / "normal-uninstall.stderr.log").write_bytes(p_un.stderr)
        assert p_un.returncode == 0, f"Normal uninstall failed with code: {p_un.returncode}"
        assert not install.exists(), "Installation directory must be removed by normal uninstall"
        assert backup.exists(), "Backup directory must be preserved by normal uninstall"
        assert marker_file.exists(), "Pending recovery marker must be preserved by normal uninstall"
        print("[+] Normal uninstall succeeded: installation removed, pending backup preserved")

        print("[*] Running fresh install of 0.2.0 with pending recovery present...")
        r["new_install"] = run_setup(new_installer, "new-install-fresh")
        print(f"[+] Fresh install exit code: {r['new_install']['exit_code']}")

        target_asar = install / "resources/app.asar"
        target_committed = (
            target_asar.is_file() and
            hashlib.file_digest(target_asar.open("rb"), "sha256").hexdigest() == plan["payloads"][1]["asar"]
        )
        current_marker_hash = hashlib.file_digest(marker_file.open("rb"), "sha256").hexdigest() if marker_file.exists() else None
        retired_exists = (backup / ".retired").exists()

        r.update(
            target_committed=target_committed,
            backup_exists=backup.exists(),
            marker_exists=marker_file.exists(),
            marker_hash_matches=(current_marker_hash == marker_hash),
            retired_marker_created=retired_exists,
            registry_count_after=len(get_registry_keys())
        )

        r["pass"] = (
            r["new_install"]["exit_code"] == 0 and
            target_committed and
            backup.exists() and
            marker_file.exists() and
            (current_marker_hash == marker_hash) and
            not retired_exists
        )

    (out_base / "result.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
    print(f"\nResult: {'PASS' if r['pass'] else 'FAIL'}")
    print(f"  Installer exit code: {r['new_install']['exit_code']}")
    if args.mode == "cleanup-fault":
        print(f"  Target committed (0.2.0 ASAR): {r.get('target_committed')}")
        print(f"  Preserved in recovery: {r['preserved_in_recovery']} / {r['initial_files']}")
        print(f"  Missing across both: {r['missing_across_both']}")
        print(f"  Corrupt across both: {r['corrupt_across_both']}")
    elif args.mode == "pending-fresh-install":
        print(f"  Target committed (0.2.0 ASAR): {r.get('target_committed')}")
        print(f"  Pending backup preserved: {r.get('backup_exists')}")
        print(f"  Marker hash matches: {r.get('marker_hash_matches')}")
    else:
        print(f"  Missing files: {len(missing)}")
        print(f"  Changed files: {len(changed)}")
        print(f"  Old ASAR preserved: {r['old_asar_preserved']}")
    print(f"  Registry count after: {r['registry_count_after']} (expected 2)")
    print(f"  Backup directory exists: {r['backup_exists']}")

    # Clean up fixture
    print(f"[*] Cleaning up installation fixture...")
    # Release handle before cleanup and remove backup if uninstaller won't touch it
    import shutil
    if backup.exists() and not (install / plan["executable_name"]).exists():
        install.mkdir(parents=True, exist_ok=True)
        for item in list(backup.iterdir()):
            target_p = install / item.name
            if not target_p.exists():
                item.rename(target_p)
        try:
            backup.rmdir()
        except Exception:
            pass
    elif backup.exists():
        try:
            shutil.rmtree(backup)
        except Exception:
            pass

    clean_uninstaller = control_uninstaller
    if (install / plan["executable_name"]).exists():
        new_uninstallers = list(install.glob("Uninstall *.exe"))
        if new_uninstallers:
            clean_uninstaller = new_uninstallers[0]

    argv = subprocess.list2cmdline([str(clean_uninstaller), "/S"]) + f" _?={install}"
    p_clean = subprocess.run(argv, cwd=out_base, capture_output=True, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
    (out_base / "cleanup.stdout.log").write_bytes(p_clean.stdout)
    (out_base / "cleanup.stderr.log").write_bytes(p_clean.stderr)
    r["cleanup"] = {
        "uninstaller_exit_code": p_clean.returncode,
        "registry_count": len(get_registry_keys()),
        "installation_exists": install.exists(),
        "backup_exists": backup.exists()
    }
    (out_base / "result.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
    print(f"[+] Cleanup exit code: {p_clean.returncode}, remaining registry: {r['cleanup']['registry_count']}")

    if not r["pass"]:
        sys.exit(1)
    print(f"\n[+] LEGACY LOCKED PROBE ({args.mode}) PASSED SUCCESSFULLY.")

if __name__ == "__main__":
    main()
