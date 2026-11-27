# Documentation Index

Technical documentation and interface contracts for **OpsPilot**.

## Technical Contracts (Source of Truth)

| Path | Description |
|---|---|
| [`contracts/`](contracts/) | Interface definitions shared across Electron main/renderer, ML service, collector, and control plane (`schema.sql`, `ml-api.openapi.yaml`, `ipc-contract.ts`, `detector-contract.ts`, `metric-format.md`, `deploy-events.md`, and Product mode contracts). See [`contracts/README.md`](contracts/README.md). |

## Architecture & Engineering Guides

| File | Description |
|---|---|
| [`14-quyet-dinh-kien-truc.md`](14-quyet-dinh-kien-truc.md) | Architecture Decision Records (ADR-001 to ADR-011) covering SSH-only design, container isolation, SQLite storage, ML sidecar runtime, and Product mode control plane trade-offs. |
| [`09-moi-truong-dev.md`](09-moi-truong-dev.md) | Local development environment setup (Windows 11 / Node 22 / pnpm / Python 3.12), approved dependencies, and platform notes. |
| [`08-vps-setup.md`](08-vps-setup.md) | Target Ubuntu 24.04 LTS VPS preparation runbook (Docker, SSH hardening, firewall, non-root setup). |

## Experimental Evaluation

| File | Description |
|---|---|
| [`07-giao-thuc-thi-nghiem.md`](07-giao-thuc-thi-nghiem.md) | Formal evaluation protocol: 5 fault scenarios, load generation, clock synchronization, ground-truth labeling, and P/R/F1/delay metrics. |
