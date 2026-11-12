"""Packaged state belongs to user data; reading config never creates or migrates models."""

import runpy
from pathlib import Path

import pytest

CONFIG = Path(__file__).resolve().parents[1] / "config.py"


def test_development_default_is_unchanged(monkeypatch):
    monkeypatch.delenv("OPSPILOT_ML_STATE_DIRECTORY", raising=False)
    assert runpy.run_path(str(CONFIG))["STATE_DIRECTORY"] == CONFIG.parent / "state"


def test_absolute_private_state_override_does_not_create_files(monkeypatch, tmp_path):
    state = tmp_path / "Dữ liệu ML" / "state"
    monkeypatch.setenv("OPSPILOT_ML_STATE_DIRECTORY", str(state))
    assert runpy.run_path(str(CONFIG))["STATE_DIRECTORY"] == state
    assert not state.exists()


@pytest.mark.parametrize("state", ["relative/state", ""])
def test_relative_or_empty_state_is_rejected(monkeypatch, state):
    monkeypatch.setenv("OPSPILOT_ML_STATE_DIRECTORY", state)
    with pytest.raises(RuntimeError, match="ML_STATE_DIRECTORY_MUST_BE_ABSOLUTE"):
        runpy.run_path(str(CONFIG))
