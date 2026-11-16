# Desktop PostgreSQL controller rollout

Private operator harness for the independently pinned Desktop PostgreSQL candidate.
This is a controller-only upgrade; it does not deploy an application or manufacture
a PostgreSQL/ENV selection receipt. The seven existing apps, PostgreSQL container,
volume, system identifier, 1,000 sample rows, encrypted resource material and original
Root-sealed schema35 backup must remain unchanged.

Node22: `node app/scripts/product-postgres-desktop-live/launch.mjs --start`.
Only provide credentials after `PRIVATE_INPUT_READY_NO_ECHO`. Input stays in RAM
or the nonce-owned encrypted private profile, never argv/environment/plaintext files.
Resume an interrupted record with `--resume <nonce>`; a PASS record cannot resume.
Transfer/recovery use the original durable upgrade UUID and the same explicit
`--transfer-controller` / `--recover-controller` flags as the earlier controller lab.

Before any SSH effect the harness requires the complete candidate proof, compiled
ten-release catalog and actual resource verification. Before an upgrade it requires
the independently pinned host, current cc8/aaf2 controller, exact seven-app baseline,
zero active jobs/leases/experiments/clients and paused policies. On failure retain
the private profile and original UUID for inspection; do not invent a replacement.

This harness is not evidence until it actually runs. Runtime provisioning and real
Main PostgreSQL first-deploy acceptance remain separate from this controller step.
