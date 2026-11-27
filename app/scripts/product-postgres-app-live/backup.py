"""Explicit operator backup/isolated restore evidence, never a product backup API."""

import hashlib
import json
import os
import re
import sqlite3
import stat
import subprocess
import sys
import time
from pathlib import Path

request = json.loads("__OPSPILOT_ACCEPTANCE_REQUEST__")
IMAGE = "postgres:16-alpine@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e"
DATA = "/var/lib/opspilot-controller/opspilot.db"
clone = None
stage = "authority"


def run(args, data=None, timeout=20):
    result = subprocess.run(
        args,
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0 or len(result.stdout) > 2 * 1024 * 1024:
        raise ValueError("COMMAND_FAILED")
    return result.stdout


def atomic(path, value):
    with open(path, "x", encoding="utf-8") as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(json.dumps(value, sort_keys=True))
        f.flush()
        os.fsync(f.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def directory(path):
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    s = path.lstat()
    assert (
        stat.S_ISDIR(s.st_mode)
        and s.st_uid == 0
        and stat.S_IMODE(s.st_mode) == 0o700
        and str(path.resolve()) == str(path)
    )


def snapshot():
    with open("/var/lib/opspilot-controller-install/upgrade.json") as f:
        upgrade = json.load(f)
    assert (
        upgrade["phase"] == "active"
        and upgrade["request_key"] == "aaf2d779-70f8-42f0-8055-d333bd0b6774"
    )
    assert (
        upgrade["release_sha256"]
        == "cc8f33f57ab518c20c75118925522dcc03bb2d2cef04ba94c9bfef101cdb0ddd"
    )
    c = sqlite3.connect("file:" + DATA + "?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    assert c.execute("SELECT max(version) FROM schema_version").fetchone()[0] == 37
    assert (
        c.execute(
            "SELECT count(*) FROM product_deploy_job WHERE state NOT IN ('succeeded','failed','rolled_back','superseded','cancelled')"
        ).fetchone()[0]
        == 0
    )
    assert (
        c.execute(
            "SELECT count(*) FROM product_app_lease WHERE released_at IS NULL"
        ).fetchone()[0]
        == 0
    )
    assert (
        c.execute(
            "SELECT count(*) FROM product_worker_lease WHERE released_at IS NULL"
        ).fetchone()[0]
        == 0
    )
    assert (
        c.execute(
            "SELECT count(*) FROM experiment_run WHERE status='running'"
        ).fetchone()[0]
        == 0
    )
    assert (
        c.execute(
            "SELECT count(*) FROM product_desktop_client WHERE revoked_at IS NULL"
        ).fetchone()[0]
        == 0
    )
    app = c.execute(
        "SELECT a.name,a.current_deployment_id,p.controller_id,p.ownership_generation,p.source_generation,p.auto_deploy_paused FROM app a JOIN product_app_control p ON p.app_id=a.id WHERE a.id=?",
        (request["app_id"],),
    ).fetchone()
    assert dict(app) == request["authority"]
    assert app["auto_deploy_paused"] == 1
    assert (
        c.execute(
            "SELECT database_id FROM product_source_postgres WHERE app_id=? AND source_generation=?",
            (request["app_id"], app["source_generation"]),
        ).fetchone()[0]
        == request["database"]["database_id"]
    )
    material = {
        t: [dict(r) for r in c.execute("SELECT * FROM " + t + " ORDER BY app_id")]
        for t in (
            "product_source_config",
            "product_source_environment",
            "product_environment_revision",
            "product_target_enrollment",
            "product_managed_postgres",
            "product_source_postgres",
        )
    }
    digest = hashlib.sha256(
        json.dumps(material, sort_keys=True, default=lambda v: v.hex()).encode()
    ).hexdigest()
    applications = [
        dict(r)
        for r in c.execute("SELECT id,name,current_deployment_id FROM app ORDER BY id")
    ]
    c.close()
    containers = []
    for row in applications:
        if row["current_deployment_id"] is None:
            continue
        for suffix in ("app", "collector"):
            value = json.loads(run(["docker", "inspect", row["name"] + "-" + suffix]))[
                0
            ]
            assert value["State"]["Running"]
            containers.append(
                [
                    value["Id"],
                    value["Image"],
                    value["State"]["StartedAt"],
                    value["RestartCount"],
                ]
            )
    return {
        "materials_sha256": digest,
        "applications": applications,
        "containers": containers,
        "database_inode": os.stat(DATA).st_ino,
    }


def source_sql():
    return (
        run(
            [
                "docker",
                "exec",
                "-u",
                "0",
                "-e",
                "PGCONNECT_TIMEOUT=2",
                "-e",
                "PGPASSFILE=/run/opspilot-secrets/app.pgpass",
                request["database"]["container_id"],
                "psql",
                "--no-password",
                "-h",
                "127.0.0.1",
                "-U",
                "opspilot",
                "-d",
                "opspilot",
                "-Atqc",
                "SELECT count(*)::text||':'||md5(string_agg(id::text||':'||label,E'\\n' ORDER BY id)) FROM acceptance_sample",
            ]
        )
        .decode()
        .strip()
    )


def verify_database():
    database = request["database"]
    value = json.loads(run(["docker", "inspect", database["container_id"]]))[0]
    assert value["Id"] == database["container_id"] and value["State"]["Running"]
    assert (
        value["Config"]["Image"] == IMAGE
        and not value["HostConfig"].get("PortBindings")
        and not value["HostConfig"]["Privileged"]
    )
    labels = value["Config"]["Labels"]
    for key, expected in (
        ("opspilot.controller_id", request["authority"]["controller_id"]),
        ("opspilot.app_id", str(request["app_id"])),
        ("opspilot.database_id", database["database_id"]),
    ):
        assert labels[key] == expected
    assert any(
        m["Type"] == "volume"
        and m["Name"] == database["volume"]
        and m["Destination"] == "/var/lib/postgresql/data"
        for m in value["Mounts"]
    )
    return value["Id"]


def cleanup_clone():
    global clone
    if clone is None:
        return
    value = json.loads(run(["docker", "inspect", clone]))[0]
    assert (
        value["Id"] == clone
        and value["Config"]["Image"] == IMAGE
        and value["Config"]["Labels"]["opspilot.acceptance_request"]
        == request["request_key"]
    )
    assert value["HostConfig"]["NetworkMode"] == "none" and not value["HostConfig"].get(
        "PortBindings"
    )
    run(["docker", "rm", "-f", clone])
    clone = None


try:
    assert (
        os.getuid() == 0
        and re.fullmatch(r"[a-f0-9]{12}", request["record"])
        and re.fullmatch(r"[a-f0-9-]{36}", request["request_key"])
    )
    assert isinstance(request["app_id"], int) and request["app_id"] > 6
    before = snapshot()
    verify_database()
    original = source_sql()
    assert original.startswith("1000:")
    base = Path("/var/lib/opspilot-postgres-acceptance")
    directory(base)
    base = base / request["record"]
    directory(base)
    slot = base / request["request_key"]
    if slot.exists() or slot.is_symlink():
        directory(slot)
        with open(slot / "receipt.json") as f:
            receipt = json.load(f)
        assert receipt["request"] == request and receipt["source_content"] == original
        archive = slot / "database.pgdump"
        s = archive.lstat()
        assert (
            stat.S_ISREG(s.st_mode)
            and s.st_uid == 0
            and s.st_nlink == 1
            and stat.S_IMODE(s.st_mode) == 0o600
            and 1 <= s.st_size <= 64 * 1024 * 1024
        )
        assert (
            hashlib.sha256(archive.read_bytes()).hexdigest()
            == receipt["archive_sha256"]
        )
        assert snapshot() == before
        print(json.dumps({**receipt["proof"], "replayed_receipt_only": True}))
        sys.exit(0)
    directory(slot)
    atomic(slot / "intent.json", request)
    stage = "dump"
    archive = slot / "database.pgdump"
    with open(archive, "xb") as f:
        os.fchmod(f.fileno(), 0o600)
        child = subprocess.Popen(
            [
                "prlimit",
                "--fsize=67108864:67108864",
                "--",
                "docker",
                "exec",
                "-u",
                "0",
                "-e",
                "PGCONNECT_TIMEOUT=2",
                "-e",
                "PGPASSFILE=/run/opspilot-secrets/app.pgpass",
                request["database"]["container_id"],
                "pg_dump",
                "--no-password",
                "-h",
                "127.0.0.1",
                "-U",
                "opspilot",
                "-d",
                "opspilot",
                "--format=custom",
                "--no-owner",
                "--no-acl",
                "--serializable-deferrable",
                "--lock-wait-timeout=5s",
            ],
            stdin=subprocess.DEVNULL,
            stdout=f,
            stderr=subprocess.DEVNULL,
        )
        try:
            assert child.wait(timeout=60) == 0
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
        f.flush()
        os.fsync(f.fileno())
    size = archive.stat().st_size
    assert 1 <= size <= 64 * 1024 * 1024
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert source_sql() == original and snapshot() == before
    stage = "isolated-restore"
    clone = (
        run(
            [
                "docker",
                "create",
                "--name",
                "opspilot-pg-restore-" + request["record"],
                "--network",
                "none",
                "--memory",
                "256m",
                "--pids-limit",
                "128",
                "--tmpfs",
                "/var/lib/postgresql/data:rw,nosuid,nodev,size=268435456",
                "-e",
                "POSTGRES_HOST_AUTH_METHOD=trust",
                "-e",
                "POSTGRES_DB=opspilot",
                "--label",
                "opspilot.acceptance_request=" + request["request_key"],
                IMAGE,
            ]
        )
        .decode()
        .strip()
    )
    assert re.fullmatch(r"[a-f0-9]{64}", clone)
    atomic(
        slot / "clone-intent.json",
        {"container_id": clone, "image": IMAGE, "request_key": request["request_key"]},
    )
    run(["docker", "start", clone])
    deadline = time.monotonic() + 60
    while True:
        probe = subprocess.run(
            [
                "docker",
                "exec",
                clone,
                "pg_isready",
                "-h",
                "127.0.0.1",
                "-U",
                "postgres",
                "-d",
                "opspilot",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        if probe.returncode == 0:
            break
        assert time.monotonic() < deadline
        time.sleep(1)
    run(
        [
            "docker",
            "exec",
            "-i",
            clone,
            "pg_restore",
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            "-U",
            "postgres",
            "-d",
            "opspilot",
        ],
        archive.read_bytes(),
        timeout=60,
    )
    restored = (
        run(
            [
                "docker",
                "exec",
                clone,
                "psql",
                "-U",
                "postgres",
                "-d",
                "opspilot",
                "-Atqc",
                "SELECT count(*)::text||':'||md5(string_agg(id::text||':'||label,E'\\n' ORDER BY id)) FROM acceptance_sample",
            ]
        )
        .decode()
        .strip()
    )
    assert restored == original
    cleanup_clone()
    verify_database()
    assert source_sql() == original and snapshot() == before
    proof = {
        "status": "PASS",
        "record": request["record"],
        "request_key": request["request_key"],
        "app_id": request["app_id"],
        "archive_bytes": size,
        "archive_sha256": digest,
        "rows": 1000,
        "restored_content_matches": True,
        "isolated_clone_removed": True,
        "clone_network": "none",
        "serving_data_changed": False,
        "serving_containers_unchanged": True,
        "private_archive_mode": "0600",
        "archive_path": str(archive),
        "product_backup_API_supported": False,
        "replayed_receipt_only": False,
    }
    atomic(
        slot / "receipt.json",
        {
            "request": request,
            "source_content": original,
            "archive_sha256": digest,
            "proof": proof,
        },
    )
    print(json.dumps(proof))
except SystemExit:
    raise
except (
    AssertionError,
    ValueError,
    OSError,
    subprocess.SubprocessError,
    KeyError,
    TypeError,
):
    cleanup_confirmed = True
    try:
        cleanup_clone()
    except (
        AssertionError,
        ValueError,
        OSError,
        subprocess.SubprocessError,
        KeyError,
        TypeError,
    ):
        cleanup_confirmed = False
    print(
        json.dumps(
            {
                "status": "FAIL",
                "stage": stage,
                "code": "POSTGRES_BACKUP_REQUIRES_INSPECTION",
                "same_UUID_only": True,
                "clone_cleanup_confirmed": cleanup_confirmed,
            }
        )
    )
    sys.exit(1)
