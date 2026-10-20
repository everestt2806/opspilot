from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from experiments import preflight
from experiments import run_experiment as runner

SECRET_SENTINEL = "never-report-this-private-key-material"
PUBLIC_KEY_BLOB = bytes.fromhex("0000000b7373682d6564323535313900000020") + bytes(range(32))
PUBLIC_KEY = base64.b64encode(PUBLIC_KEY_BLOB).decode("ascii")
PIN = preflight.public_key_fingerprint("ssh-ed25519", PUBLIC_KEY)


def _profile(
    tmp_path: Path, *, app_count: int = 1, archived: bool = False,
    include_healthcheck_policy: bool = True,
) -> Path:
    path = tmp_path / "profile.db"
    connection = sqlite3.connect(path)
    response_type_column = (
        "healthcheck_response_type TEXT, " if include_healthcheck_policy else ""
    )
    connection.executescript(
        f"""
        CREATE TABLE vps (
          id INTEGER PRIMARY KEY, host TEXT, port INTEGER, username TEXT,
          auth_type TEXT, host_fingerprint TEXT, provider TEXT, region TEXT,
          specs_json TEXT, archived_at TEXT
        );
        CREATE TABLE app (
          id INTEGER PRIMARY KEY, vps_id INTEGER, name TEXT, framework TEXT,
          host_port INTEGER, container_port INTEGER, healthcheck_path TEXT,
          {response_type_column}needs_db INTEGER, imported_from_vps INTEGER,
          current_deployment_id INTEGER
        );
        CREATE TABLE deployment (
          id INTEGER PRIMARY KEY, app_id INTEGER, version INTEGER,
          image_tag TEXT, status TEXT
        );
        """
    )
    connection.execute(
        "INSERT INTO vps VALUES (1, '198.51.100.11', 2222, 'test-user', 'key', ?, 'lab', 'region-a', ?, ?)",
        (PIN, json.dumps({"vcpu": 2, "ram_mb": 4096, "disk_gb": 40}), "archived" if archived else None),
    )
    for app_id in range(1, app_count + 1):
        deployment_id = app_id + 100
        if include_healthcheck_policy:
            connection.execute(
                "INSERT INTO app VALUES (?, 1, ?, 'express', ?, 3000, '/health', 'json', 1, 0, ?)",
                (app_id, f"app-{app_id}", 30000 + app_id, deployment_id),
            )
        else:
            connection.execute(
                "INSERT INTO app VALUES (?, 1, ?, 'express', ?, 3000, '/health', 1, 0, ?)",
                (app_id, f"app-{app_id}", 30000 + app_id, deployment_id),
            )
        connection.execute(
            "INSERT INTO deployment VALUES (?, ?, 1, 'example:v1', 'running')",
            (deployment_id, app_id),
        )
    connection.commit()
    connection.close()
    return path


def _resource_output(
    *, vcpu: int = 2, ram: int = 4_100_000_000, disk: int = 50_000_000_000,
    free: int = 45_000_000_000, containers: int = 2, ntp: str = "yes"
) -> str:
    return "\n".join(
        [
            "PREFLIGHT_VERSION=1",
            "OS_ID=ubuntu",
            "ARCH=x86_64",
            f"VCPU={vcpu}",
            f"MEMTOTAL_BYTES={ram}",
            f"DISK_TOTAL_BYTES={disk}",
            f"DISK_FREE_BYTES={free}",
            f"NTP_SYNC={ntp}",
            "DOCKER=yes",
            "COMPOSE=yes",
            f"RUNNING_CONTAINERS={containers}",
        ]
    )


class FakeSshClient:
    def __init__(self, resource_output: str) -> None:
        self.resource_output = resource_output
        self.commands: list[str] = []
        self.closed = False

    def verify_connection(self, timeout: float) -> None:
        assert timeout == preflight.NETWORK_TIMEOUT_S

    def exec(self, command: str, timeout: float) -> tuple[int, str, str]:
        self.commands.append(command)
        return 0, self.resource_output, "secret-like stderr must not be reported"

    def close(self) -> None:
        self.closed = True


def _configure_readonly_io(monkeypatch: pytest.MonkeyPatch, output: str | None = None) -> dict[str, object]:
    captured: dict[str, object] = {}
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", SECRET_SENTINEL)
    monkeypatch.delenv("OPSPILOT_SSH_KEY_FILE", raising=False)
    monkeypatch.delenv("OPSPILOT_DEPLOY_SECRET", raising=False)
    monkeypatch.setenv("OPSPILOT_KNOWN_HOSTS", "global-known-hosts-must-not-be-used")
    monkeypatch.setattr(
        preflight,
        "scan_public_host_keys",
        lambda host, port: f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}\n".encode(),
    )
    monkeypatch.setattr(preflight, "_check_app_health_policy", lambda *_: preflight._gate("APP_HEALTH", "PASS", "APP_HEALTH_POLICY_OK", status_code=200))
    monkeypatch.setattr(
        preflight,
        "check_ml_endpoint",
        lambda _url, _deployment_id: ([preflight._gate("ML_ENDPOINT", "PASS", "ML_HEALTH_AND_STATUS_OK")], {"trained": False}),
    )

    client = FakeSshClient(output or _resource_output())

    def resolve(**kwargs):
        captured["query_only"] = kwargs["conn"].execute("PRAGMA query_only").fetchone()[0]
        captured["known_hosts_path"] = str(kwargs["known_hosts_file"])
        captured["known_hosts_content"] = Path(kwargs["known_hosts_file"]).read_text(encoding="ascii")
        captured["ssh_key_file"] = kwargs["ssh_key_file"]
        return client

    monkeypatch.setattr(preflight, "resolve_ssh_client", resolve)
    captured["client"] = client
    return captured


def _gate(report: dict[str, object], name: str) -> dict[str, object]:
    return next(gate for gate in report["gates"] if gate["name"] == name)  # type: ignore[index]


def test_host_key_parser_accepts_only_saved_sha256_pin_and_preserves_algorithm() -> None:
    entry, observed = preflight.parse_matching_host_keys(
        f"ignored ssh-ed25519 {PUBLIC_KEY}\nwrong ssh-rsa {base64.b64encode(b'other').decode()}\n".encode(),
        PIN,
        "[198.51.100.11]:2222",
    )
    assert entry == [f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}"]
    assert observed == ["ssh-ed25519", "ssh-rsa"]


@pytest.mark.parametrize("output", [b"", b"host ssh-ed25519 " + base64.b64encode(b"other") + b"\n"])
def test_unmatched_or_missing_key_blocks_before_ssh(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, output: bytes) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch)
    monkeypatch.setattr(preflight, "scan_public_host_keys", lambda *_: output)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "SSH_HOST_KEY")["status"] == "BLOCKED"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "NOT_RUN"
    assert setup["client"].commands == []  # type: ignore[union-attr]


def test_matching_key_uses_isolated_known_hosts_and_readonly_profile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = _profile(tmp_path)
    before = hashlib.sha256(db_path.read_bytes()).hexdigest()
    setup = _configure_readonly_io(monkeypatch)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "SSH_HOST_KEY")["status"] == "PASS"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "PASS"
    assert setup["query_only"] == 1
    assert "[198.51.100.11]:2222 ssh-ed25519" in str(setup["known_hosts_content"])
    assert setup["known_hosts_path"] != "global-known-hosts-must-not-be-used"
    assert not Path(str(setup["known_hosts_path"])).exists()
    assert setup["client"].closed is True  # type: ignore[union-attr]
    assert hashlib.sha256(db_path.read_bytes()).hexdigest() == before


def test_profile_connection_is_readonly_and_no_other_app_keeps_host_blocked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = _profile(tmp_path, app_count=4)
    connection = preflight.open_profile_readonly(db_path)
    with pytest.raises(sqlite3.OperationalError):
        connection.execute("UPDATE vps SET name='changed' WHERE id=1")
    connection.close()
    _configure_readonly_io(monkeypatch, _resource_output(containers=9))
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    dedicated = _gate(report, "DEDICATED_HOST")
    assert dedicated["status"] == "BLOCKED"
    assert dedicated["details"] == {
        "db_app_count": 4,
        "running_container_count": 9,
        "expected_selected_app_containers": 2,
    }
    assert report["overall"] == "BLOCKED"


def test_pre_migration_profile_uses_contract_default_health_policy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path, include_healthcheck_policy=False)
    _configure_readonly_io(monkeypatch)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "APP_HEALTH")["status"] == "PASS"


def test_under_spec_host_is_blocked_without_lowering_thresholds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(
        monkeypatch,
        _resource_output(vcpu=1, ram=3_000_000_000, disk=26_000_000_000, free=18_000_000_000),
    )
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "PROTOCOL_VCPU")["status"] == "BLOCKED"
    assert _gate(report, "PROTOCOL_RAM")["status"] == "BLOCKED"
    assert _gate(report, "PROTOCOL_DISK_CAPACITY")["status"] == "BLOCKED"
    assert _gate(report, "PROTOCOL_DISK_FREE")["status"] == "PASS"


@pytest.mark.parametrize(
    ("url", "health_payload", "status_payload", "expected"),
    [
        (None, {}, {}, "BLOCKED"),
        ("http://example.com:8765", {}, {}, "BLOCKED"),
        ("http://127.0.0.1:8765", {"status": "ok", "version": "1"}, {"deployment_id": 101, "trained": False, "sample_count": 0, "min_samples_required": 150}, "PASS"),
        ("http://127.0.0.1:8765", {"status": "down", "version": "1"}, {}, "BLOCKED"),
        ("http://127.0.0.1:8765", {"status": "ok", "version": "1"}, {"deployment_id": 999, "trained": False, "sample_count": 0, "min_samples_required": 150}, "BLOCKED"),
    ],
)
def test_ml_endpoint_requires_explicit_loopback_health_and_matching_status(
    monkeypatch: pytest.MonkeyPatch, url: str | None, health_payload: dict, status_payload: dict, expected: str
) -> None:
    values = iter([(200, health_payload), (200, status_payload)])
    monkeypatch.setattr(preflight, "_get_bounded_json", lambda *_a, **_kw: next(values))
    gates, _ = preflight.check_ml_endpoint(url, 101)
    assert gates[0].status == expected


def test_missing_or_invalid_credential_blocks_without_keyscan(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = _profile(tmp_path)
    monkeypatch.delenv("OPSPILOT_SSH_SECRET", raising=False)
    monkeypatch.delenv("OPSPILOT_DEPLOY_SECRET", raising=False)
    monkeypatch.delenv("OPSPILOT_SSH_KEY_FILE", raising=False)
    scan_called = False

    def scan(*_args):
        nonlocal scan_called
        scan_called = True
        return b""

    monkeypatch.setattr(preflight, "scan_public_host_keys", scan)
    report = preflight.run_preflight(db_path, 1, 1, None)
    assert _gate(report, "SSH_CREDENTIAL")["status"] == "BLOCKED"
    assert _gate(report, "SSH_HOST_KEY")["status"] == "NOT_RUN"
    assert _gate(report, "ML_ENDPOINT")["reason"] == "ML_URL_EXPLICIT_REQUIRED"
    assert not scan_called


@pytest.mark.parametrize(
    ("archived", "imported"),
    [(True, False), (False, True)],
)
def test_ineligible_selection_does_not_scan_or_connect(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, archived: bool, imported: bool
) -> None:
    db_path = _profile(tmp_path, archived=archived)
    if imported:
        with sqlite3.connect(db_path) as connection:
            connection.execute("UPDATE app SET imported_from_vps=1 WHERE id=1")
    _configure_readonly_io(monkeypatch)
    scan_called = False

    def scan(*_args):
        nonlocal scan_called
        scan_called = True
        return b""

    monkeypatch.setattr(preflight, "scan_public_host_keys", scan)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert not scan_called
    assert _gate(report, "SSH_TRANSPORT")["status"] == "NOT_RUN"


def test_ssh_resolver_credential_error_is_sanitized(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch)
    monkeypatch.setattr(
        preflight,
        "resolve_ssh_client",
        lambda **_kwargs: (_ for _ in ()).throw(
            runner.SshKeyFileError(f"invalid credential: {SECRET_SENTINEL}")
        ),
    )

    report = preflight.run_preflight(
        db_path, 1, 1, "http://127.0.0.1:8765"
    )
    assert _gate(report, "SSH_CREDENTIAL_VALIDATION")["reason"] == "SSH_KEY_FILE_INVALID"
    assert SECRET_SENTINEL not in json.dumps(report)


def test_report_redacts_secrets_and_atomic_writer_cleans_temp(tmp_path: Path) -> None:
    output = tmp_path / "report.json"
    report = {
        "overall": "BLOCKED",
        "gates": [{"name": "SSH", "status": "BLOCKED", "reason": "SSH_AUTHENTICATION_FAILED"}],
        "side_effects": {"experiment_run_written": False},
    }
    preflight.write_report(report, output)
    payload = output.read_text(encoding="utf-8")
    assert SECRET_SENTINEL not in payload
    assert "private" not in payload
    assert list(tmp_path.iterdir()) == [output]


def test_cli_preflight_dispatch_does_not_call_experiment_or_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    report_path = tmp_path / "report.json"
    monkeypatch.setattr(
        preflight,
        "run_preflight",
        lambda **_kwargs: {"overall": "BLOCKED", "gates": [], "side_effects": {"experiment_run_written": False}},
    )
    monkeypatch.setattr(preflight, "write_report", lambda _report, _path: None)
    monkeypatch.setattr(runner, "run_experiment", lambda **_kwargs: pytest.fail("full experiment dispatched"))
    monkeypatch.setattr(runner, "run_attempt", lambda **_kwargs: pytest.fail("attempt dispatched"))
    monkeypatch.setattr(runner, "start_run", lambda *_args, **_kwargs: pytest.fail("run row created"))
    code = runner.main(
        [
            "--preflight-only",
            "--db-path",
            str(tmp_path / "profile.db"),
            "--vps-id",
            "1",
            "--app-id",
            "1",
            "--ml-url",
            "http://127.0.0.1:8765",
            "--report-path",
            str(report_path),
        ]
    )
    assert code == 2
    stdout = capsys.readouterr().out
    assert SECRET_SENTINEL not in stdout


def test_ssh_subprocess_does_not_inherit_secret_and_temp_key_is_removed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", SECRET_SENTINEL)
    monkeypatch.setenv("OPSPILOT_DEPLOY_SECRET", SECRET_SENTINEL)
    captured: dict[str, object] = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["env"] = kwargs["env"]
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner.subprocess, "run", fake_run)
    client = runner.SystemSshClient(
        host="127.0.0.1",
        port=2222,
        username="test-user",
        auth_type="key",
        secret=SECRET_SENTINEL,
        known_hosts_file=tmp_path / "known_hosts",
    )
    key_path = Path(client._effective_key_file)
    assert key_path.exists()
    client.exec("true")
    assert SECRET_SENTINEL not in str(captured["args"])
    child_env = captured["env"]
    assert "OPSPILOT_SSH_SECRET" not in child_env  # type: ignore[operator]
    assert "OPSPILOT_DEPLOY_SECRET" not in child_env  # type: ignore[operator]
    client.close()
    assert not key_path.exists()
