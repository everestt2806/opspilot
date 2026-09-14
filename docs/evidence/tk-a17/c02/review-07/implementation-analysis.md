# C02 review 07 — reconciliation lineage and mixed-tail analysis

## Reviewed payload

- Review base `24c669b`; code `61f43df`; submitted HEAD `413ec20`; ancestry and diff-check pass.
- Reviewer independently confirmed focused 96/96, ML-service 19/19, collector 26/26,
  node/web/scripts typecheck, scoped lint/format and build.
- GitNexus analyze passed. The submission changes 20 symbols and affects 38 processes at CRITICAL
  risk across deploy and monitor flows.

## Reconciliation lineage

The new reconciliation hook runs under the shared app lock and keeps unknown ownership prepared.
Its recursive SQL does not resolve the runtime image of the prepared rollback attempt. The CTE
anchors every deployment and then filters `WHERE id=d.id`; that returns the prepared row's own
`image_tag`, not the deepest ancestor reached through its `is_rollback_of` chain. The previous-owner
branch also reads raw `deployment.image_tag` instead of the resolved runtime image.

The committed test uses a normal deployment whose row tag equals its runtime image, so it cannot
detect this. The reviewer regression used active v2 plus a prepared v3 rollback row pointing to v1,
with Docker correctly reporting v1. Reconciliation left v3 prepared instead of activating it. A
manual rollback crash therefore remains blocked forever even when the live target owner is fully
verifiable. Resolution should reuse `DeploymentRepository.runtimeImageTag()` for both prepared and
active deployments, or use a root-preserving CTE with cycle/missing-lineage handling.

## Mixed invalid rotated tail

The parser now emits correct warning byte ranges, and the single-invalid-at-EOF test passes. The
outer poller replaces the old episode end with `firstWarning.start`. If valid records follow the
invalid line in the same matching `.1`, those valid rows are committed and routed to the old
deployment, but the persisted episode closes before their offsets. Multiple warning ranges are also
collapsed to the first range.

The reviewer regression inserted valid metric 2 after an invalid line and then metric 3 from the
new generation. All valid rows existed, but the old episode ended at byte 236 rather than committed
EOF 482. Keep the episode end at the committed drain `nextOffset`; record each skipped invalid byte
range separately from the generation boundary. Tests need invalid-at-start/middle/end, valid rows
after warnings and multiple warnings.

## Live evidence

The dedicated evidence now contains compact raw JSON proving resolved runtime v15 to v16 and Docker
state before/after. It also states that 421 metrics were ingested while deployment 21 gained five
metric rows, which is plausible when 416 rows were backlog before the rollback boundary. The
artifact still omits the activation boundary and per-deployment before/after counts needed to prove
that split, and mentions helper events without including them. Preserve the existing live state;
a read-only SQL/activation append is sufficient if those rows remain available.

Review 07 made no VPS or persisted SQLite mutation and did not run ML train/score. Temporary tests
were removed after execution; the three pre-existing untracked paths remain unchanged.
