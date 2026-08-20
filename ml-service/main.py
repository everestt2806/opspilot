"""OpsPilot ML service — FastAPI, bind 127.0.0.1, đúng 6 endpoint của ml-api.openapi.yaml.

Vòng đời: Electron spawn -> poller gửi /ingest từng mẫu -> đủ 150 mẫu bình thường
thì /train -> từ đó /ingest trả score đủ 4 method. /replay dùng cho phân tích offline,
không side-effect. State nằm trong state/<deployment_id>/ — restart không mất model.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from time import monotonic
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import config
from features import (
    FeatureConfig,
    build_matrix,
    build_vector,
    detect_dropped_metrics,
    score_detail,
)
from models.base import Detector
from models.ensemble import ensemble_above_threshold, ensemble_score
from models.iforest import IsolationForestDetector
from models.ocsvm import OneClassSvmDetector
from models.zscore_ewma import ZScoreEwma
from store import delete_state, load_state, save_state

SERVICE_VERSION = "0.1.0"
STARTED_AT = monotonic()

_logger = logging.getLogger("ml")
if not _logger.handlers:
    _formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    _formatter.converter = time.gmtime
    _handler = logging.StreamHandler()
    _handler.setFormatter(_formatter)
    _logger.addHandler(_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False

app = FastAPI(title="OpsPilot ML Service", version=SERVICE_VERSION, docs_url=None, redoc_url=None)

RUNTIMES: dict[int, DeploymentRuntime] = {}

CHILD_METHODS = ("zscore_ewma", "iforest", "ocsvm")
ALL_METHODS = ("zscore_ewma", "iforest", "ocsvm", "ensemble")


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


# ---------- Pydantic (v2) — tên trường khớp từng chữ với OpenAPI ----------


class MetricSample(BaseModel):
    ts: str
    seq: int | None = None
    cpu_pct: float | None = None
    mem_mb: float | None = None
    mem_pct: float | None = None
    mem_limit_mb: float | None = None
    latency_ms: float | None = None
    http_error_rate: float | None = Field(default=None, ge=0, le=1)
    db_response_ms: float | None = None
    container_up: int
    host_cpu_pct: float | None = None
    host_mem_pct: float | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_s: float


class StatusResponse(BaseModel):
    deployment_id: int
    trained: bool
    sample_count: int
    min_samples_required: int
    trained_at: str | None = None
    train_sample_count: int | None = None
    feature_version: str | None = None


class IngestRequest(BaseModel):
    deployment_id: int
    sample: MetricSample


class ScoresResponse(BaseModel):
    zscore_ewma: float | None
    iforest: float | None
    ocsvm: float | None
    ensemble: float | None


class FlagsResponse(BaseModel):
    zscore_ewma: bool
    iforest: bool
    ocsvm: bool
    ensemble: bool


class IngestResponse(BaseModel):
    ready: bool
    sample_count: int
    scores: ScoresResponse
    above_threshold: FlagsResponse
    detail: dict[str, Any] = {}


class TrainRequest(BaseModel):
    deployment_id: int
    samples: list[MetricSample]


class TrainResponse(BaseModel):
    deployment_id: int
    trained: bool
    train_sample_count: int
    feature_vector_count: int
    trained_at: str
    warnings: list[str] = []


class ResetRequest(BaseModel):
    deployment_id: int


class ResetResponse(BaseModel):
    deployment_id: int
    deleted: bool


class ReplayFeatureConfig(BaseModel):
    use_slope: bool = True
    use_mean: bool = True
    use_std: bool = True
    window: int = config.WINDOW
    metrics: list[str] | None = None


class ReplayRequest(BaseModel):
    samples: list[MetricSample]
    train_count: int
    feature_config: ReplayFeatureConfig | None = None
    methods: list[str] | None = None


class ReplayResultItem(BaseModel):
    index: int
    ts: str
    scores: dict[str, float | None]


class ReplayResponse(BaseModel):
    feature_dim: int
    results: list[ReplayResultItem]


# ---------- Runtime trong bộ nhớ + state trên đĩa ----------


class DeploymentRuntime:
    def __init__(self, deployment_id: int) -> None:
        self.deployment_id = deployment_id
        self.samples: list[MetricSample] = []
        self.trained = False
        self.meta: dict[str, Any] = {}
        self.models: dict[str, Detector] = {}
        self.feature_config: FeatureConfig | None = None
        self.last_seq: int | None = None

    def persist(self) -> None:
        payload: dict[str, Any] = {
            "samples": [s.model_dump() for s in self.samples],
            "models": self.models,
            "feature_config": self.feature_config,
            "last_seq": self.last_seq,
        }
        save_state(self.deployment_id, payload, self.meta)


def get_runtime(deployment_id: int) -> DeploymentRuntime:
    runtime = RUNTIMES.get(deployment_id)
    if runtime is not None:
        return runtime
    runtime = DeploymentRuntime(deployment_id)
    loaded = load_state(deployment_id)
    if loaded is not None:
        payload, meta = loaded
        runtime.samples = [MetricSample.model_validate(d) for d in payload.get("samples", [])]
        runtime.models = payload.get("models", {})
        fc = payload.get("feature_config")
        if isinstance(fc, FeatureConfig):
            runtime.feature_config = fc
        elif isinstance(fc, dict):
            runtime.feature_config = FeatureConfig(
                **{k: (tuple(v) if k == "metrics" else v) for k, v in fc.items()}
            )
        runtime.last_seq = payload.get("last_seq")
        runtime.trained = bool(runtime.models) and runtime.feature_config is not None
        runtime.meta = meta
    RUNTIMES[deployment_id] = runtime
    return runtime


def _empty_ingest(sample_count: int) -> IngestResponse:
    return IngestResponse(
        ready=False,
        sample_count=sample_count,
        scores=ScoresResponse(zscore_ewma=None, iforest=None, ocsvm=None, ensemble=None),
        above_threshold=FlagsResponse(
            zscore_ewma=False, iforest=False, ocsvm=False, ensemble=False
        ),
    )


# ---------- 6 endpoint ----------


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=SERVICE_VERSION,
        uptime_s=round(monotonic() - STARTED_AT, 3),
    )


@app.get("/status", response_model=StatusResponse)
def status(deployment_id: int) -> StatusResponse:
    runtime = get_runtime(deployment_id)
    return StatusResponse(
        deployment_id=deployment_id,
        trained=runtime.trained,
        sample_count=len(runtime.samples),
        min_samples_required=config.MIN_TRAIN,
        trained_at=runtime.meta.get("trained_at"),
        train_sample_count=runtime.meta.get("train_sample_count"),
        feature_version=config.FEATURE_VERSION if runtime.trained else None,
    )


@app.post("/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest) -> IngestResponse:
    runtime = get_runtime(request.deployment_id)
    sample = request.sample
    if sample.seq is not None:
        if runtime.last_seq is not None and sample.seq <= runtime.last_seq:
            _logger.warning("ingest mat thu tu seq=%s (truoc do %s)", sample.seq, runtime.last_seq)
        runtime.last_seq = sample.seq
    runtime.samples.append(sample)
    count = len(runtime.samples)

    if not runtime.trained or runtime.feature_config is None:
        runtime.persist()
        return _empty_ingest(count)

    window = [s.model_dump() for s in runtime.samples[-runtime.feature_config.window :]]
    vector = build_vector(window, runtime.feature_config)
    if vector is None:
        runtime.persist()
        return _empty_ingest(count)

    matrix = vector.reshape(1, -1)
    scores = {name: float(model.score(matrix)[0]) for name, model in runtime.models.items()}
    flags = {name: scores[name] > config.THRESHOLD for name in CHILD_METHODS}
    child_scores = {n: np.asarray([scores[n]]) for n in CHILD_METHODS}
    child_flags = {n: np.asarray([flags[n]]) for n in CHILD_METHODS}
    scores["ensemble"] = float(ensemble_score(child_scores)[0])
    flags["ensemble"] = bool(ensemble_above_threshold(child_flags, config.THRESHOLD)[0])
    detail: dict[str, Any] = {}
    zscore = runtime.models.get("zscore_ewma")
    if isinstance(zscore, ZScoreEwma) and runtime.feature_config is not None:
        detail = score_detail(vector, zscore.z_per_dimension(matrix)[0], runtime.feature_config)

    if isinstance(zscore, ZScoreEwma):
        zscore.update(matrix)

    runtime.persist()
    return IngestResponse(
        ready=True,
        sample_count=count,
        scores=ScoresResponse(**{n: scores[n] for n in ALL_METHODS}),
        above_threshold=FlagsResponse(**{n: flags[n] for n in ALL_METHODS}),
        detail=detail,
    )


@app.post("/train", response_model=TrainResponse)
def train(request: TrainRequest) -> TrainResponse:
    samples = request.samples
    if len(samples) < config.MIN_TRAIN:
        raise HTTPException(
            status_code=400,
            detail=f"Không đủ mẫu: cần ít nhất {config.MIN_TRAIN}, mới có {len(samples)}",
        )
    metrics = tuple(config.METRICS)
    dumped = [s.model_dump() for s in samples]
    dropped = detect_dropped_metrics(dumped, metrics)
    kept_metrics = tuple(m for m in metrics if m not in dropped)
    feature_config = FeatureConfig(metrics=kept_metrics)
    matrix = build_matrix(dumped, feature_config)
    if matrix.shape[0] == 0:
        raise HTTPException(status_code=400, detail="Không đủ mẫu để dựng được một cửa sổ")

    zscore = ZScoreEwma().fit(matrix)
    iforest = IsolationForestDetector().fit(matrix)
    ocsvm = OneClassSvmDetector().fit(matrix)

    runtime = get_runtime(request.deployment_id)
    runtime.models = {"zscore_ewma": zscore, "iforest": iforest, "ocsvm": ocsvm}
    runtime.feature_config = feature_config
    if len(runtime.samples) < len(samples):
        runtime.samples = samples
    runtime.trained = True
    runtime.meta = {
        "trained_at": _utc_now_iso(),
        "train_sample_count": len(samples),
        "feature_version": config.FEATURE_VERSION,
        "feature_dim": matrix.shape[1],
        "dropped_metrics": dropped,
    }
    runtime.persist()

    warnings = [f"{m} toàn null - metric này bị bỏ khỏi vector" for m in dropped]
    _logger.info(
        "train xong deployment %s: %s vector %s chieu",
        runtime.deployment_id,
        matrix.shape[0],
        matrix.shape[1],
    )
    return TrainResponse(
        deployment_id=runtime.deployment_id,
        trained=True,
        train_sample_count=len(samples),
        feature_vector_count=matrix.shape[0],
        trained_at=runtime.meta["trained_at"],
        warnings=warnings,
    )


@app.post("/reset", response_model=ResetResponse)
def reset(request: ResetRequest) -> ResetResponse:
    runtime = RUNTIMES.pop(request.deployment_id, None)
    deleted = delete_state(request.deployment_id) or runtime is not None
    return ResetResponse(deployment_id=request.deployment_id, deleted=deleted)


@app.post("/replay", response_model=ReplayResponse)
def replay(request: ReplayRequest) -> ReplayResponse:
    samples = request.samples
    if len(samples) < 170:
        raise HTTPException(status_code=422, detail="Replay cần ít nhất 170 mẫu")
    if not 0 < request.train_count < len(samples):
        raise HTTPException(status_code=422, detail="train_count phải nằm trong khoảng mẫu")

    fc = request.feature_config or ReplayFeatureConfig()
    metrics = tuple(fc.metrics) if fc.metrics else tuple(config.METRICS)
    train_slice = samples[: request.train_count]
    dropped = detect_dropped_metrics([s.model_dump() for s in train_slice], metrics)
    kept_metrics = tuple(m for m in metrics if m not in dropped)
    feature_config = FeatureConfig(
        use_slope=fc.use_slope,
        use_mean=fc.use_mean,
        use_std=fc.use_std,
        window=fc.window,
        metrics=kept_metrics,
    )

    train_matrix = build_matrix([s.model_dump() for s in train_slice], feature_config)
    if train_matrix.shape[0] == 0:
        raise HTTPException(status_code=422, detail="train_count khong du cho mot cua so")

    models = {
        "zscore_ewma": ZScoreEwma().fit(train_matrix),
        "iforest": IsolationForestDetector().fit(train_matrix),
        "ocsvm": OneClassSvmDetector().fit(train_matrix),
    }
    methods = request.methods or list(ALL_METHODS)
    unknown = [m for m in methods if m not in ALL_METHODS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"method không hợp lệ: {unknown}")
    need_ensemble = "ensemble" in methods
    emit = methods

    dumped = [s.model_dump() for s in samples]
    results: list[ReplayResultItem] = []
    for index, sample in enumerate(samples):
        window = dumped[max(0, index - feature_config.window + 1) : index + 1]
        vector = build_vector(window, feature_config)
        if vector is None:
            results.append(
                ReplayResultItem(index=index, ts=sample.ts, scores={m: None for m in emit})
            )
            continue
        matrix = vector.reshape(1, -1)
        scores = {name: float(model.score(matrix)[0]) for name, model in models.items()}
        zscore_model = models.get("zscore_ewma")
        if isinstance(zscore_model, ZScoreEwma) and index >= request.train_count:
            zscore_model.update(matrix)
        if need_ensemble:
            scores["ensemble"] = float(
                ensemble_score({n: np.asarray([scores[n]]) for n in CHILD_METHODS})[0]
            )
        results.append(
            ReplayResultItem(
                index=index,
                ts=sample.ts,
                scores={m: scores.get(m) for m in emit},
            )
        )
    return ReplayResponse(feature_dim=feature_config.feature_dim, results=results)


@app.middleware("http")
async def _log_requests(request, call_next):  # noqa: ANN001, ANN202
    started = monotonic()
    response = await call_next(request)
    _logger.info(
        "%s %s -> %s (%.3fs)",
        request.method,
        request.url.path,
        response.status_code,
        monotonic() - started,
    )
    return response
