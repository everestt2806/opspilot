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
    ExecutionIdentity, GuardedExecution, TargetGuardError, _identity_key,
    _read_marker, _write_marker_atomic,
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
    if not isinstance(context, dict) or set(context) != _CONTEXT_KEYS or context.get("version") != 1:
        raise RuntimeRejected()
    if not _plain(context):
        raise RuntimeRejected()
    claim, target = context.get("claim"), context.get("target")
    if not isinstance(claim, dict) or set(claim) != _CLAIM_KEYS or not isinstance(target, dict) or set(target) != _TARGET_KEYS:
        raise RuntimeRejected()
    for field in {"controller_id", "job_id", "attempt_id", "app_lease_id", "build_slot_lease_id"}:
        if not _match(_IDENT, claim[field]):
            raise RuntimeRejected()
    for field in {"app_id", "attempt_number", "ownership_generation", "source_generation", "app_fence", "build_slot_fence"}:
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
    for field in {"vps_id", "port", "ssh_security_revision"}:
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

    def run(self, args: list[str], timeout: float = 10.0, capture: bool = True) -> str:
        if self.cancelled.is_set():
            raise RuntimeUnknown()
        self.active = True
        retained = bytearray()
        overflow = False
        try:
            process = subprocess.Popen(["docker", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
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
                finally:
                    process.stdout.close()
            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
                raise RuntimeUnknown("SSH_RUNTIME_TIMEOUT") from None
            finally:
                reader.join(timeout=2)
            if reader.is_alive() or overflow or self.cancelled.is_set():
                raise RuntimeUnknown()
            if code != 0:
                raise RuntimeUnknown("SSH_RUNTIME_COMMAND_FAILED")
            return retained.decode("utf-8", errors="strict").strip() if capture else ""
        except (OSError, UnicodeError):
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


def _config_hash(container: dict[str, Any]) -> str:
    # Chỉ digest ra wire; env/config có thể chứa secret chỉ ở bộ nhớ target.
    return hash_h2({"Config": container.get("Config"), "HostConfig": container.get("HostConfig"),
                    "Mounts": [{key: mount.get(key) for key in ("Type", "Source", "Destination", "RW")}
                               for mount in container.get("Mounts", [])]})


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
        except Exception:
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
                "collector_container_id": None, "collector_image_id": None, "config_sha256": _config_hash(record),
                "health": "unknown", "http_status": None}

    def _check_runtime(self, value: dict[str, Any], canonical_name: bool = True) -> dict[str, Any]:
        record = self.commands.inspect("container", value["container_id"])
        self._check_labels(record, self._labels(value["deployment_id"], value["source_sha"]))
        if (record.get("Id") != value["container_id"] or record.get("Image") != value["image_id"]
            or _config_hash(record) != value["config_sha256"]
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
        text = self.commands.run(["exec", value["container_id"], "node", "-e", script,
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

    def _step_prepare(self) -> None:
        assert self.context is not None
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
        if self.previous_collector is not None:
            self.commands.run(["stop", "--time", "10", self.previous_collector["Id"]], timeout=15)
            stopped = self.commands.inspect("container", self.previous_collector["Id"])
            if stopped.get("State", {}).get("Running") or _config_hash(stopped) != _config_hash(self.previous_collector):
                raise RuntimeUnknown()
        self.boundary = self._metric_boundary()
        image = self.commands.inspect("image", self.context["candidate_image_tag"])
        self._check_labels(image, self._labels(self.deployment_id, self.context["source_sha"]))
        if image.get("Id") != self.context["candidate_image_id"]:
            raise RuntimeUnknown("SSH_RUNTIME_IDENTITY_MISMATCH")
        self._authorize()
        self.commands.run(["build", "-t", self.collector_tag,
                           *sum((["--label", f"{key}={value}"] for key, value in self._labels(self.deployment_id, self.context["source_sha"]).items()), []),
                           "-f", str(self.transfer_directory / "source/collector/Dockerfile"),
                           str(self.transfer_directory / "source/collector")], timeout=120, capture=False)
        collector_image = self.commands.inspect("image", self.collector_tag)
        self._check_labels(collector_image, self._labels(self.deployment_id, self.context["source_sha"]))
        if not _match(_IMAGE, collector_image.get("Id")):
            raise RuntimeUnknown()
        self.collector_image_id = collector_image["Id"]
        self.prepared = True

    def _resource_labels(self) -> list[str]:
        assert self.context is not None
        labels = self._labels(self.deployment_id, self.context["source_sha"])
        labels.update({"opspilot.controller_id": self.context["claim"]["controller_id"],
                       "opspilot.ownership_generation": str(self.context["claim"]["ownership_generation"]),
                       "opspilot.execution_nonce": self.context["execution_nonce"]})
        return sum((["--label", f"{key}={value}"] for key, value in labels.items()), [])

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
            *self._resource_labels(), self.context["candidate_image_id"]])
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
            *self._resource_labels(), self.collector_image_id])
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
            if _config_hash(old) != _config_hash(self.previous_collector):
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
            or _config_hash(current) != _config_hash(collector)
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
        except Exception:
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
