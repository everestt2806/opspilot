"""Two private PostgreSQL instances; actual pinned OpenSSH target reader, no VPS."""

from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
import os
import secrets
import shlex
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

if (
    sys.platform != "linux"
    or os.geteuid() != 0
    or sys.argv[1:] != ["--confirm-private-postgres-inspection"]
):
    raise SystemExit("EXPLICIT_ROOT_LINUX_PRIVATE_INSPECTION_REQUIRED")
sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "app/scripts/product-runtime-lab"))
from test_target_enrollment import SOURCE, TargetEnrollmentTests

subject = REPO / "app/src/main/controlPlane/target_postgres_inspection.py"
spec = importlib.util.spec_from_file_location("postgres_inspection_lab", subject)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
fixture = TargetEnrollmentTests("runTest")
fixture.setUp()
root = Path(fixture.temp.name)
nonce = secrets.token_hex(6)
output = REPO / "app/.out-scripts/product-postgres-inspection-native" / nonce
output.mkdir(parents=True, mode=0o700)
proof = {
    "status": "FAIL",
    "nonce": nonce,
    "scope": "PRIVATE_TWO_INSTANCE_OPENSSH_DOCKER_READER",
    "VPS_used": False,
    "production_database_used": False,
    "checks": [],
    "subject_sha256": hashlib.sha256(subject.read_bytes()).hexdigest(),
}
actors = []
networks = []
server = None
stage = "setup"


def fixed(args, timeout=30, input_bytes=None):
    result = subprocess.run(
        args,
        input=input_bytes,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode or len(result.stdout) > 256 * 1024:
        raise AssertionError("PRIVATE_LAB_COMMAND_FAILED")
    return result.stdout.decode().strip()


def check(name):
    proof["checks"].append(name)
    print("PASS " + name, flush=True)


def snapshot(actor):
    instance = actor["database"]
    return {
        "instance": instance.inspect_ready(),
        "rows": instance._psql(
            False,
            "SELECT count(*)::text||':'||md5(string_agg(id::text||':'||marker,chr(10) ORDER BY id)) FROM sample",
        ),
        "journal": hashlib.sha256(
            (instance.directory / "resource.json").read_bytes()
        ).hexdigest(),
    }


def ssh_read(packet, known=None):
    body = json.dumps(packet, separators=(",", ":")).encode()
    assert len(body) <= 128 * 1024
    result = subprocess.run(
        [
            "ssh",
            "-p",
            str(port),
            "-i",
            str(root / "client"),
            "-o",
            "BatchMode=yes",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "PasswordAuthentication=no",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "UserKnownHostsFile=" + str(known or root / "known_hosts"),
            "-o",
            "ConnectTimeout=5",
            "root@127.0.0.1",
            "python3 -c " + shlex.quote(script),
        ],
        input=body,
        capture_output=True,
        timeout=65,
        check=False,
    )
    if result.returncode:
        return {"ssh_rejected": True}
    assert len(result.stdout) <= 65 * 1024 and not result.stderr
    return json.loads(result.stdout)


try:
    assert fixed(["docker", "info", "--format", "{{.OSType}}"]) == "linux"
    for name in ["host", "client"]:
        fixed(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / name)])
    host_key = (root / "host.pub").read_text().split()[:2]
    host_pin = fixed(
        ["ssh-keygen", "-lf", str(root / "host.pub"), "-E", "sha256"]
    ).split()[1]
    (root / "authorized_keys").write_bytes((root / "client.pub").read_bytes())
    (root / "authorized_keys").chmod(0o600)
    with socket.socket() as allocated:
        allocated.bind(("127.0.0.1", 0))
        port = allocated.getsockname()[1]
    (root / "known_hosts").write_text(f"[127.0.0.1]:{port} {' '.join(host_key)}\n")
    (root / "known_hosts").chmod(0o600)
    (root / "sshd_config").write_text(
        "\n".join(
            [
                f"Port {port}",
                "ListenAddress 127.0.0.1",
                f"HostKey {root / 'host'}",
                f"PidFile {root / 'sshd.pid'}",
                f"AuthorizedKeysFile {root / 'authorized_keys'}",
                "PermitRootLogin prohibit-password",
                "PasswordAuthentication no",
                "KbdInteractiveAuthentication no",
                "UsePAM no",
                "StrictModes no",
                "AllowUsers root",
                "LogLevel ERROR",
                "PrintMotd no",
            ]
        )
        + "\n"
    )
    server = subprocess.Popen(
        ["/usr/sbin/sshd", "-D", "-e", "-f", str(root / "sshd_config")],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    until = time.monotonic() + 8
    while True:
        assert server.poll() is None
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            assert time.monotonic() < until
            time.sleep(0.05)
    stage = "pinned-SSH-before-resource-creation"
    fixed(
        [
            "ssh",
            "-p",
            str(port),
            "-i",
            str(root / "client"),
            "-o",
            "BatchMode=yes",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "UserKnownHostsFile=" + str(root / "known_hosts"),
            "-o",
            "ConnectTimeout=5",
            "root@127.0.0.1",
            "true",
        ],
        timeout=10,
    )
    check("pinned_private_SSH_authentication_verified_before_any_Docker_resource")
    enrollment_source = SOURCE.read_bytes()
    enrollment_pin = hashlib.sha256(enrollment_source).hexdigest()
    script = subject.read_text().replace(
        "__POSTGRES_INSPECTION_ENROLLMENT_SHA256__", enrollment_pin
    )
    assert "__POSTGRES_INSPECTION_ENROLLMENT_SHA256__" not in script
    proof["script_sha256"] = hashlib.sha256(script.encode()).hexdigest()
    proof["enrollment_sha256"] = enrollment_pin

    stage = "provision-private-pair"
    helpers = REPO / "app/src/main/controlPlane"
    for name in ["target_execution_guard.py", "target_product_runtime.py"]:
        content = (helpers / name).read_bytes()
        assert hashlib.sha256(content).hexdigest() == reader.EXPECTED_HELPERS[name]
        module = reader.load_module(name[:-3], content)
    runtime = module
    for app_id in [1, 2]:
        request = copy.deepcopy(fixture.request)
        payload = request["payload"]
        key = secrets.token_bytes(32)
        slot = (
            hashlib.sha256(payload["controller_id"].encode()).hexdigest()
            + "-app-"
            + str(app_id)
        )
        final = fixture.base / ("controller-" + slot)
        payload.update(
            app_id=app_id,
            state_root=str(final / "state"),
            helper_path=str(final / "helpers/target_guarded_ssh_helper.py"),
        )
        payload["target"].update(
            host="127.0.0.1", port=port, username="root", host_fingerprint=host_pin
        )
        request["key"] = base64.b64encode(key).decode()
        assert fixture.api.handle(request)["state"] == "enrolled"
        credentials = {
            "admin_password": secrets.token_urlsafe(32),
            "app_password": secrets.token_urlsafe(32),
        }
        identity = {
            "controller_id": payload["controller_id"],
            "app_id": app_id,
            "ownership_generation": 1,
            "database_id": str(uuid4()),
            "target": payload["target"],
        }
        actor = runtime.ManagedPostgres(
            final / "state",
            key,
            identity,
            credentials,
            runtime.DockerCommands(),
            lambda: None,
        )
        actors.append({"database": actor, "final": final, "payload": payload})
        network = "opspilot-pg-inspection-" + nonce + "-" + str(app_id)
        fixed(
            [
                "docker",
                "network",
                "create",
                "--label",
                "opspilot.inspection_lab=" + nonce,
                "--label",
                "opspilot.controller_id=" + payload["controller_id"],
                "--label",
                "opspilot.app_id=" + str(app_id),
                "--label",
                "opspilot.ownership_generation=1",
                network,
            ]
        )
        networks.append(network)
        actor.ensure(network)
        actor._psql(
            False,
            "CREATE TABLE sample(id int PRIMARY KEY,marker text); INSERT INTO sample VALUES(1,'instance-"
            + str(app_id)
            + "')",
            capture=False,
        )
        inspect_request = copy.deepcopy(request)
        inspect_request.update(operation="inspect", helpers={})
        actors[-1]["packet"] = {
            "format": 1,
            "read": {"operation": "inspect"},
            "enrollment": inspect_request,
            "enrollment_source": enrollment_source.decode(),
            "database_id": identity["database_id"],
            "credentials": credentials,
        }
        actors[-1]["before"] = snapshot(actors[-1])
    check(
        "explicit_private_fixture_provisions_two_same_name_databases_on_one_target_without_public_ports"
    )
    stage = "read-through-pinned-SSH"
    for index, actor in enumerate(actors):
        stage = "inspect-instance-" + str(index + 1)
        packet = copy.deepcopy(actor["packet"])
        reply = ssh_read(packet)
        proof["last_reader_code"] = reply.get(
            "code", "SSH_REJECTED" if reply.get("ssh_rejected") else "OK"
        )
        assert reply["ok"] and reply["data"]["instance"] == actor["before"]["instance"]
        stage = "tables-instance-" + str(index + 1)
        packet["read"] = {"operation": "tables"}
        reply = ssh_read(packet)
        assert reply["ok"] and reply["data"]["data"] == [
            {
                "schema": "public",
                "name": "sample",
                "columns": [
                    {"name": "id", "data_type": "integer", "nullable": False},
                    {"name": "marker", "data_type": "text", "nullable": True},
                ],
            }
        ]
        stage = "rows-instance-" + str(index + 1)
        packet["read"] = {
            "operation": "rows",
            "schema": "public",
            "table": "sample",
            "limit": 10,
        }
        reply = ssh_read(packet)
        assert reply["ok"] and reply["data"]["data"] == [
            {"id": 1, "marker": "instance-" + str(index + 1)}
        ]
    check(
        "actual_pinned_OpenSSH_inspect_tables_and_rows_route_each_database_UUID_to_its_own_data"
    )
    packet = copy.deepcopy(actors[0]["packet"])
    packet["database_id"] = actors[1]["packet"]["database_id"]
    assert not ssh_read(packet)["ok"]
    check("wrong_database_UUID_never_falls_back_to_other_existing_same_name_container")
    stage = "quoted-and-denied-relations"
    schema, table = "bạn'đọc", 't"; DROP TABLE sample; --'
    qualified = reader.quoted_identifier(schema) + "." + reader.quoted_identifier(table)
    actors[0]["database"]._psql(
        False,
        "CREATE SCHEMA "
        + reader.quoted_identifier(schema)
        + "; CREATE TABLE "
        + qualified
        + "(value text); INSERT INTO "
        + qualified
        + " VALUES('quoted-value')",
        capture=False,
    )
    packet = copy.deepcopy(actors[0]["packet"])
    packet["read"] = {"operation": "rows", "schema": schema, "table": table, "limit": 1}
    reply = ssh_read(packet)
    assert reply["ok"] and reply["data"]["data"] == [{"value": "quoted-value"}]
    actors[0]["database"]._psql(
        False,
        "DROP TABLE " + qualified + "; DROP SCHEMA " + reader.quoted_identifier(schema),
        capture=False,
    )
    check(
        "actual_PostgreSQL_unicode_quotes_and_SQL_punctuation_identifiers_roundtrip_without_injection"
    )
    actors[0]["database"]._psql(
        False,
        "CREATE VIEW reader_view AS SELECT * FROM sample; CREATE TABLE oversized(value text); INSERT INTO oversized VALUES(repeat('x',70000))",
        capture=False,
    )
    for relation in ["reader_view", "oversized"]:
        packet["read"] = {
            "operation": "rows",
            "schema": "public",
            "table": relation,
            "limit": 1,
        }
        assert not ssh_read(packet)["ok"]
    actors[0]["database"]._psql(
        False, "DROP VIEW reader_view; DROP TABLE oversized", capture=False
    )
    check("views_and_oversize_results_refuse_without_silent_empty_or_truncation")
    packet = copy.deepcopy(actors[0]["packet"])
    packet["credentials"]["app_password"] = secrets.token_urlsafe(32)
    assert not ssh_read(packet)["ok"]
    check("wrong_credential_binding_is_rejected_without_rotation_or_readback")
    fixed(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / "wrong_host")]
    )
    wrong_host = (root / "wrong_host.pub").read_text().split()[:2]
    (root / "wrong_known_hosts").write_text(
        f"[127.0.0.1]:{port} {' '.join(wrong_host)}\n"
    )
    assert ssh_read(actors[0]["packet"], root / "wrong_known_hosts") == {
        "ssh_rejected": True
    }
    check("wrong_independent_host_key_pin_rejects_SSH_before_target_reader")
    stage = "verify-retention"
    for actor in actors:
        assert snapshot(actor) == actor["before"]
    check(
        "both_instance_CIDs_volumes_systemIDs_journals_and_data_remain_unchanged_after_reads_and_refusals"
    )
    proof["instances"] = [actor["before"]["instance"] for actor in actors]
    proof["status"] = "PASS"
except Exception as error:  # noqa: BLE001 -- private gate reports location, never command/packet/credential details.
    proof["stage"] = stage
    import traceback

    frames = traceback.extract_tb(error.__traceback__)
    proof["failure_location"] = [
        {"file": Path(f.filename).name, "line": f.lineno} for f in frames
    ][-3:]
    proof["error_code"] = "PRIVATE_INSPECTION_GATE_FAILED"
finally:
    if server is not None:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
    cleanup = True
    for entry in reversed(actors):
        actor = entry["database"]
        try:
            for kind, name in [("container", actor.name), ("volume", actor.volume)]:
                found = subprocess.run(
                    ["docker", kind, "inspect", name],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    timeout=10,
                )
                if found.returncode:
                    continue
                item = json.loads(found.stdout)[0]
                labels = (
                    (item.get("Config") or {}).get("Labels")
                    if kind == "container"
                    else item.get("Labels")
                )
                assert {
                    k: v for k, v in (labels or {}).items() if k.startswith("opspilot.")
                } == actor.labels
                args = (
                    ["docker", "rm", "-f", name]
                    if kind == "container"
                    else ["docker", "volume", "rm", name]
                )
                fixed(args)
        except Exception:  # noqa: BLE001 -- failed ownership check preserves resource and marks cleanup failed.
            cleanup = False
    for network in reversed(networks):
        try:
            item = json.loads(fixed(["docker", "network", "inspect", network]))[0]
            assert (
                item["Labels"].get("opspilot.inspection_lab") == nonce
                and not item["Containers"]
            )
            fixed(["docker", "network", "rm", network])
        except Exception:  # noqa: BLE001 -- cleanup never removes an unverified resource.
            cleanup = False
    # TemporaryDirectory was allocated by this fixture; check exact resolved parent
    # and ownership before allowing its registered cleanup to remove the directory.
    assert root.resolve() == root and root.name.startswith("opspilot-target-enroll-")
    assert stat.S_ISDIR(root.lstat().st_mode) and root.lstat().st_uid == os.geteuid()
    fixture.doCleanups()
    proof["private_cleanup"] = cleanup and not root.exists()
    if not proof["private_cleanup"]:
        proof["status"] = "FAIL"
    (output / "proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(
        json.dumps(
            {
                "status": proof["status"],
                "nonce": nonce,
                "checks": len(proof["checks"]),
                "private_cleanup": proof["private_cleanup"],
            }
        )
    )
    if proof["status"] != "PASS":
        raise SystemExit(1)
