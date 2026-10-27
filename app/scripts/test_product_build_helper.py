"""Retest hành vi an toàn sau handoff; không dùng Docker/socket/network."""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/main/controlPlane"))
import target_guarded_ssh_helper as helper
from target_execution_guard import initialize_enrollment


class ImmediateThread:
    def __init__(self, target, args, daemon):
        self.target, self.args = target, args
        self.lines = args[1]

    def start(self):
        self.target(*self.args)


class BuildReview(unittest.TestCase):
    def exercise(self, exit_code=0, inspect_failure=False, log="", labels=None, image_id=None):
        with tempfile.TemporaryDirectory(prefix="opspilot-helper-review-") as scratch:
            root = Path(scratch)
            state_root = root / "state"
            marker_path = initialize_enrollment(state_root, "controller", "1", 1)
            staging = root / "staging"
            (staging / "source").mkdir(parents=True)
            (staging / "render").mkdir()
            (staging / "render/Dockerfile").write_text("FROM scratch\n")
            identity = dict(controller_id="controller", app_id="1", ownership_generation=1,
                            claim_id="claim", attempt_id="attempt", app_fence=1)
            frames = [
                dict(operation="open", identity=identity, state_root=str(state_root)),
                dict(operation="start_build", image_tag="example:v1", source_sha="a" * 40),
                dict(operation="poll_build"), dict(operation="close"),
            ]
            for index, frame in enumerate(frames, 1):
                frame.update(version=1, request_id=f"review-{index}", sequence=index, deployment_id=1)
            transfer = SimpleNamespace(directory=staging, source_complete=True,
                                       render_complete=True, cleanup_incomplete=lambda: None)
            process = SimpleNamespace(stdout=io.StringIO(log), poll=lambda: exit_code)
            inspections = SimpleNamespace(returncode=1 if inspect_failure else 0,
                stdout="" if inspect_failure else json.dumps([{"Id": image_id if image_id is not None else "sha256:" + "a" * 64,
                     "Config": {"Labels": labels if labels is not None else {
                         "opspilot.app_id": "1", "opspilot.deployment_id": "1",
                         "org.opencontainers.image.revision": "a" * 40}}}]))
            responses, threads = [], []

            def thread(*args, **kwargs):
                value = ImmediateThread(*args, **kwargs)
                threads.append(value)
                return value

            with patch.object(helper, "read_frame", side_effect=frames), \
                 patch.object(helper, "write_frame", side_effect=responses.append), \
                 patch.object(helper, "TransferState", return_value=transfer), \
                 patch.object(helper.subprocess, "Popen", return_value=process) as build_call, \
                 patch.object(helper.subprocess, "run", return_value=inspections) as inspect_call, \
                 patch.object(helper.threading, "Thread", side_effect=thread):
                self.assertEqual(helper.main(), 0)
            self.assertEqual(json.loads(marker_path.read_text())["execution_state"], "unknown")
            self.assertIn("org.opencontainers.image.revision=" + "a" * 40, build_call.call_args.args[0])
            return responses[2], threads[0].lines, inspect_call

    def test_h1_r01_inspect_failure_cannot_claim_success(self):
        response, _, _ = self.exercise(inspect_failure=True)
        self.assertEqual(response["build_state"], "failed")
        self.assertNotIn("image_id", response)

    def test_h1_r03_raw_build_secret_is_withheld(self):
        response, _, _ = self.exercise(exit_code=1, log="TOKEN=REVIEW_FAKE_SECRET\n")
        self.assertEqual(response["build_state"], "failed")
        self.assertNotIn("REVIEW_FAKE_SECRET", response["error_tail"])

    def test_h1_r04_log_buffer_is_byte_bounded(self):
        _, lines, _ = self.exercise(exit_code=1, log="x" * (2 * 1024 * 1024) + "\n")
        self.assertLessEqual(sum(len(line.encode()) for line in lines), 64 * 1024)

    def test_h1_r04_inspect_has_target_timeout(self):
        _, _, inspect_call = self.exercise()
        self.assertLessEqual(inspect_call.call_args.kwargs["timeout"], 10)

    def test_post_004_quoted_prefixed_and_pkcs8_secrets(self):
        for value in ['{"token":"REVIEW_FAKE_SECRET"}', "password='REVIEW_FAKE_SECRET'",
                      'GITHUB_TOKEN=REVIEW_FAKE_SECRET',
                      '-----BEGIN PRIVATE KEY-----\nREVIEW_FAKE_SECRET\n-----END PRIVATE KEY-----']:
            with self.subTest(value=value):
                response, _, _ = self.exercise(exit_code=1, log=value)
                self.assertNotIn('REVIEW_FAKE_SECRET', response['error_tail'])

    def test_post_006_revision_and_identity_are_required_for_success(self):
        expected = {"opspilot.app_id": "1", "opspilot.deployment_id": "1",
                    "org.opencontainers.image.revision": "a" * 40}
        for labels in [{}, {**expected, "opspilot.app_id": "2"},
                       {**expected, "opspilot.deployment_id": "2"},
                       {**expected, "org.opencontainers.image.revision": "b" * 40},
                       {**expected, "opspilot.app_id": 1}, [], expected]:
            with self.subTest(labels=labels):
                response, _, _ = self.exercise(labels=labels)
                self.assertEqual(response["build_state"], "succeeded" if labels == expected else "failed")

    def test_h1_r01_malformed_image_ids_are_rejected(self):
        for image_id in ["", "sha256:short", "a" * 64, "sha256:" + "G" * 64]:
            with self.subTest(image_id=image_id):
                response, _, _ = self.exercise(image_id=image_id)
                self.assertEqual(response['build_state'], 'failed')


if __name__ == "__main__":
    unittest.main(verbosity=2)
