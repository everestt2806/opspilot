# Technical Contracts (`docs/contracts/`)

> **Single source of truth** for database schemas, REST endpoints, IPC channels, telemetry formats, and runtime interfaces across OpsPilot modules.

## Purpose

Keeping interface definitions centralized ensures consistency between the Electron main process, React renderer, Python ML service, VPS collector sidecar, and experimental analysis pipeline.

## Core Contracts

| File | Scope |
|---|---|
| [`schema.sql`](schema.sql) | Core SQLite schema, indexes, and column specifications |
| [`ml-api.openapi.yaml`](ml-api.openapi.yaml) | Local FastAPI ML service REST specification (6 endpoints) |
| [`ipc-contract.ts`](ipc-contract.ts) | Typed Electron main ↔ renderer IPC channels, payloads, and events |
| [`detector-contract.ts`](detector-contract.ts) | Framework detector (`Detector`, `SourceTree`, `BuildPlan`) interfaces |
| [`metric-format.md`](metric-format.md) | Collector output format (`metrics.jsonl`, `latest.json`) and VPS paths |
| [`deploy-events.md`](deploy-events.md) | Deploy and cross-VPS migration pipeline event stream specification |
| `product-*.ts` / `desktop-*.ts` | Control plane, bootstrap, exposure, PostgreSQL, and environment contracts |

## Maintenance Rules

1. Update the contract file before changing producer/consumer implementations.
2. Database schema evolutions must use new additive migrations (`0XX_*.sql`); never alter historical migrations already applied to existing databases.
3. Preserve column compatibility for `metric_sample`, `score_sample`, `alert`, and `experiment_run` so historical benchmark datasets remain reproducible.
