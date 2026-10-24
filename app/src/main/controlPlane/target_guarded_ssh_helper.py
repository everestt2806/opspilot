"""Framed stdin/stdout protocol for one pinned SSH execution channel."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path
from typing import Any

from target_execution_guard import (
    ExecutionIdentity,
    GuardedExecution,
    TargetGuardError,
    acquire_execution,
)

VERSION = 1
MAX_FRAME = 16 * 1024
MAX_OUTPUT = 1024 * 1024
MAX_MESSAGES = 32
PHASES = {"prepare", "build", "activate", "rollback"}
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
}


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


def main() -> int:
    execution: GuardedExecution | None = None
    deployment_id: int | None = None
    expected_sequence = 1
    seen_request_ids: set[str] = set()
    try:
        while True:
            request = read_frame()
            if request is None:
                return 0
            request_id = request.get("request_id")
            sequence = request.get("sequence")
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
                except TargetGuardError as error:
                    reject(request, error.code if error.code in TARGET_CODES else "TARGET_MARKER_INVALID")
                    return 3
                except (KeyError, TypeError):
                    reject(request, "TARGET_IDENTITY_INVALID")
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
                    execution is None
                    or set(request) != {"version", "request_id", "sequence", "operation", "deployment_id"}
                    or request.get("deployment_id") != deployment_id
                ):
                    reject(request, "TARGET_EXECUTION_NOT_ACTIVE")
                    return 3
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
            else:
                reject(request, "SSH_PROTOCOL_MALFORMED")
                return 2
            expected_sequence += 1
    except Exception:  # noqa: BLE001 - keep unexpected protocol errors off stderr.
        # Protocol failures are intentionally silent on stderr; the controller
        # will classify EOF as an unknown outcome without persisting raw text.
        return 2
    finally:
        if execution is not None:
            try:
                execution.__exit__(None, None, None)
            except TargetGuardError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
