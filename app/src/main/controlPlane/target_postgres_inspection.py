"""Finite, read-only inspection of an already enrolled PostgreSQL instance.

Delivered as pinned stdin script, never installed as a service or deployment
claim. The controller must validate current source/instance before and after I/O.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import time
import types
from typing import Any

# Replaced only by controller code using its verified bundle asset. An unchanged
# placeholder fails closed; the incoming packet cannot select executable code.
EXPECTED_ENROLLMENT_SHA256 = "__POSTGRES_INSPECTION_ENROLLMENT_SHA256__"
EXPECTED_HELPERS = {
    "target_execution_guard.py": "3cadd020a5cfc5a784bd4c62fc7b887ea62b0094a921fc30a8177622090b222f",
    "target_product_runtime.py": "95cc98a0fe3692193e66f034ac8bdb8a0e7541e9ee4c5c75b472e18ed37fc343",
}
MAX_REPLY = 64 * 1024


class InspectionRejected(Exception):
    def __init__(self, code: str = "POSTGRES_INSPECTION_UNAVAILABLE") -> None:
        self.code = code
        super().__init__(code)


def identifier(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not 1 <= len(value.encode("utf-8")) <= 63
        or any(ord(c) < 32 or ord(c) == 127 for c in value)
    ):
        raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
    return value


def operation(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
    if value == {"operation": "inspect"} or value == {"operation": "tables"}:
        return dict(value)
    if (
        set(value) != {"operation", "schema", "table", "limit"}
        or value.get("operation") != "rows"
        or type(value.get("limit")) is not int
        or not 1 <= value["limit"] <= 100
    ):
        raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
    schema, table = identifier(value["schema"]), identifier(value["table"])
    if schema.startswith("pg_") or schema == "information_schema":
        raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
    return {
        "operation": "rows",
        "schema": schema,
        "table": table,
        "limit": value["limit"],
    }


def quoted_identifier(value: str) -> str:
    return '"' + identifier(value).replace('"', '""') + '"'


def quoted_literal(value: str) -> str:
    # standard_conforming_strings is explicitly enabled in the same transaction.
    return "'" + identifier(value).replace("'", "''") + "'"


def query(value: Any) -> str:
    read = operation(value)
    if read["operation"] == "inspect":
        raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
    if read["operation"] == "tables":
        statement = """SELECT COALESCE(jsonb_agg(t ORDER BY t.schema,t.name),'[]'::jsonb)
FROM (SELECT n.nspname AS schema,c.relname AS name,
 (SELECT COALESCE(jsonb_agg(to_jsonb(a)-'position' ORDER BY a.position),'[]'::jsonb)
  FROM (SELECT attname AS name,format_type(atttypid,atttypmod) AS data_type,
       NOT attnotnull AS nullable,attnum AS position
        FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped
        ORDER BY attnum LIMIT 129) a) AS columns
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
 AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname<>'information_schema'
 ORDER BY n.nspname,c.relname LIMIT 201) t"""
    else:
        schema, table, limit = read["schema"], read["table"], read["limit"]
        statement = (
            "SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) "
            "AND n.nspname="
            + quoted_literal(schema)
            + " AND c.relname="
            + quoted_literal(table)
            + ") "
            "THEN COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM "
            + quoted_identifier(schema)
            + "."
            + quoted_identifier(table)
            + " LIMIT "
            + str(limit)
            + ") t),'[]'::jsonb) ELSE 'null'::jsonb END"
        )
    return (
        "BEGIN READ ONLY; SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='1s'; "
        "SET LOCAL standard_conforming_strings=on; SET LOCAL search_path=pg_catalog; "
        + statement
        + "; ROLLBACK;"
    )


def load_module(name: str, content: bytes) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__file__ = "<verified-postgres-inspection>"
    sys.modules[name] = module
    exec(compile(content, module.__file__, "exec"), module.__dict__)  # noqa: S102 -- bytes verified against immutable pins before loading.
    return module


def inspect(packet: Any, enrollment_pin: str) -> dict[str, Any]:
    if (
        not isinstance(packet, dict)
        or set(packet)
        != {
            "format",
            "read",
            "enrollment",
            "enrollment_source",
            "database_id",
            "credentials",
        }
        or type(packet.get("format")) is not int
        or packet["format"] != 1
        or not isinstance(enrollment_pin, str)
        or re.fullmatch(r"[a-f0-9]{64}", enrollment_pin) is None
        or not isinstance(packet["enrollment_source"], str)
        or not isinstance(packet["database_id"], str)
        or re.fullmatch(
            r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}", packet["database_id"]
        )
        is None
    ):
        raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
    read = operation(packet["read"])
    source = packet["enrollment_source"].encode("utf-8")
    if len(source) > 96 * 1024 or hashlib.sha256(source).hexdigest() != enrollment_pin:
        raise InspectionRejected()
    request = packet["enrollment"]
    if not isinstance(request, dict) or request.get("operation") != "inspect":
        raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
    enrollment = load_module("_opspilot_inspection_enrollment", source)
    payload, key, manifest, _helpers, final, slot = enrollment._validate(request)
    if not enrollment._base(final.parent, False):
        raise InspectionRejected("POSTGRES_INSPECTION_NOT_READY")
    # Open an EXISTING shared enrollment lock, with no O_CREAT and no takeover.
    lock = os.open(
        final.parent / (".enroll-" + slot + ".lock"),
        os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
    )
    try:
        info = os.fstat(lock)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_size != 0
        ):
            raise InspectionRejected()
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        deadline = time.monotonic() + 45

        def authorize() -> None:
            if time.monotonic() > deadline:
                raise InspectionRejected("POSTGRES_INSPECTION_TIMEOUT")
            # No mutation or fake job/lease identity: verify actual enrollment,
            # helper bytes, stored key and signed ownership receipt each time.
            enrollment._inspect(final, payload, key, manifest)

        authorize()
        loaded = {}
        for name, expected in EXPECTED_HELPERS.items():
            content = enrollment._read(final / "helpers" / name, 512 * 1024)
            if hashlib.sha256(content).hexdigest() != expected:
                raise InspectionRejected()
            loaded[name] = load_module(name[:-3], content)
        runtime = loaded["target_product_runtime.py"]
        commands = runtime.DockerCommands()
        instance = runtime.ManagedPostgres(
            final / "state",
            key,
            {
                "controller_id": payload["controller_id"],
                "app_id": payload["app_id"],
                "ownership_generation": payload["ownership_generation"],
                "database_id": packet["database_id"],
                "target": payload["target"],
            },
            packet["credentials"],
            commands,
            authorize,
        )
        identity = instance.inspect_ready()
        data = None
        if read["operation"] != "inspect":
            output = commands.run(
                [
                    "exec",
                    "-u",
                    "0",
                    "-e",
                    "PGCONNECT_TIMEOUT=2",
                    "-e",
                    "PGPASSFILE=/run/opspilot-secrets/app.pgpass",
                    identity["container_id"],
                    "psql",
                    "-X",
                    "-q",
                    "--no-password",
                    "-h",
                    "127.0.0.1",
                    "-U",
                    "opspilot",
                    "-d",
                    "opspilot",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-P",
                    "pager=off",
                    "-At",
                    "-c",
                    query(read),
                ],
                timeout=8,
            )
            if len(output.encode("utf-8")) > MAX_REPLY:
                raise InspectionRejected("POSTGRES_INSPECTION_RESULT_LIMIT")
            data = json.loads(output)
            if not isinstance(data, list):
                raise InspectionRejected("POSTGRES_INSPECTION_RELATION_UNAVAILABLE")
            if len(data) > (200 if read["operation"] == "tables" else read["limit"]):
                raise InspectionRejected("POSTGRES_INSPECTION_RESULT_LIMIT")
            if any(not isinstance(row, dict) for row in data):
                raise InspectionRejected()
            if read["operation"] == "tables" and any(
                set(row) != {"schema", "name", "columns"}
                or not isinstance(row["columns"], list)
                or len(row["columns"]) > 128
                for row in data
            ):
                raise InspectionRejected("POSTGRES_INSPECTION_RESULT_LIMIT")
        if instance.inspect_ready() != identity:
            raise InspectionRejected()
        authorize()
        response = {"format": 1, "operation": read, "instance": identity, "data": data}
        if len(json.dumps(response, ensure_ascii=False).encode("utf-8")) > MAX_REPLY:
            raise InspectionRejected("POSTGRES_INSPECTION_RESULT_LIMIT")
        return response
    finally:
        os.close(lock)


def main() -> None:
    try:
        raw = sys.stdin.buffer.read(128 * 1024 + 1)
        if len(raw) > 128 * 1024:
            raise InspectionRejected("POSTGRES_INSPECTION_INPUT_INVALID")
        response = inspect(json.loads(raw), EXPECTED_ENROLLMENT_SHA256)
        print(
            json.dumps(
                {"ok": True, "data": response},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
    except InspectionRejected as error:
        print(json.dumps({"ok": False, "code": error.code}))
    except Exception:  # noqa: BLE001 -- terminal wire boundary must suppress all helper/psql error details.
        # Includes helper/psql exceptions: never forward raw stderr, SQL or secrets.
        print('{"ok":false,"code":"POSTGRES_INSPECTION_UNAVAILABLE"}')


if __name__ == "__main__":
    main()
