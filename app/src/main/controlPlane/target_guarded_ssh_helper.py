"""Framed stdin/stdout protocol for one pinned SSH execution channel."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import threading
from collections import deque
from pathlib import Path
from typing import Any

from target_execution_guard import (
    ExecutionIdentity,
    GuardedExecution,
    TargetGuardError,
    acquire_execution,
)
from target_product_runtime import (
    ProductRuntime,
    RecoveryRuntime,
    RuntimeRejected,
    RuntimeUnknown,
)

VERSION = 1
MAX_FRAME = 40 * 1024
MAX_OUTPUT = 64 * 1024
MAX_MESSAGES = 12_288
CHUNK_BYTES = 24 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_FILES = 1_024
MAX_PATH_BYTES = 1_024
PHASES = {"prepare", "build", "activate", "rollback"}
SCOPES = {"source", "render"}
RENDER_FILES = {"Dockerfile", "docker-compose.yml", ".env"}
TARGET_CODES = {
    "TARGET_NOT_ENROLLED",
    "TARGET_MARKER_INVALID",
    "TARGET_IDENTITY_INVALID",
    "TARGET_IDENTITY_MISMATCH",
    "TARGET_OWNERSHIP_GENERATION_STALE",
    "TARGET_FENCE_STALE",
    "TARGET_ATTEMPT_REPLAY",
    "TARGET_EXECUTION_UNCERTAIN",
    "TARGET_EXECUTION_NOT_ACTIVE",
    "TARGET_EXECUTION_ALREADY_ENTERED",
    "TARGET_LOCK_BUSY",
    "TARGET_LOCK_TIMEOUT_INVALID",
    "TARGET_LOCK_RELEASE_FAILED",
    "TARGET_PHASE_REJECTED",
    "SSH_BUILD_REJECTED",
    "SSH_BUILD_FAILED",
    "SSH_BUILD_TIMEOUT",
    "SSH_BUILD_NOT_ACTIVE",
    "SSH_RUNTIME_REJECTED",
    "SSH_RUNTIME_FAILED",
    "SSH_RUNTIME_UNKNOWN",
    "SSH_SETTLEMENT_REJECTED",
}


class TransferRejected(Exception):
    pass


class TransferChecksum(Exception):
    pass


def _exact_keys(request: dict[str, Any], expected: set[str]) -> bool:
    return set(request) == expected


def _safe_directory(path: Path, create: bool) -> None:
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        if not create:
            raise TransferRejected from None
    except FileNotFoundError:
        _safe_directory(path.parent, False)
        path.mkdir(mode=0o700)
    info = path.lstat()
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) & 0o077
    ):
        raise TransferRejected
    os.chmod(path, 0o700)


def _safe_relative_path(value: Any, scope: str) -> tuple[str, ...]:
    if (
        not isinstance(value, str)
        or not value
        or len(value.encode("utf-8")) > MAX_PATH_BYTES
        or value.startswith("/")
        or "\\" in value
        or any(ord(char) < 0x20 or ord(char) == 0x7F for char in value)
    ):
        raise TransferRejected
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise TransferRejected
    if scope == "render" and (len(parts) != 1 or value not in RENDER_FILES):
        raise TransferRejected
    return tuple(parts)


def _manifest_digest(files: dict[str, dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for name in sorted(files, key=lambda item: item.encode("utf-8")):
        record = files[name]
        digest.update(
            f"{name}\0{record['size']}\0{record['sha256']}\0{record['mode']:o}\n".encode()
        )
    return digest.hexdigest()


class TransferState:
    """Private per-helper staging owner bound to the opened app/deployment."""

    def __init__(self, state_root: str, identity: ExecutionIdentity, deployment_id: int):
        self.identity = identity
        self.deployment_id = deployment_id
        root = Path(state_root)
        if root.is_symlink() or not root.is_absolute():
            raise TransferRejected
        try:
            root_info = root.lstat()
        except OSError:
            raise TransferRejected
        if (
            not stat.S_ISDIR(root_info.st_mode)
            or root_info.st_uid != os.geteuid()
            or stat.S_IMODE(root_info.st_mode) & 0o077
        ):
            raise TransferRejected
        staging_root = root / "product-staging"
        _safe_directory(staging_root, True)
        app_root = staging_root / f"app-{identity.app_id}"
        _safe_directory(app_root, True)
        self.directory = app_root / f"deployment-{deployment_id}"
        self.directory.mkdir(mode=0o700)
        self.source_complete = False
        self.render_complete = False
        self.scopes: dict[str, dict[str, Any]] = {}
        self.current: dict[str, Any] | None = None
        self.reserved_bytes = 0
        self.reserved_files = 0

    def _committed_bytes(self, scope: str | None = None) -> int:
        return sum(
            record["size"]
            for name, info in self.scopes.items()
            if scope is None or name == scope
            for record in info["files"].values()
        )

    def begin_scope(self, request: dict[str, Any]) -> None:
        if not _exact_keys(request, {
            "version", "request_id", "sequence", "operation", "deployment_id",
            "scope", "file_count", "total_bytes", "manifest_sha256"
        }):
            raise TransferRejected
        scope = request.get("scope")
        count = request.get("file_count")
        total = request.get("total_bytes")
        manifest = request.get("manifest_sha256")
        if (
            scope not in SCOPES
            or scope in self.scopes
            or (scope == "source" and self.scopes)
            or (scope == "render" and not self.source_complete)
            or type(count) is not int or count < 0
            or type(total) is not int or total < 0
            or total > MAX_TOTAL_BYTES
            or not isinstance(manifest, str) or not re.fullmatch(r"[0-9a-f]{64}", manifest)
            or self.reserved_files + count > MAX_FILES
            or self.reserved_bytes + total > MAX_TOTAL_BYTES
            or (scope == "render" and count != 3)
        ):
            raise TransferRejected
        directory = self.directory / scope
        directory.mkdir(mode=0o700)
        self.scopes[scope] = {
            "directory": directory,
            "expected_count": count,
            "expected_bytes": total,
            "expected_manifest": manifest,
            "files": {},
            "complete": False,
        }
        self.reserved_bytes += total
        self.reserved_files += count

    def begin_file(self, request: dict[str, Any]) -> None:
        if not _exact_keys(request, {
            "version", "request_id", "sequence", "operation", "deployment_id",
            "scope", "path", "size", "mode", "sha256"
        }) or self.current is not None:
            raise TransferRejected
        scope = request.get("scope")
        info = self.scopes.get(scope)
        path = _safe_relative_path(request.get("path"), scope) if scope in SCOPES else ()
        name = "/".join(path)
        size = request.get("size")
        mode = request.get("mode")
        expected_hash = request.get("sha256")
        if (
            not info or info["complete"] or name in info["files"]
            or type(size) is not int or size < 0 or size > MAX_FILE_BYTES
            or type(mode) is not int
            or not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash)
            or len(info["files"]) >= info["expected_count"]
            or (scope == "source" and mode not in {0o644, 0o755})
            or (scope == "render" and mode != (0o600 if name == ".env" else 0o644))
        ):
            raise TransferRejected
        if (
            self._committed_bytes(scope) + size > info["expected_bytes"]
            or self._committed_bytes() + size > self.reserved_bytes
            or self._committed_bytes() + size > MAX_TOTAL_BYTES
        ):
            raise TransferRejected
        directory = info["directory"]
        for component in path[:-1]:
            directory = directory / component
            try:
                directory.mkdir(mode=0o700)
            except FileExistsError:
                pass
            dir_info = directory.lstat()
            if (
                stat.S_ISLNK(dir_info.st_mode)
                or not stat.S_ISDIR(dir_info.st_mode)
                or dir_info.st_uid != os.geteuid()
                or stat.S_IMODE(dir_info.st_mode) & 0o077
            ):
                raise TransferRejected
        target = directory / path[-1]
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".transfer-", suffix=".part", dir=directory
        )
        temporary = Path(temporary_name)
        self.current = {
            "scope": scope,
            "name": name,
            "target": target,
            "temporary": temporary,
            "handle": os.fdopen(descriptor, "wb"),
            "hash": hashlib.sha256(),
            "expected_size": size,
            "expected_hash": expected_hash,
            "mode": mode,
            "bytes": 0,
            "next_chunk": 0,
        }

    def write_chunk(self, request: dict[str, Any]) -> None:
        import base64

        current = self.current
        if (
            not _exact_keys(request, {
                "version", "request_id", "sequence", "operation", "deployment_id",
                "chunk_index", "data_base64"
            })
            or current is None
            or type(request.get("chunk_index")) is not int
            or request["chunk_index"] != current["next_chunk"]
            or not isinstance(request.get("data_base64"), str)
        ):
            raise TransferRejected
        try:
            data = base64.b64decode(request["data_base64"], validate=True)
        except (ValueError, TypeError):
            raise TransferRejected from None
        if not data or len(data) > CHUNK_BYTES or current["bytes"] + len(data) > current["expected_size"]:
            raise TransferRejected
        next_bytes = current["bytes"] + len(data)
        if (
            self._committed_bytes(current["scope"]) + next_bytes
            > self.scopes[current["scope"]]["expected_bytes"]
            or self._committed_bytes() + next_bytes > self.reserved_bytes
            or self._committed_bytes() + next_bytes > MAX_TOTAL_BYTES
        ):
            raise TransferRejected
        current["handle"].write(data)
        current["hash"].update(data)
        current["bytes"] += len(data)
        current["next_chunk"] += 1

    def finish_file(self, request: dict[str, Any]) -> None:
        current = self.current
        if (
            not _exact_keys(request, {
                "version", "request_id", "sequence", "operation", "deployment_id"
            })
            or current is None
        ):
            raise TransferRejected
        handle = current["handle"]
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        temp_info = current["temporary"].lstat()
        if (
            not stat.S_ISREG(temp_info.st_mode)
            or temp_info.st_nlink != 1
            or current["bytes"] != current["expected_size"]
            or current["hash"].hexdigest() != current["expected_hash"]
        ):
            self._discard_current()
            raise TransferChecksum
        if current["target"].exists() or current["target"].is_symlink():
            self._discard_current()
            raise TransferRejected
        os.chmod(current["temporary"], current["mode"])
        try:
            os.link(current["temporary"], current["target"], follow_symlinks=False)
            current["temporary"].unlink()
            directory_fd = os.open(current["target"].parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except FileExistsError:
            self._discard_current()
            raise TransferRejected from None
        scope = self.scopes[current["scope"]]
        scope["files"][current["name"]] = {
            "size": current["expected_size"],
            "sha256": current["expected_hash"],
            "mode": current["mode"],
        }
        self.current = None

    def complete_scope(self, request: dict[str, Any]) -> None:
        if not _exact_keys(request, {
            "version", "request_id", "sequence", "operation", "deployment_id",
            "scope", "file_count", "total_bytes", "manifest_sha256"
        }) or self.current is not None:
            raise TransferRejected
        scope_name = request.get("scope")
        scope = self.scopes.get(scope_name)
        files = scope["files"] if scope else {}
        total = sum(record["size"] for record in files.values())
        if (
            not scope or scope["complete"]
            or request.get("file_count") != scope["expected_count"]
            or request.get("total_bytes") != scope["expected_bytes"]
            or request.get("manifest_sha256") != scope["expected_manifest"]
            or len(files) != scope["expected_count"]
            or total != scope["expected_bytes"]
            or _manifest_digest(files) != scope["expected_manifest"]
        ):
            raise TransferChecksum
        marker = scope["directory"] / ".scope-complete"
        descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="ascii") as handle:
            handle.write(f"{scope['expected_manifest']}\n")
            handle.flush()
            os.fsync(handle.fileno())
        directory_fd = os.open(scope["directory"], os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        scope["complete"] = True
        if scope_name == "source":
            self.source_complete = True
        else:
            self.render_complete = True

    def cleanup_incomplete(self) -> None:
        self._discard_current()
        for scope in self.scopes.values():
            if not scope["complete"]:
                shutil.rmtree(scope["directory"], ignore_errors=True)
        try:
            self.directory.rmdir()
        except OSError:
            pass

    def _discard_current(self) -> None:
        current = self.current
        self.current = None
        if current is None:
            return
        try:
            current["handle"].close()
        except OSError:
            pass
        try:
            current["temporary"].unlink()
        except OSError:
            pass


def read_frame() -> dict[str, Any] | None:
    header = sys.stdin.buffer.read(4)
    if header == b"":
        return None
    if len(header) != 4:
        raise ValueError("TRUNCATED")
    length = struct.unpack(">I", header)[0]
    if length < 1 or length > MAX_FRAME:
        raise ValueError("LIMIT")
    body = sys.stdin.buffer.read(length)
    if len(body) != length:
        raise ValueError("TRUNCATED")
    value = json.loads(body.decode("utf-8"))
    if not isinstance(value, dict):
        raise TypeError("MALFORMED")
    return value


def write_frame(value: dict[str, Any]) -> None:
    body = json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    if not body or len(body) > MAX_OUTPUT:
        raise ValueError("LIMIT")
    sys.stdout.buffer.write(struct.pack(">I", len(body)) + body)
    sys.stdout.buffer.flush()


def reject(request: dict[str, Any], code: str) -> None:
    write_frame(
        {
            "version": VERSION,
            "request_id": request.get("request_id", "invalid"),
            "sequence": request.get("sequence", 0),
            "state": "rejected",
            "error_code": code,
        }
    )


class BoundedOutputBuffer:
    def __init__(self, max_bytes: int = 64 * 1024) -> None:
        self._max_bytes = max_bytes
        self._chunks: deque[str] = deque()
        self._current_bytes = 0
        self._lock = threading.Lock()

    def append(self, item: str | bytes) -> None:
        if not item:
            return
        if isinstance(item, bytes):
            text = item.decode("utf-8", errors="replace")
            byte_len = len(item)
        else:
            text = item
            byte_len = len(item.encode("utf-8", errors="replace"))

        with self._lock:
            if byte_len > self._max_bytes:
                encoded = text.encode("utf-8", errors="replace")
                text = encoded[-self._max_bytes:].decode("utf-8", errors="replace")
                byte_len = len(text.encode("utf-8", errors="replace"))

            self._chunks.append(text)
            self._current_bytes += byte_len
            while self._current_bytes > self._max_bytes and self._chunks:
                popped = self._chunks.popleft()
                self._current_bytes -= len(popped.encode("utf-8", errors="replace"))

    def get_tail(self, max_len: int = 4096) -> str:
        with self._lock:
            combined = "".join(self._chunks)
            return combined[-max_len:]

    def clear(self) -> None:
        with self._lock:
            self._chunks.clear()
            self._current_bytes = 0

    def __iter__(self):
        with self._lock:
            return iter(list(self._chunks))

    def __len__(self) -> int:
        with self._lock:
            return len(self._chunks)


def redact_secrets(text: str) -> str:
    # Log tùy ý có thể bị cắt giữa secret, không đưa raw tail qua wire.
    return "[REDACTED BUILD OUTPUT]" if text else ""


def main() -> int:
    execution: GuardedExecution | None = None
    transfer: TransferState | None = None
    identity: ExecutionIdentity | None = None
    deployment_id: int | None = None
    build_proc: subprocess.Popen[str] | None = None
    build_thread: threading.Thread | None = None
    build_image_tag: str | None = None
    build_source_sha: str | None = None
    build_state: str | None = None
    runtime: ProductRuntime | RecoveryRuntime | None = None
    output_buffer = BoundedOutputBuffer(max_bytes=64 * 1024)
    expected_sequence = 1
    seen_request_ids: set[str] = set()
    try:
        while True:
            request = read_frame()
            if request is None:
                return 0
            request_id = request.get("request_id")
            sequence = request.get("sequence")
            if not isinstance(request_id, str) or not re.fullmatch(
                r"[A-Za-z0-9_-]{1,128}", request_id
            ):
                reject(request, "SSH_PROTOCOL_MALFORMED")
                return 2
            if (
                request.get("version") != VERSION
                or not isinstance(request_id, str)
                or not request_id
                or type(sequence) is not int
                or sequence != expected_sequence
            ):
                reject(request, "SSH_PROTOCOL_SEQUENCE")
                return 2
            if sequence > MAX_MESSAGES:
                reject(request, "SSH_PROTOCOL_LIMIT")
                return 2
            if request_id in seen_request_ids:
                reject(request, "SSH_PROTOCOL_DUPLICATE")
                return 2
            seen_request_ids.add(request_id)
            operation = request.get("operation")
            if expected_sequence == 1:
                if operation == "open_recovery":
                    if not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                            "state_root",
                            "context",
                            "attestation",
                        },
                    ):
                        reject(request, "SSH_SETTLEMENT_REJECTED")
                        return 3
                    recovery_dep_id = request.get("deployment_id")
                    if not isinstance(recovery_dep_id, int) or recovery_dep_id < 1:
                        reject(request, "SSH_SETTLEMENT_REJECTED")
                        return 3
                    try:
                        runtime = RecoveryRuntime(
                            state_root=request.get("state_root"),
                            context=request.get("context"),
                            attestation=request.get("attestation"),
                        )
                        deployment_id = recovery_dep_id
                    except (RuntimeRejected, RuntimeUnknown, TargetGuardError) as error:
                        code = getattr(error, "code", "SSH_SETTLEMENT_REJECTED")
                        reject(request, code if code in TARGET_CODES else "SSH_SETTLEMENT_REJECTED")
                        return 3
                    except Exception:
                        reject(request, "SSH_SETTLEMENT_REJECTED")
                        return 3
                    write_frame(
                        {
                            "version": VERSION,
                            "request_id": request_id,
                            "sequence": sequence,
                            "state": "accepted",
                            "deployment_id": deployment_id,
                        }
                    )
                    expected_sequence += 1
                    continue
                if operation != "open" or set(request) != {
                    "version", "request_id", "sequence", "operation", "identity", "state_root", "deployment_id"
                }:
                    reject(request, "SSH_PROTOCOL_MALFORMED")
                    return 2
                state_root = request.get("state_root")
                target_identity = request.get("identity")
                candidate_deployment_id = request.get("deployment_id")
                if (
                    not isinstance(state_root, str)
                    or not Path(state_root).is_absolute()
                    or not isinstance(target_identity, dict)
                    or type(candidate_deployment_id) is not int
                    or candidate_deployment_id < 1
                ):
                    reject(request, "SSH_PROTOCOL_MALFORMED")
                    return 2
                try:
                    identity = ExecutionIdentity(
                        controller_id=target_identity["controller_id"],
                        app_id=target_identity["app_id"],
                        ownership_generation=target_identity["ownership_generation"],
                        claim_id=target_identity["claim_id"],
                        attempt_id=target_identity["attempt_id"],
                        app_fence=target_identity["app_fence"],
                    )
                    execution = acquire_execution(state_root, identity, timeout_seconds=5.0)
                    execution.__enter__()
                    transfer = TransferState(state_root, identity, candidate_deployment_id)
                except TargetGuardError as error:
                    reject(request, error.code if error.code in TARGET_CODES else "TARGET_MARKER_INVALID")
                    return 3
                except (KeyError, TypeError):
                    reject(request, "TARGET_IDENTITY_INVALID")
                    return 3
                except TransferRejected:
                    reject(request, "SSH_TRANSFER_REJECTED")
                    return 3
                deployment_id = candidate_deployment_id
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                    }
                )
            elif operation == "authorize_phase":
                if (
                    execution is None
                    or set(request) != {
                        "version", "request_id", "sequence", "operation", "phase", "deployment_id"
                    }
                    or request.get("deployment_id") != deployment_id
                    or request.get("phase") not in PHASES
                ):
                    reject(request, "TARGET_PHASE_REJECTED")
                    return 3
                try:
                    execution.authorize_write_phase(request["phase"])
                except TargetGuardError as error:
                    reject(request, error.code if error.code in TARGET_CODES else "TARGET_MARKER_INVALID")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                    }
                )
            elif operation == "close":
                if (
                    (execution is None and runtime is None)
                    or set(request) != {"version", "request_id", "sequence", "operation", "deployment_id"}
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "TARGET_EXECUTION_NOT_ACTIVE")
                    return 3
                if runtime is not None:
                    try:
                        runtime.close()
                    except Exception:
                        pass
                    runtime = None
                if build_proc is not None and build_proc.poll() is None:
                    try:
                        build_proc.terminate()
                        build_proc.wait(timeout=1)
                    except Exception:
                        try:
                            build_proc.kill()
                        except Exception:
                            pass
                if transfer is not None:
                    transfer.cleanup_incomplete()
                if execution is not None:
                    execution.__exit__(None, None, None)
                    execution = None
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                    }
                )
                return 0
            elif operation in {
                "begin_scope", "begin_file", "file_chunk", "finish_file", "complete_scope"
            }:
                if (
                    execution is None
                    or transfer is None
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "SSH_TRANSFER_REJECTED")
                    return 3
                try:
                    execution.authorize_write_phase("prepare")
                    if operation == "begin_scope":
                        transfer.begin_scope(request)
                    elif operation == "begin_file":
                        transfer.begin_file(request)
                    elif operation == "file_chunk":
                        transfer.write_chunk(request)
                    elif operation == "finish_file":
                        transfer.finish_file(request)
                    else:
                        transfer.complete_scope(request)
                except TargetGuardError as error:
                    reject(request, error.code if error.code in TARGET_CODES else "TARGET_MARKER_INVALID")
                    return 3
                except TransferChecksum:
                    reject(request, "SSH_TRANSFER_CHECKSUM")
                    return 3
                except TransferRejected:
                    reject(request, "SSH_TRANSFER_REJECTED")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                    }
                )
            elif operation == "start_build":
                if (
                    execution is None
                    or transfer is None
                    or identity is None
                    or not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                            "image_tag",
                            "source_sha",
                        },
                    )
                    or request.get("deployment_id") != deployment_id
                    or not transfer.source_complete
                    or not transfer.render_complete
                    or build_proc is not None
                ):
                    reject(request, "SSH_BUILD_REJECTED")
                    return 3
                image_tag = request.get("image_tag")
                source_sha = request.get("source_sha")
                if (
                    not isinstance(image_tag, str)
                    or not isinstance(source_sha, str)
                    or not re.fullmatch(r"[0-9a-f]{40}", source_sha)
                    or len(image_tag) > 256
                    or not re.fullmatch(
                        r"^[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*:[a-zA-Z0-9_.-]+$",
                        image_tag,
                    )
                ):
                    reject(request, "SSH_BUILD_REJECTED")
                    return 3
                dockerfile = transfer.directory / "render" / "Dockerfile"
                context_dir = transfer.directory / "source"
                if not dockerfile.is_file() or not context_dir.is_dir():
                    reject(request, "SSH_BUILD_REJECTED")
                    return 3
                try:
                    execution.authorize_write_phase("build")
                except TargetGuardError as error:
                    reject(
                        request,
                        error.code if error.code in TARGET_CODES else "TARGET_MARKER_INVALID",
                    )
                    return 3
                build_image_tag = image_tag
                build_source_sha = source_sha
                output_buffer.clear()
                try:
                    build_proc = subprocess.Popen(
                        [
                            "docker",
                            "build",
                            "-t",
                            image_tag,
                            "--label",
                            f"opspilot.app_id={identity.app_id}",
                            "--label",
                            f"opspilot.deployment_id={deployment_id}",
                            "--label",
                            f"org.opencontainers.image.revision={source_sha}",
                            "-f",
                            str(dockerfile),
                            str(context_dir),
                        ],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        bufsize=1,
                    )

                    def _drain_output(pipe: Any, buffer: BoundedOutputBuffer) -> None:
                        try:
                            while True:
                                chunk = pipe.read(4096)
                                if not chunk:
                                    break
                                buffer.append(chunk)
                        except Exception:
                            pass
                        finally:
                            try:
                                pipe.close()
                            except Exception:
                                pass

                    build_thread = threading.Thread(
                        target=_drain_output,
                        args=(build_proc.stdout, output_buffer),
                        daemon=True,
                    )
                    build_thread.start()
                except OSError:
                    reject(request, "SSH_BUILD_FAILED")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                        "build_state": "started",
                    }
                )
            elif operation == "poll_build":
                if (
                    execution is None
                    or not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                        },
                    )
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "SSH_BUILD_REJECTED")
                    return 3
                if build_proc is None or build_image_tag is None:
                    reject(request, "SSH_BUILD_NOT_ACTIVE")
                    return 3
                try:
                    execution.authorize_write_phase("build")
                except TargetGuardError as error:
                    reject(
                        request,
                        error.code if error.code in TARGET_CODES else "TARGET_MARKER_INVALID",
                    )
                    return 3
                returncode = build_proc.poll()
                if returncode is None:
                    write_frame(
                        {
                            "version": VERSION,
                            "request_id": request_id,
                            "sequence": sequence,
                            "state": "accepted",
                            "deployment_id": deployment_id,
                            "build_state": "running",
                        }
                    )
                elif returncode == 0:
                    image_id = ""
                    labels: dict[str, str] = {}
                    inspect_success = False
                    try:
                        inspect_res = subprocess.run(
                            ["docker", "inspect", build_image_tag],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True,
                            check=False,
                            timeout=10.0,
                        )
                        if inspect_res.returncode == 0:
                            inspected = json.loads(inspect_res.stdout)
                            if isinstance(inspected, list) and len(inspected) > 0:
                                raw_id = inspected[0].get("Id", "")
                                if isinstance(raw_id, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", raw_id):
                                    image_id = raw_id
                                raw_labels = inspected[0].get("Config", {}).get("Labels")
                                if isinstance(raw_labels, dict):
                                    if all(isinstance(k, str) and isinstance(v, str) for k, v in raw_labels.items()):
                                        labels = raw_labels
                                if (image_id
                                    and labels.get("opspilot.app_id") == str(identity.app_id)
                                    and labels.get("opspilot.deployment_id") == str(deployment_id)
                                    and labels.get("org.opencontainers.image.revision") == build_source_sha):
                                    inspect_success = True
                    except Exception:
                        inspect_success = False

                    if inspect_success:
                        build_state = "succeeded"
                        write_frame(
                            {
                                "version": VERSION,
                                "request_id": request_id,
                                "sequence": sequence,
                                "state": "accepted",
                                "deployment_id": deployment_id,
                                "build_state": "succeeded",
                                "exit_code": 0,
                                "image_id": image_id,
                                "image_tag": build_image_tag,
                                "labels": labels,
                            }
                        )
                    else:
                        build_state = "failed"
                        error_tail = redact_secrets(output_buffer.get_tail(4096))
                        write_frame(
                            {
                                "version": VERSION,
                                "request_id": request_id,
                                "sequence": sequence,
                                "state": "accepted",
                                "deployment_id": deployment_id,
                                "build_state": "failed",
                                "exit_code": 1,
                                "error_code": "SSH_BUILD_FAILED",
                                "error_tail": error_tail,
                            }
                        )
                else:
                    build_state = "failed"
                    error_tail = redact_secrets(output_buffer.get_tail(4096))
                    write_frame(
                        {
                            "version": VERSION,
                            "request_id": request_id,
                            "sequence": sequence,
                            "state": "accepted",
                            "deployment_id": deployment_id,
                            "build_state": "failed",
                            "exit_code": returncode,
                            "error_tail": error_tail,
                        }
                    )
            elif operation == "runtime_configure":
                if (
                    execution is None
                    or runtime is not None
                    or transfer is None
                    or build_state is None
                    or not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                            "context",
                        },
                    )
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                try:
                    runtime = ProductRuntime(
                        execution=execution,
                        transfer_directory=transfer.directory,
                        deployment_id=deployment_id,
                        build_state=build_state,
                        build_image_tag=build_image_tag,
                        build_source_sha=build_source_sha,
                    )
                    runtime.configure(request["context"])
                except (RuntimeRejected, RuntimeUnknown, TargetGuardError) as error:
                    code = getattr(error, "code", "SSH_RUNTIME_REJECTED")
                    reject(request, code if code in TARGET_CODES else "SSH_RUNTIME_REJECTED")
                    return 3
                except Exception:
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                    }
                )
            elif operation == "start_runtime_step":
                if (
                    runtime is None
                    or not isinstance(runtime, ProductRuntime)
                    or not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                            "step",
                        },
                    )
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                step = request.get("step")
                if not isinstance(step, str):
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                try:
                    runtime.start_step(step)
                except (RuntimeRejected, RuntimeUnknown, TargetGuardError) as error:
                    code = getattr(error, "code", "SSH_RUNTIME_REJECTED")
                    reject(request, code if code in TARGET_CODES else "SSH_RUNTIME_REJECTED")
                    return 3
                except Exception:
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                    }
                )
            elif operation == "poll_runtime":
                if (
                    runtime is None
                    or not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                        },
                    )
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                try:
                    progress = runtime.poll()
                except (RuntimeRejected, RuntimeUnknown, TargetGuardError) as error:
                    code = getattr(error, "code", "SSH_RUNTIME_REJECTED")
                    reject(request, code if code in TARGET_CODES else "SSH_RUNTIME_REJECTED")
                    return 3
                except Exception:
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                        "runtime": progress,
                    }
                )
            elif operation == "seal_runtime":
                if (
                    runtime is None
                    or not isinstance(runtime, ProductRuntime)
                    or not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                        },
                    )
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                try:
                    terminal = runtime.seal()
                except (RuntimeRejected, RuntimeUnknown, TargetGuardError) as error:
                    code = getattr(error, "code", "SSH_RUNTIME_REJECTED")
                    reject(request, code if code in TARGET_CODES else "SSH_RUNTIME_REJECTED")
                    return 3
                except Exception:
                    reject(request, "SSH_RUNTIME_REJECTED")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                        "terminal": terminal,
                    }
                )
            elif operation == "settle_runtime":
                if (
                    runtime is None
                    or not _exact_keys(
                        request,
                        {
                            "version",
                            "request_id",
                            "sequence",
                            "operation",
                            "deployment_id",
                            "attestation",
                        },
                    )
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "SSH_SETTLEMENT_REJECTED")
                    return 3
                try:
                    ack = runtime.settle(request["attestation"])
                except (RuntimeRejected, RuntimeUnknown, TargetGuardError) as error:
                    code = getattr(error, "code", "SSH_SETTLEMENT_REJECTED")
                    reject(request, code if code in TARGET_CODES else "SSH_SETTLEMENT_REJECTED")
                    return 3
                except Exception:
                    reject(request, "SSH_SETTLEMENT_REJECTED")
                    return 3
                write_frame(
                    {
                        "version": VERSION,
                        "request_id": request_id,
                        "sequence": sequence,
                        "state": "accepted",
                        "deployment_id": deployment_id,
                        "settlement": ack,
                    }
                )
            else:
                reject(request, "SSH_PROTOCOL_MALFORMED")
                return 2
            expected_sequence += 1
    except Exception:  # noqa: BLE001 - keep unexpected protocol errors off stderr.
        # Protocol failures are intentionally silent on stderr; the controller
        # will classify EOF as an unknown outcome without persisting raw text.
        return 2
    finally:
        if runtime is not None:
            try:
                runtime.close()
            except Exception:
                pass
        if build_proc is not None and build_proc.poll() is None:
            try:
                build_proc.terminate()
                build_proc.wait(timeout=1)
            except Exception:
                try:
                    build_proc.kill()
                except Exception:
                    pass
        if transfer is not None:
            transfer.cleanup_incomplete()
        if execution is not None:
            try:
                execution.__exit__(None, None, None)
            except TargetGuardError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
