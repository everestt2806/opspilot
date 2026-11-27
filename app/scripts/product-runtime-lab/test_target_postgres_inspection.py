"""Linux filesystem and finite-operation guards; Docker/SSH gate remains separate."""

import copy
import hashlib
import importlib.util
import io
import json
import os
import sys
import types
import unittest
from unittest.mock import patch

import test_target_enrollment as enrollment_fixture

REPO = enrollment_fixture.REPO
SOURCE = enrollment_fixture.SOURCE

SUBJECT = REPO / "app/src/main/controlPlane/target_postgres_inspection.py"


@unittest.skipUnless(
    sys.platform == "linux", "Target filesystem/flock protocol is Linux-only"
)
class TargetPostgresInspectionTests(unittest.TestCase):
    setUp = enrollment_fixture.TargetEnrollmentTests.setUp
    snapshot = enrollment_fixture.TargetEnrollmentTests.snapshot

    def reader(self):
        spec = importlib.util.spec_from_file_location(
            "postgres_inspection_subject", SUBJECT
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def packet(self):
        request = copy.deepcopy(self.request)
        request.update(operation="inspect", helpers={})
        return {
            "format": 1,
            "read": {"operation": "inspect"},
            "enrollment": request,
            "enrollment_source": SOURCE.read_text(),
            "database_id": "11111111-1111-4111-8111-111111111111",
            "credentials": {"admin_password": "a" * 48, "app_password": "b" * 48},
        }

    def wire(self, reader, packet, pin=None):
        raw = json.dumps(packet).encode() if isinstance(packet, dict) else packet
        output = io.StringIO()
        with (
            patch.object(
                reader,
                "EXPECTED_ENROLLMENT_SHA256",
                pin or hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
            ),
            patch.object(sys, "stdin", types.SimpleNamespace(buffer=io.BytesIO(raw))),
            patch.object(sys, "stdout", output),
        ):
            reader.main()
        return json.loads(output.getvalue())

    def test_finite_operations_reject_sql_bad_limits_and_system_relations(self):
        reader = self.reader()
        for change in [
            {"operation": "query", "sql": "SELECT 1"},
            {"operation": "tables", "sql": "SELECT 1"},
            {"operation": "inspect", "path": "/tmp"},
            {"operation": "rows", "schema": "public", "table": "t", "limit": True},
            {"operation": "rows", "schema": "public", "table": "t", "limit": 0},
            {"operation": "rows", "schema": "public", "table": "t", "limit": 101},
            {
                "operation": "rows",
                "schema": "pg_catalog",
                "table": "pg_authid",
                "limit": 1,
            },
            {
                "operation": "rows",
                "schema": "information_schema",
                "table": "tables",
                "limit": 1,
            },
            {"operation": "rows", "schema": "public", "table": "t\x00x", "limit": 1},
        ]:
            with (
                self.subTest(change=change),
                self.assertRaises(reader.InspectionRejected),
            ):
                reader.operation(change)

    def test_identifiers_roundtrip_quotes_unicode_and_semicolons_as_data(self):
        reader = self.reader()
        schema, table = "bạn'đọc", 't"; DROP TABLE protected; --'
        text = reader.query(
            {"operation": "rows", "schema": schema, "table": table, "limit": 7}
        )
        self.assertIn('"bạn\'đọc"."t""; DROP TABLE protected; --" LIMIT 7', text)
        self.assertIn("n.nspname='bạn''đọc'", text)
        self.assertTrue(text.startswith("BEGIN READ ONLY;"))
        self.assertTrue(text.endswith("ROLLBACK;"))
        self.assertIn("statement_timeout='3s'", text)
        self.assertIn("lock_timeout='1s'", text)
        self.assertIn("standard_conforming_strings=on", text)
        with self.assertRaises(reader.InspectionRejected):
            reader.identifier("界" * 22)

    def test_table_query_is_bounded_and_excludes_views_and_system_schemas(self):
        text = self.reader().query({"operation": "tables"})
        for fragment in [
            "LIMIT 201",
            "LIMIT 129",
            "c.relkind IN ('r','p')",
            "current_user",
            "attisdropped",
        ]:
            self.assertIn(fragment, text)
        self.assertIn("to_jsonb(a)-'position'", text)

    def test_wrong_or_missing_module_pin_refuses_before_executable_bytes_are_loaded(
        self,
    ):
        reader = self.reader()
        with patch.object(reader, "load_module") as load:
            for pin in ["0" * 64, "not-a-pin"]:
                self.assertFalse(self.wire(reader, self.packet(), pin)["ok"])
            load.assert_not_called()
        self.assertFalse(self.base.exists())

    def test_absent_enrollment_never_creates_a_base_or_contacts_docker(self):
        reader = self.reader()
        with patch("subprocess.Popen") as process:
            result = self.wire(reader, self.packet())
            self.assertFalse(result["ok"])
            process.assert_not_called()
        self.assertFalse(self.base.exists())

    def test_enrolled_but_unprovisioned_instance_never_creates_resource_directory(self):
        self.api.handle(self.request)
        before = self.snapshot()
        reader = self.reader()
        with patch("subprocess.Popen") as process:
            result = self.wire(reader, self.packet())
            self.assertFalse(result["ok"])
            process.assert_not_called()
        self.assertEqual(before, self.snapshot())
        self.assertFalse(
            (
                self.final / "state" / ("postgres-" + self.packet()["database_id"])
            ).exists()
        )

    def test_tampered_helper_refuses_before_loading_or_contacting_docker(self):
        self.api.handle(self.request)
        helper = self.final / "helpers" / "target_product_runtime.py"
        with helper.open("ab") as stream:
            stream.write(b"\nraise RuntimeError('SENSITIVE_SENTINEL')\n")
        before = self.snapshot()
        reader = self.reader()
        with patch("subprocess.Popen") as process:
            result = self.wire(reader, self.packet())
            self.assertEqual(
                result, {"ok": False, "code": "POSTGRES_INSPECTION_UNAVAILABLE"}
            )
            process.assert_not_called()
        self.assertEqual(before, self.snapshot())

    def test_wire_size_invalid_json_and_mutation_operation_never_echo_input(self):
        reader = self.reader()
        secret = "SYNTHETIC_SENSITIVE_" + os.urandom(8).hex()
        for raw in [(secret * 9000).encode(), b'{"secret":"' + secret.encode()]:
            result = self.wire(reader, raw)
            self.assertFalse(result["ok"])
            self.assertNotIn(secret, json.dumps(result))
        packet = self.packet()
        packet["enrollment"]["operation"] = "enroll"
        self.assertFalse(self.wire(reader, packet)["ok"])
        self.assertFalse(self.base.exists())


if __name__ == "__main__":
    unittest.main()
