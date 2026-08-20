from pathlib import Path

SERVICE_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
STATE_DIRECTORY = Path(__file__).resolve().parent / "state"

WINDOW = 20
METRICS: list[str] = [
    "cpu_pct",
    "mem_mb",
    "latency_ms",
    "http_error_rate",
    "db_response_ms",
]
FEATURES_PER_METRIC = 4
MIN_TRAIN = 150
RANDOM_STATE = 42
FEATURE_VERSION = "v1-5metrics-4feats-w20"
EWMA_ALPHA = 0.3
THRESHOLD = 0.7
NORM_LOW_PERCENTILE = 1.0
NORM_HIGH_PERCENTILE = 99.0
COLLECT_INTERVAL_S = 10
