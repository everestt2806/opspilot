"""Bootstrap target tường minh qua SSH/stdin; không gọi fixture initializer hoặc chạy deployment."""

from __future__ import annotations

import base64
import ctypes
import fcntl
import hashlib
import hmac
import json
import os
import re
import shutil
import stat
import sys
import uuid
from pathlib import Path

DOMAIN = b"opspilot-target-enrollment-v1\n"
MAX_INPUT = 2 * 1024 * 1024
HELPERS = {
    "target_execution_guard.py",
    "target_guarded_ssh_helper.py",
    "target_product_runtime.py",
}
PAYLOAD_KEYS = {
    "format",
    "purpose",
    "controller_id",
    "app_id",
    "ownership_generation",
    "target",
    "manifest_sha256",
    "target_root",
    "state_root",
    "helper_path",
}
MARKER_KEYS = {
    "format",
    "controller_id",
    "app_id",
    "ownership_generation",
    "highest_accepted_fence",
    "last_claim_id",
    "last_attempt_id",
    "execution_state",
}


class EnrollmentRejected(Exception):
    def __init__(self, code: str = "TARGET_ENROLLMENT_REJECTED"):
        super().__init__(code)
        self.code = code


def _canonical(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()


def _positive(value: object) -> bool:
    return type(value) is int and 0 < value <= 9007199254740991


def _private_dir(path: Path) -> None:
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.geteuid()
        or info.st_mode & 0o077
    ):
        raise EnrollmentRejected()


def _read(path: Path, cap: int) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.geteuid()
            or info.st_nlink != 1
            or info.st_mode & 0o077
            or not 0 < info.st_size <= cap
        ):
            raise EnrollmentRejected()
        with os.fdopen(os.dup(fd), "rb") as handle:
            value = handle.read(cap + 1)
        if len(value) != info.st_size or len(value) > cap:
            raise EnrollmentRejected()
        return value
    finally:
        os.close(fd)


def _sync(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write(path: Path, value: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())


def _publish(stage: Path, final: Path) -> None:
    # Kernel bảo đảm không thay cả directory rỗng hiện hữu; không check-then-replace.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(stage), -100, os.fsencode(final), 1) != 0:
        raise OSError(ctypes.get_errno(), "ENROLLMENT_PUBLISH_FAILED")


def _base(path: Path, create: bool) -> bool:
    for ancestor in [*reversed(path.parents)]:
        info = ancestor.lstat()
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid not in {0, os.geteuid()}
            or (
                info.st_mode & 0o022
                and not (info.st_uid == 0 and info.st_mode & stat.S_ISVTX)
            )
        ):
            raise EnrollmentRejected()
    if not os.path.lexists(path):
        if not create:
            return False
        try:
            path.mkdir(mode=0o700)
            _sync(path.parent)
        except FileExistsError:
            pass
    _private_dir(path)
    return True


def _proof(payload: dict, key: bytes) -> dict:
    return {
        "payload": payload,
        "signature": hmac.new(
            key, DOMAIN + _canonical(payload), hashlib.sha256
        ).hexdigest(),
    }


def _validate(
    request: object,
) -> tuple[dict, bytes, bytes, dict[str, bytes], Path, str]:
    if not isinstance(request, dict) or set(request) != {
        "format",
        "operation",
        "payload",
        "key",
        "manifest",
        "helpers",
    }:
        raise EnrollmentRejected()
    payload = request["payload"]
    if (
        type(request["format"]) is not int
        or request["format"] != 1
        or request["operation"] not in {"enroll", "inspect"}
        or not isinstance(payload, dict)
        or set(payload) != PAYLOAD_KEYS
        or type(payload["format"]) is not int
        or payload["format"] != 1
        or payload["purpose"] != "product-target-enrollment"
        or not isinstance(payload["controller_id"], str)
        or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", payload["controller_id"]
        )
        or not _positive(payload["app_id"])
        or not _positive(payload["ownership_generation"])
        or not isinstance(payload["manifest_sha256"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", payload["manifest_sha256"])
    ):
        raise EnrollmentRejected()
    target = payload["target"]
    if not isinstance(target, dict) or set(target) != {
        "vps_id",
        "host",
        "port",
        "username",
        "auth_type",
        "host_fingerprint",
        "ssh_security_revision",
    }:
        raise EnrollmentRejected()
    if (
        not _positive(target["vps_id"])
        or not _positive(target["port"])
        or target["port"] > 65535
        or not _positive(target["ssh_security_revision"])
        or target["auth_type"] not in {"key", "password"}
        or not isinstance(target["host_fingerprint"], str)
        or not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", target["host_fingerprint"])
    ):
        raise EnrollmentRejected()
    for field, limit in [("host", 253), ("username", 128)]:
        value = target[field]
        if (
            not isinstance(value, str)
            or not 0 < len(value) <= limit
            or any(ord(c) <= 32 or ord(c) == 127 or c.isspace() for c in value)
        ):
            raise EnrollmentRejected()
    base = payload["target_root"]
    if (
        not isinstance(base, str)
        or len(base) > 512
        or not re.fullmatch(r"/[A-Za-z0-9_./-]+", base)
        or any(part in {"", ".", ".."} for part in base.split("/")[1:])
    ):
        raise EnrollmentRejected()
    slot = (
        hashlib.sha256(payload["controller_id"].encode()).hexdigest()
        + "-app-"
        + str(payload["app_id"])
    )
    final = Path(base) / ("controller-" + slot)
    if len(str(final / "helpers/target_guarded_ssh_helper.py")) > 512 or any(
        len(part) > 255 for part in Path(base).parts
    ):
        raise EnrollmentRejected()
    if payload["state_root"] != str(final / "state") or payload["helper_path"] != str(
        final / "helpers/target_guarded_ssh_helper.py"
    ):
        raise EnrollmentRejected()
    key = base64.b64decode(request["key"], validate=True)
    if len(key) != 32 or base64.b64encode(key).decode() != request["key"]:
        raise EnrollmentRejected()
    manifest = request["manifest"].encode("utf-8")
    if (
        len(manifest) > 32768
        or hashlib.sha256(manifest).hexdigest() != payload["manifest_sha256"]
    ):
        raise EnrollmentRejected()
    parsed = json.loads(manifest)
    if (
        not isinstance(parsed, dict)
        or set(parsed) != {"format", "node_major", "entrypoint", "files"}
        or type(parsed["format"]) is not int
        or parsed["format"] != 1
        or parsed["node_major"] != 22
        or not isinstance(parsed["files"], list)
    ):
        raise EnrollmentRejected()
    records = {}
    for entry in parsed["files"]:
        if (
            not isinstance(entry, dict)
            or set(entry) != {"path", "size", "sha256"}
            or not isinstance(entry["path"], str)
            or entry["path"] in records
        ):
            raise EnrollmentRejected()
        records[entry["path"]] = entry
    entrypoint = parsed["entrypoint"]
    if not isinstance(entrypoint, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_.-]*\.cjs", entrypoint
    ):
        raise EnrollmentRejected()
    allowed = {
        entrypoint,
        *("target-helper/" + name for name in HELPERS | {"target_enrollment.py"}),
        "templates/express.Dockerfile",
        "templates/nextjs.Dockerfile",
        "templates/static-spa.Dockerfile",
        "templates/docker-compose.template.yml",
        "collector/Dockerfile",
        "collector/collect.py",
        "collector/requirements.txt",
    }
    if set(records) != allowed:
        raise EnrollmentRejected()
    for record in records.values():
        if (
            not _positive(record["size"])
            or record["size"] > 8 * 1024 * 1024
            or not isinstance(record["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
        ):
            raise EnrollmentRejected()
    if sum(record["size"] for record in records.values()) > 16 * 1024 * 1024:
        raise EnrollmentRejected()
    helpers = request["helpers"]
    expected = HELPERS if request["operation"] == "enroll" else set()
    if not isinstance(helpers, dict) or set(helpers) != expected:
        raise EnrollmentRejected()
    decoded = {}
    for name in HELPERS:
        record = records.get("target-helper/" + name)
        if (
            not record
            or not _positive(record["size"])
            or record["size"] > 512 * 1024
            or not isinstance(record["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
        ):
            raise EnrollmentRejected()
        if name in helpers:
            value = base64.b64decode(helpers[name], validate=True)
            if (
                len(value) != record["size"]
                or hashlib.sha256(value).hexdigest() != record["sha256"]
            ):
                raise EnrollmentRejected()
            decoded[name] = value
    return payload, key, manifest, decoded, final, slot


def _inspect(final: Path, payload: dict, key: bytes, manifest: bytes) -> dict:
    _private_dir(final)
    for directory in [final / "helpers", final / "state", final / "state/locks"]:
        _private_dir(directory)
    if set(os.listdir(final)) != {
        "helpers",
        "state",
        "enrollment.json",
        "release-manifest.json",
    }:
        raise EnrollmentRejected()
    if set(os.listdir(final / "helpers")) != HELPERS or any(
        (final / "state").glob(".marker-*")
    ):
        raise EnrollmentRejected()
    if _read(final / "release-manifest.json", 32768) != manifest:
        raise EnrollmentRejected()
    app_hash = hashlib.sha256(str(payload["app_id"]).encode()).hexdigest()
    stored_key = _read(
        final / "state" / f"h2-{app_hash}-g{payload['ownership_generation']}.key", 32
    )
    if not hmac.compare_digest(stored_key, key):
        raise EnrollmentRejected()
    marker = json.loads(_read(final / "state" / (app_hash + ".json"), 65536))
    if (
        not isinstance(marker, dict)
        or set(marker) != MARKER_KEYS
        or type(marker["format"]) is not int
        or marker["format"] != 1
        or marker["controller_id"] != payload["controller_id"]
        or marker["app_id"] != str(payload["app_id"])
        or type(marker["ownership_generation"]) is not int
        or marker["ownership_generation"] != payload["ownership_generation"]
        or type(marker["highest_accepted_fence"]) is not int
        or marker["highest_accepted_fence"] < 0
        or marker["highest_accepted_fence"] > 9007199254740991
        or marker["execution_state"] not in {"idle", "unknown"}
    ):
        raise EnrollmentRejected()
    for name in ["last_claim_id", "last_attempt_id"]:
        if marker[name] is not None and (
            not isinstance(marker[name], str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", marker[name])
        ):
            raise EnrollmentRejected()
    records = {item["path"]: item for item in json.loads(manifest)["files"]}
    for name in HELPERS:
        content = _read(final / "helpers" / name, 512 * 1024)
        record = records["target-helper/" + name]
        if (
            len(content) != record["size"]
            or hashlib.sha256(content).hexdigest() != record["sha256"]
        ):
            raise EnrollmentRejected()
    proof = json.loads(_read(final / "enrollment.json", 16384))
    expected = _proof(payload, stored_key)
    if (
        not isinstance(proof, dict)
        or set(proof) != {"payload", "signature"}
        or proof["payload"] != payload
        or not isinstance(proof["signature"], str)
        or not hmac.compare_digest(proof["signature"], expected["signature"])
    ):
        raise EnrollmentRejected()
    return {"state": "enrolled", "proof": proof}


def handle(request: object) -> dict:
    payload, key, manifest, helpers, final, slot = _validate(request)
    base = final.parent
    install = request["operation"] == "enroll"
    if not _base(base, install):
        return {"state": "absent"}
    lock_path = base / (".enroll-" + slot + ".lock")
    if not install and not os.path.lexists(lock_path):
        if os.path.lexists(final) or any(base.glob(".stage-" + slot + "-*")):
            raise EnrollmentRejected()
        return {"state": "absent"}
    fd = os.open(
        lock_path,
        (os.O_RDWR | os.O_CREAT if install else os.O_RDONLY) | os.O_NOFOLLOW,
        0o600,
    )
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.geteuid()
            or info.st_nlink != 1
            or info.st_mode & 0o077
            or info.st_size
        ):
            raise EnrollmentRejected()
        try:
            fcntl.flock(
                fd, (fcntl.LOCK_EX if install else fcntl.LOCK_SH) | fcntl.LOCK_NB
            )
        except BlockingIOError:
            raise EnrollmentRejected("TARGET_ENROLLMENT_BUSY") from None
        if any(base.glob(".stage-" + slot + "-*")):
            raise EnrollmentRejected("TARGET_ENROLLMENT_UNCERTAIN")
        if os.path.lexists(final):
            return _inspect(final, payload, key, manifest)
        if not install:
            return {"state": "absent"}
        _sync(base)
        stage = base / (".stage-" + slot + "-" + uuid.uuid4().hex)
        stage.mkdir(mode=0o700)
        try:
            (stage / "helpers").mkdir(mode=0o700)
            (stage / "state").mkdir(mode=0o700)
            (stage / "state/locks").mkdir(mode=0o700)
            for name, value in helpers.items():
                _write(stage / "helpers" / name, value)
            app_hash = hashlib.sha256(str(payload["app_id"]).encode()).hexdigest()
            marker = {
                "format": 1,
                "controller_id": payload["controller_id"],
                "app_id": str(payload["app_id"]),
                "ownership_generation": payload["ownership_generation"],
                "highest_accepted_fence": 0,
                "last_claim_id": None,
                "last_attempt_id": None,
                "execution_state": "idle",
            }
            _write(stage / "state" / (app_hash + ".json"), _canonical(marker))
            _write(
                stage
                / "state"
                / f"h2-{app_hash}-g{payload['ownership_generation']}.key",
                key,
            )
            _write(stage / "release-manifest.json", manifest)
            _write(stage / "enrollment.json", _canonical(_proof(payload, key)))
            for directory in [
                stage / "helpers",
                stage / "state/locks",
                stage / "state",
                stage,
            ]:
                _sync(directory)
            _publish(stage, final)
            _sync(base)
        finally:
            if os.path.lexists(stage):
                _private_dir(stage)
                shutil.rmtree(stage)
        return _inspect(final, payload, key, manifest)
    finally:
        os.close(fd)


def main() -> int:
    os.umask(0o077)
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise EnrollmentRejected()
        response = handle(json.loads(raw))
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # noqa: BLE001 -- Biên CLI phải khử mọi lỗi, không lộ payload/key qua traceback.
        code = (
            error.code
            if isinstance(error, EnrollmentRejected)
            else "TARGET_ENROLLMENT_REJECTED"
        )
        print(json.dumps({"state": "rejected", "code": code}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
