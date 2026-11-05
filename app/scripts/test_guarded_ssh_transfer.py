"""Regression Linux/filesystem cho quota và tên file tạm của guarded SSH."""

from __future__ import annotations

import base64
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/main/controlPlane"))

import target_guarded_ssh_helper as helper
from target_execution_guard import ExecutionIdentity


class TransferQuotaTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="opspilot-transfer-test-")
        self.addCleanup(self.scratch.cleanup)
        root = Path(self.scratch.name)
        root.chmod(0o700)
        self.state = helper.TransferState(
            str(root),
            ExecutionIdentity("controller", "app", 1, "claim", "attempt", 1),
            1,
        )
        self.addCleanup(self.state.cleanup_incomplete)

    def request(self, operation, **fields):
        return dict(
            version=1,
            request_id="regression",
            sequence=1,
            operation=operation,
            deployment_id=1,
            **fields,
        )

    def scope(self, total, count=1, scope="source", records=None):
        self.state.begin_scope(
            self.request(
                "begin_scope",
                scope=scope,
                file_count=count,
                total_bytes=total,
                manifest_sha256=helper._manifest_digest(records or {}),
            )
        )

    def begin(self, name, content, scope="source", request_id=None):
        request = self.request(
            "begin_file",
            scope=scope,
            path=name,
            size=len(content),
            mode=0o600 if name == ".env" else 0o644,
            sha256=hashlib.sha256(content).hexdigest(),
        )
        if request_id is not None:
            request["request_id"] = request_id
        self.state.begin_file(request)

    def chunk(self, content):
        self.state.write_chunk(
            self.request(
                "file_chunk",
                chunk_index=0,
                data_base64=base64.b64encode(content).decode("ascii"),
            )
        )

    def finish(self):
        self.state.finish_file(self.request("finish_file"))

    def complete(self, scope="source"):
        info = self.state.scopes[scope]
        self.state.complete_scope(
            self.request(
                "complete_scope",
                scope=scope,
                file_count=info["expected_count"],
                total_bytes=info["expected_bytes"],
                manifest_sha256=info["expected_manifest"],
            )
        )

    def test_zero_budget_rejects_file_before_creating_directories(self):
        self.scope(0)
        with self.assertRaises(helper.TransferRejected):
            self.begin("nested/one.txt", b"A")
        self.assertFalse((self.state.directory / "source/nested").exists())
        self.assertIsNone(self.state.current)

    def test_exact_boundary_and_completed_scope_survive_cleanup(self):
        records = {
            "one.txt": {
                "size": 1,
                "sha256": hashlib.sha256(b"A").hexdigest(),
                "mode": 0o644,
            }
        }
        self.scope(1, records=records)
        self.begin("one.txt", b"A")
        self.chunk(b"A")
        self.finish()
        self.complete()
        self.state.cleanup_incomplete()
        self.assertEqual((self.state.directory / "source/one.txt").read_bytes(), b"A")

    def test_cumulative_files_reject_before_second_file_creation(self):
        self.scope(1, count=2)
        self.begin("first.txt", b"A")
        self.chunk(b"A")
        self.finish()
        with self.assertRaises(helper.TransferRejected):
            self.begin("nested/second.txt", b"B")
        self.assertFalse((self.state.directory / "source/nested").exists())

    def test_source_and_render_share_absolute_budget(self):
        records = {
            "one.txt": {
                "size": 1,
                "sha256": hashlib.sha256(b"A").hexdigest(),
                "mode": 0o644,
            }
        }
        with patch.object(helper, "MAX_TOTAL_BYTES", 2):
            self.scope(1, records=records)
            self.begin("one.txt", b"A")
            self.chunk(b"A")
            self.finish()
            self.complete()
            with self.assertRaises(helper.TransferRejected):
                self.scope(2, count=3, scope="render")
            self.assertFalse((self.state.directory / "render").exists())
            render_records = {
                name: {
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "mode": 0o600 if name == ".env" else 0o644,
                }
                for name, content in (
                    ("Dockerfile", b"B"),
                    ("docker-compose.yml", b""),
                    (".env", b""),
                )
            }
            self.scope(1, count=3, scope="render", records=render_records)
            self.begin("Dockerfile", b"B", scope="render")
            self.chunk(b"B")
            self.finish()
            with self.assertRaises(helper.TransferRejected):
                self.begin("docker-compose.yml", b"C", scope="render")
            for name in ("docker-compose.yml", ".env"):
                self.begin(name, b"", scope="render")
                self.finish()
            self.complete("render")
            self.assertEqual(self.state._committed_bytes(), 2)

    def test_chunk_rechecks_scope_budget_before_write(self):
        self.scope(1)
        self.begin("one.txt", b"A")
        self.state.scopes["source"]["expected_bytes"] = 0
        with self.assertRaises(helper.TransferRejected):
            self.chunk(b"A")
        self.assertEqual(self.state.current["handle"].tell(), 0)

    def test_chunk_rechecks_session_budget_before_write(self):
        self.scope(1)
        self.begin("one.txt", b"A")
        with (
            patch.object(helper, "MAX_TOTAL_BYTES", 0),
            self.assertRaises(helper.TransferRejected),
        ):
            self.chunk(b"A")
        self.assertEqual(self.state.current["handle"].tell(), 0)

    def test_temporary_name_independent_of_request_id(self):
        self.scope(1)
        source = self.state.directory / "source"
        (source / ".victim.X").mkdir(mode=0o700)
        self.begin("victim", b"A", request_id="X/../../../../../../escaped")
        temporary = self.state.current["temporary"]
        self.assertEqual(temporary.parent, source)
        self.assertTrue(temporary.name.startswith(".transfer-"))
        self.chunk(b"A")
        self.state.current["handle"].flush()
        self.assertFalse((Path(self.scratch.name) / "escaped.part").exists())

    def test_disconnect_cleanup_removes_current_file(self):
        self.scope(2)
        self.begin("one.txt", b"AB")
        self.chunk(b"A")
        temporary = self.state.current["temporary"]
        self.state.cleanup_incomplete()
        self.assertFalse(temporary.exists())
        self.assertFalse(self.state.directory.exists())


if __name__ == "__main__":
    unittest.main()
