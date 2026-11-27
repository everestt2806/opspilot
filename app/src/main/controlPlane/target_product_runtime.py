"""Runtime Product trong cùng guarded execution; không API mạng hoặc raw shell.

Chỉ enrollment lab chủ động cấp khóa. Receipt không cấp quyền replay mutation.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import stat
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from target_execution_guard import (
    ExecutionIdentity,
    GuardedExecution,
    TargetGuardError,
    _identity_key,
    _read_marker,
    _write_marker_atomic,
)

_CONTEXT_KEYS = {"version", "execution_nonce", "claim", "target", "deployment_id", "source_sha",
                 "app_name", "host_port", "container_port", "healthcheck_path", "candidate_image_tag",
                 "candidate_image_id", "build_state", "previous", "activation_id", "health_timeout_ms",
                 "exposure_policy"}
_CLAIM_KEYS = {"controller_id", "app_id", "job_id", "attempt_id", "attempt_number",
               "ownership_generation", "source_generation", "source_config_sha256", "app_lease_id",
               "app_fence", "build_slot_lease_id", "build_slot_fence", "expires_at"}
_TARGET_KEYS = {"vps_id", "host", "port", "host_fingerprint", "username", "auth_type", "ssh_security_revision"}
_COMMIT_KEYS = {"version", "kind", "commit_id", "receipt_sha256", "context_sha256", "execution_nonce",
                "attempt_id", "deployment_id", "outcome"}
_SHA = re.compile(r"[0-9a-f]{40}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
_CID = re.compile(r"[0-9a-f]{64}\Z")
_IDENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
_NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,62}\Z")
_TAG = re.compile(r"[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+\Z")
_STEPS = {"prepare", "activate", "health", "rollback", "publish"}


class RuntimeRejected(Exception):
    def __init__(self, code: str = "SSH_RUNTIME_REJECTED"):
        self.code = code
        super().__init__(code)


class RuntimeUnknown(RuntimeRejected):
    def __init__(self, code: str = "SSH_RUNTIME_UNKNOWN"):
        super().__init__(code)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _positive(value: Any) -> bool:
    return type(value) is int and 0 < value <= 9007199254740991


def _match(pattern: re.Pattern[str], value: Any) -> bool:
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _plain(value: Any) -> bool:
    if value is None or type(value) in {str, int, bool}:
        return type(value) is not int or abs(value) <= 9007199254740991
    if isinstance(value, list):
        return all(_plain(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and key.isascii() and _plain(item) for key, item in value.items())
    return False


def canonical_json(value: Any) -> bytes:
    if not _plain(value):
        raise RuntimeRejected()
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def hash_h2(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def sign_h2(secret: bytes, domain: str, payload: Any) -> str:
    if len(secret) != 32:
        raise RuntimeRejected()
    return hmac.new(secret, domain.encode("ascii") + b"\n" + canonical_json(payload), hashlib.sha256).hexdigest()


def verify_h2(secret: bytes, domain: str, payload: Any, signature: Any) -> bool:
    return _match(_HASH, signature) and hmac.compare_digest(sign_h2(secret, domain, payload), signature)


def _private_directory(path: Path, create: bool = False) -> None:
    if create and not path.exists():
        _private_directory(path.parent)
        path.mkdir(mode=0o700)
    try:
        info = path.lstat()
        if path.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise RuntimeRejected()
    except OSError:
        raise RuntimeRejected() from None


def _metrics_directory(app_name: str) -> Path:
    """Theo metric-format; giữ quyền thư mục sẵn có, chặn symlink và writer lạ."""
    base = Path('/opt/opspilot')
    app = base / app_name
    metrics = app / 'metrics'
    for path in (base, app, metrics):
        try:
            if not path.exists() and not path.is_symlink():
                path.mkdir(mode=0o755)
            info = path.lstat()
            allowed_owners = {0, os.geteuid()} if path == base else {os.geteuid()}
            if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                or info.st_uid not in allowed_owners or info.st_mode & 0o022):
                raise RuntimeRejected()
        except OSError:
            raise RuntimeRejected() from None
    return metrics


def _read_private(path: Path, limit: int = 64 * 1024) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > limit:
                raise RuntimeRejected()
            data = source.read(limit + 1)
            if len(data) > limit:
                raise RuntimeRejected()
            return data
    except OSError:
        raise RuntimeRejected() from None


def _write_private(path: Path, value: Any) -> None:
    _private_directory(path.parent)
    data = canonical_json(value)
    if len(data) > 64 * 1024:
        raise RuntimeRejected()
    fd, temp_name = tempfile.mkstemp(prefix=".h2-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        if path.is_symlink():
            raise RuntimeRejected()
        os.replace(temp_name, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            Path(temp_name).unlink()
        except FileNotFoundError:
            pass


def _secret_path(root: Path, identity: ExecutionIdentity) -> Path:
    return root / f"h2-{_identity_key(identity.controller_id, identity.app_id)}-g{identity.ownership_generation}.key"


def initialize_runtime_enrollment(root: str | Path, controller_id: str, app_id: str,
                                  generation: int, secret: bytes) -> Path:
    """Chỉ fixture/enrollment lab tường minh; không nhận qua wire execution."""
    identity = ExecutionIdentity(controller_id, app_id, generation, "init", "init", 1)
    identity.validate()
    root = Path(root)
    _private_directory(root)
    marker = _read_marker(root / f"{_identity_key(controller_id, app_id)}.json")
    if (marker["controller_id"] != controller_id or marker["app_id"] != app_id
        or marker["ownership_generation"] != generation or len(secret) != 32):
        raise RuntimeRejected()
    path = _secret_path(root, identity)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "wb") as target:
            os.fchmod(target.fileno(), 0o600)
            target.write(secret)
            target.flush()
            os.fsync(target.fileno())
    except OSError:
        raise RuntimeRejected("SSH_RUNTIME_ALREADY_ENROLLED") from None
    return path


def validate_context(context: Any, identity: ExecutionIdentity, deployment_id: int) -> dict[str, Any]:
    if (not isinstance(context, dict) or not _CONTEXT_KEYS <= set(context)
        or not set(context) <= _CONTEXT_KEYS | {"environment", "database"} or context.get("version") != 1):
        raise RuntimeRejected()
    if not _plain(context):
        raise RuntimeRejected()
    claim, target = context.get("claim"), context.get("target")
    if not isinstance(claim, dict) or set(claim) != _CLAIM_KEYS or not isinstance(target, dict) or set(target) != _TARGET_KEYS:
        raise RuntimeRejected()
    for field in ("controller_id", "job_id", "attempt_id", "app_lease_id", "build_slot_lease_id"):
        if not _match(_IDENT, claim[field]):
            raise RuntimeRejected()
    for field in ("app_id", "attempt_number", "ownership_generation", "source_generation", "app_fence", "build_slot_fence"):
        if not _positive(claim[field]):
            raise RuntimeRejected()
    if (claim["controller_id"] != identity.controller_id or str(claim["app_id"]) != identity.app_id
        or claim["job_id"] != identity.claim_id or claim["attempt_id"] != identity.attempt_id
        or claim["ownership_generation"] != identity.ownership_generation or claim["app_fence"] != identity.app_fence
        or not _match(_HASH, claim["source_config_sha256"]) or not isinstance(claim["expires_at"], str)
        or context["deployment_id"] != deployment_id or not _positive(deployment_id)
        or not _match(_IDENT, context["execution_nonce"]) or not _match(_SHA, context["source_sha"])
        or not _match(_NAME, context["app_name"]) or not _match(_TAG, context["candidate_image_tag"])
        or not _positive(context["host_port"]) or context["host_port"] > 65535
        or not _positive(context["container_port"]) or context["container_port"] > 65535
        or not isinstance(context["healthcheck_path"], str)
        or re.fullmatch(r"/[A-Za-z0-9_./-]{0,127}", context["healthcheck_path"]) is None
        or ".." in context["healthcheck_path"]
        or not _positive(context["health_timeout_ms"]) or context["health_timeout_ms"] > 60_000
        or context["exposure_policy"] != "not_checked"):
        raise RuntimeRejected()
    if "environment" in context:
        ref = context["environment"]
        if (not isinstance(ref, dict) or set(ref) != {"controller_id", "ownership_generation", "revision"}
            or ref.get("controller_id") != claim["controller_id"]
            or ref.get("ownership_generation") != claim["ownership_generation"] or not _positive(ref.get("revision"))):
            raise RuntimeRejected()
    if "database" in context:
        ref = context["database"]
        if (not isinstance(ref, dict) or set(ref) != {"controller_id", "ownership_generation", "database_id"}
            or ref.get("controller_id") != claim["controller_id"]
            or ref.get("ownership_generation") != claim["ownership_generation"] or not _match(_UUID, ref.get("database_id"))):
            raise RuntimeRejected()
    for field in ("vps_id", "port", "ssh_security_revision"):
        if not _positive(target[field]):
            raise RuntimeRejected()
    if (target["port"] > 65535 or target["auth_type"] not in {"key", "password"}
        or not isinstance(target["host"], str) or not 0 < len(target["host"]) <= 253
        or not isinstance(target["username"], str) or not 0 < len(target["username"]) <= 128
        or not isinstance(target["host_fingerprint"], str)
        or re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", target["host_fingerprint"]) is None):
        raise RuntimeRejected()
    if context["build_state"] == "build_succeeded":
        if not _match(_IMAGE, context["candidate_image_id"]) or not _positive(context["activation_id"]):
            raise RuntimeRejected()
    elif context["build_state"] == "build_failed_definite":
        if context["candidate_image_id"] is not None or context["activation_id"] is not None:
            raise RuntimeRejected()
    else:
        raise RuntimeRejected()
    previous = context["previous"]
    if previous is not None and (not isinstance(previous, dict)
        or set(previous) != {"deployment_id", "image_tag", "source_sha"}
        or not _positive(previous["deployment_id"]) or previous["deployment_id"] == deployment_id
        or not _match(_TAG, previous["image_tag"]) or not _match(_SHA, previous["source_sha"])):
        raise RuntimeRejected()
    return json.loads(canonical_json(context))


class DockerCommands:
    """Đọc theo chunk hữu hạn; timeout/oversize chỉ trả unknown, không raw log."""
    def __init__(self) -> None:
        self.active = False
        self.cancelled = threading.Event()

    def run(self, args: list[str], timeout: float = 10.0, capture: bool = True,
            input_bytes: bytes | None = None) -> str:
        if self.cancelled.is_set():
            raise RuntimeUnknown()
        if input_bytes is not None and (not isinstance(input_bytes, bytes) or len(input_bytes) > 64 * 1024):
            raise RuntimeRejected()
        self.active = True
        retained = bytearray()
        overflow = False
        read_failed = threading.Event()
        try:
            process = subprocess.Popen(["docker", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL)
            write_failed = threading.Event()
            def supply() -> None:
                try:
                    process.stdin.write(input_bytes)
                    process.stdin.flush()
                except (OSError, ValueError):
                    write_failed.set()
                finally:
                    try:
                        process.stdin.close()
                    except OSError:
                        write_failed.set()
            def drain() -> None:
                nonlocal overflow
                try:
                    while True:
                        chunk = process.stdout.read(4096)
                        if not chunk:
                            break
                        if capture:
                            if len(retained) + len(chunk) > 64 * 1024:
                                overflow = True
                            else:
                                retained.extend(chunk)
                except (OSError, ValueError):
                    read_failed.set()
                finally:
                    try:
                        process.stdout.close()
                    except OSError:
                        read_failed.set()
            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            writer = threading.Thread(target=supply, daemon=True) if input_bytes is not None else None
            if writer is not None:
                writer.start()
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
                raise RuntimeUnknown("SSH_RUNTIME_TIMEOUT") from None
            finally:
                reader.join(timeout=2)
                if writer is not None:
                    writer.join(timeout=2)
            if (reader.is_alive() or (writer is not None and writer.is_alive()) or write_failed.is_set()
                or read_failed.is_set() or overflow or self.cancelled.is_set()):
                raise RuntimeUnknown()
            if code != 0:
                raise RuntimeUnknown("SSH_RUNTIME_COMMAND_FAILED")
            return retained.decode("utf-8", errors="strict").strip() if capture else ""
        except (OSError, UnicodeError, subprocess.SubprocessError):
            raise RuntimeUnknown() from None
        finally:
            self.active = False

    def inspect(self, kind: str, reference: str) -> dict[str, Any]:
        try:
            values = json.loads(self.run([kind, "inspect", reference]))
            if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], dict):
                raise RuntimeUnknown()
            return values[0]
        except (ValueError, TypeError):
            raise RuntimeUnknown() from None

    def container(self, name: str) -> dict[str, Any] | None:
        ids = self.run(["ps", "-aq", "--no-trunc", "--filter", f"name=^/{name}$"]).splitlines()
        if not ids:
            return None
        if len(ids) != 1 or not _match(_CID, ids[0]):
            raise RuntimeUnknown()
        result = self.inspect("container", ids[0])
        if result.get("Name") != "/" + name:
            raise RuntimeUnknown()
        return result


def _config_hash(container: dict[str, Any], secret: bytes | None = None) -> str:
    # Chỉ digest ra wire; env/config có thể chứa secret chỉ ở bộ nhớ target.
    # Docker inspect does not promise Mounts order. Preserve every identity field,
    # but canonicalize enumeration before hashing so stop/re-inspect cannot drift.
    mounts = [{key: mount.get(key) for key in ("Type", "Source", "Destination", "RW")}
              for mount in container.get("Mounts", [])]
    payload = {"Config": container.get("Config"), "HostConfig": container.get("HostConfig"),
               "Mounts": sorted(mounts, key=canonical_json)}
    if any(isinstance(value, str) and value.startswith(("OPSPILOT_CONFIG_REVISION=", "OPSPILOT_DATABASE_ID="))
           for value in (container.get("Config", {}).get("Env") or [])):
        if not isinstance(secret, bytes) or len(secret) != 32:
            raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH")
        return hmac.new(secret, b"opspilot-env-config-fingerprint-v1\n" + canonical_json(payload), hashlib.sha256).hexdigest()
    return hash_h2(payload)


_POSTGRES_IMAGE = "postgres:16-alpine@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e"
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
_PG_PASSWORD = re.compile(r"[A-Za-z0-9_-]{43}\Z")
_NETWORK_NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,126}\Z")


class ManagedPostgres:
    """Tài nguyên độc lập deployment; caller phải giữ guarded app lock/fence.

    Chưa được nối vào dispatch khi chưa có gate schema/source/runtime tương ứng.
    Journal ký trước mutation; mất phản hồi create/DDL không được tự nhận tài nguyên.
    Không cung cấp lệnh xoá volume, đổi password hay restore trong deploy/rollback.
    """
    def __init__(self, root: Path, secret: bytes, identity: dict[str, Any],
                 credentials: dict[str, str], commands: DockerCommands, authorize: Any):
        required = {"controller_id", "app_id", "ownership_generation", "database_id", "target"}
        if (not isinstance(secret, bytes) or len(secret) != 32 or not isinstance(identity, dict)
            or set(identity) != required or not _match(_IDENT, identity.get("controller_id"))
            or not _positive(identity.get("app_id")) or not _positive(identity.get("ownership_generation"))
            or not _match(_UUID, identity.get("database_id")) or not isinstance(identity.get("target"), dict)
            or not isinstance(credentials, dict) or set(credentials) != {"admin_password", "app_password"}
            or any(not _match(_PG_PASSWORD, value) for value in credentials.values())
            or credentials["admin_password"] == credentials["app_password"] or not callable(authorize)):
            raise RuntimeRejected("SSH_POSTGRES_INPUT_INVALID")
        self.identity = json.loads(canonical_json(identity))
        self.credentials = dict(credentials)
        self.secret = secret
        self.commands = commands
        self.authorize = authorize
        self.root = Path(root)
        _private_directory(self.root)
        self.directory = self.root / ("postgres-" + identity["database_id"])
        self.name = "opspilot-pg-" + identity["database_id"]
        self.volume = self.name + "-data"
        self.labels = {"opspilot.controller_id": identity["controller_id"],
                       "opspilot.app_id": str(identity["app_id"]),
                       "opspilot.ownership_generation": str(identity["ownership_generation"]),
                       "opspilot.database_id": identity["database_id"],
                       "opspilot.resource": "managed-postgres-v1"}
        self.journal: dict[str, Any] | None = None

    def _reject(self) -> None:
        raise RuntimeUnknown("SSH_POSTGRES_IDENTITY_MISMATCH")

    def _mac(self, value: Any, domain: str = "opspilot-managed-postgres-journal-v1") -> str:
        return sign_h2(self.secret, domain, value)

    def _read(self, path: Path, limit: int = 16 * 1024) -> bytes:
        # O_NONBLOCK chặn FIFO trước khi fstat; hardlink không được làm alias secret.
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > limit):
                    self._reject()
                value = stream.read(limit + 1)
                if len(value) > limit:
                    self._reject()
                return value
        except OSError:
            self._reject()

    def _exclusive(self, path: Path, content: bytes) -> None:
        self.authorize()
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(fd, "wb") as target:
                os.fchmod(target.fileno(), 0o600)
                target.write(content)
                target.flush()
                os.fsync(target.fileno())
            self._sync_directory()
        except OSError:
            self._reject()

    def _sync_directory(self) -> None:
        fd = os.open(self.directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _credentials_mac(self) -> str:
        return self._mac({"identity": self.identity, "credentials": self.credentials},
                         "opspilot-managed-postgres-credentials-v1")

    def _save(self, **changes: Any) -> None:
        self.authorize()
        value = dict(self.journal or {})
        value.update(changes)
        self._validate_journal(value)
        signed = {"payload": value, "signature": self._mac(value)}
        if self.journal is None:
            self._exclusive(self.directory / "resource.json", canonical_json(signed))
        else:
            if self._load() != self.journal:
                self._reject()
            _write_private(self.directory / "resource.json", signed)
        self.journal = value

    def _validate_journal(self, value: Any) -> None:
        if (not isinstance(value, dict) or set(value) != {"format", "identity", "image", "image_id",
            "credentials_mac", "network", "network_id", "phase", "volume_created_at", "container_id", "system_identifier",
            "secret_mount_source", "container_config_sha256"}
            or value.get("format") != 1 or value.get("identity") != self.identity
            or value.get("image") != _POSTGRES_IMAGE or not _match(_IMAGE, value.get("image_id"))
            or value.get("credentials_mac") != self._credentials_mac()
            or not _match(_NETWORK_NAME, value.get("network"))
            or not _match(_CID, value.get("network_id"))
            or value.get("phase") not in {"planned", "volume", "container", "initializing", "ready"}):
            self._reject()
        phase = value["phase"]
        if phase != "planned":
            if not isinstance(value["volume_created_at"], str) or not 1 <= len(value["volume_created_at"]) <= 64:
                self._reject()
        elif value["volume_created_at"] is not None:
            self._reject()
        if phase in {"container", "initializing", "ready"}:
            if (not _match(_CID, value["container_id"]) or not _match(_HASH, value["container_config_sha256"])
                or not isinstance(value["secret_mount_source"], str)
                or re.fullmatch(r"/[A-Za-z0-9_./-]{1,1023}", value["secret_mount_source"]) is None
                or ".." in value["secret_mount_source"].split("/")):
                self._reject()
        elif any(value[k] is not None for k in ("container_id", "secret_mount_source", "container_config_sha256")):
            self._reject()
        if phase == "ready":
            if not isinstance(value["system_identifier"], str) or re.fullmatch(r"[0-9]{1,20}", value["system_identifier"]) is None:
                self._reject()
        elif value["system_identifier"] is not None:
            self._reject()

    def _load(self) -> dict[str, Any]:
        try:
            record = json.loads(self._read(self.directory / "resource.json"))
            if (not isinstance(record, dict) or set(record) != {"payload", "signature"}
                or not verify_h2(self.secret, "opspilot-managed-postgres-journal-v1", record["payload"], record["signature"])):
                self._reject()
            self._validate_journal(record["payload"])
            return record["payload"]
        except (ValueError, TypeError, KeyError, UnicodeError):
            self._reject()

    def _files(self) -> dict[str, bytes]:
        admin, app = self.credentials["admin_password"], self.credentials["app_password"]
        marker = "OPSPILOT_DATABASE_ID=" + self.identity["database_id"] + "\n"
        url = f"postgresql://opspilot:{app}@postgres:5432/opspilot"
        return {"admin_password": admin.encode("ascii"),
                "admin.pgpass": f"127.0.0.1:5432:*:postgres:{admin}\n".encode("ascii"),
                "app.pgpass": f"127.0.0.1:5432:opspilot:opspilot:{app}\n".encode("ascii"),
                "app.env": (marker + "DATABASE_URL=" + url + "\n").encode("ascii"),
                "collector.env": (marker + "DB_DSN=" + url + "\n").encode("ascii")}

    def _verify_files(self) -> None:
        expected = self._files()
        if {path.name for path in self.directory.iterdir()} != {*expected, "resource.json"}:
            self._reject()
        for name, content in expected.items():
            if not hmac.compare_digest(self._read(self.directory / name), content):
                self._reject()

    def _label_args(self) -> list[str]:
        return [part for key, value in self.labels.items() for part in ("--label", f"{key}={value}")]

    def _network(self, name: str) -> str:
        record = self.commands.inspect("network", name)
        labels = record.get("Labels") or {}
        if (record.get("Name") != name or not _match(_CID, record.get("Id"))
            or record.get("Driver") != "bridge" or record.get("Internal")
            or (self.journal is not None and record.get("Id") != self.journal["network_id"])
            or any(labels.get(key) != self.labels[key] for key in
                   ("opspilot.controller_id", "opspilot.app_id", "opspilot.ownership_generation"))):
            self._reject()
        for cid in (record.get("Containers") or {}):
            member = self.commands.inspect("container", cid)
            aliases = (member.get("NetworkSettings", {}).get("Networks", {}).get(name) or {}).get("Aliases") or []
            if "postgres" in aliases and (self.journal is None or cid != self.journal["container_id"]):
                raise RuntimeUnknown("SSH_POSTGRES_COLLISION")
        return record["Id"]

    def _volume(self) -> dict[str, Any]:
        value = self.commands.inspect("volume", self.volume)
        if (value.get("Name") != self.volume or value.get("Driver") != "local" or value.get("Options")
            or value.get("Labels") != self.labels or value.get("Scope") != "local"
            or (self.journal["volume_created_at"] is not None
                and value.get("CreatedAt") != self.journal["volume_created_at"])):
            self._reject()
        return value

    def _container(self) -> dict[str, Any]:
        value = self.commands.inspect("container", self.journal["container_id"])
        config, host = value.get("Config") or {}, value.get("HostConfig") or {}
        mounts = value.get("Mounts") or []
        data = [m for m in mounts if m.get("Destination") == "/var/lib/postgresql/data"]
        secrets = [m for m in mounts if m.get("Destination") == "/run/opspilot-secrets"]
        env = config.get("Env") or []
        if (value.get("Id") != self.journal["container_id"] or value.get("Name") != "/" + self.name
            or value.get("Image") != self.journal["image_id"] or config.get("Image") != _POSTGRES_IMAGE
            or {k: v for k, v in (config.get("Labels") or {}).items() if k.startswith("opspilot.")} != self.labels
            or self._container_config_mac(value) != self.journal["container_config_sha256"]
            or host.get("Privileged") or host.get("PublishAllPorts") or host.get("OomKillDisable") not in {None, False}
            or host.get("PortBindings") or host.get("NetworkMode") != self.journal["network"]
            or host.get("RestartPolicy") != {"Name": "unless-stopped", "MaximumRetryCount": 0}
            or host.get("Memory") != 256 * 1024 * 1024
            or host.get("PidMode") or host.get("IpcMode") not in {"private", ""}
            or len(mounts) != 2 or len(data) != 1 or len(secrets) != 1
            or data[0].get("Type") != "volume" or data[0].get("Name") != self.volume or data[0].get("RW") is not True
            or secrets[0].get("Type") != "bind" or secrets[0].get("Source") != self.journal["secret_mount_source"]
            or secrets[0].get("RW") is not False
            or "POSTGRES_PASSWORD_FILE=/run/opspilot-secrets/admin_password" not in env
            or "POSTGRES_USER=postgres" not in env or "POSTGRES_DB=postgres" not in env
            or any(v.startswith(("POSTGRES_PASSWORD=", "DATABASE_URL=", "DB_DSN=")) for v in env)
            or set((value.get("NetworkSettings") or {}).get("Networks") or {}) != {self.journal["network"]}
            or "postgres" not in (value.get("NetworkSettings", {}).get("Networks", {}).get(self.journal["network"], {}).get("Aliases") or [])):
            self._reject()
        return value

    def _container_config_mac(self, value: dict[str, Any]) -> str:
        mounts = [{key: mount.get(key) for key in ("Type", "Source", "Destination", "RW")}
                  for mount in value.get("Mounts", [])]
        host = dict(value.get("HostConfig") or {})
        # Docker29 chuyển null thành false sau start; cùng nghĩa bật OOM killer.
        # True không được chuẩn hoá và luôn bị từ chối bởi kiểm tra container.
        if host.get("OomKillDisable") is None:
            host["OomKillDisable"] = False
        return self._mac({"Config": value.get("Config"), "HostConfig": host,
                          "Mounts": sorted(mounts, key=canonical_json)}, "opspilot-managed-postgres-container-v1")

    def _mounted_credentials(self) -> None:
        # Docker Desktop có thể ánh xạ bind source. Pin config thực từ CID vừa tạo,
        # rồi đối chiếu byte file mount với secret đã xác thực ở target, chỉ trong RAM.
        # Không đưa stdout này qua wire/receipt/log hoặc dùng hash password công khai.
        for name in ("admin_password", "admin.pgpass", "app.pgpass"):
            value = self.commands.run(["exec", "-u", "0", self.journal["container_id"],
                                       "cat", "/run/opspilot-secrets/" + name])
            if not hmac.compare_digest(value, self._files()[name].decode("ascii").strip()):
                self._reject()

    def _psql(self, admin: bool, query: str, capture: bool = True, stdin: bytes | None = None) -> str:
        user = "postgres" if admin else "opspilot"
        database = "postgres" if admin else "opspilot"
        args = ["exec"] + (["-i"] if stdin is not None else [])
        args += ["-u", "0", "-e", "PGCONNECT_TIMEOUT=2", "-e",
                 "PGPASSFILE=/run/opspilot-secrets/" + ("admin.pgpass" if admin else "app.pgpass"),
                 self.journal["container_id"], "psql", "-X", "--no-password", "-h", "127.0.0.1",
                 "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-At"]
        if stdin is not None:
            args += ["-f", "-"]
        else:
            args += ["-c", query]
        return self.commands.run(args, timeout=8, capture=capture, input_bytes=stdin)

    def _probe(self) -> str:
        system_id = self._psql(True, "SELECT system_identifier FROM pg_control_system()")
        result = self._psql(False, "SELECT current_database(),current_user,current_setting('server_version_num'),"
                             "rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin "
                             "FROM pg_roles WHERE rolname=current_user").split("|")
        owner = self._psql(True, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='opspilot'")
        if (re.fullmatch(r"[0-9]{1,20}", system_id) is None or len(result) != 9
            or result[:2] != ["opspilot", "opspilot"] or not result[2].isdigit()
            or not 160000 <= int(result[2]) < 170000 or result[3:] != ["f", "f", "f", "f", "f", "t"]
            or owner != "opspilot"):
            self._reject()
        return system_id

    def inspect_ready(self) -> dict[str, Any]:
        self.authorize()
        _private_directory(self.directory)
        self.journal = self._load()
        self._verify_files()
        if self.journal["phase"] != "ready":
            raise RuntimeUnknown("SSH_POSTGRES_NOT_READY")
        self._network(self.journal["network"])
        self._volume()
        if not self._container().get("State", {}).get("Running") or self._probe() != self.journal["system_identifier"]:
            raise RuntimeUnknown("SSH_POSTGRES_NOT_READY")
        self._mounted_credentials()
        self.authorize()
        return self._public_identity()

    def _public_identity(self) -> dict[str, Any]:
        return {"database_id": self.identity["database_id"], "container_id": self.journal["container_id"],
                "image_id": self.journal["image_id"], "volume": self.volume,
                "volume_created_at": self.journal["volume_created_at"], "system_identifier": self.journal["system_identifier"],
                "state": "ready", "public_port": None}

    def backup(self, request_key: str) -> dict[str, Any]:
        """Logical archive cố định của database app; không SQL tùy ý/restore/ghi đè.

        Bị ngắt giữ lại intent/file riêng tư, lần sau chỉ xác minh receipt hoàn tất.
        Không tự dump lại vào cùng request UUID và không log stderr/data/password.
        """
        if not _match(_UUID, request_key):
            raise RuntimeRejected("SSH_POSTGRES_INPUT_INVALID")
        self.inspect_ready()
        base = self.root / ("postgres-backups-" + self.identity["database_id"])
        self.authorize()
        _private_directory(base, create=True)
        directory = base / request_key
        receipt_path, archive_path = directory / "receipt.json", directory / "database.pgdump"
        domain = "opspilot-managed-postgres-backup-v1"
        if directory.exists() or directory.is_symlink():
            _private_directory(directory)
            try:
                receipt = json.loads(self._read(receipt_path))
                payload = receipt["payload"]
                if (set(receipt) != {"payload", "signature"}
                    or not verify_h2(self.secret, domain, payload, receipt["signature"])
                    or set(payload) != {"format", "request_key", "identity", "system_identifier", "image", "sha256", "bytes"}
                    or payload["format"] != 1 or payload["request_key"] != request_key
                    or payload["identity"] != self.identity or payload["image"] != _POSTGRES_IMAGE
                    or payload["system_identifier"] != self.journal["system_identifier"]
                    or not _match(_HASH, payload["sha256"]) or not _positive(payload["bytes"])
                    or payload["bytes"] > 64 * 1024 * 1024
                    or {p.name for p in directory.iterdir()} != {"intent.json", "database.pgdump", "receipt.json"}):
                    self._reject()
                size, digest = self._archive_digest(archive_path)
                if size != payload["bytes"] or digest != payload["sha256"]:
                    self._reject()
                self.authorize()
                return {"state": "already_created", **payload}
            except (ValueError, TypeError, KeyError, OSError):
                raise RuntimeUnknown("SSH_POSTGRES_BACKUP_UNCONFIRMED") from None
        self.authorize()
        _private_directory(directory, create=True)
        intent = {"format": 1, "request_key": request_key, "identity": self.identity,
                  "system_identifier": self.journal["system_identifier"], "image": _POSTGRES_IMAGE}
        _write_private(directory / "intent.json", {"payload": intent, "signature": self._mac(intent, domain + "-intent")})
        self.authorize()
        fd = os.open(archive_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        failed = threading.Event()
        process = None
        try:
            os.fchmod(fd, 0o600)
            process = subprocess.Popen(["docker", "exec", "-u", "0", "-e", "PGCONNECT_TIMEOUT=2", "-e",
                "PGPASSFILE=/run/opspilot-secrets/app.pgpass", self.journal["container_id"],
                "pg_dump", "--no-password", "-h", "127.0.0.1", "-U", "opspilot", "-d", "opspilot",
                "--format=custom", "--no-owner", "--no-acl", "--serializable-deferrable", "--lock-wait-timeout=5s"],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            def consume() -> None:
                size = 0
                try:
                    with os.fdopen(fd, "wb") as target:
                        while True:
                            chunk = process.stdout.read(64 * 1024)
                            if not chunk:
                                break
                            size += len(chunk)
                            if size > 64 * 1024 * 1024:
                                failed.set()
                                process.kill()
                                break
                            target.write(chunk)
                        target.flush()
                        os.fsync(target.fileno())
                except (OSError, ValueError):
                    failed.set()
                finally:
                    process.stdout.close()
            reader = threading.Thread(target=consume, daemon=True)
            reader.start()
            try:
                code = process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
                raise RuntimeUnknown("SSH_POSTGRES_BACKUP_UNCONFIRMED") from None
            finally:
                reader.join(timeout=2)
            if code != 0 or reader.is_alive() or failed.is_set() or self.commands.cancelled.is_set():
                raise RuntimeUnknown("SSH_POSTGRES_BACKUP_UNCONFIRMED")
            self.authorize()
            self._container()
            self._volume()
            if self._probe() != self.journal["system_identifier"]:
                self._reject()
            size, digest = self._archive_digest(archive_path)
            payload = {**intent, "sha256": digest, "bytes": size}
            _write_private(receipt_path, {"payload": payload, "signature": self._mac(payload, domain)})
            return {"state": "created", **payload}
        except OSError:
            if process is None:
                os.close(fd)
            raise RuntimeUnknown("SSH_POSTGRES_BACKUP_UNCONFIRMED") from None

    def _archive_digest(self, path: Path) -> tuple[int, str]:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(fd, "rb") as source:
            before = os.fstat(source.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.geteuid()
                or stat.S_IMODE(before.st_mode) != 0o600 or not 0 < before.st_size <= 64 * 1024 * 1024):
                self._reject()
            digest, size = hashlib.sha256(), 0
            if source.read(5) != b"PGDMP":
                self._reject()
            source.seek(0)
            while chunk := source.read(64 * 1024):
                size += len(chunk)
                if size > 64 * 1024 * 1024:
                    self._reject()
                digest.update(chunk)
            after = os.fstat(source.fileno())
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                self._reject()
            return size, digest.hexdigest()

    def ensure(self, network: str) -> dict[str, Any]:
        self.authorize()
        if not _match(_NETWORK_NAME, network):
            raise RuntimeRejected("SSH_POSTGRES_INPUT_INVALID")
        if self.directory.exists() or self.directory.is_symlink():
            _private_directory(self.directory)
            self.journal = self._load()
            if self.journal["network"] != network:
                self._reject()
            self._network(network)
            self._verify_files()
        else:
            network_id = self._network(network)
            # Collision trước khi ghi intent; không xoá/nhận tài nguyên cùng tên.
            if (self.commands.container(self.name) is not None or self.commands.run(
                ["volume", "ls", "--filter", f"name=^{self.volume}$", "--format", "{{.Name}}"])):
                raise RuntimeUnknown("SSH_POSTGRES_COLLISION")
            try:
                image = self.commands.inspect("image", _POSTGRES_IMAGE)
            except RuntimeUnknown:
                self.authorize()
                self.commands.run(["pull", _POSTGRES_IMAGE], timeout=120, capture=False)
                image = self.commands.inspect("image", _POSTGRES_IMAGE)
            if (not _match(_IMAGE, image.get("Id")) or image.get("Os") != "linux" or image.get("Architecture") != "amd64"
                or not any(d.endswith("@" + _POSTGRES_IMAGE.split("@", 1)[1]) for d in image.get("RepoDigests", []))):
                self._reject()
            self.authorize()
            _private_directory(self.directory, create=True)
            self._save(format=1, identity=self.identity, image=_POSTGRES_IMAGE, image_id=image["Id"],
                       credentials_mac=self._credentials_mac(), network=network, network_id=network_id, phase="planned",
                       volume_created_at=None, container_id=None, system_identifier=None,
                       secret_mount_source=None, container_config_sha256=None)
            for name, content in self._files().items():
                self._exclusive(self.directory / name, content)
        if self.journal["phase"] == "planned":
            if self.commands.run(["volume", "ls", "--filter", f"name=^{self.volume}$", "--format", "{{.Name}}"]):
                raise RuntimeUnknown("SSH_POSTGRES_CREATE_UNCONFIRMED")
            self.authorize()
            self.commands.run(["volume", "create", *self._label_args(), self.volume])
            volume = self._volume()
            self._save(phase="volume", volume_created_at=volume.get("CreatedAt"))
        self._volume()
        if self.journal["phase"] == "volume":
            if self.commands.container(self.name) is not None:
                raise RuntimeUnknown("SSH_POSTGRES_CREATE_UNCONFIRMED")
            self.authorize()
            cid = self.commands.run(["create", "--name", self.name, "--network", network, "--network-alias", "postgres",
                "--restart", "unless-stopped", "--memory", "256m", "--oom-kill-disable=false", "--ipc", "private",
                "--mount", f"type=volume,source={self.volume},target=/var/lib/postgresql/data",
                "--mount", f"type=bind,source={self.directory},target=/run/opspilot-secrets,readonly",
                "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_DB=postgres", "-e",
                "POSTGRES_PASSWORD_FILE=/run/opspilot-secrets/admin_password", *self._label_args(), _POSTGRES_IMAGE])
            if not _match(_CID, cid):
                raise RuntimeUnknown("SSH_POSTGRES_CREATE_UNCONFIRMED")
            created = self.commands.inspect("container", cid)
            mounts = [m for m in created.get("Mounts", []) if m.get("Destination") == "/run/opspilot-secrets"]
            if len(mounts) != 1:
                self._reject()
            self._save(phase="container", container_id=cid, secret_mount_source=mounts[0].get("Source"),
                       container_config_sha256=self._container_config_mac(created))
        container = self._container()
        if not container.get("State", {}).get("Running"):
            self.authorize()
            self.commands.run(["start", container["Id"]])
        self._mounted_credentials()
        if self.journal["phase"] == "container":
            deadline = time.monotonic() + 30
            while True:
                self.authorize()
                self._container()
                try:
                    if self._psql(True, "SELECT 1") == "1":
                        break
                except RuntimeUnknown:
                    if time.monotonic() >= deadline:
                        raise RuntimeUnknown("SSH_POSTGRES_NOT_READY") from None
                time.sleep(0.2)
            self._save(phase="initializing")
            self.authorize()
            # Password chỉ qua stdin; role app không có quyền quản trị.
            sql = ("SET statement_timeout='5s'; SET lock_timeout='2s';\n"
                   "CREATE ROLE opspilot LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"
                   + self.credentials["app_password"] + "';\nCREATE DATABASE opspilot OWNER opspilot;\n")
            self._psql(True, "", capture=False, stdin=sql.encode("ascii"))
        system_id = self._probe()
        if self.journal["phase"] == "initializing":
            self._save(phase="ready", system_identifier=system_id)
        if system_id != self.journal["system_identifier"]:
            self._reject()
        self.authorize()
        self._container()
        self._volume()
        self._verify_files()
        return self._public_identity()


class ProductRuntime:
    def __init__(self, execution: GuardedExecution, transfer_directory: Path, deployment_id: int,
                 build_state: str, build_image_tag: str | None, build_source_sha: str | None):
        self.execution = execution
        self.root = execution.root
        self.transfer_directory = Path(transfer_directory)
        self.deployment_id = deployment_id
        self.build_state = build_state
        self.build_image_tag = build_image_tag
        self.build_source_sha = build_source_sha
        self.context: dict[str, Any] | None = None
        self.commands = DockerCommands()
        self.worker: threading.Thread | None = None
        self.lock = threading.Lock()
        self.progress: dict[str, Any] = {"state": "idle", "remote_quiescent": True}
        self.previous: dict[str, Any] | None = None
        self.candidate: dict[str, Any] | None = None
        self.previous_app: dict[str, Any] | None = None
        self.previous_collector: dict[str, Any] | None = None
        self.candidate_collector: dict[str, Any] | None = None
        self.boundary: dict[str, Any] | None = None
        self.collector_image_id: str | None = None
        self.terminal: dict[str, Any] | None = None
        self.prepared = False
        self.activated = False
        self.health_checked = False
        self.rolled_back = False
        self.published = False
        self.ambiguous = False
        self.settled = False
        self.database: ManagedPostgres | None = None

    def configure(self, context: Any) -> None:
        if self.context is not None or self.worker is not None:
            raise RuntimeRejected()
        self.execution.authorize_write_phase("prepare")
        value = validate_context(context, self.execution.identity, self.deployment_id)
        expected_state = "build_succeeded" if self.build_state == "succeeded" else "build_failed_definite"
        if (self.build_state not in {"succeeded", "failed"} or value["build_state"] != expected_state
            or value["candidate_image_tag"] != self.build_image_tag or value["source_sha"] != self.build_source_sha):
            raise RuntimeRejected()
        self.context = value
        self.secret = _read_private(_secret_path(self.root, self.execution.identity), 32)
        if len(self.secret) != 32:
            raise RuntimeRejected()
        self.directory = self.root / "product-runtime"
        _private_directory(self.directory, create=True)
        self.receipt_path = self.directory / f"deployment-{self.deployment_id}.json"
        self.ack_path = self.directory / f"settled-{self.deployment_id}.json"
        if self.receipt_path.exists() or self.receipt_path.is_symlink() or self.ack_path.exists():
            raise RuntimeRejected()
        self.app_name = value["app_name"] + "-app"
        self.collector_name = value["app_name"] + "-collector"
        self.network = value["app_name"] + "-network"
        self.collector_tag = value["app_name"] + f"-collector:v{self.deployment_id}"
        self.metrics_directory = Path('/opt/opspilot') / value['app_name'] / 'metrics'
        self.metrics_path = self.metrics_directory / "metrics.jsonl"

    def start_step(self, step: str) -> None:
        if self.context is None or step not in _STEPS or self.terminal is not None or self.ambiguous or self.settled:
            raise RuntimeRejected()
        if self.worker is not None and self.worker.is_alive():
            raise RuntimeRejected()
        if (step == "prepare" and self.prepared) or (step != "prepare" and not self.prepared):
            raise RuntimeRejected()
        if self.context["build_state"] == "build_failed_definite" and step != "prepare":
            raise RuntimeRejected()
        if step == "activate" and self.activated:
            raise RuntimeRejected()
        if step in {"health", "rollback", "publish"} and not self.activated:
            raise RuntimeRejected()
        if step == "rollback" and (self.previous is None or not self.health_checked or self.rolled_back):
            raise RuntimeRejected()
        if step == "publish" and (not self.health_checked or self.candidate is None
                                  or self.candidate["health"] != "healthy" or self.rolled_back or self.published):
            raise RuntimeRejected()
        if step == "health" and (self.health_checked or self.rolled_back):
            raise RuntimeRejected()
        self.execution.authorize_write_phase("rollback" if step == "rollback" else "activate")
        self.progress = {"state": "running", "step": step, "remote_quiescent": False}
        self.worker = threading.Thread(target=self._work, args=(step,), daemon=False)
        self.worker.start()

    def _work(self, step: str) -> None:
        try:
            getattr(self, "_step_" + step)()
            value: dict[str, Any] = {"state": "step_succeeded", "step": step, "remote_quiescent": True,
                                     "previous": self.previous, "candidate": self.candidate}
            if self.boundary is not None:
                value["boundary"] = self.boundary
            if step == "health" and self.candidate is not None and self.candidate["health"] != "healthy":
                value["state"] = "step_failed"
                value["safe_error_code"] = "SSH_RUNTIME_UNHEALTHY"
            if step == "publish":
                value["exposure_status"] = "not_checked"
        except (RuntimeUnknown, TargetGuardError) as error:
            self.ambiguous = True
            value = {"state": "unknown", "step": step, "remote_quiescent": False,
                     "safe_error_code": error.code}
        except (OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeRejected, subprocess.SubprocessError):
            self.ambiguous = True
            value = {"state": "unknown", "step": step, "remote_quiescent": False,
                     "safe_error_code": "SSH_RUNTIME_UNKNOWN"}
        with self.lock:
            self.progress = value

    def poll(self) -> dict[str, Any]:
        if self.context is None:
            raise RuntimeRejected()
        if not self.settled:
            self.execution.authorize_write_phase("activate")
        with self.lock:
            return json.loads(canonical_json(self.progress))

    def _authorize(self, phase: str = "activate") -> None:
        if self.commands.cancelled.is_set() or self.ambiguous:
            raise RuntimeUnknown()
        self.execution.authorize_write_phase(phase)

    def _labels(self, deployment_id: int, source_sha: str) -> dict[str, str]:
        assert self.context is not None
        return {"opspilot.app_id": str(self.context["claim"]["app_id"]),
                "opspilot.deployment_id": str(deployment_id), "org.opencontainers.image.revision": source_sha}

    def _check_labels(self, record: dict[str, Any], expected: dict[str, str]) -> None:
        labels = record.get("Config", {}).get("Labels")
        if not isinstance(labels, dict) or any(labels.get(key) != value for key, value in expected.items()):
            raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH")

    def _pin(self, record: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
        labels = self._labels(expected["deployment_id"], expected["source_sha"])
        self._check_labels(record, labels)
        image = self.commands.inspect("image", expected["image_tag"])
        self._check_labels(image, labels)
        if not _match(_CID, record.get("Id")) or not _match(_IMAGE, image.get("Id")) or record.get("Image") != image["Id"]:
            raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH")
        return {"deployment_id": expected["deployment_id"], "image_tag": expected["image_tag"],
                "image_id": image["Id"], "source_sha": expected["source_sha"], "container_id": record["Id"],
                "collector_container_id": None, "collector_image_id": None, "config_sha256": _config_hash(record, self.secret),
                "health": "unknown", "http_status": None}

    def _check_runtime(self, value: dict[str, Any], canonical_name: bool = True) -> dict[str, Any]:
        record = self.commands.inspect("container", value["container_id"])
        self._check_labels(record, self._labels(value["deployment_id"], value["source_sha"]))
        if (record.get("Id") != value["container_id"] or record.get("Image") != value["image_id"]
            or _config_hash(record, self.secret) != value["config_sha256"]
            or (canonical_name and record.get("Name") != "/" + self.app_name)):
            raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH")
        return record

    def _health(self, value: dict[str, Any], budget_ms: int) -> dict[str, Any]:
        assert self.context is not None
        before = self._check_runtime(value)
        result = dict(value)
        if not before.get("State", {}).get("Running"):
            result.update(health="unhealthy", http_status=None)
            return result
        script = ("const u='http://127.0.0.1:'+process.argv[1]+process.argv[2];"
                  "fetch(u,{signal:AbortSignal.timeout(Number(process.argv[3]))})"
                  ".then(async r=>{await r.body?.cancel();console.log(JSON.stringify({http_status:r.status}))})"
                  ".catch(()=>console.log(JSON.stringify({http_status:null})))")
        # Nginx SPA không có Node; probe cố định dùng wget sẵn trong image Alpine.
        # Chỉ trả JSON status, không ghi header/body; URL đi qua positional args.
        probe = """if command -v node >/dev/null 2>&1; then
exec node -e "$1" "$2" "$3" "$4"
fi
command -v wget >/dev/null 2>&1 || exit 127
wget -S -O /dev/null -T 2 "http://127.0.0.1:$2$3" 2>&1 | awk '
$1 ~ /^HTTP\\// && $2 ~ /^[0-9][0-9][0-9]$/ {status=$2}
END {if (status == "") print "{\\"http_status\\":null}"; else printf "{\\"http_status\\":%s}\\n", status}'
"""
        text = self.commands.run(["exec", value["container_id"], "sh", "-c", probe, "opspilot-health", script,
                                  str(self.context["container_port"]), self.context["healthcheck_path"],
                                  str(max(1, min(2000, budget_ms)))], timeout=5)
        try:
            response = json.loads(text)
            status_code = response["http_status"]
            if set(response) != {"http_status"} or (status_code is not None and
                (type(status_code) is not int or not 100 <= status_code <= 599)):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise RuntimeUnknown() from None
        self._check_runtime(value)
        result.update(health="healthy" if status_code is not None and 200 <= status_code < 300 else "unhealthy",
                      http_status=status_code)
        return result

    def _metric_boundary(self) -> dict[str, Any]:
        if self.metrics_directory != _metrics_directory(self.context['app_name']):
            raise RuntimeUnknown('SSH_RUNTIME_METRICS_CHANGED')
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.metrics_path, flags, 0o600)
        try:
            info = os.fstat(fd)
            # Metrics không phải secret; giữ mode 0644 của collector hiện hành.
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
                raise RuntimeUnknown()
            # Cùng identity với SshManager.fileIdentity và LocalMetricSource.
            generation = f"{info.st_dev}:{info.st_ino}"
            result = {"generation": generation, "device": info.st_dev, "inode": info.st_ino, "next_offset": info.st_size + 1}
            if self.boundary is not None and any(result[key] != self.boundary[key] for key in ("generation", "device", "inode")):
                raise RuntimeUnknown("SSH_RUNTIME_METRICS_CHANGED")
            return result
        finally:
            os.close(fd)

    def _runtime_env_args(self) -> list[str]:
        assert self.context is not None
        expected = self.context.get("environment")
        path = self.transfer_directory / "render" / ".env"
        if expected is None:
            return []
        try:
            text = _read_private(path, 96 * 1024).decode("utf-8", errors="strict")
            if self.context.get("database") is not None:
                if not text.startswith("# opspilot-managed-postgres-v1 "):
                    raise ValueError()
                text = text.partition("\n")[2]
            first, signature, body = text.split("\n", 2)
            prefix = "# opspilot-environment-v1 "
            sig_prefix = "# opspilot-environment-hmac "
            if not first.startswith(prefix) or not signature.startswith(sig_prefix):
                raise ValueError()
            header = json.loads(first[len(prefix):])
            if (not isinstance(header, dict) or set(header) != {"format", "claim", "target", "reference", "nonce", "runtime_keys"}
                or header["format"] != 1 or header["claim"] != self.context["claim"]
                or header["target"] != self.context["target"] or header["reference"] != expected
                or not isinstance(header["nonce"], str) or re.fullmatch(r"[0-9a-f]{64}", header["nonce"]) is None
                or not isinstance(header["runtime_keys"], list) or len(header["runtime_keys"]) > 128):
                raise ValueError()
            derived = hmac.new(self.secret, b"opspilot-env-transfer-key-v1", hashlib.sha256).digest()
            mac = hmac.new(derived, b"opspilot-env-transfer-v1\n" + (first + "\n" + body).encode("utf-8"), hashlib.sha256).hexdigest()
            supplied = signature[len(sig_prefix):]
            if not _match(_HASH, supplied) or not hmac.compare_digest(mac, supplied):
                raise ValueError()
            if not body.endswith("\n"):
                raise ValueError()
            values = {}
            for line in body[:-1].split("\n"):
                name, separator, value = line.partition("=")
                if (not separator or name in values or re.fullmatch(r"[A-Z_][A-Z0-9_]{0,127}", name) is None
                    or len(value.encode("utf-8")) > 8192 or any(ord(c) < 32 or ord(c) == 127 for c in value)):
                    raise ValueError()
                values[name] = value
            marker = ":".join(str(v) for v in (expected["controller_id"], expected["ownership_generation"], expected["revision"], self.context["claim"]["source_generation"]))
            if values.pop("OPSPILOT_CONFIG_REVISION", None) != marker or sorted(values) != header["runtime_keys"]:
                raise ValueError()
            if any(name in {"PORT", "NODE_ENV", "NODE_OPTIONS", "PATH", "HOME", "DATABASE_URL"}
                   or name.startswith(("LD_", "NPM_CONFIG_", "OPSPILOT_", "DOCKER_", "COMPOSE_", "POSTGRES_", "VITE_", "NEXT_PUBLIC_")) for name in values):
                raise ValueError()
            return ["--env-file", str(path)]
        except (ValueError, TypeError, KeyError, UnicodeError, OSError, RuntimeRejected):
            raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH") from None

    def _managed_postgres(self) -> ManagedPostgres | None:
        expected = self.context.get("database")
        if expected is None:
            return None
        try:
            text = _read_private(self.transfer_directory / "render/.env", 96 * 1024).decode("utf-8", errors="strict")
            first, separator, _ = text.partition("\n")
            prefix = "# opspilot-managed-postgres-v1 "
            if not separator or not first.startswith(prefix):
                raise ValueError()
            record = json.loads(first[len(prefix):])
            if not isinstance(record, dict) or set(record) != {"payload", "signature"}:
                raise ValueError()
            payload = record["payload"]
            if (not isinstance(payload, dict) or set(payload) != {"format", "claim", "target", "reference", "image", "nonce", "credentials"}
                or payload["format"] != 1 or payload["claim"] != self.context["claim"]
                or payload["target"] != self.context["target"] or payload["reference"] != expected
                or payload["image"] != _POSTGRES_IMAGE or not _match(_HASH, payload["nonce"])
                or not isinstance(payload["credentials"], dict)
                or set(payload["credentials"]) != {"administrator_password", "application_password"}):
                raise ValueError()
            derived = hmac.new(self.secret, b"opspilot-postgres-transfer-key-v1", hashlib.sha256).digest()
            mac = hmac.new(derived, b"opspilot-postgres-transfer-v1\n" + canonical_json(payload), hashlib.sha256).hexdigest()
            if not _match(_HASH, record["signature"]) or not hmac.compare_digest(mac, record["signature"]):
                raise ValueError()
            claim = self.context["claim"]
            return ManagedPostgres(self.root, self.secret, {
                "controller_id": claim["controller_id"], "app_id": claim["app_id"],
                "ownership_generation": claim["ownership_generation"], "database_id": expected["database_id"],
                "target": self.context["target"]}, {"admin_password": payload["credentials"]["administrator_password"],
                "app_password": payload["credentials"]["application_password"]}, self.commands, self._authorize)
        except (ValueError, TypeError, KeyError, UnicodeError, OSError, RuntimeRejected):
            raise RuntimeUnknown("SSH_POSTGRES_TRANSFER_REJECTED") from None

    def _step_prepare(self) -> None:
        assert self.context is not None
        if self.context["build_state"] != "build_failed_definite":
            self.database = self._managed_postgres()
            self._runtime_env_args()
        old_app = self.commands.container(self.app_name)
        old_collector = self.commands.container(self.collector_name)
        expected = self.context["previous"]
        if expected is None:
            if old_app is not None or old_collector is not None:
                raise RuntimeUnknown("SSH_RUNTIME_COLLISION")
        else:
            if old_app is None or old_collector is None:
                raise RuntimeUnknown("SSH_RUNTIME_PREVIOUS_UNVERIFIED")
            self.previous = self._pin(old_app, expected)
            self._check_labels(old_collector, self._labels(expected["deployment_id"], expected["source_sha"]))
            if not _match(_CID, old_collector.get("Id")) or not _match(_IMAGE, old_collector.get("Image")):
                raise RuntimeUnknown()
            self.previous.update(collector_container_id=old_collector["Id"], collector_image_id=old_collector["Image"])
            self.previous_app, self.previous_collector = old_app, old_collector
            self.previous = self._health(self.previous, self.context["health_timeout_ms"])
            if self.previous["health"] != "healthy":
                raise RuntimeUnknown("SSH_RUNTIME_PREVIOUS_UNVERIFIED")
        if self.context["build_state"] == "build_failed_definite":
            self.prepared = True
            return
        self._authorize()
        image = self.commands.inspect("image", self.context["candidate_image_tag"])
        self._check_labels(image, self._labels(self.deployment_id, self.context["source_sha"]))
        if image.get("Id") != self.context["candidate_image_id"]:
            raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH")
        self._authorize()
        self.commands.run(["build", "-t", self.collector_tag,
                           *[part for key, value in self._labels(self.deployment_id, self.context["source_sha"]).items() for part in ("--label", f"{key}={value}")],
                           "-f", str(self.transfer_directory / "source/collector/Dockerfile"),
                           str(self.transfer_directory / "source/collector")], timeout=120, capture=False)
        collector_image = self.commands.inspect("image", self.collector_tag)
        self._check_labels(collector_image, self._labels(self.deployment_id, self.context["source_sha"]))
        if not _match(_IMAGE, collector_image.get("Id")):
            raise RuntimeUnknown()
        self.collector_image_id = collector_image["Id"]
        if self.database is not None:
            self._ensure_network()
            self.database.ensure(self.network)
        # A failed image preparation must not interrupt the current collector.
        # Quiesce it and capture B0 only after both candidate images are verified.
        self._authorize()
        if self.previous_collector is not None:
            self.commands.run(["stop", "--time", "10", self.previous_collector["Id"]], timeout=15)
            stopped = self.commands.inspect("container", self.previous_collector["Id"])
            if stopped.get("State", {}).get("Running") or _config_hash(stopped, self.secret) != _config_hash(self.previous_collector, self.secret):
                raise RuntimeUnknown()
        self.boundary = self._metric_boundary()
        self.prepared = True

    def _resource_labels(self) -> list[str]:
        assert self.context is not None
        labels = self._labels(self.deployment_id, self.context["source_sha"])
        labels.update({"opspilot.controller_id": self.context["claim"]["controller_id"],
                       "opspilot.ownership_generation": str(self.context["claim"]["ownership_generation"]),
                       "opspilot.execution_nonce": self.context["execution_nonce"]})
        return [part for key, value in labels.items() for part in ("--label", f"{key}={value}")]

    def _ensure_network(self) -> None:
        assert self.context is not None
        ids = self.commands.run(["network", "ls", "--no-trunc", "--filter", f"name=^{self.network}$", "--format", "{{.ID}}"])
        if not ids:
            self._authorize()
            self.commands.run(["network", "create", *self._resource_labels(), self.network])
        network = self.commands.inspect("network", self.network)
        labels = network.get("Labels", {})
        if (network.get("Name") != self.network or labels.get("opspilot.app_id") != str(self.context["claim"]["app_id"])
            or labels.get("opspilot.controller_id") != self.context["claim"]["controller_id"]
            or labels.get("opspilot.ownership_generation") != str(self.context["claim"]["ownership_generation"])):
            raise RuntimeUnknown("SSH_RUNTIME_COLLISION")

    def _step_activate(self) -> None:
        assert self.context is not None
        environment_args = self._runtime_env_args()
        collector_environment_args = []
        if self.database is not None:
            self.database.inspect_ready()
            environment_args += ["--env-file", str(self.database.directory / "app.env")]
            collector_environment_args = ["--env-file", str(self.database.directory / "collector.env")]
        self._ensure_network()
        self._authorize()
        if self.previous is not None:
            self._check_runtime(self.previous)
            self.commands.run(["stop", "--time", "10", self.previous["container_id"]], timeout=15)
            self.commands.run(["rename", self.previous["container_id"], self.app_name + f"-previous-{self.deployment_id}"])
            self.commands.run(["rename", self.previous_collector["Id"], self.collector_name + f"-previous-{self.deployment_id}"])
        self._authorize()
        container_id = self.commands.run(["run", "-d", "--name", self.app_name, "--network", self.network,
            "--network-alias", "app", "--restart", "unless-stopped", "--memory", "512m",
            "-p", f"{self.context['host_port']}:{self.context['container_port']}",
            *environment_args, *self._resource_labels(), self.context["candidate_image_id"]])
        if not _match(_CID, container_id):
            raise RuntimeUnknown()
        self.candidate = self._pin(self.commands.inspect("container", container_id), {
            "deployment_id": self.deployment_id, "image_tag": self.context["candidate_image_tag"],
            "source_sha": self.context["source_sha"]})
        self._authorize()
        collector_id = self.commands.run(["run", "-d", "--name", self.collector_name,
            "--network", self.network, "--restart", "unless-stopped", "--memory", "128m",
            "-e", "COLLECT_INTERVAL_S=10", "-e", f"APP_CONTAINER_NAME={self.app_name}",
            "-e", f"APP_URL=http://app:{self.context['container_port']}{self.context['healthcheck_path']}",
            "-e", "METRICS_DIR=/var/metrics", "-e", "MAX_FILE_MB=50",
            "--mount", f"type=bind,source={self.metrics_directory},target=/var/metrics",
            "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly",
            *collector_environment_args, *self._resource_labels(), self.collector_image_id])
        if not _match(_CID, collector_id):
            raise RuntimeUnknown()
        self.candidate_collector = self.commands.inspect("container", collector_id)
        self._check_labels(self.candidate_collector, self._labels(self.deployment_id, self.context["source_sha"]))
        if self.candidate_collector.get("Image") != self.collector_image_id or not self.candidate_collector.get("State", {}).get("Running"):
            raise RuntimeUnknown()
        self.candidate.update(collector_container_id=collector_id, collector_image_id=self.collector_image_id)
        self.activated = True

    def _step_health(self) -> None:
        assert self.context is not None and self.candidate is not None
        deadline = time.monotonic() + self.context["health_timeout_ms"] / 1000
        while True:
            self._authorize()
            remaining = max(1, int((deadline - time.monotonic()) * 1000))
            self.candidate = self._health(self.candidate, remaining)
            if self.candidate["health"] == "healthy" or time.monotonic() >= deadline:
                break
            time.sleep(min(0.2, max(0, deadline - time.monotonic())))
        self.health_checked = True

    def _step_rollback(self) -> None:
        assert self.context is not None and self.previous is not None and self.candidate is not None
        if self.candidate["health"] == "healthy":
            raise RuntimeUnknown()
        self._authorize("rollback")
        if self.candidate_collector is not None:
            self.commands.run(["stop", "--time", "10", self.candidate_collector["Id"]], timeout=15)
            collector = self.commands.inspect("container", self.candidate_collector["Id"])
            if collector.get("State", {}).get("Running"):
                raise RuntimeUnknown()
        self._check_runtime(self.candidate)
        self.commands.run(["stop", "--time", "10", self.candidate["container_id"]], timeout=15)
        self.commands.run(["rename", self.candidate["container_id"], self.app_name + f"-failed-{self.deployment_id}"])
        if self.candidate_collector is not None:
            self.commands.run(["rename", self.candidate_collector["Id"], self.collector_name + f"-failed-{self.deployment_id}"])
        self._authorize("rollback")
        self._check_runtime(self.previous, canonical_name=False)
        self.commands.run(["rename", self.previous["container_id"], self.app_name])
        self.commands.run(["start", self.previous["container_id"]])
        deadline = time.monotonic() + self.context["health_timeout_ms"] / 1000
        while True:
            self._authorize("rollback")
            self.previous = self._health(self.previous, max(1, int((deadline - time.monotonic()) * 1000)))
            if self.previous["health"] == "healthy":
                break
            if time.monotonic() >= deadline:
                raise RuntimeUnknown("SSH_RUNTIME_ROLLBACK_UNVERIFIED")
            time.sleep(0.1)
        # R0 loại toàn bộ sample candidate khỏi episode previous được phục hồi.
        self.boundary = self._metric_boundary()
        if self.previous_collector is not None:
            old = self.commands.inspect("container", self.previous_collector["Id"])
            if _config_hash(old, self.secret) != _config_hash(self.previous_collector, self.secret):
                raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH")
            self.commands.run(["rename", old["Id"], self.collector_name])
            self.commands.run(["start", old["Id"]])
            if not self.commands.inspect("container", old["Id"]).get("State", {}).get("Running"):
                raise RuntimeUnknown()
        self.rolled_back = True

    def _step_publish(self) -> None:
        assert self.context is not None and self.candidate is not None
        self.candidate = self._health(self.candidate, self.context["health_timeout_ms"])
        if self.candidate["health"] != "healthy":
            raise RuntimeUnknown()
        self.published = True

    def _verify_active_at_seal(self, value: dict[str, Any], collector: dict[str, Any] | None) -> dict[str, Any]:
        """Health cache không đủ để ký receipt; kiểm lại đúng app và collector đã pin."""
        active = self._health(value, self.context['health_timeout_ms'])
        if active['health'] != 'healthy' or collector is None:
            raise RuntimeUnknown('SSH_RUNTIME_NOT_QUIESCENT')
        current = self.commands.inspect('container', collector['Id'])
        self._check_labels(current, self._labels(active['deployment_id'], active['source_sha']))
        if (current.get('Id') != active['collector_container_id']
            or current.get('Image') != active['collector_image_id']
            or current.get('Name') != '/' + self.collector_name
            or _config_hash(current, self.secret) != _config_hash(collector, self.secret)
            or not current.get('State', {}).get('Running')):
            raise RuntimeUnknown('SSH_RUNTIME_IDENTITY_MISMATCH')
        return active

    def seal(self) -> dict[str, Any]:
        if (self.context is None or not self.prepared or self.ambiguous or self.commands.active
            or (self.worker is not None and self.worker.is_alive()) or self.settled):
            raise RuntimeRejected("SSH_RUNTIME_NOT_QUIESCENT")
        self.execution.authorize_write_phase("activate")
        if self.terminal is not None:
            return json.loads(canonical_json(self.terminal))
        active = None
        if self.context["build_state"] == "build_failed_definite":
            outcome, failed_step = "failed", "BUILD"
            active = self.previous
            if active is not None:
                active = self._verify_active_at_seal(active, self.previous_collector)
                self.previous = active
        elif self.rolled_back:
            outcome, failed_step, active = "rolled_back", "DEPLOY", self.previous
            if active is None or active["health"] != "healthy":
                raise RuntimeUnknown()
            active = self._verify_active_at_seal(active, self.previous_collector)
            self.previous = active
        elif self.published and self.candidate is not None and self.candidate["health"] == "healthy":
            outcome, failed_step, active = "succeeded", None, self.candidate
            active = self._verify_active_at_seal(active, self.candidate_collector)
            self.candidate = active
            if self.boundary is None:
                raise RuntimeUnknown()
            self._metric_boundary()
        elif self.health_checked and self.context["previous"] is None and self.candidate is not None and self.candidate["health"] == "unhealthy":
            outcome, failed_step = "failed", "DEPLOY"
            if self.candidate_collector is not None:
                self.commands.run(["stop", "--time", "10", self.candidate_collector["Id"]], timeout=15)
                if self.commands.inspect("container", self.candidate_collector["Id"]).get("State", {}).get("Running"):
                    raise RuntimeUnknown()
        else:
            raise RuntimeRejected("SSH_RUNTIME_NOT_TERMINAL")
        receipt = {"version": 1, "context": self.context, "outcome": outcome, "failed_step": failed_step,
            "active_runtime": active, "candidate_runtime": self.candidate, "previous_runtime": self.previous,
            "boundary": self.boundary, "exposure_status": "not_checked", "remote_quiescent": True, "sealed_at": _now()}
        if self.database is not None:
            receipt["database_runtime"] = self.database.inspect_ready()
        terminal = {"receipt": receipt, "receipt_sha256": hash_h2(receipt),
                         "signature": sign_h2(self.secret, "product-h2:receipt", receipt)}
        _write_private(self.receipt_path, terminal)
        self.terminal = terminal
        return json.loads(canonical_json(self.terminal))

    def settle(self, attestation: Any) -> dict[str, Any]:
        if self.context is None or self.terminal is None or self.commands.active or self.ambiguous:
            raise RuntimeRejected()
        if self.settled:
            return _settle(self.execution, self.context, self.terminal, self.secret, attestation, self.ack_path)
        self.execution.authorize_write_phase("activate")
        ack = _settle(self.execution, self.context, self.terminal, self.secret, attestation, self.ack_path)
        self.settled = True
        return ack

    def close(self) -> None:
        self.commands.cancelled.set()
        if self.worker is not None and self.worker.is_alive():
            self.worker.join(timeout=125)
            if self.worker.is_alive():
                self.ambiguous = True
                raise RuntimeUnknown("SSH_RUNTIME_NOT_QUIESCENT")


def _validate_commit(context: dict[str, Any], envelope: dict[str, Any], secret: bytes,
                     attestation: Any) -> dict[str, Any]:
    if not isinstance(attestation, dict) or set(attestation) != {"payload", "signature"}:
        raise RuntimeRejected("SSH_SETTLEMENT_REJECTED")
    payload = attestation["payload"]
    if not isinstance(payload, dict) or set(payload) != _COMMIT_KEYS or not verify_h2(secret, "product-h2:commit", payload, attestation["signature"]):
        raise RuntimeRejected("SSH_SETTLEMENT_REJECTED")
    expected = {"version": 1, "kind": "product-h2-commit", "receipt_sha256": envelope["receipt_sha256"],
                "context_sha256": hash_h2(context), "execution_nonce": context["execution_nonce"],
                "attempt_id": context["claim"]["attempt_id"], "deployment_id": context["deployment_id"],
                "outcome": envelope["receipt"]["outcome"]}
    if not _match(_IDENT, payload.get("commit_id")) or any(payload.get(key) != value for key, value in expected.items()):
        raise RuntimeRejected("SSH_SETTLEMENT_REJECTED")
    return payload


def _settle(execution: GuardedExecution, context: dict[str, Any], envelope: dict[str, Any], secret: bytes,
            attestation: Any, ack_path: Path) -> dict[str, Any]:
    payload = _validate_commit(context, envelope, secret, attestation)
    marker = _read_marker(execution._marker_path)
    identity = execution.identity
    if (marker["controller_id"] != identity.controller_id or marker["app_id"] != identity.app_id
        or marker["ownership_generation"] != identity.ownership_generation
        or marker["highest_accepted_fence"] != identity.app_fence
        or marker["last_claim_id"] != identity.claim_id or marker["last_attempt_id"] != identity.attempt_id):
        raise RuntimeRejected("SSH_SETTLEMENT_REJECTED")
    if ack_path.exists():
        ack = json.loads(_read_private(ack_path))
        if (not isinstance(ack, dict) or set(ack) != {"payload", "signature"}
            or not verify_h2(secret, "product-h2:settlement", ack["payload"], ack["signature"])
            or ack["payload"].get("commit_id") != payload["commit_id"]
            or ack["payload"].get("receipt_sha256") != envelope["receipt_sha256"]):
            raise RuntimeRejected("SSH_SETTLEMENT_REJECTED")
    else:
        if marker["execution_state"] != "unknown":
            raise RuntimeRejected("SSH_SETTLEMENT_REJECTED")
        ack_payload = {key: payload[key] for key in ("version", "commit_id", "receipt_sha256", "context_sha256",
                        "execution_nonce", "attempt_id", "deployment_id")}
        ack_payload.update(kind="product-h2-settlement", settled_at=_now())
        ack = {"payload": ack_payload, "signature": sign_h2(secret, "product-h2:settlement", ack_payload)}
        _write_private(ack_path, ack)
    # Ack durable trước idle; crash ở giữa chỉ recovery settle, không mutate lại runtime.
    marker["execution_state"] = "idle"
    _write_marker_atomic(execution._marker_path, marker)
    return ack


class RecoveryRuntime:
    """Handle riêng giữ flock, chỉ đọc receipt/settle, không gọi normal execution bypass."""
    def __init__(self, state_root: str, context: Any, attestation: Any):
        from target_execution_guard import acquire_recovery
        if not isinstance(context, dict) or not isinstance(context.get("claim"), dict):
            raise RuntimeRejected()
        claim = context["claim"]
        try:
            identity = ExecutionIdentity(claim["controller_id"], str(claim["app_id"]), claim["ownership_generation"],
                                         claim["job_id"], claim["attempt_id"], claim["app_fence"])
            self.context = validate_context(context, identity, context["deployment_id"])
            self.execution = acquire_recovery(state_root, identity)
            self.execution.__enter__()
            self.secret = _read_private(_secret_path(self.execution.root, identity), 32)
            directory = self.execution.root / "product-runtime"
            _private_directory(directory)
            self.envelope = json.loads(_read_private(directory / f"deployment-{context['deployment_id']}.json"))
            if (not isinstance(self.envelope, dict) or set(self.envelope) != {"receipt", "receipt_sha256", "signature"}
                or self.envelope["receipt"].get("context") != self.context
                or self.envelope["receipt"].get("remote_quiescent") is not True
                or hash_h2(self.envelope["receipt"]) != self.envelope["receipt_sha256"]
                or not verify_h2(self.secret, "product-h2:receipt", self.envelope["receipt"], self.envelope["signature"])):
                raise RuntimeRejected("SSH_SETTLEMENT_REJECTED")
            _validate_commit(self.context, self.envelope, self.secret, attestation)
            self.ack_path = directory / f"settled-{context['deployment_id']}.json"
        except (OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeRejected, RuntimeUnknown, TargetGuardError, subprocess.SubprocessError):
            if hasattr(self, "execution"):
                self.execution.__exit__(None, None, None)
            raise RuntimeRejected("SSH_SETTLEMENT_REJECTED") from None

    def settle(self, attestation: Any) -> dict[str, Any]:
        self.execution.authorize_settlement()
        return _settle(self.execution, self.context, self.envelope, self.secret, attestation, self.ack_path)

    def poll(self) -> dict[str, Any]:
        self.execution.authorize_settlement()
        return {"state": "idle", "remote_quiescent": True}

    def close(self) -> None:
        self.execution.__exit__(None, None, None)
