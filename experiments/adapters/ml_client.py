"""Adapter giao tiếp với OpsPilot ML Service (FastAPI) cho runner thí nghiệm (TK-S6, P2d-1a).

Tuân thủ đúng hợp đồng API tại ml-service/main.py và docs/contracts/ml-api.openapi.yaml:
  - GET  /health: Kiểm tra trạng thái sẵn sàng của service.
  - GET  /status?deployment_id={id}: Lấy trạng thái mô hình của deployment.
  - POST /reset: Xóa mô hình cũ của deployment.
  - POST /train: Huấn luyện baseline với danh sách MetricSample của Pha A.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class MlClientError(Exception):
    """Lỗi cơ sở cho ML Client."""


class MlConnectionError(MlClientError):
    """Lỗi kết nối tới ML Service (network, timeout, server unreachable)."""


class MlResponseError(MlClientError):
    """Lỗi phản hồi từ ML Service (HTTP status >= 400 hoặc JSON không hợp lệ)."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_text: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text


class MlClient:
    """HTTP Client giao tiếp với OpsPilot ML Service.

    Sử dụng urllib.request từ thư viện chuẩn Python (zero external dependencies).
    """

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8000",
        default_timeout_s: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_timeout_s = float(default_timeout_s)

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        timeout_s: float | None = None,
    ) -> dict[str, Any]:
        timeout = timeout_s if timeout_s is not None else self.default_timeout_s
        clean_path = path.lstrip("/")
        url = f"{self.base_url}/{clean_path}"
        if params:
            query_string = urllib.parse.urlencode(params)
            url = f"{url}?{query_string}"

        headers = {
            "Accept": "application/json",
            "User-Agent": "OpsPilot-MlClient/1.0",
        }
        data_bytes: bytes | None = None
        if payload is not None:
            data_bytes = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(
            url=url,
            data=data_bytes,
            headers=headers,
            method=method.upper(),
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw_body = resp.read()
                text = raw_body.decode("utf-8")
                if not text.strip():
                    return {}
                try:
                    return json.loads(text)  # type: ignore[no-any-return]
                except json.JSONDecodeError as err:
                    raise MlResponseError(
                        f"Phản hồi từ ML Service không phải JSON hợp lệ: {err}",
                        status_code=getattr(resp, "status", 200),
                        response_text=text,
                    ) from err
        except urllib.error.HTTPError as err:
            try:
                err_body = err.read().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                err_body = str(err)
            raise MlResponseError(
                f"ML Service trả về lỗi HTTP {err.code}: {err_body}",
                status_code=err.code,
                response_text=err_body,
            ) from err
        except (
            urllib.error.URLError,
            TimeoutError,
            ConnectionError,
            OSError,
        ) as err:
            raise MlConnectionError(
                f"Không thể kết nối tới ML Service tại {url}: {err}"
            ) from err

    def check_health(
        self, timeout_s: float = 5.0, raise_for_status: bool = False
    ) -> bool:
        """Kiểm tra GET /health, trả về True nếu service sẵn sàng (status == 'ok').

        Nếu raise_for_status=False (mặc định), trả về False khi không thể kết nối hoặc lỗi.
        Nếu raise_for_status=True, ném MlConnectionError hoặc MlResponseError khi gặp sự cố.
        """
        try:
            res = self._request("GET", "/health", timeout_s=timeout_s)
            return res.get("status") == "ok"
        except (MlConnectionError, MlResponseError):
            if raise_for_status:
                raise
            return False

    def get_status(self, deployment_id: int, timeout_s: float = 5.0) -> dict[str, Any]:
        """Lấy trạng thái mô hình của deployment_id qua GET /status?deployment_id=..."""
        if type(deployment_id) is not int or deployment_id <= 0:
            raise ValueError("deployment_id phải là số nguyên dương")
        return self._request(
            "GET",
            "/status",
            params={"deployment_id": deployment_id},
            timeout_s=timeout_s,
        )

    def reset_models(
        self, deployment_id: int, timeout_s: float = 10.0
    ) -> dict[str, Any]:
        """Xoá mô hình của deployment_id qua POST /reset."""
        if type(deployment_id) is not int or deployment_id <= 0:
            raise ValueError("deployment_id phải là số nguyên dương")
        return self._request(
            "POST",
            "/reset",
            payload={"deployment_id": deployment_id},
            timeout_s=timeout_s,
        )

    def train_models(
        self,
        deployment_id: int,
        samples: list[dict[str, Any]],
        timeout_s: float = 60.0,
    ) -> dict[str, Any]:
        """Huấn luyện mô hình baseline cho deployment_id qua POST /train."""
        if type(deployment_id) is not int or deployment_id <= 0:
            raise ValueError("deployment_id phải là số nguyên dương")
        if not isinstance(samples, list):
            raise TypeError("samples phải là một danh sách các dict metric sample")
        return self._request(
            "POST",
            "/train",
            payload={"deployment_id": deployment_id, "samples": samples},
            timeout_s=timeout_s,
        )
