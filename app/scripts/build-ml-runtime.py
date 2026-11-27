"""Build Windows Python resource from approved local distributions, never a copied venv."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import sys
import tempfile
import zipfile
from importlib import metadata
from pathlib import Path, PurePosixPath

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[2]
MAX_FILE = 128 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
EXCLUDED = {
    "tests",
    "test",
    "__pycache__",
    "site-packages",
    "idlelib",
    "tkinter",
    "turtledemo",
    "ensurepip",
    "venv",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked(path: Path, within: Path) -> bytes:
    if path.is_symlink() or not path.resolve().is_relative_to(within.resolve()):
        raise RuntimeError("ML_RUNTIME_SOURCE_PATH_REJECTED")
    if not path.is_file() or path.stat().st_size > MAX_FILE:
        raise RuntimeError("ML_RUNTIME_SOURCE_FILE_REJECTED")
    return path.read_bytes()


def closure(roots: list[str]) -> dict[str, str]:
    todo = list(roots)
    result = {}
    while todo:
        name = canonicalize_name(todo.pop())
        if name in result:
            continue
        distribution = metadata.distribution(name)
        result[name] = distribution.version
        for item in distribution.requires or []:
            requirement = Requirement(item)
            if requirement.marker is None or requirement.marker.evaluate({"extra": ""}):
                dependency = metadata.distribution(requirement.name)
                if not requirement.specifier.contains(dependency.version):
                    raise RuntimeError("ML_RUNTIME_DEPENDENCY_VERSION_REJECTED")
                todo.append(requirement.name)
    return dict(sorted(result.items()))


def build(output: Path) -> dict:
    lock = json.loads(
        (ROOT / "ml-service/runtime-lock.json").read_text(encoding="utf-8")
    )
    if (
        sys.platform != "win32"
        or platform.machine() != "AMD64"
        or platform.python_version() != lock["python_version"]
        or lock["platform"] != "win32-x64"
        or closure(lock["roots"]) != lock["packages"]
    ):
        raise RuntimeError("ML_RUNTIME_APPROVED_BUILD_ENVIRONMENT_REQUIRED")
    output = output.resolve()
    if output.exists() or not any(
        output.is_relative_to(ROOT / base)
        for base in ["app/resources", "app/.out-scripts"]
    ):
        raise RuntimeError("ML_RUNTIME_NEW_SCOPED_OUTPUT_REQUIRED")
    scratch = ROOT / "app/.out-scripts/ml-runtime-build"
    scratch.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="runtime-", dir=scratch))
    base = Path(sys.base_prefix).resolve()
    total = 0

    def put(relative: str, data: bytes) -> None:
        nonlocal total
        path = PurePosixPath(relative)
        if path.is_absolute() or any(p in {"", ".", ".."} for p in path.parts):
            raise RuntimeError("ML_RUNTIME_DESTINATION_REJECTED")
        destination = stage / path
        if destination.exists():
            if destination.read_bytes() != data:
                raise RuntimeError("ML_RUNTIME_FILE_COLLISION")
            return
        total += len(data)
        if len(data) > MAX_FILE or total > MAX_TOTAL:
            raise RuntimeError("ML_RUNTIME_SIZE_LIMIT")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)

    for name in [
        "python.exe",
        "python312.dll",
        "python3.dll",
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "LICENSE.txt",
    ]:
        path = base / name
        if not path.exists() and name in {"python3.dll", "vcruntime140_1.dll"}:
            continue
        put(name, checked(path, base))
    for path in sorted((base / "DLLs").iterdir()):
        if path.suffix.lower() in {".pyd", ".dll"} and not path.name.startswith(
            "_test"
        ):
            put("DLLs/" + path.name, checked(path, base))
    archive = stage / "python312.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        library = base / "Lib"
        for path in sorted(library.rglob("*.py")):
            relative = path.relative_to(library)
            if any(p in EXCLUDED for p in relative.parts):
                continue
            info = zipfile.ZipInfo(relative.as_posix(), (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(info, checked(path, base))
    total += archive.stat().st_size
    put("python312._pth", b"python312.zip\nDLLs\nLib/site-packages\nservice\n")
    for name in lock["packages"]:
        distribution = metadata.distribution(name)
        site = Path(distribution.locate_file("")).resolve()
        if not distribution.files:
            raise RuntimeError("ML_RUNTIME_WHEEL_RECORD_REQUIRED")
        for item in distribution.files:
            path = PurePosixPath(str(item))
            if ".." in path.parts:
                # pip creates console entrypoints outside site-packages; never ship them.
                if str(path).startswith("../../Scripts/"):
                    continue
                raise RuntimeError("ML_RUNTIME_WHEEL_PATH_REJECTED")
            if path.is_absolute():
                raise RuntimeError("ML_RUNTIME_WHEEL_PATH_REJECTED")
            if (
                any(p in {"tests", "test", "__pycache__"} for p in path.parts)
                or path.suffix == ".pyc"
                or path.name == "direct_url.json"
            ):
                continue
            if path.suffix == ".pth":
                raise RuntimeError("ML_RUNTIME_SITE_HOOK_UNSUPPORTED")
            data = checked(Path(distribution.locate_file(item)), site)
            if item.hash:
                expected = base64.urlsafe_b64decode(
                    item.hash.value + "=" * (-len(item.hash.value) % 4)
                ).hex()
                if item.hash.mode != "sha256" or digest(data) != expected:
                    raise RuntimeError("ML_RUNTIME_WHEEL_HASH_REJECTED")
            elif not (
                path.name == "RECORD" and path.parent.name.endswith(".dist-info")
            ):
                raise RuntimeError("ML_RUNTIME_WHEEL_HASH_REQUIRED")
            put("Lib/site-packages/" + path.as_posix(), data)
    service = ROOT / "ml-service"
    for name in ["main.py", "config.py", "features.py", "store.py"]:
        put("service/" + name, checked(service / name, service))
    for path in sorted((service / "models").glob("*.py")):
        put("service/models/" + path.name, checked(path, service))
    records = []
    for path in sorted(stage.rglob("*")):
        if path.is_file():
            data = path.read_bytes()
            records.append(
                {
                    "path": path.relative_to(stage).as_posix(),
                    "size": len(data),
                    "sha256": digest(data),
                }
            )
    if len(records) > 20000 or total > MAX_TOTAL:
        raise RuntimeError("ML_RUNTIME_SIZE_LIMIT")
    manifest = {
        "format": 1,
        "platform": "win32-x64",
        "python_version": lock["python_version"],
        "interpreter": "python.exe",
        "service_directory": "service",
        "packages": lock["packages"],
        "files": records,
    }
    encoded = (
        json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()
    (stage / "manifest.json").write_bytes(encoded)
    output.parent.mkdir(parents=True, exist_ok=True)
    os.replace(stage, output)
    return {
        "status": "PASS",
        "files": len(records),
        "bytes": total,
        "manifest_sha256": digest(encoded),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / "app/resources/ml-runtime"
    )
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.output)))
    except (
        OSError,
        ValueError,
        RuntimeError,
        KeyError,
        metadata.PackageNotFoundError,
    ) as error:
        # No paths, environment values, package source or stderr dumps in the result.
        print(
            json.dumps(
                {
                    "status": "FAIL",
                    "error": str(error)
                    if isinstance(error, RuntimeError)
                    else type(error).__name__,
                }
            )
        )
        sys.exit(1)
