"""Gate Linux cho env-file authentication và fingerprint; không ghi giá trị ra log."""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/main/controlPlane"))
from target_product_runtime import ProductRuntime, RuntimeUnknown, _config_hash


class EnvironmentRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="opspilot-env-auth-")
        self.root = Path(self.tmp.name)
        (self.root / "render").mkdir(mode=0o700)
        self.path = self.root / "render/.env"
        self.key = bytes(range(32))
        self.reference = {
            "controller_id": "test",
            "ownership_generation": 1,
            "revision": 2,
        }
        self.context = {
            "claim": {"source_generation": 3, "attempt_id": "attempt"},
            "target": {"vps_id": 1},
            "environment": self.reference,
        }
        self.values = {
            "APP_TOKEN": '  $HOME "quote" \\ = # 日本語  ',
            "EMPTY": "",
            "UNICODE": "a\u0085b\u2028c\u2029d",
        }
        self.subject = object.__new__(ProductRuntime)
        self.subject.context = copy.deepcopy(self.context)
        self.subject.transfer_directory = self.root
        self.subject.secret = self.key
        self.write()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, *, values=None, header=None, marker="test:1:2:3"):
        values = self.values if values is None else values
        obj = {
            "format": 1,
            "claim": self.context["claim"],
            "target": self.context["target"],
            "reference": self.reference,
            "nonce": "a" * 64,
            "runtime_keys": sorted(values),
        }
        if header:
            obj.update(header)
        first = (
            "# opspilot-environment-v1 "
            + json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            + "\n"
        )
        body = (
            "OPSPILOT_CONFIG_REVISION="
            + marker
            + "\n"
            + "".join(f"{k}={v}\n" for k, v in sorted(values.items()))
        )
        derived = hmac.new(
            self.key, b"opspilot-env-transfer-key-v1", hashlib.sha256
        ).digest()
        signature = hmac.new(
            derived,
            b"opspilot-env-transfer-v1\n" + (first + body).encode(),
            hashlib.sha256,
        ).hexdigest()
        self.path.write_text(
            first + "# opspilot-environment-hmac " + signature + "\n" + body,
            encoding="utf-8",
        )
        os.chmod(self.path, 0o600)

    def reject(self):
        with self.assertRaises(RuntimeUnknown) as caught:
            self.subject._runtime_env_args()
        self.assertEqual(str(caught.exception), "SSH_RUNTIME_IDENTITY_MISMATCH")

    def test_literal_empty_and_unicode_separators(self):
        self.assertEqual(
            self.subject._runtime_env_args(), ["--env-file", str(self.path)]
        )

    def test_tamper_stripped_header_missing_and_wrong_key(self):
        original = self.path.read_text(encoding="utf-8")
        for content in [
            original.replace("$HOME", "$PATH"),
            "APP_TOKEN=x\n",
            original.split("\n", 1)[1],
        ]:
            with self.subTest(tamper=True):
                self.path.write_text(content, encoding="utf-8")
                self.reject()
        self.path.unlink()
        self.reject()
        self.write()
        self.subject.secret = b"x" * 32
        self.reject()

    def test_claim_target_reference_nonce_and_marker_are_bound(self):
        for header in [
            {"claim": {}},
            {"target": {}},
            {"reference": {**self.reference, "revision": 1}},
            {"nonce": "short"},
            {"runtime_keys": []},
        ]:
            with self.subTest(field=next(iter(header))):
                self.write(header=header)
                self.reject()
        self.write(marker="test:1:1:3")
        self.reject()

    def test_permissions_symlink_control_and_reserved_keys(self):
        os.chmod(self.path, 0o644)
        self.reject()
        self.write()
        alternate = self.root / "other"
        self.path.rename(alternate)
        self.path.symlink_to(alternate)
        self.reject()
        self.path.unlink()
        for values in [
            {"PORT": "4000"},
            {"VITE_BAD": "public"},
            {"APP_TOKEN": "a\nb"},
            {"APP_TOKEN": "x" * 8193},
        ]:
            self.write(values=values)
            self.reject()

    def test_no_environment_keeps_legacy_behavior(self):
        self.path.unlink()
        self.subject.context.pop("environment")
        self.assertEqual(self.subject._runtime_env_args(), [])

    def test_prepare_rejects_missing_env_before_inspecting_or_stopping_previous_runtime(
        self,
    ):
        self.subject.context["build_state"] = "build_succeeded"
        self.subject.commands = Mock()
        self.path.unlink()
        with self.assertRaises(RuntimeUnknown):
            self.subject._step_prepare()
        self.assertEqual(self.subject.commands.mock_calls, [])

    def test_keyed_config_hash_and_legacy_compatibility(self):
        raw = {
            "Config": {
                "Env": ["APP_TOKEN=synthetic", "OPSPILOT_CONFIG_REVISION=test:1:2:3"]
            },
            "HostConfig": {},
            "Mounts": [],
        }
        digest = _config_hash(raw, self.key)
        self.assertNotEqual(digest, _config_hash(raw, b"y" * 32))
        changed = copy.deepcopy(raw)
        changed["Config"]["Env"][0] = "APP_TOKEN=other"
        self.assertNotEqual(digest, _config_hash(changed, self.key))
        with self.assertRaises(RuntimeUnknown):
            _config_hash(raw)
        raw["Config"]["Env"].pop()
        self.assertEqual(_config_hash(raw), _config_hash(raw, self.key))


if __name__ == "__main__":
    unittest.main()
