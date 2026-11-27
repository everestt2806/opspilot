"""Runner IO với process Linux riêng; không giả lập kết quả PostgreSQL/Docker gate."""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

if sys.platform != "linux":
    raise unittest.SkipTest("Linux target runtime required")
sys.dont_write_bytecode = True
sys.path.insert(
    0, str(Path(__file__).resolve().parents[3] / "app/src/main/controlPlane")
)
import target_product_runtime as runtime


class DockerIoTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="opspilot-postgres-io-")
        self.addCleanup(self.directory.cleanup)
        script = Path(self.directory.name) / "docker"
        script.write_text(
            f"#!{sys.executable}\n"
            + """
import hashlib,json,os,sys,time
mode=sys.argv[1]
if mode=='slow': time.sleep(10)
elif mode=='close-input':
    os.close(0);time.sleep(0.1);print('completed')
elif mode=='fail':
    print('SYNTHETIC_STDERR_SENTINEL',file=sys.stderr);sys.exit(42)
elif mode=='huge': os.write(1,b'x'*70000)
elif mode=='invalid-utf8': os.write(1,b'\\xff')
else:
    data=sys.stdin.buffer.read()
    print(json.dumps({'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}))
""",
            encoding="utf-8",
        )
        script.chmod(0o700)
        self.environment = patch.dict(
            os.environ, {"PATH": self.directory.name + os.pathsep + os.environ["PATH"]}
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.subject = runtime.DockerCommands()

    def test_bounded_stdin_and_output_complete_without_pipe_deadlock(self):
        data = b"SYNTHETIC_INPUT_ONLY" * 3000
        result = json.loads(self.subject.run(["echo"], input_bytes=data))
        self.assertEqual(
            result, {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        )
        self.assertFalse(self.subject.active)

    def test_oversized_input_rejected_before_spawning(self):
        with (
            patch.object(runtime.subprocess, "Popen") as spawn,
            self.assertRaises(runtime.RuntimeRejected),
        ):
            self.subject.run(["echo"], input_bytes=b"x" * (65536 + 1))
        spawn.assert_not_called()
        self.assertFalse(self.subject.active)

    def test_read_failure_after_valid_output_is_unknown_without_raw_thread_exception(
        self,
    ):
        real_spawn = subprocess.Popen

        class BrokenReader:
            def __init__(self, source):
                self.source, self.reads = source, 0

            def read(self, size):
                self.reads += 1
                if self.reads > 1:
                    raise OSError("SYNTHETIC_READ_SENTINEL")
                return self.source.read(size)

            def close(self):
                self.source.close()

        def spawn(*args, **kwargs):
            process = real_spawn(*args, **kwargs)
            process.stdout = BrokenReader(process.stdout)
            return process

        for capture in (True, False):
            with self.subTest(capture=capture):
                stderr = io.StringIO()
                with (
                    contextlib.redirect_stderr(stderr),
                    patch.object(runtime.subprocess, "Popen", spawn),
                    self.assertRaises(runtime.RuntimeUnknown) as error,
                ):
                    self.subject.run(["echo"], capture=capture)
                self.assertNotIn(
                    "SYNTHETIC_READ_SENTINEL", str(error.exception) + stderr.getvalue()
                )
                self.assertFalse(self.subject.active)

    def test_stdout_close_failure_cannot_become_success(self):
        real_spawn = subprocess.Popen

        class BrokenClose:
            def __init__(self, source):
                self.source = source

            def read(self, size):
                return self.source.read(size)

            def close(self):
                self.source.close()
                raise OSError("SYNTHETIC_CLOSE_SENTINEL")

        def spawn(*args, **kwargs):
            process = real_spawn(*args, **kwargs)
            process.stdout = BrokenClose(process.stdout)
            return process

        with (
            patch.object(runtime.subprocess, "Popen", spawn),
            self.assertRaises(runtime.RuntimeUnknown),
        ):
            self.subject.run(["echo"])
        self.assertFalse(self.subject.active)

    def test_timeout_terminates_blocked_writer_and_resets_activity(self):
        started = time.monotonic()
        with self.assertRaises(runtime.RuntimeUnknown) as error:
            self.subject.run(["slow"], timeout=0.05, input_bytes=b"x" * 65536)
        self.assertEqual(error.exception.code, "SSH_RUNTIME_TIMEOUT")
        self.assertLess(time.monotonic() - started, 2)
        self.assertFalse(self.subject.active)

    def test_closed_input_cannot_be_success_even_if_process_exits_zero(self):
        real_spawn = subprocess.Popen

        def spawn(*args, **kwargs):
            process = real_spawn(*args, **kwargs)
            # Kernel có thể nhận đủ64KiB trước khi child đóng stdin; ép pipe4KiB
            # để chứng minh nhánh write-error thật, không suy đoán từ exit code.
            fcntl.fcntl(process.stdin.fileno(), fcntl.F_SETPIPE_SZ, 4096)
            return process

        with (
            patch.object(runtime.subprocess, "Popen", spawn),
            self.assertRaises(runtime.RuntimeUnknown),
        ):
            self.subject.run(["close-input"], input_bytes=b"x" * 65536)
        self.assertFalse(self.subject.active)

    def test_nonzero_invalid_utf8_and_oversized_output_have_only_safe_errors(self):
        for mode in ("fail", "invalid-utf8", "huge"):
            with (
                self.subTest(mode=mode),
                self.assertRaises(runtime.RuntimeUnknown) as error,
            ):
                self.subject.run([mode])
            self.assertNotIn("SYNTHETIC_STDERR_SENTINEL", str(error.exception))
            self.assertFalse(self.subject.active)

    def test_discarded_output_is_drained_and_cancellation_prevents_spawn(self):
        self.assertEqual(self.subject.run(["huge"], capture=False), "")
        self.subject.cancelled.set()
        with (
            patch.object(runtime.subprocess, "Popen") as spawn,
            self.assertRaises(runtime.RuntimeUnknown),
        ):
            self.subject.run(["echo"])
        spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
