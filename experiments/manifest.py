"""Manifest và integrity gate cho một run thí nghiệm.

Module chỉ dùng thư viện chuẩn để có thể chạy offline trên máy phân tích. Manifest được ghi
ngay sau mỗi phase và không chứa credential.

Hướng dẫn đọc dữ liệu cũ (backward compatibility):
Các run trước khi chốt protocol version có thể không có trường `protocol_version` trong `meta.json`.
Khi đọc dữ liệu cũ bằng `read_manifest()` hoặc `RunManifest.from_dict()`, hệ thống sẽ tự động gán
giá trị mặc định `legacy-pre-pilot` (hoặc giá trị tuỳ chọn được truyền vào) để phân biệt rõ ràng
với protocol phiên bản hiện tại (`1.0`), bảo đảm tính toàn vẹn và không làm crash các script phân tích.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEFAULT_PROTOCOL_VERSION: str = "1.0"
LEGACY_PROTOCOL_DEFAULT: str = "legacy-pre-pilot"


@dataclass
class RunManifest:
    scenario: str
    repeat_index: int
    attempt_index: int = 1
    vps_id: str = ""
    deployment_id: int | None = None
    git_commit: str = "unknown"
    collector_version: str = "unknown"
    protocol_version: str = DEFAULT_PROTOCOL_VERSION
    feature_version: str = "v1-5metrics-4feats-w20"
    random_state: int = 42
    clock_offset_ms: int = 0
    baseline_start_ts: str | None = None
    train_at_ts: str | None = None
    fault_start_ts: str | None = None
    fault_end_ts: str | None = None
    run_end_ts: str | None = None
    expected_sample_count: int = 450
    actual_sample_count: int = 0
    largest_gap_s: float | None = None
    null_rate: dict[str, float] = field(default_factory=dict)
    fault_params: dict[str, Any] = field(default_factory=dict)
    load_params: dict[str, Any] = field(default_factory=dict)
    status: str = "running"
    abort_reason: str | None = None
    exported_hashes: dict[str, str] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.scenario not in {
            "memory_leak",
            "cpu_spike",
            "error_burst",
            "slow_db",
            "latency_creep",
        }:
            errors.append("scenario không thuộc protocol chính")
        if not 1 <= self.repeat_index <= 10:
            errors.append("repeat_index phải nằm trong 1..10")
        if not 1 <= self.attempt_index <= 3:
            errors.append("attempt_index phải nằm trong 1..3")
        if abs(self.clock_offset_ms) > 2000:
            errors.append("clock_skew vượt 2000ms")
        if self.status == "completed" and self.actual_sample_count < int(
            self.expected_sample_count * 0.9
        ):
            errors.append("sample count dưới 90% kỳ vọng")
        if self.largest_gap_s is not None and self.largest_gap_s > 120:
            errors.append("khoảng trống metric vượt 2 phút")
        return errors

    def to_json(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["integrity_errors"] = self.validate()
        return payload

    @classmethod
    def from_dict(
        cls,
        payload: dict[str, Any],
        default_protocol_version: str = LEGACY_PROTOCOL_DEFAULT,
    ) -> RunManifest:
        """Khôi phục RunManifest từ dict.

        Hỗ trợ đọc dữ liệu cũ: nếu thiếu 'protocol_version', tự động gán default_protocol_version
        ('legacy-pre-pilot'). Bỏ qua các trường ngoài schema (như 'integrity_errors').
        """
        data = dict(payload)
        data.pop("integrity_errors", None)
        if "protocol_version" not in data or data["protocol_version"] is None:
            data["protocol_version"] = default_protocol_version
        valid_fields = {f.name for f in fields(cls)}
        filtered = {k: v for k, v in data.items() if k in valid_fields}
        return cls(**filtered)


def git_commit(repo: Path | None = None) -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=repo, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(path: Path, manifest: RunManifest) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest.to_json(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_manifest(
    path: Path,
    default_protocol_version: str = LEGACY_PROTOCOL_DEFAULT,
) -> RunManifest:
    """Đọc RunManifest từ file JSON, tương thích ngược với dữ liệu cũ thiếu protocol_version."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    return RunManifest.from_dict(
        payload, default_protocol_version=default_protocol_version
    )


def export_hashes(directory: Path, manifest: RunManifest) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(directory.glob("*.csv")):
        hashes[path.name] = sha256_file(path)
    manifest.exported_hashes = hashes
    return hashes


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Ghi manifest nguyên tử, tránh file dở nếu process bị kill giữa chừng."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)
