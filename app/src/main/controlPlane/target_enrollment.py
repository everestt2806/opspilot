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
from contextlib import contextmanager
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
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
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


UPGRADE_DOMAIN = b"opspilot-target-helper-upgrade-outcome-v1\n"
JOURNAL_DOMAIN = b"opspilot-target-helper-upgrade-journal-v1\n"
DECISION_DOMAIN = b"opspilot-target-helper-upgrade-decision-v1\n"
UPGRADE_OPERATIONS = {"upgrade", "inspect-upgrade", "recover-upgrade", "cancel-upgrade"}
RUNTIME_BEFORE = {
    (85494, "9f8e1fbb6fab90e9266e160b9cbbcec9707c36f455e1962b8462699f03720f1a"): {
        "express", "static-spa", "nextjs"
    },
    (51419, "f591e2f4bd8b1a770204af8645c499ba05955090a32464c1ae5c32dd37443cb5"): {
        "express", "static-spa", "nextjs"
    },
    (46765, "eb5c697e0051f38e0633bc84e32377fbc91cf4b825c21734f5f611a49b85908d"): {
        "express"
    },
    (47340, "98b0edec5ffb29a114e411d067a551a9a90110cdcf5872ab31dee5246f3e10ff"): {
        "express",
        "static-spa",
        "nextjs",
    },
}
RUNTIME_AFTER = (
    51419,
    "f591e2f4bd8b1a770204af8645c499ba05955090a32464c1ae5c32dd37443cb5",
)
POSTGRES_RUNTIME_AFTER = (
    85494,
    "9f8e1fbb6fab90e9266e160b9cbbcec9707c36f455e1962b8462699f03720f1a",
)
POSTGRES_IO_RUNTIME_AFTER = (
    85777,
    "95cc98a0fe3692193e66f034ac8bdb8a0e7541e9ee4c5c75b472e18ed37fc343",
)
PINNED_GUARDS = {
    "target_execution_guard.py": (
        19634,
        "3cadd020a5cfc5a784bd4c62fc7b887ea62b0094a921fc30a8177622090b222f",
    ),
    "target_guarded_ssh_helper.py": (
        48202,
        "4b06a70b3274708f7af3284683df32da81c1107877f7c1313158fcc31206b0e7",
    ),
}


def _signed(payload: dict, key: bytes, domain: bytes) -> dict:
    return {
        "payload": payload,
        "signature": hmac.new(
            key, domain + _canonical(payload), hashlib.sha256
        ).hexdigest(),
    }


def _authenticated(raw: bytes, key: bytes, domain: bytes) -> dict:
    value = json.loads(raw)
    if (
        not isinstance(value, dict)
        or set(value) != {"payload", "signature"}
        or not isinstance(value["payload"], dict)
        or not isinstance(value["signature"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", value["signature"])
        or not hmac.compare_digest(
            value["signature"], _signed(value["payload"], key, domain)["signature"]
        )
    ):
        raise EnrollmentRejected("TARGET_HELPER_UPGRADE_JOURNAL_INVALID")
    return value["payload"]


@contextmanager
def _upgrade_lock(path: Path, create: bool = False):
    fd = os.open(
        path,
        os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_CREAT if create else 0),
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
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_LOCK_INVALID")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_BUSY") from None
        yield
    finally:
        os.close(fd)


def _upgrade_validate(request: dict):
    if set(request) != {
        "format",
        "operation",
        "request_key",
        "review_sha256",
        "framework",
        "key",
        "from",
        "to",
    }:
        raise EnrollmentRejected()
    if (
        type(request["format"]) is not int
        or request["format"] != 1
        or request["operation"] not in UPGRADE_OPERATIONS
        or not isinstance(request["request_key"], str)
        or not re.fullmatch(
            r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}",
            request["request_key"],
        )
        or not isinstance(request["review_sha256"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", request["review_sha256"])
        or request["framework"] not in {"express", "static-spa", "nextjs"}
        or not isinstance(request["from"], dict)
        or set(request["from"]) != {"payload", "manifest"}
        or not isinstance(request["to"], dict)
        or set(request["to"]) != {"payload", "manifest", "helpers"}
    ):
        raise EnrollmentRejected()
    old = _validate(
        {
            "format": 1,
            "operation": "inspect",
            "key": request["key"],
            **request["from"],
            "helpers": {},
        }
    )
    new = _validate(
        {"format": 1, "operation": "enroll", "key": request["key"], **request["to"]}
    )
    before, key, _, _, final, slot = old
    after = new[0]
    if {**before, "manifest_sha256": after["manifest_sha256"]} != after or before[
        "manifest_sha256"
    ] == after["manifest_sha256"]:
        raise EnrollmentRejected("TARGET_HELPER_UPGRADE_BINDING_REJECTED")
    records = [
        {entry["path"]: entry for entry in json.loads(item[2])["files"]}
        for item in (old, new)
    ]
    runtime = "target-helper/target_product_runtime.py"
    pair = lambda record: (record["size"], record["sha256"])
    ordered = [
        (46765, "eb5c697e0051f38e0633bc84e32377fbc91cf4b825c21734f5f611a49b85908d"),
        (47340, "98b0edec5ffb29a114e411d067a551a9a90110cdcf5872ab31dee5246f3e10ff"),
        RUNTIME_AFTER, POSTGRES_RUNTIME_AFTER, POSTGRES_IO_RUNTIME_AFTER,
    ]
    before_pin, after_pin = pair(records[0][runtime]), pair(records[1][runtime])
    if (
        request["framework"] not in RUNTIME_BEFORE.get(before_pin, set())
        or after_pin not in {RUNTIME_AFTER, POSTGRES_RUNTIME_AFTER, POSTGRES_IO_RUNTIME_AFTER}
        or before_pin not in ordered or ordered.index(before_pin) >= ordered.index(after_pin)
    ):
        raise EnrollmentRejected("TARGET_HELPER_UPGRADE_TRANSITION_REJECTED")
    for name, pin in PINNED_GUARDS.items():
        if any(pair(record["target-helper/" + name]) != pin for record in records):
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_TRANSITION_REJECTED")
    descriptor = {
        "format": 1,
        "purpose": "product-target-helper-upgrade-journal",
        "request_key": request["request_key"],
        "review_sha256": request["review_sha256"],
        "framework": request["framework"],
        "from": before,
        "to": after,
    }
    return old, new, descriptor, key, final, slot


def _upgrade_state(final: Path, payload: dict, key: bytes) -> bytes:
    for directory in [final, final / "helpers", final / "state", final / "state/locks"]:
        _private_dir(directory)
    if (
        set(os.listdir(final))
        != {"helpers", "state", "enrollment.json", "release-manifest.json"}
        or set(os.listdir(final / "helpers")) != HELPERS
    ):
        raise EnrollmentRejected()
    app_hash = hashlib.sha256(str(payload["app_id"]).encode()).hexdigest()
    if not hmac.compare_digest(
        _read(
            final / "state" / f"h2-{app_hash}-g{payload['ownership_generation']}.key",
            32,
        ),
        key,
    ):
        raise EnrollmentRejected()
    raw = _read(final / "state" / (app_hash + ".json"), 65536)
    marker = json.loads(raw)
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
        or not 0 <= marker["highest_accepted_fence"] <= 9007199254740991
        or marker["execution_state"] != "idle"
        or any((final / "state").glob(".marker-*"))
    ):
        raise EnrollmentRejected("TARGET_HELPER_UPGRADE_RUNTIME_UNKNOWN")
    for name in ["last_claim_id", "last_attempt_id"]:
        if marker[name] is not None and (
            not isinstance(marker[name], str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", marker[name])
        ):
            raise EnrollmentRejected()
    for name, pin in PINNED_GUARDS.items():
        value = _read(final / "helpers" / name, 512 * 1024)
        if (len(value), hashlib.sha256(value).hexdigest()) != pin:
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_TRANSITION_REJECTED")
    return raw


def _upgrade_replace(journal: Path, destination: Path, value: bytes) -> None:
    temporary = journal / (".write-" + uuid.uuid4().hex)
    _write(temporary, value)
    os.replace(temporary, destination)
    _sync(destination.parent)
    _sync(journal)


def _upgrade_outcome(
    request: dict, old, new, marker: bytes, state: str, settled: bool = False
) -> dict:
    selected = new if state == "applied" else old
    proof = _proof(selected[0], selected[1]) if state != "pending" else None
    payload = {
        "format": 1,
        "purpose": "product-target-helper-upgrade-outcome",
        "request_key": request["request_key"],
        "review_sha256": request["review_sha256"],
        "controller_id": old[0]["controller_id"],
        "app_id": old[0]["app_id"],
        "ownership_generation": old[0]["ownership_generation"],
        "from_manifest_sha256": old[0]["manifest_sha256"],
        "to_manifest_sha256": new[0]["manifest_sha256"],
        "state": state,
        "settled": settled,
        "marker_sha256": hashlib.sha256(marker).hexdigest(),
        "enrollment_proof_sha256": hashlib.sha256(_canonical(proof)).hexdigest()
        if proof
        else None,
    }
    return {
        "state": state,
        "receipt": _signed(payload, old[1], UPGRADE_DOMAIN),
        "proof": proof,
    }


def _handle_upgrade(request: dict) -> dict:
    old, new, descriptor, key, final, slot = _upgrade_validate(request)
    base = final.parent
    if not _base(base, False):
        raise EnrollmentRejected("TARGET_HELPER_UPGRADE_NOT_ENROLLED")
    _private_dir(final)
    _private_dir(final / "state")
    _private_dir(final / "state/locks")
    app_hash = hashlib.sha256(str(old[0]["app_id"]).encode()).hexdigest()
    journal = base / (".upgrade-" + slot + "-" + request["request_key"])
    operation = request["operation"]
    with (
        _upgrade_lock(base / (".enroll-" + slot + ".lock")),
        _upgrade_lock(
            final / "state/locks" / (app_hash + ".lock"), operation != "inspect-upgrade"
        ),
    ):
        marker = _upgrade_state(final, old[0], key)
        marker_hash = hashlib.sha256(marker).hexdigest()
        if not os.path.lexists(journal):
            _inspect(final, old[0], key, old[2])
            if operation in {"inspect-upgrade", "recover-upgrade"}:
                return _upgrade_outcome(request, old, new, marker, "not_applied")
            if operation == "upgrade" and any(
                base.glob(
                    ".upgrade-stage-" + slot + "-" + request["request_key"] + "-*"
                )
            ):
                raise EnrollmentRejected("TARGET_HELPER_UPGRADE_UNCERTAIN")
            for previous in base.glob(".upgrade-" + slot + "-*"):
                _private_dir(previous)
                try:
                    terminal = _authenticated(
                        _read(previous / "terminal.json", 16384), key, UPGRADE_DOMAIN
                    )
                except FileNotFoundError:
                    raise EnrollmentRejected(
                        "TARGET_HELPER_UPGRADE_UNCERTAIN"
                    ) from None
                if (
                    terminal.get("state") not in {"applied", "not_applied"}
                    or terminal.get("controller_id") != old[0]["controller_id"]
                    or terminal.get("app_id") != old[0]["app_id"]
                    or terminal.get("ownership_generation")
                    != old[0]["ownership_generation"]
                    or terminal.get("purpose")
                    != "product-target-helper-upgrade-outcome"
                    or terminal.get("format") != 1
                    or terminal.get("settled") is not True
                    or previous.name
                    != ".upgrade-" + slot + "-" + str(terminal.get("request_key"))
                ):
                    raise EnrollmentRejected("TARGET_HELPER_UPGRADE_UNCERTAIN")
            stage = base / (
                ".upgrade-stage-"
                + slot
                + "-"
                + request["request_key"]
                + "-"
                + uuid.uuid4().hex
            )
            stage.mkdir(mode=0o700)
            before_receipt = _read(final / "enrollment.json", 16384)
            initial = {
                **descriptor,
                "marker_sha256": marker_hash,
                "before_receipt_sha256": hashlib.sha256(before_receipt).hexdigest(),
            }
            try:
                entries = {
                    "intent.json": _canonical(_signed(initial, key, JOURNAL_DOMAIN)),
                    "before-runtime": _read(
                        final / "helpers/target_product_runtime.py", 512 * 1024
                    ),
                    "after-runtime": new[3]["target_product_runtime.py"],
                    "before-manifest": old[2],
                    "after-manifest": new[2],
                    "before-receipt": before_receipt,
                    "after-receipt": _canonical(_proof(new[0], key)),
                    "decision.json": _canonical(
                        _signed(
                            {
                                "request_key": request["request_key"],
                                "intent_sha256": hashlib.sha256(
                                    _canonical(initial)
                                ).hexdigest(),
                                "decision": "cancel"
                                if operation == "cancel-upgrade"
                                else "apply",
                            },
                            key,
                            DECISION_DOMAIN,
                        )
                    ),
                }
                for name, value in entries.items():
                    _write(stage / name, value)
                _sync(stage)
                _publish(stage, journal)
                _sync(base)
            finally:
                if os.path.lexists(stage):
                    _private_dir(stage)
                    shutil.rmtree(stage)
            fresh = True
        else:
            fresh = False
        _private_dir(journal)
        allowed = {
            "intent.json",
            "before-runtime",
            "after-runtime",
            "before-manifest",
            "after-manifest",
            "before-receipt",
            "after-receipt",
            "decision.json",
            "terminal.json",
        }
        if any(
            name not in allowed and not re.fullmatch(r"\.write-[a-f0-9]{32}", name)
            for name in os.listdir(journal)
        ):
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_JOURNAL_INVALID")
        intent = _authenticated(
            _read(journal / "intent.json", 32768), key, JOURNAL_DOMAIN
        )
        if (
            set(intent) != set(descriptor) | {"marker_sha256", "before_receipt_sha256"}
            or {name: intent[name] for name in descriptor} != descriptor
            or any(
                not isinstance(intent[name], str)
                or not re.fullmatch(r"[a-f0-9]{64}", intent[name])
                for name in ["marker_sha256", "before_receipt_sha256"]
            )
        ):
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_JOURNAL_INVALID")
        before_values = [
            _read(journal / name, cap)
            for name, cap in [
                ("before-runtime", 512 * 1024),
                ("before-manifest", 32768),
                ("before-receipt", 16384),
            ]
        ]
        after_values = [
            _read(journal / name, cap)
            for name, cap in [
                ("after-runtime", 512 * 1024),
                ("after-manifest", 32768),
                ("after-receipt", 16384),
            ]
        ]
        if (
            before_values[1] != old[2]
            or after_values[1] != new[2]
            or after_values[0] != new[3]["target_product_runtime.py"]
            or hashlib.sha256(before_values[2]).hexdigest()
            != intent["before_receipt_sha256"]
            or json.loads(before_values[2]) != _proof(old[0], key)
            or after_values[2] != _canonical(_proof(new[0], key))
        ):
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_JOURNAL_INVALID")
        old_runtime = next(
            entry
            for entry in json.loads(old[2])["files"]
            if entry["path"] == "target-helper/target_product_runtime.py"
        )
        if (
            len(before_values[0]) != old_runtime["size"]
            or hashlib.sha256(before_values[0]).hexdigest() != old_runtime["sha256"]
        ):
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_JOURNAL_INVALID")
        decision = _authenticated(
            _read(journal / "decision.json", 16384), key, DECISION_DOMAIN
        )
        if (
            set(decision) != {"request_key", "intent_sha256", "decision"}
            or decision["request_key"] != request["request_key"]
            or decision["intent_sha256"]
            != hashlib.sha256(_canonical(intent)).hexdigest()
            or decision["decision"] not in {"apply", "cancel"}
        ):
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_JOURNAL_INVALID")
        destinations = [
            final / "helpers/target_product_runtime.py",
            final / "release-manifest.json",
            final / "enrollment.json",
        ]
        actual = [
            _read(path, cap)
            for path, cap in zip(destinations, [512 * 1024, 32768, 16384])
        ]
        if any(
            value not in (before, after)
            for value, before, after in zip(actual, before_values, after_values)
        ):
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_TARGET_CHANGED")
        complete = (
            actual == after_values
            if decision["decision"] == "apply"
            else actual == before_values
        )
        if not complete and marker_hash != intent["marker_sha256"]:
            raise EnrollmentRejected("TARGET_HELPER_UPGRADE_RUNTIME_CHANGED")
        if os.path.lexists(journal / "terminal.json"):
            terminal = _authenticated(
                _read(journal / "terminal.json", 16384), key, UPGRADE_DOMAIN
            )
            state = (
                ("applied" if decision["decision"] == "apply" else "not_applied")
                if complete
                else "pending"
            )
            expected = _upgrade_outcome(request, old, new, marker, state, complete)[
                "receipt"
            ]["payload"]
            if (
                not complete
                or {**terminal, "marker_sha256": marker_hash} != expected
                or not isinstance(terminal.get("marker_sha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", terminal["marker_sha256"])
            ):
                raise EnrollmentRejected("TARGET_HELPER_UPGRADE_JOURNAL_INVALID")
        can_write = fresh or operation in {"recover-upgrade", "cancel-upgrade"}
        if operation == "cancel-upgrade" and not (
            decision["decision"] == "apply" and actual == after_values
        ):
            if decision["decision"] != "cancel":
                decision = {**decision, "decision": "cancel"}
                _upgrade_replace(
                    journal,
                    journal / "decision.json",
                    _canonical(_signed(decision, key, DECISION_DOMAIN)),
                )
            complete = actual == before_values
        if can_write:
            desired = after_values if decision["decision"] == "apply" else before_values
            for path, value, previous in zip(destinations, desired, actual):
                if previous != value:
                    _upgrade_replace(journal, path, value)
            actual = desired
            complete = True
        state = (
            ("applied" if decision["decision"] == "apply" else "not_applied")
            if complete
            else "pending"
        )
        if state != "pending":
            selected = new if state == "applied" else old
            _inspect(final, selected[0], key, selected[2])
        response = _upgrade_outcome(request, old, new, marker, state, complete)
        if (
            can_write
            and state != "pending"
            and not os.path.lexists(journal / "terminal.json")
        ):
            _upgrade_replace(
                journal, journal / "terminal.json", _canonical(response["receipt"])
            )
        return response


def handle(request: object) -> dict:
    if isinstance(request, dict) and request.get("operation") in UPGRADE_OPERATIONS:
        return _handle_upgrade(request)
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
