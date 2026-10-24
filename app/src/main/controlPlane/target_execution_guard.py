"""Linux target-side Product execution guard; no network/service side effects."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import tempfile
import time
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Phase = Literal["prepare", "build", "activate", "rollback"]
_PHASES = {"prepare", "build", "activate", "rollback"}
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_MARKER_KEYS = {
    "format",
    "controller_id",
    "app_id",
    "ownership_generation",
    "highest_accepted_fence",
    "last_claim_id",
    "last_attempt_id",
    "execution_state",
}


class TargetGuardError(Exception):
    """Stable, non-sensitive guard error."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ExecutionIdentity:
    controller_id: str
    app_id: str
    ownership_generation: int
    claim_id: str
    attempt_id: str
    app_fence: int

    def validate(self) -> None:
        for value in (self.controller_id, self.app_id, self.claim_id, self.attempt_id):
            if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
                raise TargetGuardError("TARGET_IDENTITY_INVALID")
        if (
            type(self.ownership_generation) is not int
            or self.ownership_generation < 1
            or type(self.app_fence) is not int
            or self.app_fence < 1
        ):
            raise TargetGuardError("TARGET_IDENTITY_INVALID")


def _identity_key(controller_id: str, app_id: str) -> str:
    # One target-local lock/marker slot per app; controller identity remains
    # checked against marker contents so a different controller is rejected.
    del controller_id
    return hashlib.sha256(app_id.encode()).hexdigest()


def _write_marker_atomic(marker_path: Path, marker: dict[str, object]) -> None:
    parent = marker_path.parent
    fd, temp_name = tempfile.mkstemp(prefix=".marker-", dir=parent)
    temp_path = Path(temp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(marker, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, marker_path)
        directory_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


def initialize_enrollment(
    state_root: str | os.PathLike[str], controller_id: str, app_id: str, ownership_generation: int
) -> Path:
    """Create an enrollment fixture only when the exact state root is absent."""
    identity = ExecutionIdentity(controller_id, app_id, ownership_generation, "init", "init", 1)
    identity.validate()
    root = Path(state_root)
    if root.exists() or root.is_symlink():
        raise TargetGuardError("TARGET_ALREADY_ENROLLED_OR_PATH_EXISTS")
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(root, 0o700)
    locks = root / "locks"
    locks.mkdir(mode=0o700)
    os.chmod(locks, 0o700)
    key = _identity_key(controller_id, app_id)
    marker_path = root / f"{key}.json"
    marker: dict[str, object] = {
        "format": 1,
        "controller_id": controller_id,
        "app_id": app_id,
        "ownership_generation": ownership_generation,
        "highest_accepted_fence": 0,
        "last_claim_id": None,
        "last_attempt_id": None,
        "execution_state": "idle",
    }
    _write_marker_atomic(marker_path, marker)
    return marker_path


def _read_marker(marker_path: Path) -> dict[str, object]:
    try:
        # A leftover temp is evidence of interrupted marker advancement. Never
        # ignore it and let an old idle marker authorize a replay.
        if any(marker_path.parent.glob(".marker-*")):
            raise TargetGuardError("TARGET_MARKER_INVALID")
        if marker_path.is_symlink():
            raise TargetGuardError("TARGET_MARKER_INVALID")
        mode = marker_path.lstat().st_mode
        if (
            not stat.S_ISREG(mode)
            or stat.S_IMODE(mode) & 0o077
            or marker_path.stat().st_uid != os.geteuid()
        ):
            raise TargetGuardError("TARGET_MARKER_INVALID")
        data = json.loads(marker_path.read_text(encoding="utf-8"))
    except TargetGuardError:
        raise
    except FileNotFoundError:
        raise TargetGuardError("TARGET_NOT_ENROLLED") from None
    except (OSError, UnicodeError):
        raise TargetGuardError("TARGET_MARKER_INVALID") from None
    except json.JSONDecodeError:
        raise TargetGuardError("TARGET_MARKER_INVALID") from None
    if not isinstance(data, dict) or set(data) != _MARKER_KEYS or data.get("format") != 1:
        raise TargetGuardError("TARGET_MARKER_INVALID")
    if (
        type(data.get("ownership_generation")) is not int
        or data["ownership_generation"] < 1
        or type(data.get("highest_accepted_fence")) is not int
        or data["highest_accepted_fence"] < 0
        or data.get("execution_state") not in {"idle", "unknown"}
        or (data.get("last_claim_id") is not None and not isinstance(data.get("last_claim_id"), str))
        or (data.get("last_attempt_id") is not None and not isinstance(data.get("last_attempt_id"), str))
    ):
        raise TargetGuardError("TARGET_MARKER_INVALID")
    return data


class GuardedExecution(AbstractContextManager["GuardedExecution"]):
    def __init__(self, root: Path, identity: ExecutionIdentity, timeout_seconds: float):
        self.root = root
        self.identity = identity
        self.timeout_seconds = timeout_seconds
        self._lock_file = None
        self._marker_path = root / f"{_identity_key(identity.controller_id, identity.app_id)}.json"

    def __enter__(self) -> GuardedExecution:  # noqa: PYI034 -- Keep Python 3.10 target compatibility.
        self.identity.validate()
        if self.timeout_seconds < 0 or self.timeout_seconds > 60:
            raise TargetGuardError("TARGET_LOCK_TIMEOUT_INVALID")
        lock_path = self.root / "locks" / f"{_identity_key(self.identity.controller_id, self.identity.app_id)}.lock"
        try:
            root_stat = self.root.stat()
            if (
                self.root.is_symlink()
                or not stat.S_ISDIR(root_stat.st_mode)
                or root_stat.st_uid != os.geteuid()
                or root_stat.st_mode & 0o077
            ):
                raise TargetGuardError("TARGET_MARKER_INVALID")
            lock_dir = lock_path.parent
            lock_dir_stat = lock_dir.stat()
            if (
                lock_dir.is_symlink()
                or not stat.S_ISDIR(lock_dir_stat.st_mode)
                or lock_dir_stat.st_uid != os.geteuid()
                or lock_dir_stat.st_mode & 0o077
            ):
                raise TargetGuardError("TARGET_MARKER_INVALID")
            flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(lock_path, flags, 0o600)
            lock_stat = os.fstat(fd)
            if (
                not stat.S_ISREG(lock_stat.st_mode)
                or lock_stat.st_uid != os.geteuid()
                or stat.S_IMODE(lock_stat.st_mode) & 0o077
            ):
                os.close(fd)
                raise TargetGuardError("TARGET_MARKER_INVALID")
            os.fchmod(fd, 0o600)
            self._lock_file = os.fdopen(fd, "r+b", buffering=0)
        except TargetGuardError:
            raise
        except OSError:
            raise TargetGuardError("TARGET_NOT_ENROLLED") from None

        deadline = time.monotonic() + self.timeout_seconds
        while True:
            try:
                fcntl.flock(self._lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    self._close_lock()
                    raise TargetGuardError("TARGET_LOCK_BUSY") from None
                time.sleep(min(0.025, max(0.0, deadline - time.monotonic())))

        try:
            marker = _read_marker(self._marker_path)
            if marker["controller_id"] != self.identity.controller_id or marker["app_id"] != self.identity.app_id:
                raise TargetGuardError("TARGET_IDENTITY_MISMATCH")
            if marker["ownership_generation"] != self.identity.ownership_generation:
                raise TargetGuardError("TARGET_OWNERSHIP_GENERATION_STALE")
            if marker["execution_state"] == "unknown":
                raise TargetGuardError("TARGET_EXECUTION_UNCERTAIN")
            if self.identity.app_fence <= marker["highest_accepted_fence"]:
                raise TargetGuardError("TARGET_FENCE_STALE")
            if self.identity.claim_id == marker["last_claim_id"] or self.identity.attempt_id == marker["last_attempt_id"]:
                raise TargetGuardError("TARGET_ATTEMPT_REPLAY")
            marker.update(
                highest_accepted_fence=self.identity.app_fence,
                last_claim_id=self.identity.claim_id,
                last_attempt_id=self.identity.attempt_id,
                execution_state="unknown",
            )
            _write_marker_atomic(self._marker_path, marker)
            return self
        except Exception:
            self._close_lock()
            raise

    def authorize_write_phase(self, phase: str) -> None:
        if phase not in _PHASES:
            raise TargetGuardError("TARGET_PHASE_REJECTED")
        marker = _read_marker(self._marker_path)
        if (
            marker["controller_id"] != self.identity.controller_id
            or marker["app_id"] != self.identity.app_id
            or marker["ownership_generation"] != self.identity.ownership_generation
            or marker["highest_accepted_fence"] != self.identity.app_fence
            or marker["last_claim_id"] != self.identity.claim_id
            or marker["last_attempt_id"] != self.identity.attempt_id
            or marker["execution_state"] != "unknown"
        ):
            raise TargetGuardError("TARGET_EXECUTION_UNCERTAIN")

    def _close_lock(self) -> None:
        if self._lock_file is not None:
            self._lock_file.close()
            self._lock_file = None

    def __exit__(self, exc_type, exc, traceback) -> None:
        self._close_lock()


def acquire_execution(
    state_root: str | os.PathLike[str], identity: ExecutionIdentity, timeout_seconds: float = 5.0
) -> GuardedExecution:
    """Return a context manager; keep it entered across the complete write region."""
    return GuardedExecution(Path(state_root), identity, timeout_seconds)
