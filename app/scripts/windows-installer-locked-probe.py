from pathlib import Path
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import subprocess
import time
import sys

import winreg

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

def main():
    parser = argparse.ArgumentParser(description="Test locked file behavior during update/uninstall")
    parser.add_argument("--record", required=True, help="Fixture record nonce")
    parser.add_argument("--lock-target", default="resources/app.asar", choices=["resources/app.asar", "executable"], help="Target file to lock")
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

    out_dir = Path(args.out_dir) if args.out_dir else (fixture_dir / "regression-locked-probe")
    out_dir.mkdir(parents=True, exist_ok=True)

    result = {
        "record": args.record,
        "lock_target": args.lock_target,
        "only_owned_fixture_mutated": True,
        "steps": {}
    }

    if not (install / plan["executable_name"]).exists():
        print(f"[*] Step 1: Clean install into {install}...")
        install_rc = run(installer, ["/S", f"/D={install}"], "01-install", out_dir, fixture_dir)
        result["steps"]["install_rc"] = install_rc
        assert install_rc == 0, f"Install failed with code {install_rc}"
        assert install.exists(), "Installation directory was not created"
    else:
        print(f"[*] Step 1: Reusing existing clean install in {install}...")
        result["steps"]["install_rc"] = 0

    initial_inventory = inventory_files(install)
    result["initial_file_count"] = len(initial_inventory)
    print(f"[+] Installed successfully: {len(initial_inventory)} files")

    reg_count_installed = get_registry_count(guid)
    result["registry_count_installed"] = reg_count_installed
    assert reg_count_installed == 2, f"Expected 2 registry entries, got {reg_count_installed}"

    uninstallers = list(install.glob("Uninstall *.exe"))
    assert len(uninstallers) == 1, f"Expected 1 uninstaller, found {len(uninstallers)}"
    uninstaller = uninstallers[0]

    if args.lock_target == "resources/app.asar":
        target_file = install / "resources/app.asar"
    else:
        target_file = install / plan["executable_name"]

    assert target_file.exists(), f"Lock target {target_file} does not exist"

    print(f"[*] Step 2: Acquire exclusive native lock on {target_file.name} (GENERIC_READ, FILE_SHARE_READ only)...")
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                   ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(target_file), 0x80000000, 1, None, 3, 128, None)
    if handle in [None, ctypes.c_void_p(-1).value]:
        raise OSError(f"Failed to acquire handle: {ctypes.get_last_error()}")

    print("[*] Step 3: Execute uninstaller with --updated flag while file is locked...")
    try:
        # Run uninstaller in updated mode
        uninst_rc = run(uninstaller, ["/S", "--updated", f"_?={install}"], "02-locked-update", out_dir, fixture_dir, timeout=120)
        result["steps"]["locked_update_rc"] = uninst_rc
        print(f"[+] Uninstaller exited with code: {uninst_rc}")

        time.sleep(2)
        post_locked_inventory = inventory_files(install)
        result["post_locked_file_count"] = len(post_locked_inventory)
    finally:
        kernel.CloseHandle(handle)
        print("[*] Released native lock handle")

    print("[*] Step 4: Verify payload preservation and rollback...")
    # Check if files were deleted or preserved
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

    result["missing_files_count"] = len(missing_files)
    result["corrupted_files_count"] = len(corrupted_files)
    result["missing_files_sample"] = missing_files[:10]
    result["registry_count_after_locked"] = get_registry_count(guid)

    backup_dirs = list(fixture_dir.glob("install/*-old-*"))
    result["lingering_backup_dirs"] = [str(b.name) for b in backup_dirs]

    # PASS Criteria:
    # 1. uninst_rc != 0 (must fail, not exit 0)
    # 2. missing_files_count == 0 (all files preserved/restored)
    # 3. corrupted_files_count == 0 (hashes identical)
    # 4. registry_count_after_locked == 2 (registry untouched)
    # 5. lingering_backup_dirs == 0 (cleanup successful)

    passed = (
        uninst_rc != 0 and
        len(missing_files) == 0 and
        len(corrupted_files) == 0 and
        result["registry_count_after_locked"] == 2 and
        len(backup_dirs) == 0
    )
    result["status"] = "PASS" if passed else "FAIL"
    report_file = out_dir / f"locked-probe-{args.lock_target.replace('/', '_')}.json"
    report_file.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(f"\nResult: {result['status']}")
    print(f"  Uninstaller return code: {uninst_rc} (expected != 0)")
    print(f"  Missing files: {len(missing_files)} / {len(initial_inventory)}")
    print(f"  Corrupted files: {len(corrupted_files)}")
    print(f"  Registry entries: {result['registry_count_after_locked']} (expected 2)")
    print(f"  Lingering backup dirs: {len(backup_dirs)}")
    print(f"Report written to: {report_file}")

    if not passed:
        sys.exit(1)

if __name__ == "__main__":
    main()
