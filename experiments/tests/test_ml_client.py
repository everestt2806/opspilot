from __future__ import annotations

import io
import json
import sys
import urllib.error
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.ml_client import (
    MlClient,
    MlClientError,
    MlConnectionError,
    MlResponseError,
)


def test_exception_hierarchy() -> None:
    assert issubclass(MlConnectionError, MlClientError)
    assert issubclass(MlResponseError, MlClientError)


def _make_mock_response(data: dict[str, Any] | str, status: int = 200) -> MagicMock:
    mock_resp = MagicMock()
    if isinstance(data, dict):
        raw = json.dumps(data).encode("utf-8")
    else:
        raw = data.encode("utf-8")
    mock_resp.read.return_value = raw
    mock_resp.status = status
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None
    return mock_resp


def test_ml_client_init() -> None:
    client = MlClient(base_url="http://localhost:8000/", default_timeout_s=15.0)
    assert client.base_url == "http://localhost:8000"
    assert client.default_timeout_s == 15.0


def test_check_health_success() -> None:
    client = MlClient()
    mock_resp = _make_mock_response(
        {"status": "ok", "version": "0.1.0", "uptime_s": 12.3}
    )

    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
        res = client.check_health(timeout_s=3.0)
        assert res is True
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        assert req.full_url == "http://127.0.0.1:8000/health"
        assert req.get_method() == "GET"
        assert mock_urlopen.call_args[1]["timeout"] == 3.0


def test_check_health_unhealthy_status() -> None:
    client = MlClient()
    mock_resp = _make_mock_response({"status": "degraded"})

    with patch("urllib.request.urlopen", return_value=mock_resp):
        assert client.check_health() is False


def test_check_health_connection_error_default() -> None:
    client = MlClient()
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError("Connection refused"),
    ):
        assert client.check_health() is False


def test_check_health_connection_error_raise_for_status() -> None:
    client = MlClient()
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError("Connection refused"),
    ):
        with pytest.raises(MlConnectionError) as exc_info:
            client.check_health(raise_for_status=True)
        assert "Không thể kết nối tới ML Service" in str(exc_info.value)


def test_check_health_http_error_raise_for_status() -> None:
    client = MlClient()
    err = urllib.error.HTTPError(
        url="http://127.0.0.1:8000/health",
        code=503,
        msg="Service Unavailable",
        hdrs=MagicMock(),
        fp=io.BytesIO(b"Service overloaded"),
    )
    with patch("urllib.request.urlopen", side_effect=err):
        with pytest.raises(MlResponseError) as exc_info:
            client.check_health(raise_for_status=True)
        assert exc_info.value.status_code == 503
        assert "Service overloaded" in exc_info.value.response_text


def test_get_status_success() -> None:
    client = MlClient()
    payload = {
        "deployment_id": 42,
        "trained": True,
        "sample_count": 180,
        "min_samples_required": 150,
        "trained_at": "2026-10-02T10:00:00Z",
    }
    mock_resp = _make_mock_response(payload)

    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
        res = client.get_status(deployment_id=42, timeout_s=4.0)
        assert res == payload
        req = mock_urlopen.call_args[0][0]
        assert req.full_url == "http://127.0.0.1:8000/status?deployment_id=42"
        assert req.get_method() == "GET"


def test_get_status_invalid_deployment_id() -> None:
    client = MlClient()
    with pytest.raises(ValueError, match="deployment_id phải là số nguyên dương"):
        client.get_status(0)
    with pytest.raises(ValueError, match="deployment_id phải là số nguyên dương"):
        client.get_status(-5)
    with pytest.raises(ValueError, match="deployment_id phải là số nguyên dương"):
        client.get_status("42")  # type: ignore[arg-type]


def test_reset_models_success() -> None:
    client = MlClient()
    payload = {"deployment_id": 42, "deleted": True}
    mock_resp = _make_mock_response(payload)

    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
        res = client.reset_models(deployment_id=42, timeout_s=8.0)
        assert res == payload
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        assert req.full_url == "http://127.0.0.1:8000/reset"
        assert req.get_method() == "POST"
        assert req.headers["Content-type"] == "application/json"
        assert json.loads(req.data.decode("utf-8")) == {"deployment_id": 42}
        assert mock_urlopen.call_args[1]["timeout"] == 8.0


def test_reset_models_invalid_id() -> None:
    client = MlClient()
    with pytest.raises(ValueError, match="deployment_id phải là số nguyên dương"):
        client.reset_models(-1)


def test_reset_models_timeout() -> None:
    client = MlClient()
    with patch("urllib.request.urlopen", side_effect=TimeoutError("Request timed out")):
        with pytest.raises(MlConnectionError) as exc_info:
            client.reset_models(42)
        assert "Không thể kết nối tới ML Service" in str(exc_info.value)


def test_train_models_success() -> None:
    client = MlClient()
    samples = [
        {
            "ts": "2026-10-02T10:00:00Z",
            "cpu_pct": 10.5,
            "mem_mb": 256.0,
            "container_up": 1,
        },
        {
            "ts": "2026-10-02T10:00:10Z",
            "cpu_pct": 11.0,
            "mem_mb": 258.0,
            "container_up": 1,
        },
    ]
    expected_resp = {
        "deployment_id": 42,
        "trained": True,
        "train_sample_count": 2,
        "feature_vector_count": 2,
        "trained_at": "2026-10-02T10:30:00Z",
        "warnings": [],
    }
    mock_resp = _make_mock_response(expected_resp)

    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
        res = client.train_models(deployment_id=42, samples=samples, timeout_s=60.0)
        assert res == expected_resp
        req = mock_urlopen.call_args[0][0]
        assert req.full_url == "http://127.0.0.1:8000/train"
        assert req.get_method() == "POST"
        body = json.loads(req.data.decode("utf-8"))
        assert body == {"deployment_id": 42, "samples": samples}
        assert mock_urlopen.call_args[1]["timeout"] == 60.0


def test_train_models_invalid_arguments() -> None:
    client = MlClient()
    with pytest.raises(ValueError, match="deployment_id phải là số nguyên dương"):
        client.train_models(0, [])
    with pytest.raises(TypeError, match="samples phải là một danh sách"):
        client.train_models(42, "not-a-list")  # type: ignore[arg-type]


def test_train_models_http_400_insufficient_samples() -> None:
    client = MlClient()
    err_body = json.dumps(
        {"detail": "Không đủ mẫu: cần ít nhất 150, mới có 50"}, ensure_ascii=False
    ).encode("utf-8")
    err = urllib.error.HTTPError(
        url="http://127.0.0.1:8000/train",
        code=400,
        msg="Bad Request",
        hdrs=MagicMock(),
        fp=io.BytesIO(err_body),
    )

    with patch("urllib.request.urlopen", side_effect=err):
        with pytest.raises(MlResponseError) as exc_info:
            client.train_models(deployment_id=42, samples=[])
        assert exc_info.value.status_code == 400
        assert "Không đủ mẫu" in exc_info.value.response_text
        assert "400" in str(exc_info.value)


def test_invalid_json_response() -> None:
    client = MlClient()
    mock_resp = _make_mock_response("<html>502 Bad Gateway</html>")

    with patch("urllib.request.urlopen", return_value=mock_resp):
        with pytest.raises(MlResponseError) as exc_info:
            client.reset_models(deployment_id=42)
        assert "không phải JSON hợp lệ" in str(exc_info.value)
        assert exc_info.value.response_text == "<html>502 Bad Gateway</html>"
