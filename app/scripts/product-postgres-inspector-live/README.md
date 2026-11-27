# PostgreSQL inspector protected rollout

Development-VPS acceptance only, with eight retained apps and two separately pinned
PostgreSQL instances. No application deployment, credential rotation, database
provisioning or manufactured Desktop project/source-selection receipt.

Run under Node22:

```powershell
node app/scripts/product-postgres-inspector-live/launch.mjs --start
```

Provide private JSON only after `PRIVATE_INPUT_READY_NO_ECHO`. The launcher passes
credentials in RAM/stdin to Electron; the private nonce-owned profile encrypts its
credential with DPAPI. Credentials never belong in argv, environment or reports.
Only a successful settled record removes that exact private profile. On failure
retain its journal and inspect/resume the original UUID with `--resume <nonce>`;
explicit recovery uses `--recover-controller`. Never start a replacement intent.

Before any serving effect, require the frozen candidate proof, independently pinned
eleventh compiled release and actual packaged-resource verification. Fresh SSH
attestation must match controller4bc/ce4d/schema37, eight paused apps,16 app/collector
CIDs, both PG CIDs/volumes/systemIDs/1,000 rows, protected source/env/key material,
and zero active jobs/leases/experiments/clients. Upgrade through the real Main
review/prepare/transfer/send/inspect/binding-refresh path, retaining original Root
schema35 backup and all ten prior release descriptors.

The finite inspection acceptance calls the actual Main enrollment transport,
installed Root administrator, same-UID controller CLI, pinned target SSH and both
real PG instances. Check inspect/tables/10- and100-row samples, cross-instance
rejection, limit101 rejection and missing relation. Persist identities, column
metadata and sample digests only; no returned sample rows or credentials.

**Scope boundary:** the earlier successful app-creation operator profiles were
removed. Reading current context from controller SQLite is a transport acceptance
input, not an own-current-selection receipt. This harness does not bypass or prove
the Desktop Service/UI project-receipt guard. That live acceptance needs a genuine
retained project profile or a separately designed reconnect/adoption flow. Existing
private Service/UI proofs remain synthetic-transport proofs, clearly labelled.

`read-only.mjs --confirm-readonly-inspector-baseline` performs only the exact old
serving baseline read. It is intentionally pinned to the pre-upgrade release and
will refuse the new serving revision after a successful rollout.
