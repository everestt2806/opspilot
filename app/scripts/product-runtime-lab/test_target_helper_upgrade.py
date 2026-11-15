"""Target engine thật: pinned bytes, flock, explicit recovery/cancel và SIGKILL."""

import base64
import copy
import fcntl
import hashlib
import hmac
import json
import os
import signal
import subprocess
import sys
import unittest
import uuid
from unittest.mock import patch

import test_target_enrollment as fixture


@unittest.skipUnless(
    sys.platform == "linux", "Linux filesystem/flock/renameat2 required"
)
class TargetHelperUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.TargetEnrollmentTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.api = self.fixture.api
        self.final = self.fixture.final
        self.base = self.fixture.base
        self.key = self.fixture.key
        self.slot = self.fixture.slot
        self.current = copy.deepcopy(self.fixture.request)
        # Real historical payload bytes; fake entrypoint is unused by target enrollment.
        source = (
            fixture.REPO
            / "app/resources/controller-releases/linux-x64-node22-20261113-spa-retained/release/payload"
        )
        self.old = copy.deepcopy(self.current)
        self.old["manifest"] = (source / "bundle-manifest.json").read_text()
        self.old["payload"]["manifest_sha256"] = hashlib.sha256(
            self.old["manifest"].encode()
        ).hexdigest()
        self.old["helpers"] = {
            name: base64.b64encode(
                (source / "target-helper" / name).read_bytes()
            ).decode()
            for name in self.api.HELPERS
        }
        self.api.handle(self.old)
        self.lock = (
            self.final / "state/locks" / (hashlib.sha256(b"1").hexdigest() + ".lock")
        )
        self.lock.touch(mode=0o600)
        self.packet = {
            "format": 1,
            "operation": "upgrade",
            "request_key": str(uuid.uuid4()),
            "review_sha256": "a" * 64,
            "framework": "express",
            "key": self.current["key"],
            "from": {"payload": self.old["payload"], "manifest": self.old["manifest"]},
            "to": {
                "payload": self.current["payload"],
                "manifest": self.current["manifest"],
                "helpers": self.current["helpers"],
            },
        }

    def call(self, operation="upgrade", packet=None):
        return self.api.handle({**(packet or self.packet), "operation": operation})

    def snapshot(self):
        return self.fixture.snapshot()

    def journal(self):
        return self.base / (".upgrade-" + self.slot + "-" + self.packet["request_key"])

    def assert_receipt(self, response, state, packet=None):
        packet = packet or self.packet
        self.assertEqual(response["state"], state)
        payload = response["receipt"]["payload"]
        self.assertEqual(payload["state"], state)
        self.assertEqual(payload["request_key"], packet["request_key"])
        expected = hmac.new(
            self.key,
            self.api.UPGRADE_DOMAIN + self.api._canonical(payload),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(response["receipt"]["signature"], expected)
        proof = response["proof"]
        self.assertEqual(
            payload["enrollment_proof_sha256"],
            hashlib.sha256(self.api._canonical(proof)).hexdigest() if proof else None,
        )
        if state == "pending":
            self.assertIsNone(proof)
        else:
            self.assertEqual(
                proof["payload"],
                packet["to" if state == "applied" else "from"]["payload"],
            )

    def partial(self, boundary=1):
        original = self.api._upgrade_replace
        count = 0

        def interrupted(*args):
            nonlocal count
            original(*args)
            count += 1
            if count == boundary:
                raise RuntimeError("SYNTHETIC_STOP_AFTER_REPLACE")

        with (
            patch.object(self.api, "_upgrade_replace", interrupted),
            self.assertRaises(RuntimeError),
        ):
            self.call()

    def test_upgrade_preserves_state_key_guards_locks_and_every_unrelated_file(self):
        before = self.snapshot()
        self.assert_receipt(self.call(), "applied")
        after = self.snapshot()
        changed = {
            "helpers/target_product_runtime.py",
            "release-manifest.json",
            "enrollment.json",
        }
        self.assertEqual(set(before), set(after))
        self.assertEqual(
            {name: value for name, value in before.items() if name not in changed},
            {name: value for name, value in after.items() if name not in changed},
        )
        self.assertTrue((self.journal() / "terminal.json").is_file())
        self.assertEqual(self.journal().stat().st_mode & 0o777, 0o700)
        self.assertTrue(
            all(
                path.stat().st_mode & 0o777 == 0o600
                for path in self.journal().iterdir()
                if path.is_file()
            )
        )
        self.assertNotIn(
            self.key,
            b"".join(
                path.read_bytes() for path in self.journal().iterdir() if path.is_file()
            ),
        )
        for operation in [
            "upgrade",
            "inspect-upgrade",
            "recover-upgrade",
            "cancel-upgrade",
        ]:
            snapshot = self.snapshot()
            self.assert_receipt(self.call(operation), "applied")
            self.assertEqual(snapshot, self.snapshot())

    def test_inspect_recover_absent_are_unsettled_and_cancel_blocks_late_upgrade(self):
        before = self.snapshot()
        for operation in ["inspect-upgrade", "recover-upgrade"]:
            result = self.call(operation)
            self.assert_receipt(result, "not_applied")
            self.assertFalse(result["receipt"]["payload"]["settled"])
            self.assertFalse(self.journal().exists())
            self.assertEqual(before, self.snapshot())
        cancelled = self.call("cancel-upgrade")
        self.assert_receipt(cancelled, "not_applied")
        self.assertTrue(cancelled["receipt"]["payload"]["settled"])
        self.assertTrue(self.journal().exists())
        self.assert_receipt(self.call(), "not_applied")
        self.assertEqual(before, self.snapshot())

    def test_inspection_does_not_create_a_missing_runtime_lock(self):
        self.lock.unlink()
        before = self.snapshot()
        with self.assertRaises(FileNotFoundError):
            self.call("inspect-upgrade")
        self.assertEqual(before, self.snapshot())

    def test_partial_never_replays_without_explicit_recover(self):
        self.partial()
        before = self.snapshot()
        for operation in ["upgrade", "inspect-upgrade"]:
            self.assert_receipt(self.call(operation), "pending")
            self.assertEqual(before, self.snapshot())
        self.assert_receipt(self.call("recover-upgrade"), "applied")

    def test_cancel_reverts_exact_old_bytes_and_cold_recover_keeps_cancelled_decision(
        self,
    ):
        before = {name: item[2] for name, item in self.snapshot().items()}
        self.partial(2)
        self.assert_receipt(self.call("cancel-upgrade"), "not_applied")
        self.assertEqual(
            before, {name: item[2] for name, item in self.snapshot().items()}
        )
        snapshot = self.snapshot()
        self.assert_receipt(self.call("recover-upgrade"), "not_applied")
        self.assertEqual(snapshot, self.snapshot())

    def test_unknown_execution_rejects_before_journal_or_helpers(self):
        path = self.final / "state" / (hashlib.sha256(b"1").hexdigest() + ".json")
        value = json.loads(path.read_bytes())
        value["execution_state"] = "unknown"
        path.write_text(json.dumps(value))
        before = self.snapshot()
        with self.assertRaisesRegex(self.api.EnrollmentRejected, "RUNTIME_UNKNOWN"):
            self.call()
        self.assertFalse(self.journal().exists())
        self.assertEqual(before, self.snapshot())

    def test_both_existing_locks_exclude_upgrade_without_mutation(self):
        for path in [self.lock, self.base / (".enroll-" + self.slot + ".lock")]:
            with path.open("rb") as held:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                before = self.snapshot()
                with self.assertRaisesRegex(self.api.EnrollmentRejected, "BUSY"):
                    self.call()
                self.assertEqual(before, self.snapshot())

    def test_unrecognized_bytes_and_corrupt_journal_are_never_overwritten(self):
        for name in [
            "intent.json",
            "decision.json",
            "before-runtime",
            "after-runtime",
            "before-manifest",
            "after-manifest",
            "before-receipt",
            "after-receipt",
        ]:
            with self.subTest(name=name):
                if not self.journal().exists():
                    self.partial()
                path = self.journal() / name
                original = path.read_bytes()
                path.write_bytes(original + b"CORRUPT")
                before = self.snapshot()
                with self.assertRaises((self.api.EnrollmentRejected, ValueError)):
                    self.call("recover-upgrade")
                self.assertEqual(before, self.snapshot())
                path.write_bytes(original)
        runtime = self.final / "helpers/target_product_runtime.py"
        runtime.write_bytes(b"UNKNOWN_RUNTIME")
        before = self.snapshot()
        with self.assertRaisesRegex(self.api.EnrollmentRejected, "TARGET_CHANGED"):
            self.call("recover-upgrade")
        self.assertEqual(before, self.snapshot())

    def test_terminal_tamper_rejected_and_foreign_pending_uuid_cannot_begin(self):
        self.partial()
        other = {**self.packet, "request_key": str(uuid.uuid4())}
        before = self.snapshot()
        with self.assertRaises((self.api.EnrollmentRejected, FileNotFoundError)):
            self.call(packet=other)
        self.assertEqual(before, self.snapshot())
        self.call("recover-upgrade")
        path = self.journal() / "terminal.json"
        value = json.loads(path.read_bytes())
        value["signature"] = "0" * 64
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(self.api.EnrollmentRejected, "JOURNAL_INVALID"):
            self.call("inspect-upgrade")
        before = self.snapshot()
        with self.assertRaisesRegex(self.api.EnrollmentRejected, "JOURNAL_INVALID"):
            self.call("recover-upgrade")
        self.assertEqual(before, self.snapshot())

    def test_framework_matrix_and_oldest_express(self):
        for framework in ["express", "static-spa", "nextjs"]:
            packet = {**self.packet, "framework": framework}
            self.assert_receipt(self.call("inspect-upgrade", packet), "not_applied")
        source = (
            fixture.REPO
            / "app/resources/controller-releases/linux-x64-node22-20261110/release/payload"
        )
        packet = copy.deepcopy(self.packet)
        packet["from"]["manifest"] = (source / "bundle-manifest.json").read_text()
        packet["from"]["payload"]["manifest_sha256"] = hashlib.sha256(
            packet["from"]["manifest"].encode()
        ).hexdigest()
        self.api._upgrade_validate(
            packet
        )  # Pin eb5c allowed only for Express; actual bytes still require enrollment inspect.
        packet["framework"] = "static-spa"
        with self.assertRaisesRegex(self.api.EnrollmentRejected, "TRANSITION_REJECTED"):
            self.api._upgrade_validate(packet)

    def test_packet_binding_unknown_guard_and_tampered_key_reject(self):
        for kind in ["binding", "key", "guard", "uuid", "bytes"]:
            packet = copy.deepcopy(self.packet)
            if kind == "binding":
                packet["to"]["payload"]["target"]["host"] = "foreign.test"
            elif kind == "key":
                packet["key"] = base64.b64encode(os.urandom(32)).decode()
            elif kind == "uuid":
                packet["request_key"] = "invalid"
            elif kind == "bytes":
                packet["to"]["helpers"]["target_product_runtime.py"] = base64.b64encode(
                    b"unknown"
                ).decode()
            else:
                manifest = json.loads(packet["to"]["manifest"])
                for entry in manifest["files"]:
                    if entry["path"].endswith("/target_execution_guard.py"):
                        entry["sha256"] = "0" * 64
                packet["to"]["manifest"] = json.dumps(manifest)
                packet["to"]["payload"]["manifest_sha256"] = hashlib.sha256(
                    packet["to"]["manifest"].encode()
                ).hexdigest()
            before = self.snapshot()
            with self.assertRaises((self.api.EnrollmentRejected, ValueError)):
                self.call(packet=packet)
            self.assertEqual(before, self.snapshot())

    def test_actual_SIGKILL_after_each_file_replace_then_inspect_and_explicit_recover(
        self,
    ):
        child = """
import importlib.util,json,os,signal,sys
spec=importlib.util.spec_from_file_location('subject',sys.argv[1]); api=importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
boundary=int(sys.argv[2]); original=api._upgrade_replace; count=0
def interrupted(*args):
 global count
 original(*args); count+=1
 if count==boundary: os.kill(os.getpid(),signal.SIGKILL)
api._upgrade_replace=interrupted
api.handle(json.load(sys.stdin))
"""
        for boundary in [1, 2, 3, 4]:
            with self.subTest(boundary=boundary):
                # Fresh independently enrolled slot per boundary, not a SQL adoption shortcut.
                if boundary != 1:
                    self.fixture.doCleanups()
                    self.setUp()
                result = subprocess.run(
                    [sys.executable, "-c", child, str(fixture.SOURCE), str(boundary)],
                    input=json.dumps(self.packet),
                    text=True,
                    capture_output=True,
                    timeout=20,
                    check=False,
                )
                self.assertEqual(result.returncode, -signal.SIGKILL)
                before = self.snapshot()
                self.assert_receipt(
                    self.call("inspect-upgrade"),
                    "applied" if boundary >= 3 else "pending",
                )
                self.assertEqual(before, self.snapshot())
                self.assert_receipt(self.call("recover-upgrade"), "applied")

    def test_actual_SIGKILL_before_and_after_journal_publication(self):
        child = """
import importlib.util,json,os,signal,sys
spec=importlib.util.spec_from_file_location('subject',sys.argv[1]); api=importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
original=api._publish
def stop(*args):
 if sys.argv[2]=='before': os.kill(os.getpid(),signal.SIGKILL)
 original(*args); os.kill(os.getpid(),signal.SIGKILL)
api._publish=stop
api.handle(json.load(sys.stdin))
"""
        for boundary in ["before", "after"]:
            if boundary == "after":
                self.fixture.doCleanups()
                self.setUp()
            before = self.snapshot()
            result = subprocess.run(
                [sys.executable, "-c", child, str(fixture.SOURCE), boundary],
                input=json.dumps(self.packet),
                text=True,
                capture_output=True,
                timeout=20,
                check=False,
            )
            self.assertEqual(result.returncode, -signal.SIGKILL)
            self.assertEqual(before, self.snapshot())
            self.assert_receipt(
                self.call("inspect-upgrade"),
                "not_applied" if boundary == "before" else "pending",
            )
            if boundary == "before":
                with self.assertRaisesRegex(self.api.EnrollmentRejected, "UNCERTAIN"):
                    self.call()
                self.assert_receipt(self.call("cancel-upgrade"), "not_applied")
                self.assert_receipt(self.call(), "not_applied")
            else:
                self.assert_receipt(self.call("recover-upgrade"), "applied")

    def test_actual_SIGKILL_after_cancel_decision_then_recovery_restores_old(self):
        self.partial(2)
        child = """
import importlib.util,json,os,signal,sys
spec=importlib.util.spec_from_file_location('subject',sys.argv[1]); api=importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
original=api._upgrade_replace
def stop(*args):
 original(*args); os.kill(os.getpid(),signal.SIGKILL)
api._upgrade_replace=stop
api.handle(json.load(sys.stdin))
"""
        result = subprocess.run(
            [sys.executable, "-c", child, str(fixture.SOURCE)],
            input=json.dumps({**self.packet, "operation": "cancel-upgrade"}),
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
        self.assertEqual(result.returncode, -signal.SIGKILL)
        self.assert_receipt(self.call("inspect-upgrade"), "pending")
        self.assert_receipt(self.call("recover-upgrade"), "not_applied")
        self.assert_receipt(self.call(), "not_applied")

    def test_independent_bootstrap_CLI_sanitizes_errors_and_never_prints_key(self):
        result = subprocess.run(
            [sys.executable, str(fixture.SOURCE)],
            input=json.dumps(self.packet),
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assert_receipt(json.loads(result.stdout), "applied")
        self.assertNotIn(self.packet["key"], result.stdout)
        invalid = {**self.packet, "password": "SYNTHETIC_SECRET_CANARY"}
        result = subprocess.run(
            [sys.executable, str(fixture.SOURCE)],
            input=json.dumps(invalid),
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["state"], "rejected")
        self.assertNotIn("SYNTHETIC_SECRET_CANARY", result.stdout + result.stderr)

    def test_all_four_pinned_framework_pairs_can_actually_replace_the_runtime(self):
        root = fixture.REPO / "app/resources/controller-releases"
        for app_id, (framework, release) in enumerate(
            [
                ("express", "linux-x64-node22-20261110"),
                ("static-spa", "linux-x64-node22-20261113-spa-retained"),
                ("nextjs", "linux-x64-node22-20261113-spa-retained"),
            ],
            start=2,
        ):
            old = copy.deepcopy(self.old)
            source = root / release / "release/payload"
            old["manifest"] = (source / "bundle-manifest.json").read_text()
            old["helpers"] = {
                name: base64.b64encode(
                    (source / "target-helper" / name).read_bytes()
                ).decode()
                for name in self.api.HELPERS
            }
            directory = self.base / (
                "controller-"
                + hashlib.sha256(b"test-controller").hexdigest()
                + "-app-"
                + str(app_id)
            )
            old["payload"].update(
                app_id=app_id,
                state_root=str(directory / "state"),
                helper_path=str(directory / "helpers/target_guarded_ssh_helper.py"),
                manifest_sha256=hashlib.sha256(old["manifest"].encode()).hexdigest(),
            )
            self.api.handle(old)
            target = copy.deepcopy(self.current["payload"])
            target.update(
                app_id=app_id,
                state_root=str(directory / "state"),
                helper_path=str(directory / "helpers/target_guarded_ssh_helper.py"),
            )
            packet = {
                **self.packet,
                "request_key": str(uuid.uuid4()),
                "framework": framework,
                "from": {"payload": old["payload"], "manifest": old["manifest"]},
                "to": {**self.packet["to"], "payload": target},
            }
            before = {
                str(path): (path.stat().st_ino, path.read_bytes())
                for path in (directory / "state").iterdir()
                if path.is_file()
            }
            self.assert_receipt(self.call(packet=packet), "applied", packet)
            self.assertEqual(
                before,
                {
                    str(path): (path.stat().st_ino, path.read_bytes())
                    for path in (directory / "state").iterdir()
                    if path.is_file()
                },
            )

    def test_two_process_apply_and_cancel_races_have_one_consistent_terminal(self):
        for operations in [("upgrade", "upgrade"), ("upgrade", "cancel-upgrade")]:
            if operations[1] == "cancel-upgrade":
                self.fixture.doCleanups()
                self.setUp()
            processes = [
                subprocess.Popen(
                    [sys.executable, str(fixture.SOURCE)],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for _ in operations
            ]
            for process, operation in zip(processes, operations):
                process.stdin.write(json.dumps({**self.packet, "operation": operation}))
                process.stdin.close()
            responses = []
            for process in processes:
                process.wait(timeout=20)
                self.assertEqual(process.stderr.read(), "")
                responses.append(json.loads(process.stdout.read()))
                process.stdout.close()
                process.stderr.close()
            positive = [value for value in responses if value["state"] != "rejected"]
            self.assertTrue(positive)
            final = self.call("inspect-upgrade")
            self.assertIn(final["state"], {"applied", "not_applied"})
            for value in positive:
                self.assert_receipt(value, final["state"])
                self.assertTrue(value["receipt"]["payload"]["settled"])
            for value in responses:
                if value["state"] == "rejected":
                    self.assertEqual(value["code"], "TARGET_HELPER_UPGRADE_BUSY")

    def test_FIFO_and_symlink_target_files_cannot_block_or_redirect_the_CLI(self):
        path = self.final / "helpers/target_product_runtime.py"
        original = path.read_bytes()
        for kind in ["fifo", "symlink"]:
            path.unlink()
            if kind == "fifo":
                os.mkfifo(path, mode=0o600)
            else:
                path.symlink_to(self.final / "enrollment.json")
            result = subprocess.run(
                [sys.executable, str(fixture.SOURCE)],
                input=json.dumps(self.packet),
                text=True,
                capture_output=True,
                timeout=5,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)["state"], "rejected")
            path.unlink()
            path.write_bytes(original)
            path.chmod(0o600)


def outcome_probe():
    """Private pipe to native Node verifier; caller supplies synthetic RAM-only HMAC key."""
    value = json.loads(sys.stdin.buffer.read(1025))
    key = base64.b64decode(value["key"], validate=True)
    if len(key) != 32 or base64.b64encode(key).decode() != value["key"]:
        raise ValueError("PROBE_KEY_INVALID")
    random = os.urandom
    cases = []
    subject = TargetHelperUpgradeTests()

    def start():
        with patch.object(
            os, "urandom", side_effect=lambda n: key if n == 32 else random(n)
        ):
            subject.setUp()

    def capture(name, operation):
        packet = subject.packet
        cases.append(
            {
                "name": name,
                "expected": {
                    "request_key": packet["request_key"],
                    "review_sha256": packet["review_sha256"],
                    "from": packet["from"]["payload"],
                    "to": packet["to"]["payload"],
                },
                "response": subject.call(operation),
            }
        )

    try:
        start()
        capture("absent_unsettled", "inspect-upgrade")
        subject.partial()
        capture("partial_unsettled", "inspect-upgrade")
        capture("applied_settled", "recover-upgrade")
        old_directory = subject.fixture.temp.name
        if not subject.doCleanups() or os.path.exists(old_directory):
            raise RuntimeError("PROBE_CLEANUP_FAILED")
        start()
        capture("cancelled_settled", "cancel-upgrade")
    finally:
        old_directory = subject.fixture.temp.name
        if not subject.doCleanups() or os.path.exists(old_directory):
            raise RuntimeError("PROBE_CLEANUP_FAILED")
    print(json.dumps({"cases": cases, "private_cleanup": True}, separators=(",", ":")))


if __name__ == "__main__" and sys.argv[1:] == ["--outcome-probe"]:
    outcome_probe()
elif __name__ == "__main__":
    unittest.main()
