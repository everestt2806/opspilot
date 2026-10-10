import json
import tempfile
import unittest
from pathlib import Path

from experiments.manifest import (
    DEFAULT_PROTOCOL_VERSION,
    LEGACY_PROTOCOL_DEFAULT,
    RunManifest,
    read_manifest,
    sha256_file,
    write_manifest,
)


class ManifestTests(unittest.TestCase):
    def test_rejects_clock_skew_and_short_completed_run(self) -> None:
        manifest = RunManifest(
            scenario="memory_leak",
            repeat_index=1,
            clock_offset_ms=2001,
            status="completed",
            actual_sample_count=1,
        )
        errors = manifest.validate()
        self.assertIn("clock_skew vượt 2000ms", errors)
        self.assertIn("sample count dưới 90% kỳ vọng", errors)

    def test_writes_manifest_and_hashes_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            csv = root / "metric_sample.csv"
            csv.write_text("seq\n1\n", encoding="utf-8")
            manifest = RunManifest("memory_leak", 1)
            write_manifest(root / "meta.json", manifest)
            self.assertEqual(len(sha256_file(csv)), 64)
            self.assertTrue((root / "meta.json").exists())

    def test_protocol_version_separate_from_feature_version(self) -> None:
        manifest = RunManifest("memory_leak", 1)
        self.assertEqual(manifest.protocol_version, DEFAULT_PROTOCOL_VERSION)
        self.assertEqual(manifest.protocol_version, "1.0")
        self.assertEqual(manifest.feature_version, "v1-5metrics-4feats-w20")
        self.assertNotEqual(manifest.protocol_version, manifest.feature_version)
        payload = manifest.to_json()
        self.assertIn("protocol_version", payload)
        self.assertEqual(payload["protocol_version"], "1.0")
        self.assertIn("feature_version", payload)

    def test_read_manifest_with_protocol_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "meta.json"
            manifest = RunManifest("cpu_spike", 2, protocol_version="1.1")
            write_manifest(target, manifest)
            loaded = read_manifest(target)
            self.assertEqual(loaded.protocol_version, "1.1")
            self.assertEqual(loaded.scenario, "cpu_spike")
            self.assertEqual(loaded.repeat_index, 2)

    def test_legacy_manifest_without_protocol_version_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "meta_legacy.json"
            legacy_data = {
                "scenario": "latency_creep",
                "repeat_index": 3,
                "feature_version": "v1-5metrics-4feats-w20",
                "integrity_errors": [],
            }
            target.write_text(json.dumps(legacy_data), encoding="utf-8")

            # Default fallback when protocol_version is absent
            loaded = read_manifest(target)
            self.assertEqual(loaded.protocol_version, LEGACY_PROTOCOL_DEFAULT)
            self.assertEqual(loaded.protocol_version, "legacy-pre-pilot")
            self.assertEqual(loaded.scenario, "latency_creep")
            self.assertEqual(loaded.feature_version, "v1-5metrics-4feats-w20")

            # Custom fallback override
            loaded_custom = read_manifest(target, default_protocol_version="1.0-compat")
            self.assertEqual(loaded_custom.protocol_version, "1.0-compat")


if __name__ == "__main__":
    unittest.main()
