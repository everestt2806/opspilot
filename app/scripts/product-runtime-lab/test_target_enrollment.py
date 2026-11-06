"""Kiểm filesystem Linux thật và crash/concurrency của production bootstrap."""

import base64
import copy
import hashlib
import hmac
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / "app/src/main/controlPlane/target_enrollment.py"


@unittest.skipUnless(
    sys.platform == "linux", "Filesystem và flock/renameat2 là Linux-only"
)
class TargetEnrollmentTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("enrollment_subject", SOURCE)
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)
        self.temp = tempfile.TemporaryDirectory(prefix="opspilot-target-enroll-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / "targets"
        self.key = os.urandom(32)
        self.slot = hashlib.sha256(b"test-controller").hexdigest() + "-app-1"
        self.final = self.base / ("controller-" + self.slot)
        catalog = json.loads(
            (REPO / "app/control-plane-runtime/bundle-files.json").read_text()
        )
        assets = {
            name: (REPO / source).read_bytes() for name, source in catalog.items()
        }
        assets["control-plane.cjs"] = b"SYNTHETIC_ENTRYPOINT"
        manifest = json.dumps(
            {
                "format": 1,
                "node_major": 22,
                "entrypoint": "control-plane.cjs",
                "files": [
                    {
                        "path": name,
                        "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                    for name, data in sorted(assets.items())
                ],
            },
            separators=(",", ":"),
        )
        payload = {
            "format": 1,
            "purpose": "product-target-enrollment",
            "controller_id": "test-controller",
            "app_id": 1,
            "ownership_generation": 1,
            "manifest_sha256": hashlib.sha256(manifest.encode()).hexdigest(),
            "target_root": str(self.base),
            "state_root": str(self.final / "state"),
            "helper_path": str(self.final / "helpers/target_guarded_ssh_helper.py"),
            "target": {
                "vps_id": 1,
                "host": "target.test",
                "port": 22,
                "username": "deploy",
                "auth_type": "key",
                "host_fingerprint": "SHA256:" + "A" * 43,
                "ssh_security_revision": 1,
            },
        }
        self.request = {
            "format": 1,
            "operation": "enroll",
            "payload": payload,
            "manifest": manifest,
            "key": base64.b64encode(self.key).decode(),
            "helpers": {
                name: base64.b64encode(assets["target-helper/" + name]).decode()
                for name in self.api.HELPERS
            },
        }

    def inspect(self):
        request = copy.deepcopy(self.request)
        request.update(operation="inspect", helpers={})
        return self.api.handle(request)

    def snapshot(self):
        return {
            str(p.relative_to(self.final)): (
                p.stat().st_ino,
                p.stat().st_mtime_ns,
                p.read_bytes(),
            )
            for p in self.final.rglob("*")
            if p.is_file()
        }

    def test_absence_probe_never_creates_base(self):
        self.assertEqual(self.inspect(), {"state": "absent"})
        self.assertFalse(self.base.exists())

    def test_install_proof_and_replay_preserve_every_file(self):
        result = self.api.handle(self.request)
        self.assertEqual(result["state"], "enrolled")
        payload = result["proof"]["payload"]
        expected = hmac.new(
            self.key,
            b"opspilot-target-enrollment-v1\n"
            + json.dumps(
                payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
            ).encode(),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(result["proof"]["signature"], expected)
        before = self.snapshot()
        self.assertEqual(self.inspect(), result)
        self.assertEqual(self.api.handle(self.request), result)
        self.assertEqual(before, self.snapshot())
        for path in self.final.rglob("*"):
            self.assertEqual(path.stat().st_mode & 0o077, 0)

    def test_other_key_generation_or_binding_cannot_adopt_installed_path(self):
        self.api.handle(self.request)
        before = self.snapshot()
        for field in ["key", "generation", "binding"]:
            request = copy.deepcopy(self.request)
            if field == "key":
                request["key"] = base64.b64encode(os.urandom(32)).decode()
            elif field == "generation":
                request["payload"]["ownership_generation"] = 2
            else:
                request["payload"]["target"]["ssh_security_revision"] = 2
            with self.assertRaises((self.api.EnrollmentRejected, OSError)):
                self.api.handle(request)
        self.assertEqual(before, self.snapshot())

    def test_partial_existing_directory_is_never_overwritten(self):
        self.final.mkdir(parents=True, mode=0o700)
        self.base.chmod(0o700)
        (self.final / "foreign").write_bytes(b"KEEP")
        with self.assertRaises((self.api.EnrollmentRejected, OSError)):
            self.api.handle(self.request)
        self.assertEqual((self.final / "foreign").read_bytes(), b"KEEP")
        self.assertFalse((self.final / "state").exists())

    def test_tampered_or_linked_helper_rejected_without_repair(self):
        self.api.handle(self.request)
        helper = self.final / "helpers/target_execution_guard.py"
        original = helper.read_bytes()
        helper.write_bytes(b"CHANGED")
        with self.assertRaises(self.api.EnrollmentRejected):
            self.inspect()
        self.assertEqual(helper.read_bytes(), b"CHANGED")
        helper.write_bytes(original)
        saved = Path(self.temp.name) / "saved"
        helper.rename(saved)
        helper.symlink_to(saved)
        with self.assertRaises((self.api.EnrollmentRejected, OSError)):
            self.inspect()
        helper.unlink()
        saved.rename(helper)
        os.link(helper, Path(self.temp.name) / "outside-hardlink")
        with self.assertRaises(self.api.EnrollmentRejected):
            self.inspect()

    def test_unsafe_mode_and_foreign_owner_rejected(self):
        self.api.handle(self.request)
        receipt = self.final / "enrollment.json"
        receipt.chmod(0o644)
        with self.assertRaises(self.api.EnrollmentRejected):
            self.inspect()
        receipt.chmod(0o600)
        if os.geteuid() == 0:
            os.chown(receipt, 65534, 65534)
            with self.assertRaises(self.api.EnrollmentRejected):
                self.inspect()
            os.chown(receipt, 0, 0)

    def test_loss_after_publish_can_only_reconcile_exact_receipt(self):
        publish = self.api._publish

        def lose_reply(stage, final):
            publish(stage, final)
            raise OSError("SIMULATED_LOSS_AFTER_REAL_RENAME")

        with patch.object(self.api, "_publish", lose_reply), self.assertRaises(OSError):
            self.api.handle(self.request)
        before = self.snapshot()
        self.assertEqual(self.inspect()["state"], "enrolled")
        self.assertEqual(before, self.snapshot())

    def test_crash_during_stage_blocks_reinstall(self):
        script = f"""import importlib.util,sys,json,os
s=importlib.util.spec_from_file_location('subject',{str(SOURCE)!r})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
write=m._write
def crash(path,value):
 write(path,value);os._exit(73)
m._write=crash
m.handle(json.load(sys.stdin))
"""
        child = subprocess.run(
            [sys.executable, "-B", "-c", script],
            input=json.dumps(self.request),
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
        self.assertEqual(child.returncode, 73)
        self.assertFalse(self.final.exists())
        self.assertTrue(list(self.base.glob(".stage-*")))
        for operation in [
            self.request,
            {**self.request, "operation": "inspect", "helpers": {}},
        ]:
            with self.assertRaises(self.api.EnrollmentRejected):
                self.api.handle(operation)

    def test_two_processes_do_not_replace_another_enrollment(self):
        processes = [
            subprocess.Popen(
                [sys.executable, "-B", str(SOURCE)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(2)
        ]
        for process in processes:
            process.stdin.write(json.dumps(self.request))
            process.stdin.close()
        responses = []
        for process in processes:
            responses.append(json.loads(process.stdout.read()))
            process.wait(timeout=15)
            process.stdout.close()
            process.stderr.close()
        self.assertTrue(any(value["state"] == "enrolled" for value in responses))
        self.assertEqual(self.inspect()["state"], "enrolled")
        self.assertFalse(list(self.base.glob(".stage-*")))

    def test_runtime_guard_accepts_marker_and_inspect_does_not_clear_unknown(self):
        self.api.handle(self.request)
        sys.path.insert(0, str(self.final / "helpers"))
        try:
            import target_execution_guard as guard

            identity = guard.ExecutionIdentity(
                "test-controller", "1", 1, "claim-1", "attempt-1", 1
            )
            with guard.acquire_execution(self.final / "state", identity):
                pass
        finally:
            sys.path.pop(0)
        before = self.snapshot()
        self.assertEqual(self.inspect()["state"], "enrolled")
        self.assertEqual(before, self.snapshot())

    def test_invalid_manifest_and_path_reject_before_creating_base(self):
        for kind in ["manifest", "path", "key", "unknown-field"]:
            request = copy.deepcopy(self.request)
            if kind == "manifest":
                request["manifest"] += " "
            elif kind == "path":
                request["payload"]["target_root"] += "/../escape"
            elif kind == "key":
                request["key"] = "invalid"
            else:
                request["extra"] = "unknown"
            with self.assertRaises((self.api.EnrollmentRejected, ValueError)):
                self.api.handle(request)
        self.assertFalse(self.base.exists())


if __name__ == "__main__":
    unittest.main()
