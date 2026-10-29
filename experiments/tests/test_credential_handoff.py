from __future__ import annotations

import io
import json
import tempfile

from experiments import credential_handoff

SECRET = "do-not-print-private-key-fixture"


def test_handoff_dispatches_preflight_only_and_never_reports_secret(monkeypatch, tmp_path) -> None:
    captured: dict[str, object] = {}
    report = {
        "mode": "preflight_only",
        "overall": "BLOCKED",
        "gates": [],
        "side_effects": {"experiment_run_written": False},
    }
    monkeypatch.setattr(credential_handoff.sys, "stdin", io.TextIOWrapper(io.BytesIO(SECRET.encode())))
    monkeypatch.setattr(credential_handoff.sys, "stdout", io.StringIO())
    monkeypatch.setattr(credential_handoff.sys, "stderr", io.StringIO())

    original_tempdir = tempfile.tempdir

    def run_preflight(**kwargs):
        captured.update(kwargs)
        captured["scratch_tempdir"] = tempfile.tempdir
        return report

    def write_report(value, path):
        captured["report_path"] = path
        assert value is report
        assert SECRET not in json.dumps(value)

    monkeypatch.setattr(credential_handoff, "run_preflight", run_preflight)
    monkeypatch.setattr(credential_handoff, "write_report", write_report)
    monkeypatch.setenv("OPSPILOT_SSH_SECRET", "stale-env-secret")
    ml_service_root = tmp_path / "ml-service"
    ml_service_root.mkdir()
    (ml_service_root / "main.py").write_text("# fixture", encoding="utf-8")
    args = [
        "--db-path", str(tmp_path / "profile.db"),
        "--vps-id", "9",
        "--app-id", "3",
        "--ml-url", "http://127.0.0.1:8765",
        "--report-path", str(tmp_path / "report.json"),
        "--scratch-dir", str(tmp_path),
        "--ml-service-root", str(ml_service_root),
    ]
    exit_code = credential_handoff.main(
        args
    )

    assert exit_code == 2
    assert captured["ssh_secret"] == SECRET
    assert captured["vps_id"] == 9 and captured["app_id"] == 3
    assert captured["report_path"] == str(tmp_path / "report.json")
    assert captured["scratch_tempdir"] == str(tmp_path.resolve())
    assert tempfile.tempdir == original_tempdir
    assert "stale-env-secret" not in credential_handoff.sys.stdout.getvalue()
    assert SECRET not in credential_handoff.sys.stdout.getvalue()
    assert "OPSPILOT_SSH_SECRET" not in __import__("os").environ


def test_handoff_rejects_missing_and_oversized_secret(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(credential_handoff.sys, "stdout", io.StringIO())
    stderr = io.StringIO()
    monkeypatch.setattr(credential_handoff.sys, "stderr", stderr)
    args = ["--db-path", "x", "--vps-id", "1", "--app-id", "1", "--ml-url", "http://127.0.0.1:8765", "--report-path", str(tmp_path / "report.json"), "--scratch-dir", str(tmp_path), "--ml-service-root", str(tmp_path / "ml-service")]
    monkeypatch.setattr(credential_handoff.sys, "stdin", io.TextIOWrapper(io.BytesIO(b"")))
    assert credential_handoff.main(args) == 3
    monkeypatch.setattr(credential_handoff.sys, "stdin", io.TextIOWrapper(io.BytesIO(b"x" * (credential_handoff.MAX_SECRET_BYTES + 1))))
    assert credential_handoff.main(args) == 3
    assert SECRET not in stderr.getvalue()


def test_handoff_requires_manager_verified_known_hosts_file_inside_scratch(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(credential_handoff.sys, "stdout", io.StringIO())
    stderr = io.StringIO()
    monkeypatch.setattr(credential_handoff.sys, "stderr", stderr)
    monkeypatch.setattr(credential_handoff.sys, "stdin", io.TextIOWrapper(io.BytesIO(SECRET.encode())))
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    ml_service_root = scratch / "ml-service"
    ml_service_root.mkdir()
    outside = tmp_path / "known_hosts"
    outside.write_text("[host]:22 ssh-ed25519 AAAA\n", encoding="ascii")
    args = [
        "--db-path", str(tmp_path / "profile.db"),
        "--vps-id", "1",
        "--app-id", "1",
        "--ml-url", "http://127.0.0.1:8765",
        "--report-path", str(tmp_path / "report.json"),
        "--scratch-dir", str(scratch),
        "--ml-service-root", str(ml_service_root),
        "--verified-known-hosts-file", str(outside),
    ]

    assert credential_handoff.main(args) == 3
    assert "PREFLIGHT_HANDOFF_FAILED:ValueError" in stderr.getvalue()
    assert SECRET not in stderr.getvalue()
