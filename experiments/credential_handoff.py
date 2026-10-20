"""Controlled stdin credential handoff for a read-only preflight only."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from experiments.preflight import run_preflight, write_report

MAX_SECRET_BYTES = 1024 * 1024


def _read_secret() -> str:
    raw = sys.stdin.buffer.read(MAX_SECRET_BYTES + 1)
    if len(raw) > MAX_SECRET_BYTES:
        raise ValueError("credential input exceeds limit")
    if not raw:
        raise ValueError("credential input missing")
    secret = raw.decode("utf-8")
    if not secret.strip():
        raise ValueError("credential input empty")
    return secret


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--vps-id", required=True, type=int)
    parser.add_argument("--app-id", required=True, type=int)
    parser.add_argument("--ml-url", required=True)
    parser.add_argument("--report-path", required=True)
    parser.add_argument("--scratch-dir", required=True)
    parser.add_argument("--ml-service-root", required=True)
    args = parser.parse_args(argv)
    secret: str | None = None
    previous_tempdir = tempfile.tempdir
    try:
        secret = _read_secret()
        scratch = Path(args.scratch_dir).resolve(strict=True)
        if not scratch.is_dir():
            raise ValueError("scratch directory unavailable")
        tempfile.tempdir = str(scratch)
        ml_root = Path(args.ml_service_root).resolve(strict=True)
        if not ml_root.is_dir() or ml_root != scratch / "ml-service":
            raise ValueError("isolated ML service root invalid")
        os.environ["OPSPILOT_ML_SERVICE_ROOT"] = str(ml_root)
        for name in ("OPSPILOT_SSH_SECRET", "OPSPILOT_DEPLOY_SECRET", "OPSPILOT_SSH_KEY_FILE"):
            os.environ.pop(name, None)
        report = run_preflight(
            db_path=Path(args.db_path),
            vps_id=args.vps_id,
            app_id=args.app_id,
            ml_url=args.ml_url,
            ssh_secret=secret,
        )
        write_report(report, args.report_path)
        sys.stdout.write(json.dumps(report, ensure_ascii=False) + "\n")
        return 0 if report["overall"] == "PASS" else 2
    except Exception as error:  # noqa: BLE001 - expose only a sanitized error class
        error_class = type(error).__name__
        if error_class not in {"OSError", "ValueError", "UnicodeDecodeError", "ProfileError", "OperationalError", "DatabaseError"}:
            error_class = "InternalError"
        sys.stderr.write(f"PREFLIGHT_HANDOFF_FAILED:{error_class}\n")
        return 3
    finally:
        secret = None
        tempfile.tempdir = previous_tempdir


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
