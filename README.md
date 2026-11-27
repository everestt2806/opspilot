# OpsPilot

**OpsPilot** is a cross-platform desktop application for deploying, migrating, and monitoring web applications on Linux VPS instances over SSH, integrated with an unsupervised Machine Learning anomaly detection engine to detect degraded operational states and trigger automatic rollback before complete service failure.

> **Information Technology Project (504070)** — Faculty of Information Technology, Ton Duc Thang University  
> **Authors:** Nguyen Van Son (`521H0148`) · Vo Thi Thien Kim (`521H0092`)  
> **Advisor:** M.Sc. Doan Xuan Thanh

---

## Key Capabilities

- **SSH-First VPS Management:** Connect to Ubuntu/Linux VPS nodes with TOFU host-key verification, OS-backed encrypted credential storage (Electron `safeStorage`), environment diagnostics, and remote Docker/Nginx readiness checks. No permanent agent is required on target VPS nodes in Desktop mode.
- **Multi-Framework Container Deployment:** Automated framework detection and template generation (`Dockerfile` + `docker-compose.yml`) supporting **Express.js + PostgreSQL**, **Next.js**, and **Vite SPA** from either local folders or Git repositories, with zero-downtime health checks and automatic rollback on failure.
- **Cross-VPS Migration:** End-to-end application and PostgreSQL database migration (`pg_dump` / `pg_restore` + schema/row-count verification + source backup/restore protection) across independent VPS nodes.
- **Runtime Telemetry & Multi-Method Anomaly Detection:** Lightweight sidecar collector capturing 11 operational metrics every 10 seconds, evaluated in real time by a local Python ML service running four parallel detection methods:
  - Rule-based thresholds
  - Statistical Z-score / EWMA
  - Isolation Forest (`scikit-learn`)
  - One-Class SVM (`scikit-learn`)
  - Weighted Ensemble decision engine with hysteresis and automated rollback trigger
- **Automated Verification & Evaluation Suite:** Reproducible fault-injection harness (`memory_leak`, `cpu_saturation`, `latency_creep`, `error_rate_spike`, `slow_db`) validated across 50 formal experimental runs (10 repetitions × 5 scenarios).

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                          OpsPilot Desktop App                           │
│                                                                         │
│  ┌──────────────────────┐       Typed IPC       ┌────────────────────┐  │
│  │  Renderer (React 19, │ ◄───────────────────► │  Main Process      │  │
│  │  Ant Design, Zustand,│                       │  (Node 22, SSH2,   │  │
│  │  Recharts, xterm.js) │                       │   SQLite + Vault)  │  │
│  └──────────────────────┘                       └───────┬──────┬─────┘  │
│                                                         │      │        │
│                                            REST 127.0.0.1      │ SSH    │
│                                                         ▼      │        │
│                                            ┌────────────────┐  │        │
│                                            │  ML Service    │  │        │
│                                            │  (FastAPI +    │  │        │
│                                            │  scikit-learn) │  │        │
│                                            └────────────────┘  │        │
└────────────────────────────────────────────────────────────────┼────────┘
                                                                 │
                                                                 ▼
                                            ┌─────────────────────────────┐
                                            │   Target VPS (Ubuntu 24.04) │
                                            │   Docker · App · PostgreSQL │
                                            │   Metrics Collector Sidecar │
                                            └─────────────────────────────┘
```

---

## Formal Evaluation Summary (50-Run Benchmark)

Evaluated on live Ubuntu 24.04 VPS nodes under controlled load (`5 req/s`) across 5 fault scenarios (10 runs per scenario, 60-second grace window):

| Detector | Precision | Recall | F1-Score | Median Detection Delay |
|---|---:|---:|---:|---:|
| Rule-Based | 0.900 | 0.900 | 0.900 | 185.0 s |
| Z-Score / EWMA | 0.783 | 0.940 | 0.855 | 25.0 s |
| Isolation Forest | 0.904 | 0.940 | 0.922 | 35.0 s |
| One-Class SVM | 0.904 | 0.940 | 0.922 | 25.0 s |
| **Ensemble** | **0.941** | **0.960** | **0.950** | **25.0 s** |

Raw CSV outputs and reproducible analysis scripts are located in [`experiments/results/formal-50/`](experiments/results/formal-50/).

---

## Repository Structure

```text
app/            Electron desktop application (main: SSH, deploy, migrate, monitor, SQLite; renderer: React UI)
ml-service/     Local FastAPI + scikit-learn anomaly detection service (loopback 127.0.0.1:8765)
collector/      Lightweight Python metrics collector container writing metrics.jsonl on VPS
templates/      Docker and docker-compose templates per detected web framework
experiments/    Fault injectors, load generator, 50-run experiment runner, and statistical analysis scripts
demo-apps/      Sample applications (Express + PostgreSQL, Vite SPA, Next.js) for integration testing
docs/           Technical contracts (SQLite schema, OpenAPI, IPC types), architecture decisions, and protocols
tools/          Local developer environment helper scripts
```

---

## Environment Requirements

| Component | Version | Notes |
|---|---|---|
| Node.js | 22 LTS | See `.nvmrc`; on Windows with multiple Node versions, run `. .\tools\enter-node22.ps1` |
| pnpm | 11+ | Configured via `packageManager` (`corepack enable`) |
| Python | 3.12 | Required for local `ml-service/` and `experiments/` development (bundled automatically in the Windows `.exe` installer) |
| Docker | Latest | Required on target VPS instances (Ubuntu 24.04 LTS recommended) |

---

## Getting Started

### 1. Install Dependencies

```bash
# Node.js / Electron workspace
pnpm install --frozen-lockfile

# Python ML service virtual environment
cd ml-service
python -m venv .venv
# Windows: .venv\Scripts\activate  |  Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Common Commands

On Windows with multiple Node installations, select Node 22 first:

```powershell
. .\tools\enter-node22.ps1
```

Then run from the repository root:

```bash
pnpm dev          # Start Electron app in development mode (spawns local ML service)
pnpm typecheck    # Type-check Electron main, preload, and renderer TypeScript
pnpm lint         # Run ESLint (app) and Ruff (ml-service)
pnpm test         # Run Vitest unit/integration suite and Pytest ML test suite
pnpm build        # Compile Electron main, preload, and renderer bundles
pnpm build:win    # Build portable Windows NSIS installer via electron-builder
```

### 3. Python Test Suites (Collector & Experiments)

```bash
python -m pytest ml-service/tests collector/tests experiments/tests -q
python -m ruff check ml-service collector experiments
```

---

## Technical Documentation

- **Documentation Index:** [`docs/README.md`](docs/README.md)
- **Technical Contracts (SQLite schema, IPC, OpenAPI, metric format):** [`docs/contracts/`](docs/contracts/)
- **Architecture Decision Records (ADRs):** [`docs/14-quyet-dinh-kien-truc.md`](docs/14-quyet-dinh-kien-truc.md)
- **Experimental Evaluation Protocol:** [`docs/07-giao-thuc-thi-nghiem.md`](docs/07-giao-thuc-thi-nghiem.md)
- **Development Environment Guide:** [`docs/09-moi-truong-dev.md`](docs/09-moi-truong-dev.md)
- **Target VPS Setup Runbook:** [`docs/08-vps-setup.md`](docs/08-vps-setup.md)
