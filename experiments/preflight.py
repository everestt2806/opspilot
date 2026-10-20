"""Read-only preflight for the TK-S6 experiment runner.

Runner transport readiness comes only from its resolver/client after strict
host-key/auth verification and a fixed read-only inventory command. Optional
SshManager snapshots are timestamped display evidence, never runner proof.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from experiments.run_experiment import (
    SshAuthenticationError,
    SshHostKeyError,
    SshKeyFileError,
    UnsupportedAuthTypeError,
    measure_clock_offset_ms,
    resolve_ssh_client,
)

MAX_KEYSCAN_BYTES = 64 * 1024
MAX_SSH_OUTPUT_BYTES = 16 * 1024
SSH_SNAPSHOT_MAX_AGE = timedelta(minutes=5)
MAX_HTTP_BYTES = 32 * 1024
NETWORK_TIMEOUT_S = 5.0
KEYSCAN_CONNECTION_TIMEOUT_S = 5
# Observed Windows OpenSSH keyscan returned after 5.42s with its own -T 5
# deadline; leave a small process-start/exit margin so the outer guard does not
# mislabel the inner per-connection timeout as a subprocess timeout.
KEYSCAN_PROCESS_TIMEOUT_S = 8.0
MIN_VCPU = 2
MIN_RAM_BYTES = 4_000_000_000
MIN_RAM_AVAILABLE_BYTES = 512 * 1024 * 1024
MIN_DISK_BYTES = 40_000_000_000
MIN_DISK_FREE_BYTES = 2_000_000_000
MAX_CLOCK_SKEW_MS = 2_000
EXPECTED_FEATURES = 5


def _safe_child_environment() -> dict[str, str]:
    sensitive_markers = ("SECRET", "TOKEN", "PASSWORD", "CREDENTIAL", "PRIVATE_KEY", "APP_ENV_JSON")
    return {
        name: value
        for name, value in os.environ.items()
        if not any(marker in name.upper() for marker in sensitive_markers)
        and name.upper() != "OPSPILOT_SSH_KEY_FILE"
    }

RESOURCE_COMMAND = """set -eu
export LC_ALL=C
printf 'PREFLIGHT_VERSION=1\\n'
printf 'OS_ID='; (. /etc/os-release && printf '%s\\n' "${ID:-unknown}")
printf 'ARCH='; uname -m
printf 'VCPU='; (getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || printf '0'); printf '\\n'
printf 'MEMTOTAL_BYTES='; awk '/^MemTotal:/ {printf "%.0f\\n", $2 * 1024}' /proc/meminfo
printf 'MEMAVAILABLE_BYTES='; awk '/^MemAvailable:/ {printf "%.0f\\n", $2 * 1024}' /proc/meminfo
printf 'DISK_TOTAL_BYTES='; df -B1 --output=size / 2>/dev/null | tail -n 1 | tr -d ' '
printf 'DISK_FREE_BYTES='; df -B1 --output=avail / 2>/dev/null | tail -n 1 | tr -d ' '
printf 'NTP_SYNC='; (timedatectl show -p NTPSynchronized --value 2>/dev/null || printf 'unknown'); printf '\\n'
printf 'DOCKER='; if command -v docker >/dev/null 2>&1; then printf 'yes\\n'; else printf 'no\\n'; fi
printf 'COMPOSE='; if docker compose version >/dev/null 2>&1; then printf 'yes\\n'; else printf 'no\\n'; fi
container_rows=$(docker ps --no-trunc --format '{{.ID}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.Label "com.docker.compose.project.working_dir"}}|{{.Label "com.docker.compose.project.config_files"}}')
printf 'CONTAINER_INVENTORY_BEGIN=1\\n'
if [ -n "$container_rows" ]; then
  while IFS= read -r row; do printf 'CONTAINER=%s\\n' "$row"; done <<EOF
$container_rows
EOF
fi
printf 'CONTAINER_INVENTORY_END=1\\n'
"""


@dataclass(frozen=True)
class Gate:
    name: str
    status: str
    reason: str
    details: dict[str, Any] | None = None


class ProfileError(Exception):
    """A sanitized problem reading the selected profile or records."""


def _gate(name: str, status: str, reason: str, **details: Any) -> Gate:
    if status not in {"PASS", "BLOCKED", "NOT_RUN"}:
        raise ValueError("Invalid preflight gate status")
    return Gate(name, status, reason, details or None)


def _host_token(host: str, port: int) -> str:
    candidate = host.strip()
    if not candidate or len(candidate) > 253 or candidate.startswith("-"):
        raise ValueError("invalid host")
    try:
        address = ipaddress.ip_address(candidate)
        normalized = address.compressed
    except ValueError:
        normalized = candidate.rstrip(".").lower()
        labels = normalized.split(".")
        if any(
            not label
            or len(label) > 63
            or re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label) is None
            for label in labels
        ):
            raise ValueError("invalid host") from None
    if not 1 <= port <= 65535:
        raise ValueError("invalid port")
    if port == 22:
        return normalized
    return f"[{normalized}]:{port}"


def public_key_fingerprint(key_type: str, encoded_key: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9@._+-]{2,80}", key_type) is None:
        raise ValueError("invalid key type")
    blob = base64.b64decode(encoded_key, validate=True)
    if not blob or base64.b64encode(blob).decode("ascii") != encoded_key:
        raise ValueError("non-canonical public key")
    digest = base64.b64encode(hashlib.sha256(blob).digest()).decode("ascii").rstrip("=")
    return f"SHA256:{digest}"


def parse_matching_host_keys(
    scan_output: bytes, expected_fingerprint: str, host_token: str
) -> tuple[list[str], list[str]]:
    """Return known_hosts entries only for public keys matching the saved pin."""
    if len(scan_output) > MAX_KEYSCAN_BYTES:
        raise ValueError("keyscan output too large")
    expected = expected_fingerprint.strip()
    if re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", expected) is None:
        raise ValueError("invalid saved fingerprint")
    matches: list[str] = []
    observed_types: list[str] = []
    for raw_line in scan_output.decode("ascii", errors="strict").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) < 3 or fields[0] != host_token:
            continue
        key_type, encoded_key = fields[-2], fields[-1]
        try:
            fingerprint = public_key_fingerprint(key_type, encoded_key)
        except (ValueError, base64.binascii.Error):
            continue
        if key_type not in observed_types:
            observed_types.append(key_type)
        if hmac.compare_digest(fingerprint, expected):
            entry = f"{host_token} {key_type} {encoded_key}"
            if entry not in matches:
                matches.append(entry)
    return matches, observed_types


def _load_manager_snapshot(
    path: str | Path, *, host: str, port: int, vps_id: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    raw = Path(path).read_bytes()
    if len(raw) > MAX_SSH_OUTPUT_BYTES:
        raise ValueError("verified SSH snapshot exceeds output limit")
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict):
        raise TypeError("verified SSH snapshot must be an object")
    expected_endpoint = f"{host}:{port}"
    if (
        value.get("endpoint") != expected_endpoint
        or value.get("target_vps_id") != vps_id
        or value.get("source") != "SshManager"
    ):
        raise ValueError("verified SSH snapshot identity mismatch")
    collected_at = value.get("collected_at_utc")
    if not isinstance(collected_at, str):
        raise TypeError("verified SSH snapshot collection time missing")
    try:
        collected = datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("verified SSH snapshot collection time invalid") from None
    if collected.tzinfo is None:
        raise ValueError("verified SSH snapshot collection time must include timezone")
    reference = now or datetime.now(UTC)
    age = reference - collected.astimezone(UTC)
    if age < timedelta(seconds=-30) or age > SSH_SNAPSHOT_MAX_AGE:
        raise ValueError("verified SSH snapshot is stale")
    key_type = value.get("observed_key_type")
    if not isinstance(key_type, str) or re.fullmatch(r"(?:ssh-[A-Za-z0-9-]+|ecdsa-[A-Za-z0-9-]+|sk-[A-Za-z0-9-]+)", key_type) is None:
        raise ValueError("verified SSH snapshot key type invalid")
    resource_code = value.get("resource_exit_code")
    resource_output = value.get("resource_output")
    clock_offset = value.get("clock_offset_ms")
    if type(resource_code) is not int or not isinstance(resource_output, str):
        raise ValueError("verified SSH snapshot resource fields invalid")
    if len(resource_output.encode("utf-8", errors="strict")) > MAX_SSH_OUTPUT_BYTES:
        raise ValueError("verified SSH snapshot resource output exceeds limit")
    if clock_offset is not None and type(clock_offset) is not int:
        raise ValueError("verified SSH snapshot clock field invalid")
    return value


def _snapshot_display(
    snapshot: dict[str, Any] | None,
    invalid_reason: str | None,
    vps: dict[str, Any] | None,
) -> dict[str, Any]:
    if snapshot is None:
        return {
            "status": "NOT_USABLE" if invalid_reason else "NOT_PROVIDED",
            "reason": invalid_reason,
        }
    return {
        "status": "RECORDED_NOT_LIVE_PROOF",
        "source": snapshot["source"],
        "collected_at_utc": snapshot["collected_at_utc"],
        "target_vps_id": snapshot["target_vps_id"],
        "endpoint": snapshot["endpoint"],
        "freshness": "WITHIN_LIMIT",
        "freshness_limit_seconds": int(SSH_SNAPSHOT_MAX_AGE.total_seconds()),
        "selected_target_matches": bool(
            vps is not None
            and snapshot["target_vps_id"] == vps["id"]
            and snapshot["endpoint"] == f"{vps['host']}:{vps['port']}"
        ),
    }


def scan_public_host_keys(host: str, port: int) -> bytes:
    token = _host_token(host, port)
    del token  # validation before placing the host in argv
    child_env = _safe_child_environment()
    completed = subprocess.run(
        ["ssh-keyscan", "-T", str(KEYSCAN_CONNECTION_TIMEOUT_S), "-p", str(port), host],
        capture_output=True,
        timeout=KEYSCAN_PROCESS_TIMEOUT_S,
        check=False,
        env=child_env,
        stdin=subprocess.DEVNULL,
    )
    output = completed.stdout
    if len(output) > MAX_KEYSCAN_BYTES:
        raise ValueError("keyscan output too large")
    if completed.returncode != 0 and not output:
        raise OSError("keyscan failed")
    return output


def open_profile_readonly(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path).resolve(strict=True)
    if not path.is_file():
        raise ProfileError("profile database unavailable")
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    if connection.execute("PRAGMA query_only").fetchone()[0] != 1:
        connection.close()
        raise ProfileError("profile is not read-only")
    return connection


def load_selection(
    connection: sqlite3.Connection, vps_id: int, app_id: int
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], int]:
    try:
        app_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(app)").fetchall()
        }
        healthcheck_policy = (
            "healthcheck_response_type"
            if "healthcheck_response_type" in app_columns
            else "'status_2xx' AS healthcheck_response_type"
        )
        vps_row = connection.execute(
            """SELECT id, host, port, username, auth_type, host_fingerprint,
                      provider, region, specs_json, archived_at
                 FROM vps WHERE id=?""",
            (vps_id,),
        ).fetchone()
        app_row = connection.execute(
            f"""SELECT id, vps_id, name, framework, host_port, container_port,
                      healthcheck_path, {healthcheck_policy}, needs_db,
                      imported_from_vps, current_deployment_id
                 FROM app WHERE id=?""",
            (app_id,),
        ).fetchone()
        if vps_row is None or app_row is None:
            raise ProfileError("selected record missing")
        deployment_id = app_row["current_deployment_id"]
        if type(deployment_id) is not int or deployment_id <= 0:
            raise ProfileError("current deployment missing")
        deployment_row = connection.execute(
            "SELECT id, app_id, version, image_tag, status FROM deployment WHERE id=?",
            (deployment_id,),
        ).fetchone()
        if deployment_row is None:
            raise ProfileError("current deployment missing")
        app_count = int(
            connection.execute(
                """SELECT COUNT(*) FROM app a
                     JOIN deployment d ON d.id=a.current_deployment_id
                    WHERE a.vps_id=? AND d.status='running'""",
                (vps_id,),
            ).fetchone()[0]
        )
        return dict(vps_row), dict(app_row), dict(deployment_row), app_count
    except sqlite3.Error as exc:
        raise ProfileError("profile schema/query failed") from exc


def _parse_resource_output(output: str) -> dict[str, str] | None:
    if len(output.encode("utf-8", errors="replace")) > MAX_SSH_OUTPUT_BYTES:
        return None
    values: dict[str, str] = {}
    container_records: list[str] = []
    inventory_started = False
    inventory_ended = False
    for line in output.splitlines():
        key, separator, value = line.partition("=")
        if key == "CONTAINER":
            if not separator or not inventory_started or inventory_ended or not value:
                return None
            container_records.append(value)
            continue
        if key == "CONTAINER_INVENTORY_BEGIN":
            if not separator or value != "1" or inventory_started:
                return None
            inventory_started = True
            continue
        if key == "CONTAINER_INVENTORY_END":
            if not separator or value != "1" or not inventory_started or inventory_ended:
                return None
            inventory_ended = True
            continue
        if separator and key in {
            "PREFLIGHT_VERSION",
            "OS_ID",
            "ARCH",
            "VCPU",
            "MEMTOTAL_BYTES",
            "MEMAVAILABLE_BYTES",
            "DISK_TOTAL_BYTES",
            "DISK_FREE_BYTES",
            "NTP_SYNC",
            "DOCKER",
            "COMPOSE",
        }:
            if key in values:
                return None
            values[key] = value[:100]
        elif line.strip():
            return None
    required = {
        "PREFLIGHT_VERSION",
        "OS_ID",
        "ARCH",
        "VCPU",
        "MEMTOTAL_BYTES",
        "MEMAVAILABLE_BYTES",
        "DISK_TOTAL_BYTES",
        "DISK_FREE_BYTES",
        "NTP_SYNC",
        "DOCKER",
        "COMPOSE",
    }
    if (
        not required.issubset(values)
        or values["PREFLIGHT_VERSION"] != "1"
        or not inventory_started
        or not inventory_ended
    ):
        return None
    values["CONTAINER_RECORDS"] = "\n".join(container_records)
    return values


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _get_bounded_json(url: str, timeout_s: float = NETWORK_TIMEOUT_S) -> tuple[int, dict[str, Any]]:
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), _NoRedirect()
    )
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "OpsPilot-Experiment-Preflight/1"},
        method="GET",
    )
    try:
        with opener.open(request, timeout=timeout_s) as response:
            body = response.read(MAX_HTTP_BYTES + 1)
            if len(body) > MAX_HTTP_BYTES:
                raise ValueError("response too large")
            payload = json.loads(body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise TypeError("response schema invalid")
            return int(response.status), payload
    except urllib.error.HTTPError as exc:
        # Never retain or expose an error response body.
        exc.close()
        raise ValueError("HTTP status rejected") from None
    except (OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("endpoint unavailable or invalid") from None


def check_ml_endpoint(base_url: str | None, deployment_id: int) -> tuple[list[Gate], dict[str, Any]]:
    if not base_url:
        return [_gate("ML_ENDPOINT", "BLOCKED", "ML_URL_EXPLICIT_REQUIRED")], {}
    try:
        parsed = urllib.parse.urlsplit(base_url)
        if (
            parsed.scheme != "http"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.port is None
            or not 1 <= parsed.port <= 65535
        ):
            raise ValueError("endpoint must be explicit loopback HTTP")
    except ValueError:
        return [_gate("ML_ENDPOINT", "BLOCKED", "ML_URL_INVALID_LOOPBACK_REQUIRED")], {}

    base = f"http://{parsed.netloc}"
    try:
        _prepare_ml_service_runtime()
        health_status, health = _get_bounded_json(f"{base}/health")
        if health_status != 200 or health.get("status") != "ok" or not isinstance(health.get("version"), str):
            raise ValueError("health schema/status invalid")
        status_code, model_status = _get_bounded_json(
            f"{base}/status?deployment_id={deployment_id}"
        )
        if (
            status_code != 200
            or type(model_status.get("deployment_id")) is not int
            or model_status.get("deployment_id") != deployment_id
            or type(model_status.get("trained")) is not bool
            or type(model_status.get("sample_count")) is not int
            or type(model_status.get("min_samples_required")) is not int
        ):
            raise ValueError("status schema/identity invalid")
        return [
            _gate("ML_ENDPOINT", "PASS", "ML_HEALTH_AND_STATUS_OK", version=health["version"]),
            _gate(
                "ML_MODEL_STATUS",
                "PASS",
                "ML_STATUS_READ_ONLY",
                trained=model_status["trained"],
                sample_count=model_status["sample_count"],
                min_samples_required=model_status["min_samples_required"],
            ),
        ], model_status
    except (OSError, TimeoutError, ValueError):
        return [_gate("ML_ENDPOINT", "BLOCKED", "ML_HEALTH_OR_STATUS_UNAVAILABLE_OR_INVALID")], {}


def _prepare_ml_service_runtime() -> None:
    """Set import paths only to an explicitly isolated copied service tree."""
    root = os.environ.get("OPSPILOT_ML_SERVICE_ROOT")
    if not root:
        return
    path = Path(root).resolve(strict=True)
    if not path.is_dir() or not (path / "main.py").is_file() or (path / "state").exists():
        raise ValueError("isolated ML service tree is invalid")
    import sys

    sys.path.insert(0, str(path))


def _check_app_health_policy(vps: dict[str, Any], app: dict[str, Any]) -> Gate:
    try:
        host = str(vps["host"])
        _host_token(host, int(vps["port"]))
        port = int(app["host_port"])
        path = str(app["healthcheck_path"])
        if not 1 <= port <= 65535 or not path.startswith("/") or any(ord(c) < 32 for c in path):
            raise ValueError("invalid app health metadata")
        parsed_host = f"[{host}]" if ":" in host else host
        url = f"http://{parsed_host}:{port}{urllib.parse.quote(path, safe='/-._~')}"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        request = urllib.request.Request(url, headers={"User-Agent": "OpsPilot-Experiment-Preflight/1"}, method="GET")
        with opener.open(request, timeout=NETWORK_TIMEOUT_S) as response:
            body = response.read(MAX_HTTP_BYTES + 1)
            if len(body) > MAX_HTTP_BYTES or not 200 <= response.status < 300:
                raise ValueError("health response rejected")
            if app["healthcheck_response_type"] == "json":
                payload = json.loads(body.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("health JSON must be an object")
                if payload.get("ok") is False or payload.get("healthy") is False:
                    raise ValueError("health JSON explicitly unhealthy")
                status_value = payload.get("status")
                if isinstance(status_value, str) and status_value.strip().lower() in {
                    "error",
                    "unhealthy",
                }:
                    raise ValueError("health JSON explicitly unhealthy")
            elif app["healthcheck_response_type"] != "status_2xx":
                raise ValueError("unknown health policy")
            return _gate("APP_HEALTH", "PASS", "APP_HEALTH_POLICY_OK", status_code=response.status)
    except (OSError, TimeoutError, ValueError, urllib.error.URLError, json.JSONDecodeError):
        return _gate("APP_HEALTH", "BLOCKED", "APP_HEALTH_NOT_CONFIRMED")


def _credential_state(
    auth_type: str, ssh_key_file: str | Path | None, ssh_secret: str | None = None
) -> tuple[bool, str]:
    if auth_type != "key":
        return False, "SSH_AUTH_TYPE_UNSUPPORTED"
    explicit_file = ssh_key_file or os.environ.get("OPSPILOT_SSH_KEY_FILE")
    if explicit_file:
        path = Path(explicit_file).expanduser()
        try:
            if path.is_file() and path.stat().st_size > 0:
                return True, "SSH_KEY_FILE_AVAILABLE"
        except OSError:
            pass
        return False, "SSH_KEY_FILE_UNAVAILABLE"
    secret = ssh_secret or os.environ.get("OPSPILOT_SSH_SECRET") or os.environ.get("OPSPILOT_DEPLOY_SECRET")
    if secret and secret.strip():
        return True, "SSH_SECRET_AVAILABLE_IN_MEMORY"
    return False, "SSH_CREDENTIAL_MISSING"


def _dedicated_host_gate(
    resources: dict[str, str], app: dict[str, Any], app_count: int
) -> Gate:
    raw_records = resources.get("CONTAINER_RECORDS")
    if raw_records is None:
        return _gate("DEDICATED_HOST", "BLOCKED", "CONTAINER_INVENTORY_UNAVAILABLE")

    app_name = app.get("name")
    if not isinstance(app_name, str) or re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", app_name) is None:
        return _gate("DEDICATED_HOST", "BLOCKED", "APP_STACK_IDENTITY_INVALID")

    expected_services = {"app", "collector"}
    if app.get("needs_db") == 1:
        expected_services.add("postgres")
    expected_working_dir = f"/opt/opspilot/{app_name}"
    expected_config_file = f"{expected_working_dir}/docker-compose.yml"
    seen_ids: set[str] = set()
    seen_services: set[str] = set()
    outside_stack = False
    malformed = False
    records = [line for line in raw_records.splitlines() if line]
    for record in records:
        fields = record.split("|")
        if len(fields) != 5:
            malformed = True
            continue
        container_id, project, service, working_dir, config_files = fields
        if re.fullmatch(r"[0-9a-f]{12,64}", container_id) is None or container_id in seen_ids:
            malformed = True
            continue
        seen_ids.add(container_id)
        if (
            project != app_name
            or working_dir != expected_working_dir
            or config_files != expected_config_file
            or service not in expected_services
        ):
            outside_stack = True
            continue
        if service in seen_services:
            malformed = True
        seen_services.add(service)

    details = {
        "db_running_app_count": app_count,
        "running_container_count": len(records),
        "required_service_count": len(expected_services),
    }
    if malformed:
        return _gate("DEDICATED_HOST", "BLOCKED", "CONTAINER_INVENTORY_INVALID", **details)
    if outside_stack:
        return _gate("DEDICATED_HOST", "BLOCKED", "CONTAINER_OUTSIDE_SELECTED_STACK", **details)
    missing = expected_services - seen_services
    if missing:
        return _gate(
            "DEDICATED_HOST",
            "BLOCKED",
            "REQUIRED_STACK_SERVICE_MISSING",
            missing_service_count=len(missing),
            **details,
        )
    if app_count != 1:
        return _gate("DEDICATED_HOST", "BLOCKED", "OTHER_OPSPILOT_APPS_RUNNING", **details)
    return _gate("DEDICATED_HOST", "PASS", "ONLY_SELECTED_APP_STACK_RUNNING", **details)


def _protocol_gates(
    resources: dict[str, str],
    vps: dict[str, Any],
    app: dict[str, Any],
    deployment: dict[str, Any],
    app_count: int,
    clock_offset: int | None,
) -> list[Gate]:
    try:
        vcpu = int(resources["VCPU"])
        memory_total = int(resources["MEMTOTAL_BYTES"])
        disk = int(resources["DISK_TOTAL_BYTES"])
        disk_free = int(resources["DISK_FREE_BYTES"])
    except (KeyError, ValueError):
        return [_gate("PROTOCOL_RESOURCES", "BLOCKED", "RESOURCE_SNAPSHOT_INVALID")]
    try:
        memory_available = int(resources["MEMAVAILABLE_BYTES"])
    except (KeyError, ValueError):
        memory_available = None

    gates = [
        _gate(
            "PROTOCOL_PLATFORM",
            "PASS"
            if resources.get("OS_ID") in {"ubuntu", "debian"}
            and resources.get("ARCH") in {"x86_64", "aarch64"}
            else "BLOCKED",
            "SUPPORTED_LINUX_PLATFORM" if resources.get("OS_ID") in {"ubuntu", "debian"} else "UNSUPPORTED_OR_UNKNOWN_LINUX_DISTRIBUTION",
            os_id=resources.get("OS_ID"),
            architecture=resources.get("ARCH"),
        ),
        _gate("PROTOCOL_VCPU", "PASS" if vcpu >= MIN_VCPU else "BLOCKED", "VCPU_TARGET", actual=vcpu, required=MIN_VCPU),
        _gate("PROTOCOL_RAM_CAPACITY", "PASS" if memory_total >= MIN_RAM_BYTES else "BLOCKED", "RAM_CAPACITY_REFERENCE", actual=memory_total, required=MIN_RAM_BYTES),
        _gate(
            "PROTOCOL_RAM_AVAILABLE",
            "PASS" if memory_available is not None and memory_available > MIN_RAM_AVAILABLE_BYTES else "BLOCKED" if memory_available is not None else "NOT_RUN",
            "RAM_AVAILABLE_GUARD" if memory_available is not None else "MEMAVAILABLE_NOT_REPORTED",
            actual=memory_available,
            required_strictly_greater_than=MIN_RAM_AVAILABLE_BYTES,
        ),
        _gate("PROTOCOL_DISK_CAPACITY", "PASS" if disk >= MIN_DISK_BYTES else "BLOCKED", "DISK_40GB_TARGET", actual=disk, required=MIN_DISK_BYTES),
        _gate("PROTOCOL_DISK_FREE", "PASS" if disk_free > MIN_DISK_FREE_BYTES else "BLOCKED", "DEPLOY_FREE_DISK_GUARD", actual=disk_free, required_strictly_greater_than=MIN_DISK_FREE_BYTES),
        _gate("PROTOCOL_NTP_SYNC", "PASS" if resources.get("NTP_SYNC") == "yes" else "BLOCKED", "NTP_SYNC_REQUIRED", ntp_sync=resources.get("NTP_SYNC")),
    ]
    if clock_offset is None:
        gates.append(_gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", "CLOCK_OFFSET_NOT_MEASURED"))
    else:
        gates.append(
            _gate(
                "PROTOCOL_CLOCK_OFFSET",
                "PASS" if abs(clock_offset) <= MAX_CLOCK_SKEW_MS else "BLOCKED",
                "CLOCK_OFFSET_WITHIN_LIMIT" if abs(clock_offset) <= MAX_CLOCK_SKEW_MS else "CLOCK_SKEW_EXCEEDS_LIMIT",
                offset_ms=clock_offset,
                max_abs_offset_ms=MAX_CLOCK_SKEW_MS,
            )
        )
    gates.append(_gate("PROTOCOL_DOCKER", "PASS" if resources.get("DOCKER") == "yes" and resources.get("COMPOSE") == "yes" else "BLOCKED", "DOCKER_COMPOSE_REQUIRED"))
    is_running = deployment.get("status") == "running"
    gates.append(_gate("SELECTED_DEPLOYMENT", "PASS" if is_running else "BLOCKED", "CURRENT_DEPLOYMENT_MUST_BE_RUNNING", deployment_status=deployment.get("status")))
    imported = app.get("imported_from_vps") == 1
    gates.append(_gate("SELECTED_APP_ORIGIN", "BLOCKED" if imported else "PASS", "IMPORTED_APP_NOT_EXPERIMENT_TARGET" if imported else "OPS_PILOT_APP_RECORD"))
    expected_stack = app.get("framework") == "express" and app.get("needs_db") == 1
    gates.append(
        _gate(
            "PROTOCOL_APP_STACK",
            "PASS" if expected_stack else "BLOCKED",
            "EXPRESS_POSTGRESQL_APP_REQUIRED" if not expected_stack else "EXPECTED_EXPERIMENT_APP_STACK",
        )
    )
    gates.append(_dedicated_host_gate(resources, app, app_count))

    declared_specs: dict[str, Any] = {}
    try:
        if vps.get("specs_json"):
            decoded = json.loads(vps["specs_json"])
            if isinstance(decoded, dict):
                declared_specs = decoded
    except (json.JSONDecodeError, TypeError):
        pass
    provider_region_set = bool(vps.get("provider") and vps.get("region"))
    gates.append(
        _gate(
            "EXPERIMENT_PROVIDER_METADATA",
            "PASS" if provider_region_set else "BLOCKED",
            "PROVIDER_AND_REGION_REQUIRED",
        )
    )
    declared_match = (
        declared_specs.get("vcpu") == MIN_VCPU
        and declared_specs.get("ram_mb") == 4096
        and declared_specs.get("disk_gb") == 40
    )
    gates.append(
        _gate(
            "DECLARED_EXPERIMENT_SPECS",
            "PASS" if declared_match else "BLOCKED",
            "DECLARED_2CPU_4GB_40GB_TARGET",
        )
    )
    return gates


def _remote_observation_gates(
    client: Any,
    vps: dict[str, Any],
    app: dict[str, Any],
    deployment: dict[str, Any],
    app_count: int,
    measured_clock_offset_ms: int | None = None,
) -> list[Gate]:
    gates: list[Gate] = []
    try:
        client.verify_connection(timeout=NETWORK_TIMEOUT_S)
    except SshHostKeyError:
        return [
            _gate("SSH_HOST_KEY", "BLOCKED", "SSH_HOST_KEY_REJECTED"),
            _gate("SSH_TRANSPORT", "BLOCKED", "SSH_HOST_KEY_REJECTED"),
            _gate("VPS_RESOURCES", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("DEDICATED_HOST", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("PROTOCOL_NTP_SYNC", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
        ]
    except SshAuthenticationError:
        return [
            _gate("SSH_HOST_KEY", "PASS", "RUNNER_STRICT_HOST_KEY_CHECK_PASSED"),
            _gate("SSH_TRANSPORT", "BLOCKED", "SSH_AUTHENTICATION_FAILED"),
            _gate("VPS_RESOURCES", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("DEDICATED_HOST", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("PROTOCOL_NTP_SYNC", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
        ]
    except Exception:  # noqa: BLE001
        return [
            _gate("SSH_HOST_KEY", "NOT_RUN", "RUNNER_HOST_KEY_CHECK_NOT_CONFIRMED"),
            _gate("SSH_TRANSPORT", "BLOCKED", "SSH_CONNECTION_FAILED"),
            _gate("VPS_RESOURCES", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("DEDICATED_HOST", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("PROTOCOL_NTP_SYNC", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
            _gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
        ]

    if measured_clock_offset_ms is not None:
        clock_offset = measured_clock_offset_ms
    else:
        try:
            clock_offset = measure_clock_offset_ms(client)
        except Exception:  # noqa: BLE001
            clock_offset = None

    try:
        code, stdout, _stderr = client.exec(RESOURCE_COMMAND, timeout=NETWORK_TIMEOUT_S)
    except Exception:  # noqa: BLE001
        code, stdout = 1, ""
    if code != 0 or len(stdout.encode("utf-8", errors="replace")) > MAX_SSH_OUTPUT_BYTES:
        gates.extend(
            [
                _gate("SSH_HOST_KEY", "PASS", "RUNNER_STRICT_HOST_KEY_CHECK_PASSED"),
                _gate("SSH_TRANSPORT", "BLOCKED", "SSH_READONLY_COMMAND_FAILED"),
                _gate("VPS_RESOURCES", "BLOCKED", "READ_ONLY_INVENTORY_COMMAND_FAILED"),
                _gate("DEDICATED_HOST", "BLOCKED", "CONTAINER_INVENTORY_UNAVAILABLE"),
                _gate("PROTOCOL_NTP_SYNC", "NOT_RUN", "RESOURCE_SNAPSHOT_UNAVAILABLE"),
            ]
        )
        gates.append(
            _gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", "CLOCK_OFFSET_NOT_MEASURED")
            if clock_offset is None
            else _gate(
                "PROTOCOL_CLOCK_OFFSET",
                "PASS" if abs(clock_offset) <= MAX_CLOCK_SKEW_MS else "BLOCKED",
                "CLOCK_OFFSET_WITHIN_LIMIT" if abs(clock_offset) <= MAX_CLOCK_SKEW_MS else "CLOCK_SKEW_EXCEEDS_LIMIT",
                offset_ms=clock_offset,
                max_abs_offset_ms=MAX_CLOCK_SKEW_MS,
            )
        )
        return gates

    gates.append(_gate("SSH_HOST_KEY", "PASS", "RUNNER_STRICT_HOST_KEY_CHECK_PASSED"))
    gates.append(_gate("SSH_TRANSPORT", "PASS", "RUNNER_AUTHENTICATED_AND_READONLY_COMMAND_SUCCEEDED"))

    resources = _parse_resource_output(stdout)
    if resources is None:
        gates.extend(
            [
                _gate("VPS_RESOURCES", "BLOCKED", "RESOURCE_SNAPSHOT_INVALID"),
                _gate("DEDICATED_HOST", "BLOCKED", "CONTAINER_INVENTORY_INVALID"),
                _gate("PROTOCOL_NTP_SYNC", "NOT_RUN", "RESOURCE_SNAPSHOT_INVALID"),
            ]
        )
        gates.append(
            _gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", "CLOCK_OFFSET_NOT_MEASURED")
            if clock_offset is None
            else _gate(
                "PROTOCOL_CLOCK_OFFSET",
                "PASS" if abs(clock_offset) <= MAX_CLOCK_SKEW_MS else "BLOCKED",
                "CLOCK_OFFSET_WITHIN_LIMIT" if abs(clock_offset) <= MAX_CLOCK_SKEW_MS else "CLOCK_SKEW_EXCEEDS_LIMIT",
                offset_ms=clock_offset,
                max_abs_offset_ms=MAX_CLOCK_SKEW_MS,
            )
        )
        return gates

    gates.append(
        _gate(
            "VPS_RESOURCES",
            "PASS",
            "READ_ONLY_RESOURCE_AND_CONTAINER_INVENTORY",
            source="experiment_runner.SystemSshClient",
            collected_at_utc=datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
            target_vps_id=int(vps["id"]),
            endpoint=f"{vps['host']}:{vps['port']}",
            freshness_limit_seconds=int(SSH_SNAPSHOT_MAX_AGE.total_seconds()),
        )
    )
    gates.extend(_protocol_gates(resources, vps, app, deployment, app_count, clock_offset))
    return gates

def run_preflight(
    db_path: str | Path,
    vps_id: int | None,
    app_id: int | None,
    ml_url: str | None,
    *,
    ssh_key_file: str | Path | None = None,
    ssh_secret: str | None = None,
    verified_known_hosts_file: str | Path | None = None,
    verified_ssh_snapshot_file: str | Path | None = None,
) -> dict[str, Any]:
    """Check readiness without creating an experiment or invoking run adapters."""
    gates: list[Gate] = []
    selected: dict[str, int | None] = {"vps_id": vps_id, "app_id": app_id, "deployment_id": None}
    connection: sqlite3.Connection | None = None
    vps: dict[str, Any] | None = None
    app: dict[str, Any] | None = None
    deployment: dict[str, Any] | None = None
    app_count = 0
    profile_opened = False
    ssh_manager_snapshot: dict[str, Any] | None = None
    ssh_manager_snapshot_invalid_reason: str | None = None
    try:
        connection = open_profile_readonly(db_path)
        profile_opened = True
        gates.append(_gate("PROFILE_READ_ONLY", "PASS", "SQLITE_READONLY_QUERY_ONLY"))
        if type(vps_id) is not int or vps_id <= 0 or type(app_id) is not int or app_id <= 0:
            raise ProfileError("positive VPS and app IDs required")
        vps, app, deployment, app_count = load_selection(connection, vps_id, app_id)
        selected["deployment_id"] = int(deployment["id"])
        gates.append(_gate("SELECTION", "PASS", "PROFILE_RECORDS_FOUND", vps_id=vps_id, app_id=app_id, deployment_id=deployment["id"]))
        gates.append(_gate("VPS_ACTIVE", "PASS" if vps.get("archived_at") is None else "BLOCKED", "VPS_ARCHIVED" if vps.get("archived_at") else "VPS_NOT_ARCHIVED"))
        belongs = app.get("vps_id") == vps_id and deployment.get("app_id") == app_id
        gates.append(_gate("APP_DEPLOYMENT_OWNERSHIP", "PASS" if belongs else "BLOCKED", "APP_DEPLOYMENT_VPS_MISMATCH" if not belongs else "APP_DEPLOYMENT_LINKS_MATCH"))
    except (OSError, sqlite3.Error, ProfileError, ValueError):
        if not profile_opened:
            gates.append(_gate("PROFILE_READ_ONLY", "BLOCKED", "PROFILE_OR_SELECTION_INVALID"))
        else:
            gates.append(_gate("SELECTION", "BLOCKED", "PROFILE_SELECTION_INVALID"))
    finally:
        if connection is not None:
            connection.close()

    selection_safe_for_observation = (
        vps is not None
        and app is not None
        and deployment is not None
        and vps.get("archived_at") is None
        and app.get("vps_id") == vps_id
        and deployment.get("app_id") == app_id
        and app.get("imported_from_vps") != 1
    )
    if selected["deployment_id"] is not None and selection_safe_for_observation:
        ml_gates, _model_status = check_ml_endpoint(ml_url, selected["deployment_id"])
        gates.extend(ml_gates)
    else:
        gates.append(_gate("ML_ENDPOINT", "NOT_RUN", "PROFILE_SELECTION_NOT_AVAILABLE"))
    if selection_safe_for_observation:
        gates.append(_check_app_health_policy(vps, app))
    else:
        gates.append(_gate("APP_HEALTH", "NOT_RUN", "PROFILE_SELECTION_NOT_AVAILABLE"))

    if vps is None or app is None or deployment is None:
        gates.extend(
            [
                _gate("SSH_CREDENTIAL", "NOT_RUN", "PROFILE_SELECTION_NOT_AVAILABLE"),
                _gate("SSH_HOST_KEY", "NOT_RUN", "PROFILE_SELECTION_NOT_AVAILABLE"),
                _gate("SSH_TRANSPORT", "NOT_RUN", "PROFILE_SELECTION_NOT_AVAILABLE"),
                _gate("VPS_RESOURCES", "NOT_RUN", "PROFILE_SELECTION_NOT_AVAILABLE"),
            ]
        )
    else:
        selection_safe_for_ssh = selection_safe_for_observation
        if not selection_safe_for_ssh:
            reason = (
                "VPS_ARCHIVED"
                if vps.get("archived_at") is not None
                else "APP_DEPLOYMENT_VPS_MISMATCH"
                if app.get("vps_id") != vps_id or deployment.get("app_id") != app_id
                else "IMPORTED_APP_NOT_EXPERIMENT_TARGET"
            )
            gates.extend(
                [
                    _gate("SSH_CREDENTIAL", "NOT_RUN", "SELECTION_NOT_ELIGIBLE_FOR_SSH"),
                    _gate("SSH_HOST_KEY", "NOT_RUN", reason),
                    _gate("SSH_TRANSPORT", "NOT_RUN", reason),
                    _gate("VPS_RESOURCES", "NOT_RUN", reason),
                ]
            )
            selection_safe_for_ssh = False
        expected_fingerprint = vps.get("host_fingerprint") if selection_safe_for_ssh else None
        if selection_safe_for_ssh:
            pin_valid = isinstance(expected_fingerprint, str) and re.fullmatch(
                r"SHA256:[A-Za-z0-9+/]{43}", expected_fingerprint.strip()
            ) is not None
            gates.append(_gate("SSH_PIN_CONFIG", "PASS" if pin_valid else "BLOCKED", "PIN_PRESENT" if pin_valid else "PIN_MISSING_OR_INVALID"))
            has_credential, credential_reason = _credential_state(str(vps.get("auth_type")), ssh_key_file, ssh_secret)
            gates.append(_gate("SSH_CREDENTIAL", "PASS" if has_credential else "BLOCKED", credential_reason))
            host_token = ""
            try:
                host_token = _host_token(str(vps["host"]), int(vps["port"]))
            except (KeyError, TypeError, ValueError):
                gates.append(_gate("SSH_ENDPOINT", "BLOCKED", "SSH_ENDPOINT_INVALID"))

            if not pin_valid or not has_credential or not host_token:
                gates.extend(
                    [
                        _gate("SSH_HOST_KEY", "NOT_RUN", "PIN_CREDENTIAL_OR_ENDPOINT_UNAVAILABLE"),
                        _gate("SSH_TRANSPORT", "NOT_RUN", "PIN_CREDENTIAL_OR_ENDPOINT_UNAVAILABLE"),
                        _gate("VPS_RESOURCES", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"),
                    ]
                )
            else:
                ssh_phase = "HOST_KEY_SCAN"
                try:
                    if verified_ssh_snapshot_file is not None:
                        try:
                            ssh_manager_snapshot = _load_manager_snapshot(
                                verified_ssh_snapshot_file,
                                host=str(vps["host"]),
                                port=int(vps["port"]),
                                vps_id=vps_id,
                            )
                        except (OSError, TypeError, ValueError, UnicodeError) as exc:
                            # A saved snapshot is display-only; it never decides runner readiness.
                            ssh_manager_snapshot = None
                            ssh_manager_snapshot_invalid_reason = (
                                "SSH_MANAGER_SNAPSHOT_STALE"
                                if "stale" in str(exc).lower()
                                else "SSH_MANAGER_SNAPSHOT_IDENTITY_OR_SCHEMA_INVALID"
                            )
                    if verified_known_hosts_file is not None:
                        verified_hosts_path = Path(verified_known_hosts_file).resolve(strict=True)
                        if not verified_hosts_path.is_file():
                            raise ValueError("verified known-hosts evidence is not a file")
                        keyscan_output = verified_hosts_path.read_bytes()
                        if len(keyscan_output) > MAX_KEYSCAN_BYTES:
                            raise ValueError("verified known-hosts evidence exceeds limit")
                    else:
                        keyscan_output = scan_public_host_keys(str(vps["host"]), int(vps["port"]))
                    matching_lines, observed_key_types = parse_matching_host_keys(
                        keyscan_output, expected_fingerprint, host_token
                    )
                    if not matching_lines:
                        gates.append(
                            _gate(
                                "SSH_HOST_KEY",
                                "BLOCKED",
                                "NO_SCANNED_KEY_MATCHES_SAVED_PIN",
                                observed_key_types=observed_key_types,
                            )
                        )
                        gates.append(_gate("SSH_TRANSPORT", "NOT_RUN", "HOST_KEY_PIN_NOT_MATCHED"))
                        gates.append(_gate("VPS_RESOURCES", "NOT_RUN", "HOST_KEY_PIN_NOT_MATCHED"))
                    else:
                        if ssh_manager_snapshot is not None and ssh_manager_snapshot["observed_key_type"] not in {
                            line.split()[1] for line in matching_lines
                        }:
                            ssh_manager_snapshot = None
                            ssh_manager_snapshot_invalid_reason = "SSH_MANAGER_SNAPSHOT_KEY_TYPE_MISMATCH"
                        ssh_phase = "SSH_PREFLIGHT"
                        with tempfile.TemporaryDirectory(prefix="opspilot-preflight-") as isolated_dir:
                            known_hosts_path = Path(isolated_dir) / "known_hosts"
                            known_hosts_path.write_text("\n".join(matching_lines) + "\n", encoding="ascii")
                            try:
                                os.chmod(known_hosts_path, 0o600)
                            except OSError:
                                pass
                            previous_tempdir = tempfile.tempdir
                            tempfile.tempdir = isolated_dir
                            client = None
                            resolver_connection: sqlite3.Connection | None = None
                            try:
                                resolver_connection = open_profile_readonly(db_path)
                                client = resolve_ssh_client(
                                    conn=resolver_connection,
                                    vps_id=vps_id,
                                    ssh_key_file=ssh_key_file,
                                    ssh_secret=ssh_secret,
                                    known_hosts_file=known_hosts_path,
                                )
                                ssh_secret = None
                            finally:
                                if resolver_connection is not None:
                                    resolver_connection.close()
                                tempfile.tempdir = previous_tempdir
                            if client is None:
                                gates.append(_gate("SSH_HOST_KEY", "NOT_RUN", "RUNNER_CLIENT_UNAVAILABLE"))
                                gates.append(_gate("SSH_TRANSPORT", "BLOCKED", "SSH_CLIENT_UNAVAILABLE"))
                                gates.append(_gate("VPS_RESOURCES", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"))
                                gates.append(_gate("DEDICATED_HOST", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"))
                                gates.append(_gate("PROTOCOL_NTP_SYNC", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"))
                                gates.append(_gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", "SSH_TRANSPORT_NOT_VERIFIED"))
                            else:
                                try:
                                    gates.extend(
                                        _remote_observation_gates(
                                            client, vps, app, deployment, app_count
                                        )
                                    )
                                finally:
                                    client.close()
                except SshKeyFileError:
                    gates.append(_gate("SSH_CREDENTIAL_VALIDATION", "BLOCKED", "SSH_KEY_FILE_INVALID"))
                    gates.append(_gate("SSH_HOST_KEY", "NOT_RUN", "SSH_CREDENTIAL_INVALID"))
                    gates.append(_gate("SSH_TRANSPORT", "NOT_RUN", "SSH_CREDENTIAL_INVALID"))
                    gates.append(_gate("VPS_RESOURCES", "NOT_RUN", "SSH_CREDENTIAL_INVALID"))
                except UnsupportedAuthTypeError:
                    gates.append(_gate("SSH_CREDENTIAL_VALIDATION", "BLOCKED", "SSH_AUTH_TYPE_UNSUPPORTED"))
                    gates.append(_gate("SSH_HOST_KEY", "NOT_RUN", "SSH_CREDENTIAL_INVALID"))
                    gates.append(_gate("SSH_TRANSPORT", "NOT_RUN", "SSH_CREDENTIAL_INVALID"))
                    gates.append(_gate("VPS_RESOURCES", "NOT_RUN", "SSH_CREDENTIAL_INVALID"))
                except (OSError, subprocess.SubprocessError, TypeError, ValueError, UnicodeError) as exc:
                    if ssh_phase == "HOST_KEY_SCAN":
                        if isinstance(exc, subprocess.TimeoutExpired):
                            reason = "HOST_KEY_SCAN_TIMEOUT"
                        elif isinstance(exc, OSError):
                            reason = "HOST_KEY_SCAN_FAILED"
                        else:
                            reason = "HOST_KEY_SCAN_OUTPUT_INVALID"
                        transport_reason = "HOST_KEY_PIN_NOT_MATCHED"
                    else:
                        reason = "SSH_PREFLIGHT_FAILED"
                        transport_reason = "SSH_RUNNER_PREFLIGHT_FAILED"
                    gates.append(
                        _gate("SSH_HOST_KEY", "BLOCKED" if ssh_phase == "HOST_KEY_SCAN" else "NOT_RUN", reason)
                    )
                    gates.append(
                        _gate("SSH_TRANSPORT", "NOT_RUN" if ssh_phase == "HOST_KEY_SCAN" else "BLOCKED", transport_reason)
                    )
                    gates.append(_gate("VPS_RESOURCES", "NOT_RUN", transport_reason))
                    gates.append(_gate("DEDICATED_HOST", "NOT_RUN", transport_reason))
                    gates.append(_gate("PROTOCOL_NTP_SYNC", "NOT_RUN", transport_reason))
                    gates.append(_gate("PROTOCOL_CLOCK_OFFSET", "NOT_RUN", transport_reason))

    if not any(g.name == "PROTOCOL_PROVIDER_PAIR" for g in gates):
        gates.append(_gate("PROTOCOL_PROVIDER_PAIR", "NOT_RUN", "SECOND_VPS_NOT_SELECTED_OR_VERIFIED"))
    for gate_name in (
        "DEDICATED_HOST",
        "PROTOCOL_RAM_AVAILABLE",
        "PROTOCOL_NTP_SYNC",
        "PROTOCOL_CLOCK_OFFSET",
    ):
        if not any(g.name == gate_name for g in gates):
            gates.append(_gate(gate_name, "NOT_RUN", "REMOTE_EVIDENCE_UNAVAILABLE"))
    blocked = any(g.status == "BLOCKED" for g in gates)
    not_run = any(g.status == "NOT_RUN" for g in gates)
    report = {
        "generated_at_utc": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "mode": "preflight_only",
        "overall": "BLOCKED" if blocked or not_run else "PASS",
        "selected": selected,
        "ssh_manager_snapshot": _snapshot_display(
            ssh_manager_snapshot, ssh_manager_snapshot_invalid_reason, vps
        ),
        "gates": [asdict(g) for g in gates],
        "side_effects": {
            "experiment_run_written": False,
            "deployment_started": False,
            "ml_reset_train_ingest_called": False,
            "loadgen_or_fault_called": False,
            "remote_cleanup_called": False,
        },
    }
    return report


def write_report(report: dict[str, Any], report_path: str | Path) -> None:
    """Atomically write a sanitized local report; never includes command output or secrets."""
    path = Path(report_path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".preflight-", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write("\n")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
