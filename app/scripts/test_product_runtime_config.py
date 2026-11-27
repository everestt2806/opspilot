"""Runtime identity must ignore Docker mount enumeration order, not configuration changes."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/main/controlPlane"))

from target_product_runtime import _config_hash


class RuntimeConfigIdentityTests(unittest.TestCase):
    def fixture(self):
        return {
            "Config": {"Env": ["PORT=3000"], "Labels": {"opspilot.app_id": "1"}},
            "HostConfig": {
                "Memory": 134217728,
                "RestartPolicy": {"Name": "unless-stopped"},
            },
            "Mounts": [
                {
                    "Type": "bind",
                    "Source": "/opt/opspilot/app/metrics",
                    "Destination": "/var/metrics",
                    "RW": True,
                },
                {
                    "Type": "bind",
                    "Source": "/var/run/docker.sock",
                    "Destination": "/var/run/docker.sock",
                    "RW": False,
                },
            ],
        }

    def test_mount_enumeration_order_does_not_change_runtime_identity(self):
        original = self.fixture()
        reordered = copy.deepcopy(original)
        reordered["Mounts"].reverse()
        self.assertEqual(_config_hash(original), _config_hash(reordered))

    def test_mount_and_container_configuration_changes_still_change_identity(self):
        original = self.fixture()
        baseline = _config_hash(original)
        for part, field, value in [
            ("Config", "Env", ["PORT=4000"]),
            ("HostConfig", "Memory", 268435456),
            ("HostConfig", "RestartPolicy", {"Name": "no"}),
        ]:
            with self.subTest(part=part, field=field):
                changed = copy.deepcopy(original)
                changed[part][field] = value
                self.assertNotEqual(baseline, _config_hash(changed))
        for field, value in [
            ("Source", "/other"),
            ("Destination", "/other"),
            ("RW", False),
            ("Type", "volume"),
        ]:
            with self.subTest(mount_field=field):
                changed = copy.deepcopy(original)
                changed["Mounts"][0][field] = value
                self.assertNotEqual(baseline, _config_hash(changed))


if __name__ == "__main__":
    unittest.main()
