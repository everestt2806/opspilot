# ML-READY-1 — local historical-data smoke

This is a reproducible local training/inference smoke using the existing
`ml-service.main.replay` pipeline. It does not start the ML service, call SSH,
alter the VPS, or persist a model.

## Data provenance and integrity

The inputs are the operational sample exports documented by
[`kich-ban-11h.md`](../../demo-11-10/kich-ban-11h.md): a read-only export of
`metric_sample` from the G2 SQLite profile, deployment 7 (Express v5), and the
matching collector `raw_json` rows. The original files remain unchanged:

- `docs/demo-11-10/ml-samples-v5-180.csv` — SHA-256
  `9d2af5f64e64c3371fb988b54fef0770460368ddf935b456a605a1abd7bc425a`
- `docs/demo-11-10/ml-collector-raw-v5-180.jsonl` — SHA-256
  `4d0a9e29bc395ce34508ef6be100f58e43fbc2ac65b01ca81991cf10a46956ab`

Both sources contain 180 ordered rows, seq 9118–9297, from
2026-10-10 07:42:34Z through 08:12:24Z at exact 10-second intervals. The five
input metrics are `cpu_pct`, `mem_mb`, `latency_ms`, `http_error_rate`, and
`db_response_ms`; all are present and non-null in both files, and timestamp,
sequence, metrics, and `container_up` agree row-for-row. All raw
`http_error_rate_source` values are `probe`.

## Run and results

Run from the repository root with the existing Python virtualenv:

```powershell
ml-service/.venv/Scripts/python.exe docs/evidence/tk-s7-ml-ready-1/run_smoke.py
```

The pipeline fits on exactly the first 150 samples (seq 9118–9267), producing
131 rolling feature windows with the existing 20-sample feature window. It
then scores the remaining 30 samples (seq 9268–9297) in chronological order.
The holdout is not used for feature selection, model fitting, scaling, or
score-percentile normalization. The existing replay entrypoint runs in a
separate Python process with `STATE_DIRECTORY` redirected to a temporary empty
directory; no state is persisted, and the pre-existing `ml-service/state/`
files are hash-checked as unchanged.

Review files:

- [`training-metadata.json`](training-metadata.json) records source hashes,
  split, feature/model versions, and isolation checks.
- [`inference-scores.csv`](inference-scores.csv) contains one row per holdout
  sample and scores from `zscore_ewma`, `iforest`, `ocsvm`, and `ensemble`.
- [`validation-results.json`](validation-results.json) records the data and
  isolation assertions.
- [`run_smoke.py`](run_smoke.py) is the small reproducible harness; it does not
  copy either source dataset into this evidence directory.

## Interpretation limits

This is **historical normal-data training smoke**, not a 75-minute pilot. The
inputs contain no fault labels; this run creates no synthetic labels and
reports no accuracy, precision, recall, or demonstrated fault-detection
quality. Scores show only that the existing training and inference path runs
on these historical normal samples. The existing model state and active app
models were not reset, replaced, or trained by this run.
