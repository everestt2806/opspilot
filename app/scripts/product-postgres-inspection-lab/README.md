# Exact-instance PostgreSQL inspection metadata lab

Node22: `node app/scripts/product-postgres-inspection-lab/run.mjs --confirm-local-postgres-inspection`.

Uses real private Desktop38/controller37 SQLite databases and cipher/services with synthetic controller transport. Reviews the selected PostgreSQL UUID, refuses wrong instance/source/target/owner/controller and extra SQL/name fallback, verifies no metadata write/job/credential output. Context is configuration_verified/runtime_not_checked; no target query or container is contacted. This is not a database runtime inspector or VPS acceptance.

Runs independently before IPC/UI. Evidence: `app/.out-scripts/product-postgres-inspection-lab/<nonce>/proof.json`. Scratch cleanup verifies resolved temporary parent, symlink state and exact nonce marker before removing only its own directory. No production profile, SSH, Docker or VPS is used.
