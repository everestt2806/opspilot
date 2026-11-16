# Exact-instance PostgreSQL inspection metadata lab

Node22: `node app/scripts/product-postgres-inspection-lab/run.mjs --confirm-local-postgres-inspection`.

Uses real private Desktop38/controller37 SQLite databases and cipher/services with synthetic controller transport. Reviews the selected PostgreSQL UUID, refuses wrong instance/source/target/owner/controller and extra SQL/name fallback, verifies no metadata write/job/credential output. Context is configuration_verified/runtime_not_checked; no target query or container is contacted. This is not a database runtime inspector or VPS acceptance.

Runs independently before IPC/UI. Evidence: `app/.out-scripts/product-postgres-inspection-lab/<nonce>/proof.json`. Scratch cleanup verifies resolved temporary parent, symlink state and exact nonce marker before removing only its own directory. No production profile, SSH, Docker or VPS is used.

# Target and controller CLI acceptance

Private Linux labs only. Require root, Python3, Linux Docker, OpenSSH server/client,
Node22 and the already approved Linux controller modules. Never pass a serving VPS
profile or production database directory. All generated database credentials stay
in memory/stdin; reports contain only identities and check results.

First build a private controller bundle as described in
`../product-postgres-lab/README.md`. Do not overwrite an approved serving release.

```sh
# Fixed-operation/lock/permissions tests, without Docker or SSH:
PYTHONDONTWRITEBYTECODE=1 python3 app/scripts/product-runtime-lab/test_target_postgres_inspection.py

# Two same-name PostgreSQL databases, independently pinned actual OpenSSH:
PYTHONDONTWRITEBYTECODE=1 python3 app/scripts/product-postgres-inspection-lab/native.py --confirm-private-postgres-inspection

# Full production CLI -> encrypted controller SQLite -> pinned SSH -> PostgreSQL:
# Set NODE_PATH, OPSPILOT_CONTROL_PLANE_MODULES and OPSPILOT_CONTROL_PLANE_OUTPUT
# to the approved Linux modules and newly built private bundle first.
OPSPILOT_POSTGRES_INSPECTION_GATE=1 node app/scripts/product-postgres-lab/selection.mjs --confirm-local-postgres-selection
```

`bridge.mjs` and `bridge_fixture.py` are internal to that explicit selection lab.
Only the fixture provisions databases and seed rows; the production inspector
performs finite read operations. The fixture never fabricates a deployment claim.
Both native labs verify unchanged CID/volume/system identifier/journal/rows and
remove only resources with the exact fixture ownership. Docker engine metadata
labels are tolerated; mismatched OpsPilot ownership refuses cleanup.

Proofs are written beneath `app/.out-scripts/product-postgres-inspection-native/`
and `app/.out-scripts/product-postgres-selection/`. These prove a private target
reader and controller CLI, not installed admin/Main IPC, UI, or a serving rollout.
Temporary SSH fixtures use `StrictModes no` for generated keys under private temp
paths, matching the existing selection lab. Product host-key pins and target
file/key/journal permission checks remain enforced.
