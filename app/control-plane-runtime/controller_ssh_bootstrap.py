"""Pinned SSH bootstrap. Never import/execute an unverified candidate."""

import ctypes
import errno
import fcntl
import hashlib
import json
import os
import platform
import re
import selectors
import signal
import stat
import struct
import subprocess
import time

TRANSFER_ROOT = "/var/lib/opspilot-controller-transfer"
INSTALLATION_PATHS = (
    "/var/lib/opspilot-controller-install",
    "/opt/opspilot-controller",
    "/var/lib/opspilot-controller",
    "/etc/systemd/system/opspilot-controller-product.service",
)
APPROVED_LOCK_SHA = ""
APPROVED_PACKAGES = {}
APPROVED_PAYLOAD = []
FRAME = 4096
MANIFEST = 2 * 1024 * 1024
INSTALLER = 1024 * 1024
TOTAL = 260 * 1024 * 1024
DEADLINE = time.monotonic() + 1200
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
SHA = r"[a-f0-9]{64}"


class BootstrapFailure(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def fail(code):
    raise BootstrapFailure("BOOTSTRAP_" + code)


def full(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def exists(path):
    return os.path.lexists(path)


def directory(path, private=False):
    current = "/"
    for name in os.path.abspath(path).split("/")[1:]:
        current = os.path.join(current, name)
        info = os.lstat(current)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            fail("CONFLICT")
    if private and stat.S_IMODE(os.lstat(path).st_mode) != 0o700:
        fail("CONFLICT")


def checked_file(path, cap, mode=None):
    directory(os.path.dirname(path), private=True)
    before = os.lstat(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or info.st_uid != 0
        or info.st_mode & 0o022
        or (info.st_ino, info.st_dev) != (before.st_ino, before.st_dev)
        or not 0 <= info.st_size <= cap
        or mode is not None
        and stat.S_IMODE(info.st_mode) != mode
    ):
        os.close(fd)
        fail("CONFLICT")
    return fd, info


def read_file(path, cap, mode=0o600):
    fd, before = checked_file(path, cap, mode)
    try:
        data = bytearray()
        while len(data) <= cap:
            part = os.read(fd, min(65536, cap + 1 - len(data)))
            if not part:
                break
            data.extend(part)
        after = os.fstat(fd)
        if len(data) != before.st_size or (
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ) != (before.st_size, before.st_mtime_ns, before.st_ctime_ns):
            fail("CONFLICT")
        return bytes(data)
    finally:
        os.close(fd)


def verify_file(path, record):
    fd, before = checked_file(path, record["size"], record["mode"])
    try:
        digest = hashlib.sha256()
        length = 0
        prefix = b""
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            if not prefix:
                prefix = chunk[:64]
            length += len(chunk)
            if length > record["size"]:
                fail("LIMIT")
            digest.update(chunk)
        after = os.fstat(fd)
        if (
            length != record["size"]
            or digest.hexdigest() != record["sha256"]
            or (after.st_size, after.st_mtime_ns, after.st_ctime_ns)
            != (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        ):
            fail("PIN_MISMATCH")
        if (record["path"] == "node" or record["path"].endswith(".node")) and (
            len(prefix) < 64
            or prefix[:7] != b"\x7fELF\x02\x01\x01"
            or prefix[18:20] != b"\x3e\x00"
        ):
            fail("HOST_UNSUPPORTED")
    finally:
        os.close(fd)


def exact_read(size):
    chunks = bytearray()
    selector = selectors.DefaultSelector()
    selector.register(0, selectors.EVENT_READ)
    try:
        while len(chunks) < size:
            remaining = DEADLINE - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                fail("LIMIT")
            chunk = os.read(0, min(65536, size - len(chunks)))
            if not chunk:
                fail("UNAVAILABLE")
            chunks.extend(chunk)
        return bytes(chunks)
    finally:
        selector.close()


def require_eof():
    selector = selectors.DefaultSelector()
    selector.register(0, selectors.EVENT_READ)
    try:
        remaining = DEADLINE - time.monotonic()
        if remaining <= 0 or not selector.select(remaining) or os.read(0, 1):
            fail("INPUT_INVALID")
    finally:
        selector.close()


def reply(value):
    data = json.dumps(value, separators=(",", ":")).encode()
    if len(data) > (65536 if value.get("state") == "admin_result" else FRAME):
        fail("LIMIT")
    stream = struct.pack(">I", len(data)) + data
    offset = 0
    while offset < len(stream):
        offset += os.write(1, stream[offset:])


def request():
    size = struct.unpack(">I", exact_read(4))[0]
    if not 1 <= size <= FRAME:
        fail("INPUT_INVALID")
    value = json.loads(exact_read(size).decode("utf-8"))
    common = {
        "format",
        "operation",
        "request_key",
        "release_sha256",
        "installer_sha256",
    }
    if (
        not isinstance(value, dict)
        or value.get("format") != 1
        or type(value["format"]) is not int
    ):
        fail("INPUT_INVALID")
    if value.get("operation") == "discover":
        if set(value) != {"format", "operation"}:
            fail("INPUT_INVALID")
        return value
    if not full(UUID, value.get("request_key")) or not all(
        full(SHA, value.get(key)) for key in ("release_sha256", "installer_sha256")
    ):
        fail("INPUT_INVALID")
    operation = value.get("operation")
    if operation in ("transfer", "install", "recover"):
        common.add("consent")
        if value.get("consent") is not True:
            fail("INPUT_INVALID")
    elif operation not in ("status", "inspect", "admin"):
        fail("INPUT_INVALID")
    if operation == "transfer":
        common.update(("manifest_size", "installer_size"))
        if any(
            type(value.get(key)) is not int or not 1 <= value[key] <= cap
            for key, cap in (("manifest_size", MANIFEST), ("installer_size", INSTALLER))
        ):
            fail("INPUT_INVALID")
    if operation == "admin":
        common.add("request_size")
        if (
            type(value.get("request_size")) is not int
            or not 1 <= value["request_size"] <= 512 * 1024
        ):
            fail("INPUT_INVALID")
    if set(value) != common:
        fail("INPUT_INVALID")
    return value


def manifest_records(raw, expected):
    if hashlib.sha256(raw).hexdigest() != expected:
        fail("PIN_MISMATCH")
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict) or set(value) != {
        "format",
        "platform",
        "node_version",
        "node_abi",
        "minimum_glibc",
        "payload_sha256",
        "lock_sha256",
        "packages",
        "files",
    }:
        fail("INPUT_INVALID")
    if (
        type(value["format"]) is not int
        or value["format"] != 1
        or value["platform"] != "linux-x64-glibc"
        or value["lock_sha256"] != APPROVED_LOCK_SHA
    ):
        fail("HOST_UNSUPPORTED")
    if (
        not full(r"22\.\d+\.\d+", value["node_version"])
        or not full(r"\d{1,4}", value["node_abi"])
        or not full(r"\d{1,3}\.\d{1,3}", value["minimum_glibc"])
        or not full(SHA, value["payload_sha256"])
    ):
        fail("INPUT_INVALID")
    if not isinstance(value["packages"], list) or len(value["packages"]) > len(
        APPROVED_PACKAGES
    ):
        fail("INPUT_INVALID")
    packages = {}
    for item in value["packages"]:
        if not isinstance(item, dict) or set(item) != {"path", "name", "version"}:
            fail("INPUT_INVALID")
        approved = APPROVED_PACKAGES.get(item["path"])
        if (
            not approved
            or item["path"] in packages
            or item["name"] != approved["name"]
            or item["version"] != approved["version"]
        ):
            fail("CONFLICT")
        packages[item["path"]] = item
    if any(
        not item["optional"] and path not in packages
        for path, item in APPROVED_PACKAGES.items()
    ):
        fail("CONFLICT")
    if not isinstance(value["files"], list) or not 1 <= len(value["files"]) <= 10000:
        fail("LIMIT")
    previous = ""
    total = 0
    for item in value["files"]:
        if not isinstance(item, dict) or set(item) != {
            "path",
            "size",
            "sha256",
            "mode",
        }:
            fail("INPUT_INVALID")
        path = item["path"]
        if (
            not full(r"[A-Za-z0-9_@+./-]{1,512}", path)
            or any(part in ("", ".", "..") for part in path.split("/"))
            or path <= previous
        ):
            fail("INPUT_INVALID")
        previous = path
        if (
            type(item["size"]) is not int
            or not 0 <= item["size"] <= (128 if path == "node" else 32) * 1024 * 1024
            or not full(SHA, item["sha256"])
            or type(item["mode"]) is not int
            or item["mode"] != (0o700 if path == "node" else 0o600)
        ):
            fail("LIMIT")
        if (
            path not in ("node", "runtime-lock.json")
            and not path.startswith("payload/")
            and not any(path.startswith(package + "/") for package in packages)
        ):
            fail("CONFLICT")
        total += item["size"]
    if total > 256 * 1024 * 1024 or not {"node", "runtime-lock.json"}.issubset(
        item["path"] for item in value["files"]
    ):
        fail("LIMIT")
    return value


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_exclusive(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        offset = 0
        while offset < len(data):
            offset += os.write(fd, data[offset:])
        os.fsync(fd)
    finally:
        os.close(fd)


def prepare_namespace(header):
    intent = {
        key: header[key]
        for key in (
            "format",
            "request_key",
            "release_sha256",
            "installer_sha256",
            "manifest_size",
            "installer_size",
        )
    }
    if not exists(TRANSFER_ROOT):
        directory(os.path.dirname(TRANSFER_ROOT))
        temporary = TRANSFER_ROOT + ".preparing-" + header["request_key"]
        if not exists(temporary):
            os.mkdir(temporary, 0o700)
        directory(temporary, private=True)
        if set(os.listdir(temporary)) - {"intent.json", "operation.lock"}:
            fail("CONFLICT")
        intent_path = os.path.join(temporary, "intent.json")
        if exists(intent_path):
            if json.loads(read_file(intent_path, 4096)) != intent:
                fail("CONFLICT")
        else:
            if os.listdir(temporary):
                fail("CONFLICT")
            write_exclusive(intent_path, json.dumps(intent).encode())
        lock_path = os.path.join(temporary, "operation.lock")
        if not exists(lock_path):
            write_exclusive(lock_path, b"")
        descriptor, _ = checked_file(lock_path, 0, 0o600)
        os.close(descriptor)
        sync_directory(temporary)
        libc = ctypes.CDLL(None, use_errno=True)
        result = libc.renameat2(
            -100, os.fsencode(temporary), -100, os.fsencode(TRANSFER_ROOT), 1
        )
        if result != 0:
            if ctypes.get_errno() == errno.EEXIST:
                fail("BUSY")
            fail("UNAVAILABLE")
        sync_directory(os.path.dirname(TRANSFER_ROOT))
    return intent


def read_intent(header=None):
    directory(TRANSFER_ROOT, private=True)
    intent = json.loads(read_file(os.path.join(TRANSFER_ROOT, "intent.json"), 4096))
    if not isinstance(intent, dict) or set(intent) != {
        "format",
        "request_key",
        "release_sha256",
        "installer_sha256",
        "manifest_size",
        "installer_size",
    }:
        fail("CONFLICT")
    if type(intent["format"]) is not int or intent["format"] != 1:
        fail("CONFLICT")
    if not full(UUID, intent["request_key"]) or not all(
        full(SHA, intent[key]) for key in ("release_sha256", "installer_sha256")
    ):
        fail("CONFLICT")
    for key in ("format", "request_key", "release_sha256", "installer_sha256"):
        if header is not None and intent[key] != header[key]:
            fail("CONFLICT")
    if any(
        type(intent[key]) is not int or not 1 <= intent[key] <= cap
        for key, cap in (("manifest_size", MANIFEST), ("installer_size", INSTALLER))
    ):
        fail("CONFLICT")
    return intent


def entries(manifest, intent):
    return [
        {**item, "destination": "release/" + item["path"]} for item in manifest["files"]
    ] + [
        {
            "path": "installer.cjs",
            "destination": "installer.cjs",
            "size": intent["installer_size"],
            "sha256": intent["installer_sha256"],
            "mode": 0o600,
        }
    ]


def scan(manifest, intent, final=False):
    expected = {"intent.json", "operation.lock", "release/release-manifest.json"}
    expected.update(item["destination"] for item in entries(manifest, intent))
    directories = {""}
    for file in expected:
        parent = os.path.dirname(file)
        while parent:
            directories.add(parent)
            parent = os.path.dirname(parent)
    visited = 0
    for current, names, files in os.walk(TRANSFER_ROOT, followlinks=False):
        relative = os.path.relpath(current, TRANSFER_ROOT)
        relative = "" if relative == "." else relative
        directory(current, private=True)
        if relative not in directories:
            fail("CONFLICT")
        visited += len(names) + len(files)
        if visited > 20050:
            fail("LIMIT")
        for name in names:
            directory(os.path.join(current, name), private=True)
        for name in files:
            file = relative + "/" + name if relative else name
            if file not in expected and (
                final
                or not file.endswith(".partial-" + intent["request_key"])
                or file[: -(len(intent["request_key"]) + 9)] not in expected
            ):
                fail("CONFLICT")


def payload_check(manifest):
    root = os.path.join(TRANSFER_ROOT, "release")
    raw = read_file(os.path.join(root, "payload/bundle-manifest.json"), 32768)
    if hashlib.sha256(raw).hexdigest() != manifest["payload_sha256"]:
        fail("PIN_MISMATCH")
    payload = json.loads(raw)
    expected = sorted(["control-plane.cjs", *APPROVED_PAYLOAD])
    if (
        not isinstance(payload, dict)
        or set(payload) != {"format", "node_major", "entrypoint", "files"}
        or type(payload["format"]) is not int
        or payload["format"] != 1
        or type(payload["node_major"]) is not int
        or payload["node_major"] != 22
        or payload["entrypoint"] != "control-plane.cjs"
        or not isinstance(payload["files"], list)
        or len(payload["files"]) != len(expected)
    ):
        fail("CONFLICT")
    outer = {item["path"]: item for item in manifest["files"]}
    if {path[8:] for path in outer if path.startswith("payload/")} != {
        *expected,
        "bundle-manifest.json",
    }:
        fail("CONFLICT")
    total = 0
    for index, item in enumerate(payload["files"]):
        if (
            not isinstance(item, dict)
            or set(item) != {"path", "size", "sha256"}
            or item["path"] != expected[index]
            or type(item["size"]) is not int
            or not 1 <= item["size"] <= 8 * 1024 * 1024
        ):
            fail("CONFLICT")
        record = outer["payload/" + item["path"]]
        if record["size"] != item["size"] or record["sha256"] != item["sha256"]:
            fail("PIN_MISMATCH")
        total += item["size"]
    if total > 16 * 1024 * 1024:
        fail("LIMIT")
    if (
        hashlib.sha256(
            read_file(os.path.join(root, "runtime-lock.json"), MANIFEST)
        ).hexdigest()
        != APPROVED_LOCK_SHA
    ):
        fail("PIN_MISMATCH")
    for item in manifest["packages"]:
        metadata = json.loads(
            read_file(
                os.path.join(root, item["path"], "package.json"), 32 * 1024 * 1024
            )
        )
        if (
            metadata.get("name") != item["name"]
            or metadata.get("version") != item["version"]
        ):
            fail("CONFLICT")


def status(header, manifest, intent, final=False):
    scan(manifest, intent, final=final)
    records = entries(manifest, intent)
    count = 0
    for item in records:
        file = os.path.join(TRANSFER_ROOT, item["destination"])
        if exists(file):
            verify_file(file, item)
            count += 1
    if count == len(records):
        scan(manifest, intent, final=True)
        payload_check(manifest)
    return {
        "state": "verified" if count == len(records) else "uploading",
        "request_key": header["request_key"],
        "release_sha256": header["release_sha256"],
        "installer_sha256": header["installer_sha256"],
        "completed_files": count,
        "total_files": len(records),
    }


def transfer_file(item, key):
    file = os.path.join(TRANSFER_ROOT, item["destination"])
    parent = os.path.dirname(file)
    current = TRANSFER_ROOT
    for name in os.path.relpath(parent, TRANSFER_ROOT).split("/"):
        if name == ".":
            continue
        current = os.path.join(current, name)
        if not exists(current):
            os.mkdir(current, 0o700)
        directory(current, private=True)
    temporary = file + ".partial-" + key
    if exists(temporary):
        fd, _ = checked_file(temporary, item["size"])
        os.close(fd)
        os.unlink(temporary)
    if exists(file):
        verify_file(file, item)
        return False
    return True


def receive_file(item, key):
    file = os.path.join(TRANSFER_ROOT, item["destination"])
    temporary = file + ".partial-" + key
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        remaining = item["size"]
        while remaining:
            chunk = exact_read(min(remaining, 65536))
            offset = 0
            while offset < len(chunk):
                offset += os.write(fd, chunk[offset:])
            remaining -= len(chunk)
        os.fchmod(fd, item["mode"])
        os.fsync(fd)
    finally:
        os.close(fd)
    verify_file(temporary, item)
    if exists(file):
        fail("CONFLICT")
    os.rename(temporary, file)
    sync_directory(os.path.dirname(file))


def run_installer(header, lock, admin=None):
    operation = header["operation"]
    request = {
        "format": 1,
        "operation": operation,
        "request_key": header["request_key"],
    }
    if operation in ("install", "recover"):
        request.update(consent=True, release_sha256=header["release_sha256"])
    if operation == "install":
        request["release_directory"] = os.path.join(TRANSFER_ROOT, "release")
    if operation == "admin":
        request = admin
    node = os.path.join(TRANSFER_ROOT, "release/node")
    tool = os.path.join(TRANSFER_ROOT, "installer.cjs")
    child = subprocess.Popen(
        [node, tool],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"},
        start_new_session=True,
        pass_fds=(lock,),
    )
    selector = selectors.DefaultSelector()
    output = bytearray()
    stderr_size = 0
    try:
        child.stdin.write(json.dumps(request).encode())
        child.stdin.close()
        for stream in (child.stdout, child.stderr):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ)
        admin_op = admin.get("command", {}).get("operation") if admin else None
        timeout = (
            225
            if admin_op == "project-readiness"
            else 135
            if admin_op == "verify-project-source"
            else 105
            if admin_op in ("register-vps", "enroll-project-target")
            else 90
        )
        deadline = min(DEADLINE, time.monotonic() + timeout)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fail("OUTCOME_UNKNOWN")
            for key, _ in selector.select(min(remaining, 0.5)):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk:
                    selector.unregister(key.fileobj)
                elif key.fileobj is child.stdout:
                    output.extend(chunk)
                    if len(output) > 65536:
                        fail("OUTCOME_UNKNOWN")
                else:
                    stderr_size += len(chunk)
                    if stderr_size > 4096:
                        fail("OUTCOME_UNKNOWN")
        code = child.wait(timeout=max(0.1, deadline - time.monotonic()))
        result = json.loads(output)
        if code != 0:
            mapped = {
                "CONTROLLER_INSTALL_NOT_FOUND": "NOT_FOUND",
                "CONTROLLER_INSTALL_BUSY": "BUSY",
                "CONTROLLER_INSTALL_CONFLICT": "CONFLICT",
            }
            reason = (
                result.get("error")
                if isinstance(result, dict) and set(result) == {"error"}
                else None
            )
            fail(mapped.get(reason, "INSTALLER_FAILED"))
        if operation == "admin":
            return {
                "state": "admin_result",
                "request_key": header["request_key"],
                "result": result,
            }
        if (
            not isinstance(result, dict)
            or result.get("format") != 1
            or result.get("request_key") != header["request_key"]
        ):
            fail("INSTALLER_FAILED")
        return {
            "state": "installation_result",
            "request_key": header["request_key"],
            "installation": result,
        }
    finally:
        selector.close()
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=2)
        child.stdout.close()
        child.stderr.close()


def main():
    if os.geteuid() != 0:
        fail("ROOT_REQUIRED")
    os.umask(0o077)
    header = request()
    admin = None
    if header["operation"] == "admin":
        admin = json.loads(exact_read(header["request_size"]).decode("utf-8"))
        if (
            not isinstance(admin, dict)
            or set(admin) != {"format", "operation", "authority", "command"}
            or type(admin.get("format")) is not int
            or admin["format"] != 1
            or admin.get("operation") != "admin"
            or not isinstance(admin.get("authority"), dict)
            or any(
                admin["authority"].get(key) != header[key]
                for key in ("request_key", "release_sha256", "installer_sha256")
            )
        ):
            fail("INPUT_INVALID")
    if header["operation"] == "discover":
        require_eof()
        if not exists(TRANSFER_ROOT):
            if any(exists(path) for path in INSTALLATION_PATHS):
                fail("CONFLICT")
            # A crash before the singleton rename is still a pending installation.
            parent = os.path.dirname(TRANSFER_ROOT)
            directory(parent)
            if any(
                name.startswith(os.path.basename(TRANSFER_ROOT) + ".preparing-")
                for name in os.listdir(parent)
            ):
                fail("CONFLICT")
            reply({"state": "absent"})
            return
        intent = read_intent()
        fd, _ = checked_file(os.path.join(TRANSFER_ROOT, "operation.lock"), 0, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fail("BUSY")
            reply(
                {
                    "state": "discovered",
                    **{
                        key: intent[key]
                        for key in ("request_key", "release_sha256", "installer_sha256")
                    },
                }
            )
        finally:
            os.close(fd)
        return
    manifest = None
    raw = None
    if header["operation"] == "transfer":
        reply({"state": "send_manifest"})
        raw = exact_read(header["manifest_size"])
        manifest = manifest_records(raw, header["release_sha256"])
        if (
            sum(item["size"] for item in manifest["files"])
            + len(raw)
            + header["installer_size"]
            > TOTAL
        ):
            fail("LIMIT")
        if platform.system() != "Linux" or platform.machine() != "x86_64":
            fail("HOST_UNSUPPORTED")
        libc = os.confstr("CS_GNU_LIBC_VERSION").split()
        if libc[0] != "glibc" or tuple(map(int, libc[1].split("."))) < tuple(
            map(int, manifest["minimum_glibc"].split("."))
        ):
            fail("HOST_UNSUPPORTED")
        disk = os.statvfs(os.path.dirname(TRANSFER_ROOT))
        if disk.f_bavail * disk.f_frsize <= 2 * 1024 * 1024 * 1024 + TOTAL:
            fail("LIMIT")
        prepare_namespace(header)
    elif not exists(TRANSFER_ROOT):
        require_eof()
        if header["operation"] != "status":
            fail("NOT_FOUND")
        reply(
            {
                "state": "absent",
                "request_key": header["request_key"],
                "release_sha256": header["release_sha256"],
                "installer_sha256": header["installer_sha256"],
                "completed_files": 0,
                "total_files": 0,
            }
        )
        return
    intent = read_intent(header)
    fd, _ = checked_file(os.path.join(TRANSFER_ROOT, "operation.lock"), 0, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("BUSY")
        release = os.path.join(TRANSFER_ROOT, "release")
        manifest_path = os.path.join(release, "release-manifest.json")
        if header["operation"] == "transfer":
            if (
                header["manifest_size"] != intent["manifest_size"]
                or header["installer_size"] != intent["installer_size"]
            ):
                fail("CONFLICT")
            if not exists(release):
                os.mkdir(release, 0o700)
            directory(release, private=True)
            if exists(manifest_path):
                if read_file(manifest_path, MANIFEST) != raw:
                    fail("CONFLICT")
            else:
                write_exclusive(manifest_path, raw)
                sync_directory(release)
            scan(manifest, intent)
            for index, item in enumerate(entries(manifest, intent)):
                needed = transfer_file(item, header["request_key"])
                reply({"state": "send_file", "index": index, "needed": needed})
                if exact_read(1) != b"\x01":
                    fail("INPUT_INVALID")
                if needed:
                    receive_file(item, header["request_key"])
            require_eof()
            reply(status(header, manifest, intent, final=True))
        else:
            require_eof()
            if not exists(manifest_path):
                if header["operation"] == "status":
                    reply(
                        {
                            "state": "uploading",
                            "request_key": header["request_key"],
                            "release_sha256": header["release_sha256"],
                            "installer_sha256": header["installer_sha256"],
                            "completed_files": 0,
                            "total_files": 0,
                        }
                    )
                    return
                fail("NOT_FOUND")
            manifest = manifest_records(
                read_file(manifest_path, MANIFEST), header["release_sha256"]
            )
            result = status(header, manifest, intent)
            if header["operation"] == "status":
                reply(result)
            else:
                if result["state"] != "verified":
                    fail("NOT_FOUND")
                reply(run_installer(header, fd, admin))
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except (
        BootstrapFailure,
        AttributeError,
        OSError,
        ValueError,
        TypeError,
        KeyError,
        OverflowError,
        RuntimeError,
        subprocess.SubprocessError,
    ) as error:
        code = (
            error.code
            if isinstance(error, BootstrapFailure)
            else "BOOTSTRAP_UNAVAILABLE"
        )
        try:
            reply({"state": "error", "code": code})
        except OSError:
            pass
        raise SystemExit(1) from None
