import tempfile
import unittest
from pathlib import Path

from experiments.manifest import RunManifest, sha256_file, write_manifest


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


if __name__ == "__main__":
    unittest.main()
