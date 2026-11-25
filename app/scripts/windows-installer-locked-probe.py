import io
import os
import sys
from pathlib import Path
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import subprocess
import time
import winreg

# Ensure UTF-8 output on Windows consoles to prevent UnicodeEncodeError with Vietnamese paths
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

def run(exe, args, log_prefix, out_dir, cwd, timeout=300):
    argv = [str(exe), *args]
    if args and args[-1].startswith('_?='):
        # NSIS consumes unquoted tail after _?=
        argv = subprocess.list2cmdline([str(exe), *args[:-1]]) + ' ' + args[-1]
    p = subprocess.run(argv, cwd=str(cwd), capture_output=True, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    (out_dir / f"{log_prefix}.stdout.log").write_bytes(p.stdout)
    (out_dir / f"{log_prefix}.stderr.log").write_bytes(p.stderr)
    return p.returncode

def get_registry_count(guid):
    count = 0
    for subkey in [rf"Software\{guid}", rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{guid}"]:
        try:
            k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, subkey)
            winreg.CloseKey(k)
            count += 1
        except OSError:
            pass
    return count

def inventory_files(directory):
    files = {}
    for p in directory.rglob('*'):
        if p.is_file():
            rel = str(p.relative_to(directory)).replace('\\', '/')
            files[rel] = {
                'size': p.stat().st_size,
                'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
            }
    return files

def acquire_native_lock(file_path):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                   ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(file_path), 0x80000000, 1, None, 3, 128, None)
    if handle in [None, ctypes.c_void_p(-1).value]:
        raise OSError(f"Failed to acquire handle: {ctypes.get_last_error()}")
    return handle, lambda: kernel.CloseHandle(handle)

def check_payload_integrity(install, initial_inventory):
    missing_files = []
    corrupted_files = []
    for rel_path, meta in initial_inventory.items():
        curr_p = install / rel_path
        if not curr_p.exists():
            missing_files.append(rel_path)
        else:
            curr_size = curr_p.stat().st_size
            if curr_size != meta['size']:
                corrupted_files.append((rel_path, 'size_mismatch'))
            else:
                curr_sha = hashlib.file_digest(curr_p.open('rb'), 'sha256').hexdigest()
                if curr_sha != meta['sha256']:
                    corrupted_files.append((rel_path, 'hash_mismatch'))
    return missing_files, corrupted_files

def main():
    parser = argparse.ArgumentParser(description="Test locked file and recovery backup behavior during update/uninstall")
    parser.add_argument("--record", required=True, help="Fixture record nonce")
    parser.add_argument("--lock-target", default="resources/app.asar", choices=["resources/app.asar", "executable"], help="Target file to lock")
    parser.add_argument("--test-case", default="all", choices=["locked", "pre-existing-backup", "full-installer-chain", "all"], help="Specific regression test case to run")
    parser.add_argument("--out-dir", default=None, help="Output directory for logs and report")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    fixture_dir = root / ".out-scripts/windows-installer-lab" / args.record
    assert fixture_dir.exists(), f"Fixture {fixture_dir} does not exist"
    assert (fixture_dir / ".owner").read_text(encoding='utf-8') == args.record

    plan = json.loads((fixture_dir / "plan.json").read_text(encoding='utf-8'))
    install = Path(plan["installation_directory"])
    assert install.resolve().is_relative_to(fixture_dir.resolve()), "Install dir must be inside fixture"
    installer = Path(plan["installer"])
    guid = plan["guid"]
    backup_dir = install.parent / f"{install.name}_b"

    out_dir = Path(args.out_dir) if args.out_dir else (fixture_dir / "regression-locked-probe")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Ensure clean install
    if not (install / plan["executable_name"]).exists():
        print(f"[*] Step 1: Clean install into {install}...")
        install_rc = run(installer, ["/S", f"/D={install}"], "01-install", out_dir, fixture_dir)
        assert install_rc == 0, f"Install failed with code {install_rc}"
        assert install.exists(), "Installation directory was not created"
    else:
        print(f"[*] Step 1: Reusing existing clean install in {install}...")

    initial_inventory = inventory_files(install)
    print(f"[+] Installed successfully: {len(initial_inventory)} files")

    reg_count_installed = get_registry_count(guid)
    assert reg_count_installed == 2, f"Expected 2 registry entries, got {reg_count_installed}"

    uninstallers = list(install.glob("Uninstall *.exe"))
    assert len(uninstallers) == 1, f"Expected 1 uninstaller, found {len(uninstallers)}"
    uninstaller = uninstallers[0]

    all_passed = True

    # CASE A: Locked file update (resources/app.asar or executable)
    if args.test_case in ["locked", "all"]:
        targets = [args.lock_target] if args.test_case == "locked" else ["resources/app.asar", "executable"]
        for target_name in targets:
            print(f"\n========================================================")
            print(f"[*] RUNNING TEST CASE: locked file probe ({target_name})")
            print(f"========================================================")
            target_file = install / ("resources/app.asar" if target_name == "resources/app.asar" else plan["executable_name"])
            assert target_file.exists(), f"Lock target {target_file} does not exist"

            handle, release_lock = acquire_native_lock(target_file)
            result = {
                "record": args.record,
                "test_case": f"locked_{target_name.replace('/', '_')}",
                "lock_target": target_name,
                "only_owned_fixture_mutated": True,
                "initial_file_count": len(initial_inventory),
                "registry_count_installed": reg_count_installed,
                "steps": {}
            }

            try:
                uninst_rc = run(uninstaller, ["/S", "--updated", f"_?={install}"], f"02-locked-{target_name.replace('/', '_')}", out_dir, fixture_dir, timeout=120)
                result["steps"]["locked_update_rc"] = uninst_rc
                print(f"[+] Uninstaller exited with code: {uninst_rc}")
            finally:
                release_lock()
                print("[*] Released native lock handle")

            time.sleep(1)
            missing, corrupted = check_payload_integrity(install, initial_inventory)
            result["missing_files_count"] = len(missing)
            result["corrupted_files_count"] = len(corrupted)
            result["missing_files_sample"] = missing[:10]
            result["registry_count_after_locked"] = get_registry_count(guid)
            result["lingering_backup_dirs"] = [str(backup_dir.name)] if backup_dir.exists() else []

            passed = (
                uninst_rc != 0 and
                len(missing) == 0 and
                len(corrupted) == 0 and
                result["registry_count_after_locked"] == 2 and
                not backup_dir.exists()
            )
            result["status"] = "PASS" if passed else "FAIL"
            all_passed = all_passed and passed

            report_file = out_dir / f"locked-probe-{target_name.replace('/', '_')}.json"
            report_file.write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(f"Result for {target_name}: {result['status']}")
            print(f"  Uninstaller return code: {uninst_rc} (expected != 0)")
            print(f"  Missing files: {len(missing)} / {len(initial_inventory)}")
            print(f"  Corrupted files: {len(corrupted)}")
            print(f"  Registry entries: {result['registry_count_after_locked']} (expected 2)")
            print(f"  Backup dir exists: {backup_dir.exists()} (expected False)")
            print(f"  Report written to: {report_file}")

    # CASE B: Pre-existing backup directory / retained recovery marker (R8)
    if args.test_case in ["pre-existing-backup", "all"]:
        print(f"\n========================================================")
        print(f"[*] RUNNING TEST CASE: Pre-existing recovery backup retention (R8)")
        print(f"========================================================")
        # Create pre-existing backup directory and recovery marker
        backup_dir.mkdir(parents=True, exist_ok=True)
        marker_file = backup_dir / "retained-recovery-marker.txt"
        marker_content = b"OPSPILOT_RECOVERY_MARKER_SYNTHETIC_TEST_TOKEN_20261125\n"
        marker_file.write_bytes(marker_content)
        marker_sha256 = hashlib.sha256(marker_content).hexdigest()
        print(f"[+] Created pre-existing recovery marker at: {marker_file}")
        print(f"    Marker SHA256: {marker_sha256}")

        result_r8 = {
            "record": args.record,
            "test_case": "pre_existing_backup_retention",
            "backup_directory": str(backup_dir),
            "marker_file": str(marker_file),
            "marker_sha256_before": marker_sha256,
            "only_owned_fixture_mutated": True,
            "initial_file_count": len(initial_inventory),
            "registry_count_installed": reg_count_installed,
            "steps": {}
        }

        # Run uninstaller in update mode
        uninst_rc = run(uninstaller, ["/S", "--updated", f"_?={install}"], "03-preexisting-backup", out_dir, fixture_dir, timeout=120)
        result_r8["steps"]["update_rc"] = uninst_rc
        print(f"[+] Uninstaller exited with code: {uninst_rc} (expected exit 2)")

        # Verify:
        # 1. Uninstaller aborted before mutation (exit != 0)
        # 2. Marker file still exists in backup_dir and has exact same SHA256
        # 3. Payload files in install directory are 100% intact
        # 4. Registry entries are 100% intact (2 keys)
        marker_exists = marker_file.exists()
        marker_sha256_after = hashlib.sha256(marker_file.read_bytes()).hexdigest() if marker_exists else None
        result_r8["marker_exists_after"] = marker_exists
        result_r8["marker_sha256_after"] = marker_sha256_after

        missing, corrupted = check_payload_integrity(install, initial_inventory)
        result_r8["missing_files_count"] = len(missing)
        result_r8["corrupted_files_count"] = len(corrupted)
        result_r8["registry_count_after"] = get_registry_count(guid)

        passed_r8 = (
            uninst_rc != 0 and
            marker_exists and
            marker_sha256_after == marker_sha256 and
            len(missing) == 0 and
            len(corrupted) == 0 and
            result_r8["registry_count_after"] == 2
        )
        result_r8["status"] = "PASS" if passed_r8 else "FAIL"
        all_passed = all_passed and passed_r8

        report_file_r8 = out_dir / "locked-probe-pre-existing-backup.json"
        report_file_r8.write_text(json.dumps(result_r8, indent=2), encoding='utf-8')
        print(f"Result for R8 Pre-existing backup: {result_r8['status']}")
        print(f"  Uninstaller return code: {uninst_rc} (expected != 0)")
        print(f"  Marker preserved: {marker_exists} (hash match: {marker_sha256_after == marker_sha256})")
        print(f"  Missing files: {len(missing)} / {len(initial_inventory)}")
        print(f"  Corrupted files: {len(corrupted)}")
        print(f"  Registry entries: {result_r8['registry_count_after']} (expected 2)")
        print(f"  Report written to: {report_file_r8}")

        # Clean up synthetic marker and backup directory after verified test
        if marker_file.exists():
            marker_file.unlink()
        if backup_dir.exists():
            backup_dir.rmdir()

    # CASE C: Full Installer Integration Probes (R9)
    if args.test_case in ["full-installer-chain", "all"]:
        print(f"\n========================================================")
        print(f"[*] RUNNING TEST CASE: Full Installer Integration Probes (R9)")
        print(f"========================================================")

        # C1: Full installer when pre-existing recovery backup is present
        print(f"\n[*] Case C1: Full installer with pre-existing backup...")
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_marker = backup_dir / "retained-recovery-marker.txt"
        backup_marker_content = b"OPSPILOT_RECOVERY_MARKER_FULL_CHAIN_20261125\n"
        backup_marker.write_bytes(backup_marker_content)
        backup_marker_sha256 = hashlib.sha256(backup_marker_content).hexdigest()

        payload_marker = install / "payload-marker-r9.txt"
        payload_marker_content = b"OPSPILOT_PAYLOAD_MARKER_FULL_CHAIN_20261125\n"
        payload_marker.write_bytes(payload_marker_content)
        payload_marker_sha256 = hashlib.sha256(payload_marker_content).hexdigest()

        # Run full installer /S /D=<install>
        c1_rc = run(installer, ["/S", f"/D={install}"], "04-full-installer-backup-pending", out_dir, fixture_dir, timeout=180)
        print(f"[+] Full installer exited with code: {c1_rc} (expected exit 2 != 0)")

        b_exists = backup_marker.exists()
        b_sha = hashlib.sha256(backup_marker.read_bytes()).hexdigest() if b_exists else None
        p_exists = payload_marker.exists()
        p_sha = hashlib.sha256(payload_marker.read_bytes()).hexdigest() if p_exists else None

        missing_c1, corrupted_c1 = check_payload_integrity(install, initial_inventory)
        reg_c1 = get_registry_count(guid)

        c1_passed = (
            c1_rc != 0 and
            b_exists and b_sha == backup_marker_sha256 and
            p_exists and p_sha == payload_marker_sha256 and
            len(missing_c1) == 0 and len(corrupted_c1) == 0 and
            reg_c1 == 2
        )
        print(f"  Result C1: {'PASS' if c1_passed else 'FAIL'}")
        print(f"    Installer exit code: {c1_rc} (expected != 0)")
        print(f"    Backup marker preserved: {b_exists} (hash match: {b_sha == backup_marker_sha256})")
        print(f"    Payload marker preserved: {p_exists} (hash match: {p_sha == payload_marker_sha256})")
        print(f"    Missing payload files: {len(missing_c1)}")
        print(f"    Registry count: {reg_c1} (expected 2)")
        all_passed = all_passed and c1_passed

        # Clean synthetic markers
        if payload_marker.exists():
            payload_marker.unlink()
        if backup_marker.exists():
            backup_marker.unlink()
        if backup_dir.exists():
            backup_dir.rmdir()

        report_c1 = {
            "record": args.record,
            "test_case": "full_installer_pre_existing_backup",
            "installer_exit_code": c1_rc,
            "backup_marker_preserved": b_exists and (b_sha == backup_marker_sha256),
            "payload_marker_preserved": p_exists and (p_sha == payload_marker_sha256),
            "missing_payload_files": len(missing_c1),
            "corrupted_payload_files": len(corrupted_c1),
            "registry_count": reg_c1,
            "status": "PASS" if c1_passed else "FAIL"
        }
        (out_dir / "full-installer-backup-pending.json").write_text(json.dumps(report_c1, indent=2), encoding='utf-8')

        # C2: Full installer with locked resources/app.asar
        print(f"\n[*] Case C2: Full installer with locked resources/app.asar...")
        target_asar = install / "resources/app.asar"
        handle_asar, release_asar = acquire_native_lock(target_asar)
        try:
            c2_rc = run(installer, ["/S", f"/D={install}"], "05-full-installer-locked-asar", out_dir, fixture_dir, timeout=180)
            print(f"[+] Full installer exited with code: {c2_rc} (expected exit 2 != 0)")
        finally:
            release_asar()
            print("[*] Released native lock handle on app.asar")

        time.sleep(1)
        missing_c2, corrupted_c2 = check_payload_integrity(install, initial_inventory)
        reg_c2 = get_registry_count(guid)
        c2_passed = (
            c2_rc != 0 and
            len(missing_c2) == 0 and len(corrupted_c2) == 0 and
            reg_c2 == 2 and
            not backup_dir.exists()
        )
        print(f"  Result C2: {'PASS' if c2_passed else 'FAIL'}")
        print(f"    Installer exit code: {c2_rc} (expected != 0)")
        print(f"    Missing payload files: {len(missing_c2)}")
        print(f"    Registry count: {reg_c2} (expected 2)")
        all_passed = all_passed and c2_passed

        report_c2 = {
            "record": args.record,
            "test_case": "full_installer_locked_asar",
            "installer_exit_code": c2_rc,
            "missing_payload_files": len(missing_c2),
            "corrupted_payload_files": len(corrupted_c2),
            "registry_count": reg_c2,
            "status": "PASS" if c2_passed else "FAIL"
        }
        (out_dir / "full-installer-locked-asar.json").write_text(json.dumps(report_c2, indent=2), encoding='utf-8')

        # C3: Full installer with locked executable
        print(f"\n[*] Case C3: Full installer with locked executable...")
        target_exe = install / plan["executable_name"]
        handle_exe, release_exe = acquire_native_lock(target_exe)
        try:
            c3_rc = run(installer, ["/S", f"/D={install}"], "06-full-installer-locked-exe", out_dir, fixture_dir, timeout=180)
            print(f"[+] Full installer exited with code: {c3_rc} (expected exit 2 != 0)")
        finally:
            release_exe()
            print("[*] Released native lock handle on executable")

        time.sleep(1)
        missing_c3, corrupted_c3 = check_payload_integrity(install, initial_inventory)
        reg_c3 = get_registry_count(guid)
        c3_passed = (
            c3_rc != 0 and
            len(missing_c3) == 0 and len(corrupted_c3) == 0 and
            reg_c3 == 2 and
            not backup_dir.exists()
        )
        print(f"  Result C3: {'PASS' if c3_passed else 'FAIL'}")
        print(f"    Installer exit code: {c3_rc} (expected != 0)")
        print(f"    Missing payload files: {len(missing_c3)}")
        print(f"    Registry count: {reg_c3} (expected 2)")
        all_passed = all_passed and c3_passed

        report_c3 = {
            "record": args.record,
            "test_case": "full_installer_locked_exe",
            "installer_exit_code": c3_rc,
            "missing_payload_files": len(missing_c3),
            "corrupted_payload_files": len(corrupted_c3),
            "registry_count": reg_c3,
            "status": "PASS" if c3_passed else "FAIL"
        }
        (out_dir / "full-installer-locked-exe.json").write_text(json.dumps(report_c3, indent=2), encoding='utf-8')

        # C4: Positive control - Same-version reinstall via full installer
        print(f"\n[*] Case C4: Positive control - Same-version reinstall via full installer...")
        c4_rc = run(installer, ["/S", f"/D={install}"], "07-full-installer-reinstall", out_dir, fixture_dir, timeout=180)
        print(f"[+] Full installer reinstall exited with code: {c4_rc} (expected 0)")
        missing_c4, corrupted_c4 = check_payload_integrity(install, initial_inventory)
        reg_c4 = get_registry_count(guid)
        c4_passed = (
            c4_rc == 0 and
            len(missing_c4) == 0 and len(corrupted_c4) == 0 and
            reg_c4 == 2
        )
        print(f"  Result C4: {'PASS' if c4_passed else 'FAIL'}")
        print(f"    Installer exit code: {c4_rc} (expected 0)")
        print(f"    Missing payload files: {len(missing_c4)}")
        print(f"    Registry count: {reg_c4} (expected 2)")
        all_passed = all_passed and c4_passed

        report_c4 = {
            "record": args.record,
            "test_case": "full_installer_positive_reinstall",
            "installer_exit_code": c4_rc,
            "missing_payload_files": len(missing_c4),
            "corrupted_payload_files": len(corrupted_c4),
            "registry_count": reg_c4,
            "status": "PASS" if c4_passed else "FAIL"
        }
        (out_dir / "full-installer-positive-reinstall.json").write_text(json.dumps(report_c4, indent=2), encoding='utf-8')

        # C5: Positive control - Normal uninstall
        print(f"\n[*] Case C5: Positive control - Normal uninstall...")
        c5_rc = run(uninstaller, ["/S", f"_?={install}"], "08-normal-uninstall", out_dir, fixture_dir, timeout=120)
        print(f"[+] Uninstaller exited with code: {c5_rc} (expected 0)")
        install_exists = install.exists()
        reg_c5 = get_registry_count(guid)
        remaining_payload = [f for f in install.glob('*') if not f.name.startswith("Uninstall ")] if install_exists else []
        c5_passed = (
            c5_rc == 0 and
            len(remaining_payload) == 0 and
            not (install / plan["executable_name"]).exists() and
            not (install / "resources").exists() and
            reg_c5 == 0
        )
        print(f"  Result C5: {'PASS' if c5_passed else 'FAIL'}")
        print(f"    Uninstaller exit code: {c5_rc} (expected 0)")
        print(f"    Remaining payload items (excl uninstaller): {len(remaining_payload)}")
        print(f"    Main executable removed: {not (install / plan['executable_name']).exists()}")
        print(f"    Resources removed: {not (install / 'resources').exists()}")
        print(f"    Registry count: {reg_c5} (expected 0)")
        all_passed = all_passed and c5_passed

        report_c5 = {
            "record": args.record,
            "test_case": "positive_normal_uninstall",
            "uninstaller_exit_code": c5_rc,
            "install_directory_exists": install_exists,
            "remaining_payload_items": len(remaining_payload),
            "main_exe_removed": not (install / plan["executable_name"]).exists(),
            "resources_removed": not (install / "resources").exists(),
            "registry_count": reg_c5,
            "status": "PASS" if c5_passed else "FAIL"
        }
        (out_dir / "positive-normal-uninstall.json").write_text(json.dumps(report_c5, indent=2), encoding='utf-8')

    if not all_passed:
        sys.exit(1)
    print("\n[+] ALL REGRESSION TEST CASES PASSED SUCCESSFULLY.")

if __name__ == "__main__":
    main()
