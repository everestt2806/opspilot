from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import subprocess
import tempfile
from datetime import UTC, datetime, timedelta
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
    available: int = 1_000_000_000, free: int = 45_000_000_000,
    containers: int = 3, ntp: str = "yes",
    container_records: list[str] | None = None,
) -> str:
    if container_records is None:
        base = _valid_container_records()
        container_records = base[:containers]
        container_records.extend(
            f"{'f' * (64 - len(str(index)))}{index}|outside-project|service{index}|/opt/other|/opt/other/docker-compose.yml"
            for index in range(max(0, containers - len(base)))
        )
    lines = [
            "PREFLIGHT_VERSION=1",
            "OS_ID=ubuntu",
            "ARCH=x86_64",
            f"VCPU={vcpu}",
            f"MEMTOTAL_BYTES={ram}",
            f"MEMAVAILABLE_BYTES={available}",
            f"DISK_TOTAL_BYTES={disk}",
            f"DISK_FREE_BYTES={free}",
            f"NTP_SYNC={ntp}",
            "DOCKER=yes",
            "COMPOSE=yes",
        ]
    lines.append("CONTAINER_INVENTORY_BEGIN=1")
    lines.extend(f"CONTAINER={record}" for record in container_records)
    lines.append("CONTAINER_INVENTORY_END=1")
    return "\n".join(lines)


def _valid_container_records(app_name: str = "app-1") -> list[str]:
    working_dir = f"/opt/opspilot/{app_name}"
    compose_file = f"{working_dir}/docker-compose.yml"
    return [
        f"{'a' * 64}|{app_name}|app|{working_dir}|{compose_file}",
        f"{'b' * 64}|{app_name}|postgres|{working_dir}|{compose_file}",
        f"{'c' * 64}|{app_name}|collector|{working_dir}|{compose_file}",
    ]


class FakeSshClient:
    def __init__(self, resource_output: str, *, command_code: int = 0, verify_error: Exception | None = None) -> None:
        self.resource_output = resource_output
        self.command_code = command_code
        self.commands: list[str] = []
        self.closed = False
        self.verify_error = verify_error
        self.verify_calls = 0

    def verify_connection(self, timeout: float) -> None:
        assert timeout == preflight.NETWORK_TIMEOUT_S
        self.verify_calls += 1
        if self.verify_error:
            raise self.verify_error

    def exec(self, command: str, timeout: float) -> tuple[int, str, str]:
        self.commands.append(command)
        return self.command_code, self.resource_output, "secret-like stderr must not be reported"

    def close(self) -> None:
        self.closed = True


def _configure_readonly_io(
    monkeypatch: pytest.MonkeyPatch, output: str | None = None, *, command_code: int = 0
) -> dict[str, object]:
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
    monkeypatch.setattr(preflight, "measure_clock_offset_ms", lambda _client: 0)

    client = FakeSshClient(output or _resource_output(), command_code=command_code)

    def resolve(**kwargs):
        captured["query_only"] = kwargs["conn"].execute("PRAGMA query_only").fetchone()[0]
        captured["known_hosts_path"] = str(kwargs["known_hosts_file"])
        captured["known_hosts_content"] = Path(kwargs["known_hosts_file"]).read_text(encoding="ascii")
        captured["ssh_key_file"] = kwargs["ssh_key_file"]
        return client

    monkeypatch.setattr(preflight, "resolve_ssh_client", resolve)
    captured["client"] = client
    return captured


def _configure_resolver_capture(kwargs: dict[str, object], setup: dict[str, object]) -> FakeSshClient:
    connection = kwargs["conn"]
    assert isinstance(connection, sqlite3.Connection)
    setup["runner_resolver_called"] = True
    setup["query_only"] = connection.execute("PRAGMA query_only").fetchone()[0]
    setup["known_hosts_content"] = Path(kwargs["known_hosts_file"]).read_text(encoding="ascii")
    setup["ssh_key_file"] = kwargs["ssh_key_file"]
    return setup["client"]  # type: ignore[return-value]


def _manager_snapshot(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "source": "SshManager",
        "collected_at_utc": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "target_vps_id": 1,
        "endpoint": "198.51.100.11:2222",
        "observed_key_type": "ssh-ed25519",
        "clock_offset_ms": 2401,
        "resource_exit_code": 0,
        "resource_output": _resource_output(),
    }
    value.update(overrides)
    return value


def _gate(report: dict[str, object], name: str) -> dict[str, object]:
    return next(gate for gate in report["gates"] if gate["name"] == name)  # type: ignore[index]


def test_host_key_parser_accepts_only_saved_sha256_pin_and_preserves_algorithm() -> None:
    entry, observed = preflight.parse_matching_host_keys(
        f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}\n[198.51.100.11]:2222 ssh-rsa {base64.b64encode(b'other').decode()}\nwrong ssh-ed25519 {PUBLIC_KEY}\n".encode(),
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


def test_keyscan_timeout_is_reported_separately(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _profile(tmp_path)
    _configure_readonly_io(monkeypatch)
    monkeypatch.setattr(
        preflight,
        "scan_public_host_keys",
        lambda *_args: (_ for _ in ()).throw(subprocess.TimeoutExpired("ssh-keyscan", 5)),
    )
    report = preflight.run_preflight(tmp_path / "profile.db", 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "SSH_HOST_KEY")["reason"] == "HOST_KEY_SCAN_TIMEOUT"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "NOT_RUN"


def test_matching_key_uses_isolated_known_hosts_and_readonly_profile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = _profile(tmp_path)
    before = hashlib.sha256(db_path.read_bytes()).hexdigest()
    setup = _configure_readonly_io(monkeypatch)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "SSH_HOST_KEY")["status"] == "PASS"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "PASS"
    assert _gate(report, "SSH_TRANSPORT")["reason"] == "RUNNER_AUTHENTICATED_AND_READONLY_COMMAND_SUCCEEDED"
    assert setup["client"].verify_calls == 1  # type: ignore[union-attr]
    assert setup["client"].commands == [preflight.RESOURCE_COMMAND]  # type: ignore[union-attr]
    assert setup["query_only"] == 1
    assert "[198.51.100.11]:2222 ssh-ed25519" in str(setup["known_hosts_content"])
    assert setup["known_hosts_path"] != "global-known-hosts-must-not-be-used"
    assert not Path(str(setup["known_hosts_path"])).exists()
    assert setup["client"].closed is True  # type: ignore[union-attr]
    assert hashlib.sha256(db_path.read_bytes()).hexdigest() == before


def test_manager_verified_key_uses_exact_endpoint_pin_then_runner_strictly_verifies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch)
    verified_file = tmp_path / "scratch" / "known_hosts.verified"
    verified_file.parent.mkdir()
    verified_file.write_text(f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}\n", encoding="ascii")
    monkeypatch.setattr(
        preflight,
        "scan_public_host_keys",
        lambda *_: (_ for _ in ()).throw(AssertionError("must reuse SshManager proof")),
    )

    report = preflight.run_preflight(
        db_path,
        1,
        1,
        "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
    )

    assert _gate(report, "SSH_HOST_KEY")["reason"] == "RUNNER_STRICT_HOST_KEY_CHECK_PASSED"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "PASS"
    assert "[198.51.100.11]:2222 ssh-ed25519" in str(setup["known_hosts_content"])
    assert setup["client"].closed is True  # type: ignore[union-attr]


def test_manager_verified_key_rejects_wrong_endpoint_even_when_fingerprint_matches(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch)
    verified_file = tmp_path / "scratch" / "known_hosts.verified"
    verified_file.parent.mkdir()
    verified_file.write_text(f"wrong-endpoint ssh-ed25519 {PUBLIC_KEY}\n", encoding="ascii")

    report = preflight.run_preflight(
        db_path,
        1,
        1,
        "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
    )

    assert _gate(report, "SSH_HOST_KEY")["status"] == "BLOCKED"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "NOT_RUN"
    assert setup["client"].commands == []  # type: ignore[union-attr]


def test_manager_snapshot_is_recorded_but_runner_reauthenticates_and_collects_fresh_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch)
    verified_file = tmp_path / "known_hosts.verified"
    verified_file.write_text(f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}\n", encoding="ascii")
    snapshot_file = tmp_path / "snapshot.json"
    snapshot_file.write_text(
        json.dumps(_manager_snapshot()),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        preflight,
        "scan_public_host_keys",
        lambda *_: (_ for _ in ()).throw(AssertionError("trusted manager snapshot is authoritative")),
    )
    monkeypatch.setattr(
        preflight,
        "resolve_ssh_client",
        lambda **kwargs: _configure_resolver_capture(kwargs, setup),
    )

    report = preflight.run_preflight(
        db_path,
        1,
        1,
        "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
        verified_ssh_snapshot_file=snapshot_file,
    )

    assert _gate(report, "SSH_HOST_KEY")["reason"] == "RUNNER_STRICT_HOST_KEY_CHECK_PASSED"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "PASS"
    assert _gate(report, "VPS_RESOURCES")["status"] == "PASS"
    assert _gate(report, "PROTOCOL_CLOCK_OFFSET")["reason"] == "CLOCK_OFFSET_WITHIN_LIMIT"
    assert report["ssh_manager_snapshot"]["status"] == "RECORDED_NOT_LIVE_PROOF"  # type: ignore[index]
    assert report["ssh_manager_snapshot"]["source"] == "SshManager"  # type: ignore[index]
    assert report["ssh_manager_snapshot"]["target_vps_id"] == 1  # type: ignore[index]
    assert report["ssh_manager_snapshot"]["collected_at_utc"]  # type: ignore[index]
    assert _gate(report, "VPS_RESOURCES")["details"]["source"] == "experiment_runner.SystemSshClient"  # type: ignore[index]
    assert setup["client"].commands == [preflight.RESOURCE_COMMAND]  # type: ignore[union-attr]
    assert "CONTAINER_INVENTORY_BEGIN" not in json.dumps(report)


def test_manager_ssh_success_does_not_pass_runner_when_runner_command_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch, command_code=255)
    verified_file = tmp_path / "known_hosts.verified"
    verified_file.write_text(f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}\n", encoding="ascii")
    snapshot_file = tmp_path / "snapshot.json"
    snapshot_file.write_text(json.dumps(_manager_snapshot()), encoding="utf-8")
    monkeypatch.setattr(preflight, "scan_public_host_keys", lambda *_: pytest.fail("manager key file should be used"))

    def resolve(**kwargs):
        _configure_resolver_capture(kwargs, setup)
        return setup["client"]

    monkeypatch.setattr(preflight, "resolve_ssh_client", resolve)
    report = preflight.run_preflight(
        db_path, 1, 1, "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
        verified_ssh_snapshot_file=snapshot_file,
    )

    assert report["ssh_manager_snapshot"]["status"] == "RECORDED_NOT_LIVE_PROOF"  # type: ignore[index]
    assert _gate(report, "SSH_TRANSPORT")["status"] == "BLOCKED"
    assert _gate(report, "SSH_TRANSPORT")["reason"] == "SSH_READONLY_COMMAND_FAILED"
    assert _gate(report, "VPS_RESOURCES")["status"] == "BLOCKED"
    assert setup["client"].verify_calls == 1  # type: ignore[union-attr]


def test_runner_transport_does_not_pass_when_runner_authentication_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch)
    client = FakeSshClient(_resource_output(), verify_error=runner.SshAuthenticationError("sanitized"))
    setup["client"] = client
    monkeypatch.setattr(preflight, "resolve_ssh_client", lambda **_kwargs: client)

    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")

    assert _gate(report, "SSH_TRANSPORT")["status"] == "BLOCKED"
    assert _gate(report, "SSH_TRANSPORT")["reason"] == "SSH_AUTHENTICATION_FAILED"
    assert _gate(report, "VPS_RESOURCES")["status"] == "NOT_RUN"
    assert client.commands == []
    assert client.closed


def test_stale_manager_snapshot_is_not_used_and_runner_collects_live_target_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch)
    verified_file = tmp_path / "known_hosts.verified"
    verified_file.write_text(f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}\n", encoding="ascii")
    snapshot_file = tmp_path / "snapshot.json"
    old_time = (datetime.now(UTC) - timedelta(minutes=preflight.SSH_SNAPSHOT_MAX_AGE.total_seconds() / 60 + 1)).isoformat().replace("+00:00", "Z")
    snapshot_file.write_text(json.dumps(_manager_snapshot(collected_at_utc=old_time, resource_output="stale")), encoding="utf-8")

    def resolve(**kwargs):
        _configure_resolver_capture(kwargs, setup)
        return setup["client"]

    monkeypatch.setattr(preflight, "resolve_ssh_client", resolve)
    report = preflight.run_preflight(
        db_path, 1, 1, "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
        verified_ssh_snapshot_file=snapshot_file,
    )

    assert report["ssh_manager_snapshot"]["status"] == "NOT_USABLE"  # type: ignore[index]
    assert report["ssh_manager_snapshot"]["reason"] == "SSH_MANAGER_SNAPSHOT_STALE"  # type: ignore[index]
    assert _gate(report, "SSH_TRANSPORT")["status"] == "PASS"
    assert _gate(report, "VPS_RESOURCES")["details"]["target_vps_id"] == 1  # type: ignore[index]
    assert _gate(report, "VPS_RESOURCES")["details"]["source"] == "experiment_runner.SystemSshClient"  # type: ignore[index]
    assert setup["client"].resource_output != "stale"  # type: ignore[union-attr]


def test_pinned_manager_snapshot_rejects_stale_endpoint_and_oversized_inventory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch)
    verified_file = tmp_path / "known_hosts.verified"
    verified_file.write_text(f"[198.51.100.11]:2222 ssh-ed25519 {PUBLIC_KEY}\n", encoding="ascii")
    snapshot_file = tmp_path / "snapshot.json"
    snapshot_file.write_text(
        json.dumps(_manager_snapshot(endpoint="198.51.100.12:2222")),
        encoding="utf-8",
    )
    report = preflight.run_preflight(
        db_path,
        1,
        1,
        "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
        verified_ssh_snapshot_file=snapshot_file,
    )
    assert report["ssh_manager_snapshot"]["status"] == "NOT_USABLE"  # type: ignore[index]
    assert report["ssh_manager_snapshot"]["reason"] == "SSH_MANAGER_SNAPSHOT_IDENTITY_OR_SCHEMA_INVALID"  # type: ignore[index]
    assert _gate(report, "SSH_TRANSPORT")["status"] == "PASS"


def test_pinned_manager_snapshot_still_requires_public_key_matching_saved_pin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch)
    verified_file = tmp_path / "known_hosts.verified"
    verified_file.write_text(
        f"[198.51.100.11]:2222 ssh-ed25519 {base64.b64encode(b'not-the-pinned-key').decode()}\n",
        encoding="ascii",
    )
    snapshot_file = tmp_path / "snapshot.json"
    snapshot_file.write_text(
        json.dumps(_manager_snapshot()),
        encoding="utf-8",
    )
    report = preflight.run_preflight(
        db_path,
        1,
        1,
        "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
        verified_ssh_snapshot_file=snapshot_file,
    )
    assert _gate(report, "SSH_HOST_KEY")["status"] == "BLOCKED"
    assert _gate(report, "SSH_TRANSPORT")["status"] == "NOT_RUN"

    snapshot_file.write_text(
        json.dumps(_manager_snapshot(resource_output="x" * (preflight.MAX_SSH_OUTPUT_BYTES + 1))),
        encoding="utf-8",
    )
    report = preflight.run_preflight(
        db_path,
        1,
        1,
        "http://127.0.0.1:8765",
        verified_known_hosts_file=verified_file,
        verified_ssh_snapshot_file=snapshot_file,
    )
    assert report["ssh_manager_snapshot"]["status"] == "NOT_USABLE"  # type: ignore[index]
    assert _gate(report, "SSH_TRANSPORT")["status"] == "NOT_RUN"


def test_public_key_scan_filters_all_secret_environment_and_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    for name in ("OPSPILOT_SSH_SECRET", "OPSPILOT_DEPLOY_SECRET", "OPSPILOT_SSH_KEY_FILE", "EXTERNAL_API_TOKEN", "OPSPILOT_APP_ENV_JSON"):
        monkeypatch.setenv(name, SECRET_SENTINEL)

    def run(*_args, **kwargs):
        captured["command"] = _args[0]
        captured.update(kwargs)
        return SimpleNamespace(stdout=b"", returncode=0)

    monkeypatch.setattr(preflight.subprocess, "run", run)
    preflight.scan_public_host_keys("198.51.100.11", 2222)
    assert captured["timeout"] == preflight.KEYSCAN_PROCESS_TIMEOUT_S == 8.0
    assert captured["command"][1:3] == ["-T", "5"]  # type: ignore[index]
    child_env = captured["env"]
    assert all(name not in child_env for name in ("OPSPILOT_SSH_SECRET", "OPSPILOT_DEPLOY_SECRET", "OPSPILOT_SSH_KEY_FILE", "EXTERNAL_API_TOKEN", "OPSPILOT_APP_ENV_JSON"))
    assert captured["stdin"] is preflight.subprocess.DEVNULL


def test_explicit_handoff_secret_is_used_without_environment_or_report_leak(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    setup = _configure_readonly_io(monkeypatch)
    monkeypatch.delenv("OPSPILOT_SSH_SECRET", raising=False)
    handoff_secret = "private-key-from-controlled-stdin"
    captured: dict[str, object] = {}

    def resolve(**kwargs):
        captured["ssh_secret"] = kwargs["ssh_secret"]
        captured["query_only"] = kwargs["conn"].execute("PRAGMA query_only").fetchone()[0]
        return setup["client"]

    monkeypatch.setattr(preflight, "resolve_ssh_client", resolve)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765", ssh_secret=handoff_secret)
    rendered = json.dumps(report)
    assert captured["ssh_secret"] == handoff_secret
    assert captured["query_only"] == 1
    assert handoff_secret not in rendered
    assert report["mode"] == "preflight_only"
    assert all(value is False for value in report["side_effects"].values())


def test_ml_endpoint_imports_only_explicit_isolated_source_tree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = tmp_path / "ml-service"
    service.mkdir()
    (service / "main.py").write_text("# source fixture", encoding="utf-8")
    monkeypatch.setenv("OPSPILOT_ML_SERVICE_ROOT", str(service))
    captured: list[str] = []

    def get(url: str, **_kwargs):
        captured.append(url)
        if url.endswith("/health"):
            return 200, {"status": "ok", "version": "test"}
        return 200, {
            "deployment_id": 101,
            "trained": False,
            "sample_count": 0,
            "min_samples_required": 150,
        }

    monkeypatch.setattr(preflight, "_get_bounded_json", get)
    gates, _ = preflight.check_ml_endpoint("http://127.0.0.1:8765", 101)
    assert [gate.status for gate in gates] == ["PASS", "PASS"]
    assert __import__("sys").path[0] == str(service.resolve())
    assert all(url.startswith("http://127.0.0.1:8765/") for url in captured)


def test_ml_endpoint_rejects_stateful_ml_service_copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = tmp_path / "ml-service"
    (service / "state").mkdir(parents=True)
    (service / "main.py").write_text("# source fixture", encoding="utf-8")
    monkeypatch.setenv("OPSPILOT_ML_SERVICE_ROOT", str(service))
    monkeypatch.setattr(preflight, "_get_bounded_json", lambda *_args, **_kwargs: pytest.fail("HTTP must not run"))
    gates, _ = preflight.check_ml_endpoint("http://127.0.0.1:8765", 101)
    assert gates[0].status == "BLOCKED"


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
    assert dedicated["reason"] == "CONTAINER_OUTSIDE_SELECTED_STACK"
    assert dedicated["details"]["db_running_app_count"] == 4  # type: ignore[index]
    assert dedicated["details"]["running_container_count"] == 9  # type: ignore[index]
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
    assert _gate(report, "PROTOCOL_RAM_CAPACITY")["status"] == "BLOCKED"
    assert _gate(report, "PROTOCOL_DISK_CAPACITY")["status"] == "BLOCKED"
    assert _gate(report, "PROTOCOL_DISK_FREE")["status"] == "PASS"


def test_selected_compose_stack_requires_app_database_and_collector(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch, _resource_output())
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "DEDICATED_HOST")["status"] == "PASS"
    assert _gate(report, "DEDICATED_HOST")["details"]["required_service_count"] == 3  # type: ignore[index]


@pytest.mark.parametrize("missing_service", ["app", "postgres", "collector"])
def test_missing_required_service_blocks_even_when_other_stack_labels_match(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, missing_service: str
) -> None:
    db_path = _profile(tmp_path)
    records = [
        record
        for record in _valid_container_records()
        if record.split("|")[2] != missing_service
    ]
    _configure_readonly_io(monkeypatch, _resource_output(container_records=records))
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "DEDICATED_HOST")["reason"] == "REQUIRED_STACK_SERVICE_MISSING"


@pytest.mark.parametrize("bad_inventory", ["", "broken", "no end marker"])
def test_inventory_error_blocks_dedicated_host(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bad_inventory: str
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch, bad_inventory, command_code=1 if bad_inventory == "" else 0)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "DEDICATED_HOST")["status"] == "BLOCKED"
    if bad_inventory == "":
        assert _gate(report, "DEDICATED_HOST")["reason"] == "CONTAINER_INVENTORY_UNAVAILABLE"
    else:
        assert _gate(report, "DEDICATED_HOST")["reason"] == "CONTAINER_INVENTORY_INVALID"


def test_low_available_memory_blocks_even_when_total_ram_meets_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch, _resource_output(ram=8_000_000_000, available=300_000_000))
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "PROTOCOL_RAM_CAPACITY")["status"] == "PASS"
    assert _gate(report, "PROTOCOL_RAM_AVAILABLE")["status"] == "BLOCKED"


def test_missing_memavailable_is_not_run_and_never_inferred_from_total_ram(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    output = _resource_output(ram=8_000_000_000).replace(
        "MEMAVAILABLE_BYTES=1000000000", "MEMAVAILABLE_BYTES="
    )
    _configure_readonly_io(monkeypatch, output)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "PROTOCOL_RAM_CAPACITY")["status"] == "PASS"
    assert _gate(report, "PROTOCOL_RAM_AVAILABLE")["status"] == "NOT_RUN"


def test_ntp_sync_does_not_substitute_for_clock_offset_measurement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch, _resource_output(ntp="yes"))
    monkeypatch.setattr(preflight, "measure_clock_offset_ms", lambda _client: 2_501)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "PROTOCOL_NTP_SYNC")["status"] == "PASS"
    assert _gate(report, "PROTOCOL_CLOCK_OFFSET")["status"] == "BLOCKED"


def test_unavailable_clock_measurement_is_not_run_despite_ntp_yes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    _configure_readonly_io(monkeypatch, _resource_output(ntp="yes"))

    def measurement_unavailable(_client):
        raise TimeoutError("sensitive/raw detail must not escape")

    monkeypatch.setattr(preflight, "measure_clock_offset_ms", measurement_unavailable)
    report = preflight.run_preflight(db_path, 1, 1, "http://127.0.0.1:8765")
    assert _gate(report, "PROTOCOL_NTP_SYNC")["status"] == "PASS"
    assert _gate(report, "PROTOCOL_CLOCK_OFFSET")["status"] == "NOT_RUN"
    assert "sensitive/raw" not in json.dumps(report)


def test_clock_offset_is_not_run_when_transport_is_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = _profile(tmp_path)
    monkeypatch.delenv("OPSPILOT_SSH_SECRET", raising=False)
    monkeypatch.delenv("OPSPILOT_DEPLOY_SECRET", raising=False)
    monkeypatch.delenv("OPSPILOT_SSH_KEY_FILE", raising=False)
    report = preflight.run_preflight(db_path, 1, 1, None)
    assert _gate(report, "PROTOCOL_NTP_SYNC")["status"] == "NOT_RUN"
    assert _gate(report, "PROTOCOL_CLOCK_OFFSET")["status"] == "NOT_RUN"


class _FakeHttpResponse:
    status = 200

    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, _limit: int) -> bytes:
        return self.body


class _FakeHttpOpener:
    def __init__(self, body: bytes) -> None:
        self.response = _FakeHttpResponse(body)

    def open(self, *_args, **_kwargs):
        return self.response


@pytest.mark.parametrize(
    ("policy", "body", "status"),
    [
        ("json", b'{"ok":false}', "BLOCKED"),
        ("json", b'{"status":"unhealthy"}', "BLOCKED"),
        ("json", b"null", "BLOCKED"),
        ("json", b"[]", "BLOCKED"),
        ("json", b"not json", "BLOCKED"),
        ("json", b'{"ok":true,"status":"healthy"}', "PASS"),
        ("status_2xx", b"<!doctype html><h1>Healthy</h1>", "PASS"),
    ],
)
def test_health_policy_respects_json_health_and_status_only_html(
    monkeypatch: pytest.MonkeyPatch, policy: str, body: bytes, status: str
) -> None:
    monkeypatch.setattr(
        preflight.urllib.request,
        "build_opener",
        lambda *_args, **_kwargs: _FakeHttpOpener(body),
    )
    gate = preflight._check_app_health_policy(
        {"host": "127.0.0.1", "port": 22},
        {
            "host_port": 30000,
            "healthcheck_path": "/health",
            "healthcheck_response_type": policy,
        },
    )
    assert gate.status == status


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
    monkeypatch.setenv("OPSPILOT_APP_ENV_JSON", SECRET_SENTINEL)
    monkeypatch.setenv("EXTERNAL_API_TOKEN", SECRET_SENTINEL)
    monkeypatch.setattr(runner, "_restrict_windows_key_acl", lambda *_args, **_kwargs: None)
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
    assert "OPSPILOT_APP_ENV_JSON" not in child_env  # type: ignore[operator]
    assert "EXTERNAL_API_TOKEN" not in child_env  # type: ignore[operator]
    client.close()
    assert not key_path.exists()


def test_ssh_timeout_closes_temporary_key_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(runner, "_restrict_windows_key_acl", lambda *_args, **_kwargs: None)
    client = runner.SystemSshClient(
        host="127.0.0.1", auth_type="key", secret="timeout-key-fixture"
    )
    key_path = Path(client._effective_key_file)
    monkeypatch.setattr(
        runner.subprocess,
        "run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired("ssh", 5)),
    )
    code, stdout, stderr = client.exec("true", timeout=5)
    assert code == 124 and stdout == "" and stderr == "SSH_TIMEOUT"
    assert client.last_error_code == "SSH_TIMEOUT"
    client.close()
    assert not key_path.exists()


@pytest.mark.parametrize(
    ("diagnostic", "expected"),
    [
        ("Load key: invalid format SECRET_SENTINEL", "SSH_KEY_FORMAT_ERROR"),
        ("WARNING: UNPROTECTED PRIVATE KEY FILE! bad permissions SECRET_SENTINEL", "SSH_KEY_PERMISSION_ERROR"),
        ("no mutual signature algorithm SECRET_SENTINEL", "SSH_UNSUPPORTED_ALGORITHM"),
        ("Permission denied (publickey) SECRET_SENTINEL", "SSH_AUTHENTICATION_FAILED"),
        ("Host key verification failed SECRET_SENTINEL", "SSH_HOST_KEY_FAILURE"),
    ],
)
def test_ssh_failure_classification_is_allowlisted_and_redacted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, diagnostic: str, expected: str
) -> None:
    monkeypatch.setattr(runner, "_restrict_windows_key_acl", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        runner.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(returncode=255, stdout="", stderr=diagnostic),
    )
    client = runner.SystemSshClient(host="fixture.invalid", secret=SECRET_SENTINEL)
    code, _stdout, safe_stderr = client.exec("true")
    assert code == 255
    assert safe_stderr == expected == client.last_error_code
    assert SECRET_SENTINEL not in safe_stderr
    with pytest.raises(runner.SshError) as caught:
        client.verify_connection()
    assert caught.value.reason_code == expected
    assert SECRET_SENTINEL not in str(caught.value)
    client.close()


@pytest.mark.parametrize("line_ending", ["\n", "\r\n"])
def test_windows_openssh_key_materialization_strips_only_utf8_bom_and_preserves_key(
    tmp_path: Path, line_ending: str
) -> None:
    """A BOM-prefixed credential must parse to the same public key after materialization."""
    import shutil

    ssh_keygen = shutil.which("ssh-keygen")
    if ssh_keygen is None:
        pytest.skip("OpenSSH ssh-keygen is not installed")

    fixture_path = tmp_path / "fixture_ed25519"
    generated = subprocess.run(
        [ssh_keygen, "-q", "-t", "ed25519", "-N", "", "-f", str(fixture_path)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert generated.returncode == 0
    original = fixture_path.read_text(encoding="utf-8")
    normalized_original = original.replace("\r\n", "\n")
    fixture_with_bom = "\ufeff" + normalized_original.replace("\n", line_ending)
    bom_dir = tmp_path / "bom-fixture"
    bom_dir.mkdir()
    if __import__("os").name == "nt":
        runner._restrict_windows_key_acl(bom_dir, directory=True)
    else:
        bom_dir.chmod(0o700)
    bom_path = bom_dir / "fixture_ed25519_bom"
    bom_path.write_bytes(fixture_with_bom.encode("utf-8"))
    if __import__("os").name == "nt":
        runner._restrict_windows_key_acl(bom_path, directory=False)
    else:
        bom_path.chmod(0o600)

    original_public_key = subprocess.run(
        [ssh_keygen, "-y", "-P", "", "-f", str(fixture_path)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    bom_parse = subprocess.run(
        [ssh_keygen, "-y", "-P", "", "-f", str(bom_path)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert original_public_key.returncode == 0
    assert bom_parse.returncode != 0
    assert runner._classify_ssh_error(bom_parse.stderr) == "SSH_KEY_FORMAT_ERROR"

    client = runner.SystemSshClient(host="fixture.invalid", secret=fixture_with_bom)
    materialized_path = Path(client._effective_key_file)
    materialized_bytes = materialized_path.read_bytes()
    materialized_public_key = subprocess.run(
        [ssh_keygen, "-y", "-P", "", "-f", str(materialized_path)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert materialized_public_key.returncode == 0
    assert materialized_public_key.stdout == original_public_key.stdout
    assert not materialized_bytes.startswith(b"\xef\xbb\xbf")
    expected_newline = line_ending.encode("ascii")
    assert expected_newline in materialized_bytes
    assert materialized_bytes.endswith(expected_newline)
    assert (b"\r\n" in materialized_bytes) == (line_ending == "\r\n")
    assert "******" in repr(client)

    client.close()
    assert not materialized_path.exists()


@pytest.mark.skipif(__import__("os").name != "nt", reason="Windows DACL validation")
def test_windows_temporary_ssh_key_uses_restricted_acl(tmp_path: Path) -> None:
    from experiments.run_experiment import _restrict_windows_key_acl

    directory = tmp_path / "private-key-dir"
    directory.mkdir()
    _restrict_windows_key_acl(directory, directory=True)
    key_path = directory / "key"
    key_path.write_text("fixture-key", encoding="utf-8")
    _restrict_windows_key_acl(key_path, directory=False)
    acl = __import__("subprocess").run(
        ["icacls.exe", str(key_path)], capture_output=True, text=True, timeout=5, check=True
    ).stdout
    assert "SYSTEM" in acl
    assert "(F)" in acl
    assert "(I)" not in acl
    assert "fixture-key" not in acl
