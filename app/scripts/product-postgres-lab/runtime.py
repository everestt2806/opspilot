"""Gate Docker Linux riêng tư; không VPS/production DB, không in credential."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

if sys.platform != "linux" or sys.argv[1:] != ["--confirm-local-postgres-runtime"]:
    raise SystemExit("EXPLICIT_LINUX_LOCAL_POSTGRES_GATE_REQUIRED")
sys.dont_write_bytecode = True
repository = Path(__file__).resolve().parents[3]
helpers = repository / "app/src/main/controlPlane"
sys.path.insert(0, str(helpers))
spec = importlib.util.spec_from_file_location("target_product_runtime", helpers / "target_product_runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
nonce = secrets.token_hex(6)
output = repository / "app/.out-scripts/product-postgres-runtime" / nonce
output.mkdir(parents=True, mode=0o700)
lab_root = Path(os.environ.get("OPSPILOT_POSTGRES_LAB_ROOT", "/var/tmp"))
if lab_root != Path("/var/tmp") and (not str(lab_root).startswith("/var/lib/docker/volumes/opspilot-pg-lab-")
                                    or lab_root.name != "_data"):
    raise SystemExit("LOCAL_LAB_ROOT_INVALID")
scratch = Path(tempfile.mkdtemp(prefix="opspilot-postgres-runtime-", dir=lab_root))
scratch.chmod(0o700)
commands = runtime.DockerCommands()
network = "opspilot-pg-lab-" + nonce
key = secrets.token_bytes(32)
credentials = {"admin_password": secrets.token_urlsafe(32), "app_password": secrets.token_urlsafe(32)}
target = {"vps_id": 1, "host": "127.0.0.1", "port": 22, "username": "lab",
          "host_fingerprint": "SHA256:" + "a" * 43, "auth_type": "key", "ssh_security_revision": 1}
controller = str(uuid4())
identities = []
checks = []
mutations = []
networks = []
authorized = True
proof = {"format": 1, "nonce": nonce, "state": "RUNNING", "checks": checks,
         "runtime_sha256": hashlib.sha256((helpers / "target_product_runtime.py").read_bytes()).hexdigest(),
         "image": runtime._POSTGRES_IMAGE, "serving_vps_used": False}


def check(name, condition=True):
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print("PASS " + name, flush=True)


def authority():
    if not authorized:
        raise runtime.RuntimeRejected("LAB_AUTHORITY_REVOKED")


class Observe(runtime.DockerCommands):
    def inspect(self, kind, reference):
        value = super().inspect(kind, reference)
        if kind == "container" and (value.get("Config") or {}).get("Labels", {}).get("opspilot.controller_id") == controller:
            proof["last_container_shape"] = {"Image": value.get("Image"), "Name": value.get("Name"),
                "labels": value.get("Config", {}).get("Labels"), "config_image": value.get("Config", {}).get("Image"),
                "host": {k: value.get("HostConfig", {}).get(k) for k in ("Privileged", "PublishAllPorts", "PortBindings",
                    "NetworkMode", "RestartPolicy", "Memory", "PidMode", "IpcMode", "Mounts", "Runtime")},
                "mounts": value.get("Mounts"), "networks": list(value.get("NetworkSettings", {}).get("Networks", {}))}
        return value

    def run(self, args, **kwargs):
        # Không ghi args/env/SQL/stdin; chỉ lưu loại thao tác để kiểm tra fail-closed.
        if (args[0] in {"pull", "create", "start", "stop", "run", "rename", "rm"}
            or args[:2] == ["volume", "create"] or kwargs.get("input_bytes") is not None):
            mutations.append(args[0])
        return super().run(args, **kwargs)


def actor(identity=None, values=None, secret=None, docker=None):
    if identity is None:
        identity = {"controller_id": controller, "app_id": 1, "ownership_generation": 1,
                    "database_id": str(uuid4()), "target": target}
        identities.append(identity)
    return runtime.ManagedPostgres(scratch, key if secret is None else secret, identity,
                                   credentials if values is None else values, docker or Observe(), authority)


def rejected(name, operation, expected=None):
    try:
        operation()
    except runtime.RuntimeRejected as error:
        check(name, expected is None or error.code == expected)
        return
    raise AssertionError(name)


def create_network(name):
    commands.run(["network", "create", "--label", "opspilot.controller_id=" + controller,
                  "--label", "opspilot.app_id=1", "--label", "opspilot.ownership_generation=1",
                  "--label", "opspilot.lab=" + nonce, name])
    networks.append(name)


try:
    commands.run(["info", "--format", "{{.OSType}}"])
    create_network(network)
    database = actor()
    initial = database.ensure(network)
    check("real_postgres16_no_public_port_non_admin_app", initial["state"] == "ready" and initial["public_port"] is None)
    database._psql(False, "", capture=False, stdin=(
        "CREATE TABLE notes(id integer PRIMARY KEY,title text NOT NULL);\n"
        "INSERT INTO notes SELECT i,'note-' || i FROM generate_series(1,1000) AS i;\n").encode("ascii"))
    expected_rows = database._psql(False, "SELECT count(*),md5(string_agg(id || ':' || title,',' ORDER BY id)) FROM notes")
    check("one_thousand_real_rows", expected_rows.split("|")[0] == "1000")
    check("cold_reopen_preserves_cid_volume_system_identity_and_data",
          actor(database.identity).ensure(network) == initial and database._psql(False,
              "SELECT count(*),md5(string_agg(id || ':' || title,',' ORDER BY id)) FROM notes") == expected_rows)
    commands.run(["stop", "--time", "10", initial["container_id"]], timeout=15)
    check("restart_keeps_same_database_and_rows", actor(database.identity).ensure(network) == initial
          and database._psql(False, "SELECT count(*) FROM notes") == "1000")
    rejected("app_role_cannot_create_admin_role", lambda: database._psql(False,
             "CREATE ROLE forbidden_superuser SUPERUSER", capture=False), "SSH_RUNTIME_COMMAND_FAILED")
    baseline = len(mutations)
    rejected("wrong_credentials_rejected_without_mutation", lambda: actor(database.identity,
             {**credentials, "app_password": secrets.token_urlsafe(32)}).ensure(network))
    rejected("wrong_master_key_rejected_without_mutation", lambda: actor(database.identity,
             secret=secrets.token_bytes(32)).ensure(network))
    rejected("wrong_target_rejected_without_mutation", lambda: actor({**database.identity,
             "target": {**target, "host": "192.0.2.12"}}).ensure(network))
    rejected("wrong_owner_rejected_without_mutation", lambda: actor({**database.identity,
             "ownership_generation": 2}).ensure(network))
    authorized = False
    rejected("lost_authority_stops_before_access", lambda: actor(database.identity).ensure(network), "LAB_AUTHORITY_REVOKED")
    authorized = True
    check("rejections_have_zero_docker_writes", baseline == len(mutations))
    admin_path = database.directory / "admin_password"
    original = admin_path.read_bytes()
    link = scratch / "secret-link"
    os.link(admin_path, link)
    rejected("secret_hardlink_rejected", lambda: actor(database.identity).ensure(network))
    link.unlink()
    admin_path.unlink()
    os.mkfifo(admin_path, 0o600)
    rejected("secret_fifo_rejected_without_hang", lambda: actor(database.identity).ensure(network))
    admin_path.unlink()
    with admin_path.open("xb") as file:
        file.write(original)
    admin_path.chmod(0o600)
    check("rejected_secret_not_repaired_or_rotated", actor(database.identity).ensure(network) == initial)
    backup_key = str(uuid4())
    backup = database.backup(backup_key)
    check("logical_backup_custom_archive_with_checksum", backup["state"] == "created" and backup["bytes"] > 0)
    archive = scratch / ("postgres-backups-" + database.identity["database_id"]) / backup_key / "database.pgdump"
    check("cold_backup_uuid_reads_original_archive", actor(database.identity).backup(backup_key)
          == {**backup, "state": "already_created"})
    # Clone chỉ trong fixture sở hữu riêng; production deploy/rollback không có restore.
    database._psql(True, "CREATE DATABASE restore_check OWNER opspilot", capture=False)
    with archive.open("rb") as source:
        result = subprocess.run(["docker", "exec", "-i", "-u", "0", "-e", "PGCONNECT_TIMEOUT=2", "-e",
            "PGPASSFILE=/run/opspilot-secrets/admin.pgpass", initial["container_id"], "pg_restore", "--no-password",
            "--exit-on-error", "--no-owner", "--no-acl", "-h", "127.0.0.1", "-U", "postgres", "-d", "restore_check"],
            stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=False)
    check("native_pg_restore_completes", result.returncode == 0)
    restored = commands.run(["exec", "-u", "0", "-e", "PGPASSFILE=/run/opspilot-secrets/admin.pgpass",
        initial["container_id"], "psql", "-X", "--no-password", "-h", "127.0.0.1", "-U", "postgres",
        "-d", "restore_check", "-Atc", "SELECT count(*),md5(string_agg(id || ':' || title,',' ORDER BY id)) FROM notes"])
    check("restored_1000_rows_match_full_content_checksum", restored == expected_rows)
    before_size = archive.stat().st_size
    with archive.open("ab") as file:
        file.write(b"TAMPERED_LAB_ONLY")
    rejected("tampered_archive_not_accepted_or_replaced", lambda: actor(database.identity).backup(backup_key))
    with archive.open("r+b") as file:
        file.truncate(before_size)
    check("repaired_lab_archive_is_original_receipt", actor(database.identity).backup(backup_key)["sha256"] == backup["sha256"])

    class LostResponse(Observe):
        def __init__(self, point):
            super().__init__()
            self.point = point
            self.fired = False

        def run(self, args, **kwargs):
            value = super().run(args, **kwargs)
            matches = ((self.point == "volume" and args[:2] == ["volume", "create"])
                       or (self.point == "container" and args[0] == "create")
                       or (self.point == "bootstrap" and kwargs.get("input_bytes") is not None))
            if matches and not self.fired:
                self.fired = True
                raise runtime.RuntimeUnknown("LAB_LOST_RESPONSE")
            return value

    for point in ("volume", "container", "bootstrap"):
        fault_network = network + "-" + point
        create_network(fault_network)
        uncertain = actor(docker=LostResponse(point))
        rejected("lost_" + point + "_response", lambda value=uncertain, net=fault_network: value.ensure(net), "LAB_LOST_RESPONSE")
        baseline = len(mutations)
        if point == "bootstrap":
            # DDL đã hoàn tất, recovery chỉ đọc và ghi journal; không chạy lại SQL.
            recovered = actor(uncertain.identity).ensure(fault_network)
            check("lost_bootstrap_response_read_only_recovery", recovered["state"] == "ready" and len(mutations) == baseline)
        else:
            rejected("ambiguous_" + point + "_cannot_adopt_or_recreate",
                     lambda value=uncertain, net=fault_network: actor(value.identity).ensure(net), "SSH_POSTGRES_CREATE_UNCONFIRMED")
            check("ambiguous_" + point + "_has_zero_replayed_writes", len(mutations) == baseline)

    class PartialBootstrap(Observe):
        def run(self, args, **kwargs):
            if kwargs.get("input_bytes") is not None:
                # Chỉ CREATE ROLE; recovery không được lặp hoặc tự hoàn tất DDL còn dở.
                kwargs["input_bytes"] = kwargs["input_bytes"].split(b"CREATE DATABASE", 1)[0]
                super().run(args, **kwargs)
                raise runtime.RuntimeUnknown("LAB_PARTIAL_BOOTSTRAP")
            return super().run(args, **kwargs)

    partial_network = network + "-partial"
    create_network(partial_network)
    partial = actor(docker=PartialBootstrap())
    rejected("partial_ddl_retains_unknown", lambda: partial.ensure(partial_network), "LAB_PARTIAL_BOOTSTRAP")
    baseline = len(mutations)
    rejected("partial_ddl_never_replayed_or_database_recreated", lambda: actor(partial.identity).ensure(partial_network))
    check("partial_ddl_recovery_does_not_mutate", baseline == len(mutations))

    collision = actor()
    commands.run(["volume", "create", "--label", "opspilot.lab=" + nonce, collision.volume])
    rejected("foreign_named_volume_never_adopted", lambda: collision.ensure(network), "SSH_POSTGRES_COLLISION")
    check("collision_does_not_create_private_state", not collision.directory.exists())
    check("existing_database_unchanged_after_all_faults", actor(database.identity).ensure(network) == initial
          and database._psql(False, "SELECT count(*) FROM notes") == "1000")
    proof["identity"] = initial
    proof["row_count"] = 1000
    proof["state"] = "PASS"
except BaseException as error:
    proof["state"] = "FAIL"
    proof["error_type"] = type(error).__name__
    proof["error_code"] = getattr(error, "code", "LOCAL_GATE_ASSERTION")
    raise
finally:
    cleanup = []
    for identity in identities:
        name = "opspilot-pg-" + identity["database_id"]
        container = commands.container(name)
        if container is not None:
            labels = container.get("Config", {}).get("Labels", {})
            if labels.get("opspilot.controller_id") != controller or labels.get("opspilot.database_id") != identity["database_id"]:
                raise RuntimeError("CLEANUP_IDENTITY_MISMATCH")
            commands.run(["rm", "-f", container["Id"]], timeout=20, capture=False)
        volume = name + "-data"
        if commands.run(["volume", "ls", "--filter", f"name=^{volume}$", "--format", "{{.Name}}"]):
            labels = commands.inspect("volume", volume).get("Labels", {})
            if labels.get("opspilot.controller_id") != controller and labels.get("opspilot.lab") != nonce:
                raise RuntimeError("CLEANUP_VOLUME_IDENTITY_MISMATCH")
            commands.run(["volume", "rm", volume], capture=False)
        cleanup.append(identity["database_id"])
    for name in networks:
        if commands.inspect("network", name).get("Labels", {}).get("opspilot.lab") != nonce:
            raise RuntimeError("CLEANUP_NETWORK_IDENTITY_MISMATCH")
        commands.run(["network", "rm", name], capture=False)
    if scratch.resolve().parent != lab_root.resolve() or not scratch.name.startswith("opspilot-postgres-runtime-") or scratch.is_symlink():
        raise RuntimeError("CLEANUP_PRIVATE_DIRECTORY_MISMATCH")
    shutil.rmtree(scratch)
    proof["cleanup"] = {"database_ids": cleanup, "network_removed": True, "private_directory_removed": True}
    proof["checks_count"] = len(checks)
    (output / "proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print("PROOF " + str(output / "proof.json"), flush=True)
