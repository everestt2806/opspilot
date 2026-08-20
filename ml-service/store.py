"""Ghi/nạp state theo deployment_id: state/<id>/state.pkl + meta.json.

Ghi nguyên tử (file tạm + os.replace) vì poller cũng đọc song song. Pickle cả samples —
restart service không mất cửa sổ trượt, /ingest tiếp tục đúng mạch.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

import joblib

from config import STATE_DIRECTORY

logger = logging.getLogger("ml.store")

_STATE_FILE = "state.pkl"
_META_FILE = "meta.json"


def state_dir(deployment_id: int) -> Path:
    return STATE_DIRECTORY / str(deployment_id)


def save_state(deployment_id: int, payload: dict[str, Any], meta: dict[str, Any]) -> None:
    directory = state_dir(deployment_id)
    directory.mkdir(parents=True, exist_ok=True)
    tmp_state = directory / f"{_STATE_FILE}.tmp"
    joblib.dump(payload, tmp_state)
    tmp_state.replace(directory / _STATE_FILE)
    meta_text = json.dumps(meta, ensure_ascii=False, indent=2)
    (directory / _META_FILE).write_text(meta_text, encoding="utf-8")
    logger.info("luu state deployment %s", deployment_id)


def load_state(deployment_id: int) -> tuple[dict[str, Any], dict[str, Any]] | None:
    directory = state_dir(deployment_id)
    state_path = directory / _STATE_FILE
    meta_path = directory / _META_FILE
    if not state_path.exists() or not meta_path.exists():
        return None
    try:
        payload: dict[str, Any] = joblib.load(state_path)
        meta: dict[str, Any] = json.loads(meta_path.read_text(encoding="utf-8"))
        return payload, meta
    except Exception as exc:  # state hỏng thì coi như chưa có, đừng làm sập service
        logger.warning("khong nap duoc state %s: %s", deployment_id, exc)
        return None


def delete_state(deployment_id: int) -> bool:
    directory = state_dir(deployment_id)
    if not directory.exists():
        return False
    shutil.rmtree(directory)
    return True
