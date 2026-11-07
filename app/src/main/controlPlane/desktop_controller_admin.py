"""Bootstrap Desktop: verify pinned offline payload before invoking fixed admin CLI."""

import hashlib
import json
import os
import re
import selectors
import signal
import sqlite3
import stat
import subprocess
import sys
import time

APPROVED_ASSETS = ()
MAX_REPLY = 65536


class AdminFailure(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def checked_path(value, directory=False, private=False):
    if not isinstance(value, str) or not re.fullmatch(
        r"/[A-Za-z0-9_./-]{1,511}", value
    ):
        raise ValueError()
    if os.path.normpath(value) != value or "//" in value:
        raise ValueError()
    parts = value.split("/")
    for index in range(1, len(parts) + 1):
        path = "/".join(parts[:index]) or "/"
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode) or info.st_uid not in (0, os.geteuid()):
            raise ValueError()
        sticky_root_parent = (
            path in ("/tmp", "/var/tmp")
            and info.st_uid == 0
            and info.st_mode & stat.S_ISVTX
            and index < len(parts)
        )
        if info.st_mode & 0o022 and not sticky_root_parent:
            raise ValueError()
    info = os.lstat(value)
    if directory != stat.S_ISDIR(info.st_mode):
        raise ValueError()
    if private and (info.st_uid != os.geteuid() or info.st_mode & 0o077):
        raise ValueError()
    return info


def read_file(path, cap):
    before = checked_path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_ino != before.st_ino
            or info.st_dev != before.st_dev
            or not 1 <= info.st_size <= cap
        ):
            raise ValueError()
        with os.fdopen(os.dup(descriptor), "rb") as stream:
            content = stream.read(cap + 1)
        if len(content) != info.st_size:
            raise ValueError()
        return content
    finally:
        os.close(descriptor)


def verify(request):
    artifact = request["artifact_path"]
    root, entrypoint = os.path.split(artifact)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*\.cjs", entrypoint):
        raise ValueError()
    checked_path(root, directory=True)
    manifest_bytes = read_file(root + "/bundle-manifest.json", 32768)
    if hashlib.sha256(manifest_bytes).hexdigest() != request["manifest_sha256"]:
        raise ValueError()
    manifest = json.loads(manifest_bytes)
    if (
        set(manifest) != {"entrypoint", "files", "format", "node_major"}
        or manifest["format"] != 1
        or manifest["node_major"] != 22
        or manifest["entrypoint"] != entrypoint
    ):
        raise ValueError()
    expected = sorted([entrypoint, *APPROVED_ASSETS])
    if len(manifest["files"]) != len(expected):
        raise ValueError()
    total = 0
    for name, record in zip(expected, manifest["files"], strict=True):
        if (
            set(record) != {"path", "sha256", "size"}
            or record["path"] != name
            or type(record["size"]) is not int
            or not 1 <= record["size"] <= 8388608
            or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"])
        ):
            raise ValueError()
        total += record["size"]
        if total > 16777216:
            raise ValueError()
        content = read_file(root + "/" + name, 8388608)
        if (
            len(content) != record["size"]
            or hashlib.sha256(content).hexdigest() != record["sha256"]
        ):
            raise ValueError()
    present = []
    for current, directories, files in os.walk(root, followlinks=False):
        if len(present) + len(files) > len(expected) + 1 or len(directories) > 16:
            raise ValueError()
        for directory in directories:
            checked_path(os.path.join(current, directory), directory=True)
        for file in files:
            present.append(os.path.relpath(os.path.join(current, file), root))
    if sorted(present) != sorted([*expected, "bundle-manifest.json"]):
        raise ValueError()
    node_info = checked_path(request["node_path"])
    descriptor = os.open(request["node_path"], os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or (info.st_ino, info.st_dev) != (node_info.st_ino, node_info.st_dev)
            or not 1 <= info.st_size <= 268435456
            or os.read(descriptor, 4) != b"\x7fELF"
            or not info.st_mode & 0o111
            or info.st_mode & 0o6000
        ):
            raise ValueError()
    finally:
        os.close(descriptor)
    checked_path(request["data_directory"], directory=True, private=True)
    marker = json.loads(
        read_file(request["data_directory"] + "/.product-controller-initialized", 4096)
    )
    database_path = request["data_directory"] + "/opspilot.db"
    checked_path(database_path, private=True)
    try:
        with sqlite3.connect(
            "file:" + database_path + "?mode=ro", uri=True, timeout=1
        ) as database:
            controllers = database.execute(
                "SELECT controller_id,status FROM product_controller"
            ).fetchall()
    except sqlite3.Error:
        raise AdminFailure("CONTROLLER_IDENTITY_MISMATCH") from None
    if marker != {
        "format": 1,
        "controller_id": request["controller_id"],
    } or controllers != [(request["controller_id"], "active")]:
        raise AdminFailure("CONTROLLER_IDENTITY_MISMATCH")
    if not re.fullmatch(r"v22\.\d+\.\d+", run_cli(request, "_version", {})):
        raise AdminFailure("CONTROLLER_NODE_UNSUPPORTED")


def run_cli(request, operation, payload):
    args = (
        [request["node_path"], "--version"]
        if operation == "_version"
        else [
            request["node_path"],
            request["artifact_path"],
            operation,
            "--data-dir",
            request["data_directory"],
        ]
    )
    process = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=os.path.dirname(request["artifact_path"]),
        env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "NODE_ENV": "production"},
        start_new_session=True,
    )
    try:
        if operation != "_version":
            process.stdin.write(json.dumps(payload).encode())
        process.stdin.close()
        content = bytearray()
        deadline = time.monotonic() + 15
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    raise ValueError()
                chunk = os.read(
                    process.stdout.fileno(), min(65536, MAX_REPLY - len(content) + 1)
                )
                if not chunk:
                    break
                content.extend(chunk)
                if len(content) > MAX_REPLY:
                    raise ValueError()
        if process.wait(timeout=max(0.1, deadline - time.monotonic())) != 0:
            raise ValueError()
        decoded = content.decode("utf-8", errors="strict")
        return decoded.strip() if operation == "_version" else json.loads(decoded)
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        process.stdout.close()


def main():
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        raise ValueError()
    request = json.loads(raw.decode("utf-8", errors="strict"))
    if set(request) != {
        "operation",
        "artifact_path",
        "data_directory",
        "node_path",
        "manifest_sha256",
        "controller_id",
        "payload",
    }:
        raise ValueError()
    if request["operation"] not in (
        "enroll-desktop-client",
        "revoke-desktop-client",
        "status",
        "project-targets",
        "register-project",
    ):
        raise ValueError()
    try:
        verify(request)
    except AdminFailure:
        raise
    except (ValueError, TypeError, KeyError, AttributeError, OSError):
        raise AdminFailure("CONTROLLER_BUNDLE_VERIFICATION_FAILED") from None
    identity = run_cli(request, "status", {})
    if identity.get("controller_id") != request["controller_id"]:
        raise AdminFailure("CONTROLLER_IDENTITY_MISMATCH")
    response = (
        identity
        if request["operation"] == "status"
        else run_cli(request, request["operation"], request["payload"])
    )
    sys.stdout.write(json.dumps({"ok": True, "data": response}) + "\n")


if __name__ == "__main__":

    def interrupted(_signum, _frame):
        raise InterruptedError()

    signal.signal(signal.SIGHUP, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except AdminFailure as error:
        sys.stdout.write(json.dumps({"ok": False, "code": error.code}) + "\n")
    except (
        ValueError,
        TypeError,
        KeyError,
        AttributeError,
        OSError,
        subprocess.SubprocessError,
    ):
        sys.stdout.write('{"ok":false,"code":"CONTROLLER_ADMIN_FAILED"}\n')
