#!/usr/bin/env python3
"""Real Linux process lab for the Product target execution guard."""

from __future__ import annotations

import fcntl
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/main/controlPlane"))
import target_execution_guard as guard


def identity(app: str, fence: int = 1, **overrides: object) -> guard.ExecutionIdentity:
    values: dict[str, object] = {
        "controller_id": "controller-lab",
        "app_id": app,
        "ownership_generation": 1,
        "claim_id": f"claim-{fence}",
        "attempt_id": f"attempt-{fence}",
        "app_fence": fence,
    }
    values.update(overrides)
    return guard.ExecutionIdentity(**values)  # type: ignore[arg-type]


def worker(root: Path, app: str, counter: Path, hold: float, fence: int, ready: Path | None = None) -> int:
    try:
        with guard.acquire_execution(root, identity(app, fence), timeout_seconds=4) as execution:
            execution.authorize_write_phase("prepare")
            with counter.open("a", encoding="ascii") as output:
                output.write(f"{app}:{fence}\n")
                output.flush()
                os.fsync(output.fileno())
            if ready:
                ready.touch()
            time.sleep(hold)
        return 0
    except guard.TargetGuardError as error:
        print(error.code, flush=True)
        return 20


def child(*args: str) -> subprocess.Popen[str]:
    return subprocess.Popen([sys.executable, __file__, *args], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def expect_rejected(root: Path, value: guard.ExecutionIdentity, expected: str) -> None:
    try:
        with guard.acquire_execution(root, value) as execution:
            execution.authorize_write_phase("prepare")
    except guard.TargetGuardError as error:
        assert error.code == expected, (expected, error.code)
    else:
        raise AssertionError(f"expected {expected}")


def assert_os_lock_state(root: Path, app: str, should_be_held: bool) -> None:
    key = guard._identity_key("controller-lab", app)
    with (root / "locks" / f"{key}.lock").open("r+b") as lock_file:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            assert should_be_held, "OS lock remained held after execution ended"
            return
        else:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            assert not should_be_held, "OS lock was not held through mutation phase"


def main() -> None:
    if len(sys.argv) < 2:
        raise RuntimeError("HARNESS_SCRATCH_REQUIRED")
    scratch = Path(sys.argv[1]) / "lab"
    scratch.mkdir(mode=0o700)
    children: list[subprocess.Popen[str]] = []
    try:
        root_a = scratch / "app-a"
        counter_a = scratch / "counter-a.txt"
        guard.initialize_enrollment(root_a, "controller-lab", "app-a", 1)

        first = child("worker", str(root_a), "app-a", str(counter_a), "0.7", "1")
        children.append(first)
        deadline = time.monotonic() + 3
        while not counter_a.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert counter_a.exists(), "first worker failed to enter guarded write phase"
        assert_os_lock_state(root_a, "app-a", should_be_held=True)
        second = child("worker", str(root_a), "app-a", str(counter_a), "0", "2")
        children.append(second)
        first_out, first_err = first.communicate(timeout=5)
        second_out, second_err = second.communicate(timeout=5)
        assert first.returncode == 0, (first.returncode, first_out, first_err)
        assert second.returncode == 20 and "TARGET_EXECUTION_UNCERTAIN" in second_out, (second.returncode, second_out, second_err)
        assert counter_a.read_text(encoding="ascii").splitlines() == ["app-a:1"]
        assert_os_lock_state(root_a, "app-a", should_be_held=False)
        print("same_app_competition=one_mutation successor=blocked_unknown")

        busy_root = scratch / "lock-timeout"
        guard.initialize_enrollment(busy_root, "controller-lab", "lock-timeout", 1)
        lock_key = guard._identity_key("controller-lab", "lock-timeout")
        lock_path = busy_root / "locks" / f"{lock_key}.lock"
        lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(lock_fd, "r+b") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                try:
                    with guard.acquire_execution(busy_root, identity("lock-timeout"), timeout_seconds=0.05):
                        raise AssertionError("guard stole a held OS lock")
                except guard.TargetGuardError as error:
                    assert error.code == "TARGET_LOCK_BUSY"
                assert_os_lock_state(busy_root, "lock-timeout", should_be_held=True)
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        print("lock_timeout=busy_without_steal")

        root_c = scratch / "app-c"
        guard.initialize_enrollment(root_c, "controller-lab", "app-c", 1)
        root_b = scratch / "app-b"
        counter_b = scratch / "counter-b.txt"
        guard.initialize_enrollment(root_b, "controller-lab", "app-b", 1)
        ready_c = scratch / "ready-c"
        ready_b = scratch / "ready-b"
        proc_a = child("worker", str(root_c), "app-c", str(scratch / "counter-c.txt"), "0.5", "1", str(ready_c))
        proc_b = child("worker", str(root_b), "app-b", str(counter_b), "0.5", "1", str(ready_b))
        children.extend((proc_a, proc_b))
        deadline = time.monotonic() + 3
        while not (ready_c.exists() and ready_b.exists()) and time.monotonic() < deadline:
            time.sleep(0.01)
        assert ready_c.exists() and ready_b.exists(), "independent app executions did not overlap"
        out_a, err_a = proc_a.communicate(timeout=4)
        out_b, err_b = proc_b.communicate(timeout=4)
        assert proc_a.returncode == 0, (proc_a.returncode, out_a, err_a)
        assert proc_b.returncode == 0, (proc_b.returncode, out_b, err_b)
        assert counter_b.read_text(encoding="ascii").splitlines() == ["app-b:1"]
        print("independent_apps=separate_locks_and_markers")

        expect_rejected(root_a, identity("app-a", 3, ownership_generation=2), "TARGET_OWNERSHIP_GENERATION_STALE")
        expect_rejected(root_a, identity("app-a", 3, controller_id="other-controller"), "TARGET_IDENTITY_MISMATCH")
        expect_rejected(root_a, identity("other-app", 3), "TARGET_NOT_ENROLLED")
        expect_rejected(root_a, identity("app-a", 1), "TARGET_EXECUTION_UNCERTAIN")
        fence_root = scratch / "old-fence"
        guard.initialize_enrollment(fence_root, "controller-lab", "old-fence", 1)
        fence_marker = next(fence_root.glob("*.json"))
        fence_data = json.loads(fence_marker.read_text(encoding="utf-8"))
        fence_data["highest_accepted_fence"] = 8
        guard._write_marker_atomic(fence_marker, fence_data)
        expect_rejected(fence_root, identity("old-fence", 8), "TARGET_FENCE_STALE")
        print("stale_generation=blocked wrong_controller=blocked old_fence=blocked replay_after_restart=blocked")

        missing_root = scratch / "missing"
        try:
            with guard.acquire_execution(missing_root, identity("missing")):
                raise AssertionError("missing enrollment accepted")
        except guard.TargetGuardError as error:
            assert error.code == "TARGET_NOT_ENROLLED"
        corrupt_root = scratch / "corrupt"
        guard.initialize_enrollment(corrupt_root, "controller-lab", "corrupt", 1)
        marker = next(corrupt_root.glob("*.json"))
        marker.write_text("{broken", encoding="ascii")
        try:
            with guard.acquire_execution(corrupt_root, identity("corrupt")):
                raise AssertionError("corrupt marker accepted")
        except guard.TargetGuardError as error:
            assert error.code == "TARGET_MARKER_INVALID"
        print("missing_and_corrupt_markers=blocked")

        phase_root = scratch / "phase-validation"
        guard.initialize_enrollment(phase_root, "controller-lab", "phase-validation", 1)
        try:
            with guard.acquire_execution(phase_root, identity("phase-validation")) as execution:
                try:
                    execution.authorize_write_phase("caller-shell-text")
                except guard.TargetGuardError as error:
                    assert error.code == "TARGET_PHASE_REJECTED"
                else:
                    raise AssertionError("unrecognized write phase accepted")
                marker_path = next(phase_root.glob("*.json"))
                marker_data = json.loads(marker_path.read_text(encoding="utf-8"))
                marker_data["highest_accepted_fence"] = 2
                guard._write_marker_atomic(marker_path, marker_data)
                try:
                    execution.authorize_write_phase("build")
                except guard.TargetGuardError as error:
                    assert error.code == "TARGET_EXECUTION_UNCERTAIN"
                else:
                    raise AssertionError("changed authority accepted for later phase")
        except guard.TargetGuardError as error:
            if error.code not in {"TARGET_PHASE_REJECTED", "TARGET_EXECUTION_UNCERTAIN"}:
                raise
        phase_marker = next(phase_root.glob("*.json"))
        phase_data = json.loads(phase_marker.read_text(encoding="utf-8"))
        assert phase_data["execution_state"] == "unknown"
        print("fixed_phase_allowlist=arbitrary_phase_blocked")

        crash_root = scratch / "crash"
        guard.initialize_enrollment(crash_root, "controller-lab", "crash", 1)
        ready = scratch / "crash-ready"
        crashing = child("worker", str(crash_root), "crash", str(scratch / "crash-counter"), "30", "1", str(ready))
        children.append(crashing)
        deadline = time.monotonic() + 3
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert ready.exists(), "crash worker did not reach mutation"
        os.kill(crashing.pid, signal.SIGKILL)
        crashing.wait(timeout=3)
        expect_rejected(crash_root, identity("crash", 2), "TARGET_EXECUTION_UNCERTAIN")
        print("process_killed_during_mutation=successor_blocked")

        partial_root = scratch / "partial-marker"
        marker_path = guard.initialize_enrollment(partial_root, "controller-lab", "partial", 1)
        original = marker_path.read_bytes()
        crashing_marker = child("partial", str(partial_root))
        children.append(crashing_marker)
        out, err = crashing_marker.communicate(timeout=3)
        assert crashing_marker.returncode == 77, (crashing_marker.returncode, out, err)
        assert marker_path.read_bytes() == original, "partial write replaced durable marker"
        # Crash occurred before guard returned; orphan temp evidence blocks retry.
        expect_rejected(partial_root, identity("partial"), "TARGET_MARKER_INVALID")
        print("crash_before_atomic_replace=old_marker_intact orphan_temp_blocks_replay")

        try:
            guard.initialize_enrollment(partial_root, "controller-lab", "partial", 1)
        except guard.TargetGuardError as error:
            assert error.code == "TARGET_ALREADY_ENROLLED_OR_PATH_EXISTS"
        else:
            raise AssertionError("initializer adopted existing path")
        print("initializer_existing_path=refused")
        print(json.dumps({"lab": "PASS", "linux_processes": True, "remote_deploy": False}))
    finally:
        for process in children:
            if process.poll() is None:
                process.kill()
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=2)
        import shutil

        shutil.rmtree(scratch, ignore_errors=False)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "worker":
        _, _, root, app, counter, hold, fence, *ready = sys.argv
        raise SystemExit(worker(Path(root), app, Path(counter), float(hold), int(fence), Path(ready[0]) if ready else None))
    if len(sys.argv) > 1 and sys.argv[1] == "partial":
        _, _, root = sys.argv
        marker_path = next(Path(root).glob("*.json"))
        def die_before_replace(_path: Path, _marker: dict[str, object]) -> None:
            (Path(root) / ".marker-interrupted.tmp").write_text('{"partial":', encoding="ascii")
            os._exit(77)
        guard._write_marker_atomic = die_before_replace  # type: ignore[assignment]
        with guard.acquire_execution(root, identity("partial")):
            raise SystemExit(99)
    main()
