"""Fixed readonly controller host snapshot. No stdin secrets or installation commands."""

import json
import os
import platform
import pwd


def snapshot():
    uid = os.getuid()
    account = pwd.getpwuid(uid)
    home = account.pw_dir
    if uid == 0:
        paths = [
            "/opt/opspilot-controller",
            "/var/lib/opspilot-controller",
            "/etc/opspilot-controller",
            "/etc/systemd/system/opspilot-controller.service",
            "/etc/systemd/system/opspilot-controller-product.service",
        ]
        try:
            pwd.getpwnam("opspilot-controller")
            existing_account = True
        except KeyError:
            existing_account = False
        disk_path = "/var"
    else:
        paths = [
            os.path.join(home, ".local/share/opspilot/controller"),
            os.path.join(home, ".local/share/opspilot/controller-data"),
            os.path.join(home, ".config/systemd/user/opspilot-controller.service"),
            os.path.join(
                home, ".config/systemd/user/opspilot-controller-product.service"
            ),
        ]
        existing_account = False
        disk_path = home
    available_memory = 0
    with open("/proc/meminfo", encoding="ascii") as stream:
        for line in stream:
            if line.startswith("MemAvailable:"):
                available_memory = int(line.split()[1]) * 1024
                break
    disk = os.statvfs(disk_path)
    try:
        libc = os.confstr("CS_GNU_LIBC_VERSION").split()
    except (ValueError, OSError, AttributeError):
        libc = ["unknown", "0.0"]
    return {
        "format": 1,
        "system": platform.system(),
        "architecture": platform.machine(),
        "libc": libc[0],
        "libc_version": libc[1],
        "uid": uid,
        "available_memory_bytes": available_memory,
        "free_disk_bytes": disk.f_bavail * disk.f_frsize,
        "systemd_system": os.path.isdir("/run/systemd/system"),
        "systemd_user_bus": os.path.exists(f"/run/user/{uid}/bus"),
        "user_linger": os.path.isfile(
            os.path.join("/var/lib/systemd/linger", account.pw_name)
        ),
        "installation_conflict": existing_account
        or any(os.path.lexists(path) for path in paths),
    }


if __name__ == "__main__":
    try:
        print(json.dumps(snapshot(), separators=(",", ":")), flush=True)
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError):
        # Không trả traceback/path hoặc stderr từ host về Desktop.
        print('{"error":"CONTROLLER_HOST_PROBE_FAILED"}', flush=True)
        raise SystemExit(1) from None
