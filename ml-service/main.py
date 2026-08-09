from time import monotonic

from fastapi import FastAPI
from pydantic import BaseModel

SERVICE_VERSION = "0.1.0"
STARTED_AT = monotonic()

app = FastAPI(
    title="DeployTool ML Service",
    version=SERVICE_VERSION,
    docs_url=None,
    redoc_url=None,
)


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_s: float


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=SERVICE_VERSION,
        uptime_s=round(monotonic() - STARTED_AT, 3),
    )
