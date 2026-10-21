# TK-S7 P3b-1 — contract dữ liệu auto deploy Product mode

| Owner | Date | Branch | Status | Base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3a design `15fae0457e91b757257d78e4c3c4ec4cab946fbf`, ADR-011 |

## Requirement ledger

| Requirement | Bằng chứng trong hồ sơ | State |
|---|---|---|
| Identity/state/transition và history cursor | `docs/contracts/product-auto-deploy.ts`, state machine dưới đây | PASS |
| Idempotency phân biệt poll, branch A→B→A, manual request, retry và config generation | Bảng tình huống và quy tắc enqueue; rà soát với P3a | PASS |
| Coalescing, retry/backoff, lease/fence, crash/uncertain, remote command đang chạy | Chính sách scheduler/recovery và pseudocode | PASS |
| Product ownership/cutover/import collision/enforcement giới hạn | Phần ownership và cutover; nêu rõ giới hạn binary cũ | PASS |
| DDL dự kiến, constraints/indexes/transactions; không tuyên bố migration đã áp dụng | SQL proposal parse trong SQLite in-memory với stub `app`/`deployment`; không migration | PASS |
| Enrollment/API tách riêng; Desktop/Git manual giữ nguyên | P3b-3 tách riêng; phạm vi unchanged được nêu | PASS |
| Type/cú pháp, đối chiếu tình huống, diff check, commit local | TypeScript strict check, DDL proposal syntax, scenario cross-check và `git diff --check` PASS; content commit `5248e204f4d8326270f692d8d24b6368139c7d33` | PASS |

## Phạm vi và nguồn

Đây là contract review-only. `docs/contracts/product-auto-deploy.ts` định nghĩa DTO/type và state names; file chưa được runtime import. DDL bên dưới là **đề xuất**, không phải migration, không sửa `schema.sql`, không tạo service/API/token và không thay đổi deploy.

Đối chiếu ADR-011, `docs/31-lo-trinh-hoan-thien-san-pham.md`, P3a, `docs/contracts/schema.sql`, `ipc-contract.ts`, `deploy-events.md`, Git snapshot, DeployService/Pipeline, DeploymentRepository và app lock. Deployment hiện tại tiếp tục là lịch sử triển khai chuẩn; bảng mới chỉ liên kết job/attempt với deployment đó.

## Identity và generation

- `controller_id`: UUID bền của một cài đặt control plane. Mọi ownership, history cursor, lease và API cache đều scope theo ID này; DB restore sang controller khác cần quy trình re-enrollment/identity review, không tự nhận owner.
- `app_id`: ID canonical của controller DB. Product ownership là tuple `(app_id, controller_id, ownership_generation)`. Desktop mode hiện hữu tiếp tục dùng SQLite/pipeline cục bộ; không cần row trong `product_app_control` cho tới khi app được enroll Product. Row `mode='desktop', controller_id=NULL` dùng để biểu diễn đường chuyển về Desktop sau một lần cutover. Product mode yêu cầu ID controller cụ thể.
- `ownership_generation`: tăng bằng CAS khi chuyển Desktop↔Product, chuyển controller hoặc enrollment/revoke. Mỗi job/attempt chụp generation lúc tạo; mismatch trước claim, trước mỗi pha mutate và finalize làm stale/conflict.
- `source_generation`: tăng khi đổi repository, production ref, root, build/deploy-relevant config hoặc policy. Lưu `config_sha256` canonical của snapshot cấu hình đã chọn. Không dùng job/retry/deployment thuộc generation cũ để kết luận generation mới đã deploy.
- `branch_observation`: một dòng durable cho lần đổi tip, có `observation_sequence` tăng trong `(app_id, source_generation, ref)`, full 40-hex SHA và timestamp. Poll lặp cùng tip chỉ cập nhật lần kiểm tra/liveness; không phát observation mới hoặc job mới.
- `job`: yêu cầu logic và idempotency boundary. `target_sha` là immutable provenance nhưng không unique toàn thời gian.
- `attempt`: một lần claim/execute của cùng job. Retry an toàn tạo attempt number mới; không tạo job thứ hai. Mỗi attempt có một `lease_id` và monotonic per-app fence.
- `deployment`: row hiện có, tạo bởi pipeline cho một lần pipeline/deploy history; attempt trỏ tới row nếu row đã được cấp. Claim/snapshot thất bại trước khi pipeline mở history có thể chưa có `deployment_id`.
- `history cursor`: `(controller_id, event_id)` theo thứ tự tăng đơn điệu. Cursor từ controller khác bị từ chối; cache desktop chỉ là projection có `controller_id` và freshness, không là writer.

## Job key và idempotency — thay quy tắc sai của P3a

Không đặt `UNIQUE(app_id, target_sha)`. Một SHA có thể được yêu cầu lại khi branch quay về commit đó, khi người dùng chủ động redeploy, hoặc khi deploy config generation đổi. SHA chỉ dùng để so sánh provenance/live state và nhận diện tip.

- **Poll:** chỉ tạo observation khi SHA khác tip gần nhất của cùng source generation/ref. Job poll có key ổn định `poll:<source_generation>:<observation_sequence>`; unique `(controller_id, app_id, idempotency_key)` chặn poll transaction bị gửi lại. Cùng SHA ở observation sequence mới có thể tạo job mới nếu nó khác SHA live đã xác minh.
- **A→B→A:** nếu B đã thành live trước lần quan sát A cuối, tạo job A mới dù có job A thành công trong lịch sử. Nếu live hiện đã là A và config generation khớp thì ghi observation, không chạy deploy vô ích.
- **Manual redeploy:** mỗi ý định mới phải có UUID idempotency key. Retry HTTP/SSH cùng yêu cầu dùng lại key; lần redeploy chủ động tiếp theo phải dùng key mới và được ghi `trigger='manual_redeploy'`, kể cả SHA giống nhau.
- **Retry:** giữ nguyên `job_id`/key/target SHA; tạo attempt number tiếp theo sau khi chứng minh attempt trước chưa ghi remote hoặc đã được đối chiếu. Build/health failure là failed/rolled_back terminal mặc định; retry cùng SHA sau đó là yêu cầu manual mới, không auto replay.
- **Config đổi:** tăng source generation và hash. Job queued đời cũ được supersede. Không kế thừa success của `(SHA, old_generation)` cho config mới. Attempt đang mutate phải hoàn tất hoặc uncertain trước khi generation mới có thể claim.

| Sự kiện | Kết quả mong đợi |
|---|---|
| Tip A poll đầu tiên, deploy thành công | 1 observation, 1 job, 1 attempt, thường 1 deployment |
| Poll A lặp 100 lần | Không có observation/job/attempt/deployment mới |
| A live → tip B, B deploy → branch quay về A | 2 observation/job cho B và A; 2 attempt/deployment mới; A được phép deploy lại |
| Tip A đã thành live; observation lại A | Observation cập nhật; không job/attempt/deployment |
| Cùng manual key gửi hai lần do response timeout | 1 job, không tạo attempt thứ hai chỉ do request replay |
| Hai manual redeploy cùng SHA với hai key mới | 2 job riêng; mỗi job một attempt/deployment nếu pipeline chạy |
| Attempt 1 fail an toàn trước remote write, retry được | 1 job, 2 attempts; deployment row chỉ khi pipeline/history đã bắt đầu ở từng attempt |
| Build/health fail, người dùng bấm redeploy mới | Job cũ terminal failed/rolled_back; key mới tạo job mới cùng SHA |
| Config generation 4→5 nhưng SHA không đổi | Job/observation generation 5 riêng nếu deploy cần thiết; không nhận success generation 4 |
| Đang deploy A; tip đổi B rồi C | A không bị kill; queued B superseded, C còn một job chờ; không build B nếu chưa claim |

## State machine và transition

```text
branch tip changed → observed(seq, sha) → queued → claimed(lease, fence)
                                                   ↓ exact snapshot SHA/config
                                                deploying(deployment_id?)
                                                   ├─ succeeded
                                                   ├─ failed (build/health or exhausted)
                                                   ├─ rolled_back (rollback verified)
                                                   └─ uncertain (remote/DB outcome unclear)
queued → superseded | cancelled
claimed/deploying → retry_wait → queued (only after safe no-write proof)
```

- `queued → claimed`: atomic transaction claims oldest eligible job only if app remains Product-owned by the same controller and ownership/source generations match. Claim creates lease UUID, fence `previous_fence+1`, expiry and attempt row.
- `claimed → deploying`: heartbeat/lease valid; detached source snapshot matches full SHA and source config hash; acquire remote app lock; verify mode marker/remote generation. Create/link deployment history before the first remote mutation.
- `queued → superseded`: only unclaimed job, replaced by newer desired tip or config generation. Preserve row and reason for audit.
- `claimed/deploying → retry_wait`: only a classified transient failure with positive evidence no remote mutation was dispatched/applied, remaining retry budget, same config/ownership generations. Each retry increments attempt number and fence.
- `deploying → succeeded`: candidate build and runtime health pass, pipeline commits deployment/current pointer, then job/attempt/outbox finalize using lease+fence CAS. External exposure degradation stays distinct from app health per existing deploy contract.
- `deploying → failed/rolled_back`: build/health failure retains verified previous live runtime; `rolled_back` only if prior runtime restoration was verified. Failure/rollback failure where actual remote state is unknown becomes `uncertain`.
- `claimed/deploying → uncertain`: controller crash/SSH timeout after write dispatch, lost remote lock, lease expiry with live child, DB commit uncertainty, or failed ownership/generation CAS after remote work. No automatic retry or second write until explicit read-only reconciliation proves outcome.
- `uncertain` is terminal for automatic worker transitions. Audited operator reconciliation may resolve it to succeeded, failed, or retry-eligible only with matching DB/remote SHA/runtime and ownership; uncertain is never reset to queued by polling.
- `succeeded`, `failed`, `rolled_back`, `superseded`, `cancelled` are terminal. A new manual intent is a new job. Do not rewrite terminal provenance.

Retry policy: maximum **3 attempts total** per job (initial + at most two retries), for safe transient pre-write failures only, with delays 30 seconds then 2 minutes and jitter. Exhaustion → `failed`. Build and health failure do not auto-retry. Git poll errors are separate: exponential delay 30 seconds, 1, 2, 5, then 15 minutes maximum with jitter; no new job until a valid tip is read. These are proposed contract defaults and should be config-bounded, not caller-controlled.

Push coalescing: a job still queued/unclaimed may be superseded by latest tip. Never cancel a claimed job midway through mutation. While it runs, retain only latest desired tip; after terminal success/failure, compare latest tip with verified live SHA and enqueue at most one needed job. Force-push compares full SHA, not ancestry. Deleted/unavailable branch creates no deploy job and leaves live app unchanged.

## Lease, fencing and recovery boundary

DB CAS alone is insufficient: a command already running on a target VPS can still mutate after its worker loses DB lease. Required enforcement at each boundary:

1. Claim/heartbeat and every controller DB write checks `(controller_id, ownership_generation, source_generation, lease_id, fence, expected state)` in one transaction. Fencing counter never decrements or resets when lease row is released.
2. Before every remote write phase, controller rechecks DB lease/generation, then obtains the shared per-app remote lock. Under that lock, the fixed remote wrapper checks controller/app ownership marker and rejects a fence lower than the last accepted fence; no caller-supplied shell/path/command is permitted.
3. Hold remote lock through the entire mutating command and verify it is still owned before each subsequent phase. After lease loss, worker stops dispatching new commands and cannot finalize. DB CAS fences stale result writes.
4. A remote command already in flight is **not safely cancelled by a DB lease expiration**. Do not let a new worker steal the remote lock or start writes merely because TTL elapsed. Wait for proof old process/SSH command exited and inspect runtime read-only. If process liveness/outcome cannot be established, mark uncertain and require operator; never claim that the fence can retroactively stop an already-running Docker/Compose command.

Crash recovery reads the attempt, controller process/lease, remote lock owner/fence, deployment image/current pointer and health before action. Proven not dispatched → eligible retry within budget. Proven deployed and healthy but DB finalization missing → reconcile the existing attempt/deployment, do not redeploy. Proven old runtime intact and no mutation → retry eligibility. Any mixed/ambiguous result → uncertain. Deployment DB failure after remote success must not emit success until recovered and reconciled.

Manual deploy/redeploy/rollback in Product mode goes through the same queue/lease. Existing Desktop direct pipeline remains for Desktop-owned apps. Legacy direct writer conflict is not solved by “last write wins”; reject when remote Product marker/lock is detected, but recognize that a legacy client can ignore a cooperative marker.

## Ownership, import, cutover and enforcement limits

- Product ownership is explicit `(controller_id, app_id, ownership_generation)`. Controller must validate archived VPS, app/VPS identity and target SSH pin before accepting a job. Desktop app-local SQLite is read/cache only for Product-owned rows; no second deployment history writer or fallback direct deploy on controller disconnect.
- Import preserves source IDs/provenance only when collision-free and verified. Stage import in isolated tables/transaction; map IDs deterministically through an import map. If app ID collides with a different VPS/source identity, deployment IDs collide with different SHA/image lineage, or current runtime cannot be reconciled, abort the full app import. Do not merge, renumber silently, or overwrite history. Record source DB ID, source app/deployment IDs, source controller ID, imported-at and verified checksums. Re-running same import key is idempotent; new/divergent snapshot is a new reviewed import.
- Cutover: stop desktop accepts for selected app; drain/reconcile running writes; hold maintenance ownership lock; export WAL-consistent snapshot; import and compare app/config/history/full SHA/current runtime image; verify SSH identity; atomically CAS mode owner and increment ownership generation; only then enable poller. If any step is uncertain, leave old mode locked/read-only and do not fail open.
- **SQLite ownership flag alone cannot stop old binaries.** Safe live cutover requires deploying all supported clients with a mode-aware gate and ensuring desktop cannot still use independent write authority. Stronger enforcement requires a distinct controller SSH principal/key and target-side restricted command wrapper/permissions for deployment mutations; revoke or remove old desktop write key where feasible. `docker` group/sudo access is effectively root, so an old credential retaining it can bypass a cooperative marker. If credential separation/target guard is unavailable, Product cutover is blocked; report this residual risk rather than claiming DB CAS is enforcement.
- Rollback to Desktop follows reverse maintenance: stop poll/enqueue, drain, resolve uncertain, export latest controller state, import/verify IDs/provenance/current runtime, lock both writers, CAS ownership generation to Desktop, then restore direct writes. Retain controller DB read-only backup. No switch while history/runtime diverges.

## Review DDL proposal — not applied

Names and columns below are illustrative contract. Existing `app` and `deployment` remain canonical; P3b persistence checkpoint must reconcile exact names with migration conventions. This block must **not** be read as applied schema.

```sql
CREATE TABLE product_controller (
  controller_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','maintenance','revoked'))
);

CREATE TABLE product_source_config (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  repository_url TEXT NOT NULL,
  production_ref TEXT NOT NULL,
  repository_root TEXT NOT NULL,
  deploy_config_json TEXT NOT NULL, -- allowlisted non-secret build/deploy settings only
  config_sha256 TEXT NOT NULL CHECK (length(config_sha256) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, source_generation),
  UNIQUE (app_id, source_generation, config_sha256)
);

CREATE TABLE product_app_control (
  app_id INTEGER PRIMARY KEY REFERENCES app(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('desktop','product')),
  controller_id TEXT REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation >= 1),
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  source_config_sha256 TEXT NOT NULL CHECK (length(source_config_sha256) = 64),
  changed_at TEXT NOT NULL,
  CHECK ((mode = 'desktop' AND controller_id IS NULL) OR
         (mode = 'product' AND controller_id IS NOT NULL)),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT,
  FOREIGN KEY (app_id, source_generation, source_config_sha256)
    REFERENCES product_source_config(app_id, source_generation, config_sha256) ON DELETE RESTRICT
);

CREATE TABLE product_branch_observation (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  ref TEXT NOT NULL,
  observation_sequence INTEGER NOT NULL CHECK (observation_sequence >= 1),
  observed_sha TEXT NOT NULL CHECK (length(observed_sha) = 40 AND observed_sha NOT GLOB '*[^0-9a-f]*'),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (app_id, source_generation, ref, observation_sequence),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT
);
CREATE INDEX idx_product_observation_tip
  ON product_branch_observation(app_id, source_generation, ref, observation_sequence DESC);

CREATE TABLE product_deploy_job (
  job_id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation >= 1),
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  source_config_sha256 TEXT NOT NULL CHECK (length(source_config_sha256) = 64),
  trigger TEXT NOT NULL CHECK (trigger IN ('branch_poll','manual_redeploy','manual_rollback')),
  idempotency_key TEXT NOT NULL,
  ref TEXT NOT NULL,
  target_sha TEXT CHECK (target_sha IS NULL OR
    (length(target_sha) = 40 AND target_sha NOT GLOB '*[^0-9a-f]*')),
  target_deployment_id INTEGER REFERENCES deployment(id) ON DELETE RESTRICT,
  observation_sequence INTEGER,
  state TEXT NOT NULL CHECK (state IN ('queued','claimed','deploying','retry_wait',
    'succeeded','failed','rolled_back','uncertain','superseded','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  supersedes_job_id TEXT REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  safe_error_code TEXT,
  CHECK (attempt_count <= max_attempts),
  CHECK (length(idempotency_key) > 0),
  UNIQUE (controller_id, app_id, idempotency_key),
  CHECK ((trigger = 'branch_poll' AND observation_sequence IS NOT NULL) OR
         (trigger <> 'branch_poll' AND observation_sequence IS NULL)),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT,
  FOREIGN KEY (app_id, source_generation, source_config_sha256)
    REFERENCES product_source_config(app_id, source_generation, config_sha256) ON DELETE RESTRICT,
  CHECK ((trigger IN ('branch_poll','manual_redeploy') AND target_sha IS NOT NULL AND
          target_deployment_id IS NULL) OR
         (trigger = 'manual_rollback' AND target_deployment_id IS NOT NULL))
);
CREATE INDEX idx_product_job_claim
  ON product_deploy_job(state, available_at, created_at);
CREATE INDEX idx_product_job_app_history
  ON product_deploy_job(controller_id, app_id, created_at DESC);
CREATE INDEX idx_product_job_target
  ON product_deploy_job(app_id, source_generation, target_sha);
-- Deliberately no UNIQUE(app_id, target_sha).

CREATE TABLE product_app_fence (
  app_id INTEGER PRIMARY KEY REFERENCES app(id) ON DELETE RESTRICT,
  last_fence INTEGER NOT NULL DEFAULT 0 CHECK (last_fence >= 0)
);
CREATE TABLE product_app_lease (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  lease_id TEXT NOT NULL UNIQUE,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation >= 1),
  fence INTEGER NOT NULL CHECK (fence >= 1),
  job_id TEXT NOT NULL REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE (app_id, fence),
  UNIQUE (lease_id, fence, job_id),
  FOREIGN KEY (app_id) REFERENCES product_app_fence(app_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX one_active_product_lease_per_app
  ON product_app_lease(app_id) WHERE released_at IS NULL;

CREATE TABLE product_worker_lease (
  slot_name TEXT NOT NULL CHECK (slot_name = 'build'),
  lease_id TEXT NOT NULL UNIQUE,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  fence INTEGER NOT NULL CHECK (fence >= 1),
  job_id TEXT NOT NULL REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (slot_name, fence),
  UNIQUE (lease_id, fence, job_id)
);
CREATE UNIQUE INDEX one_active_product_build_slot
  ON product_worker_lease(slot_name) WHERE released_at IS NULL;

CREATE TABLE product_deploy_attempt (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  lease_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token >= 1),
  build_slot_lease_id TEXT NOT NULL,
  build_slot_fence INTEGER NOT NULL CHECK (build_slot_fence >= 1),
  state TEXT NOT NULL CHECK (state IN ('claimed','snapshot_verified','deploying','succeeded',
    'failed','abandoned_before_write','rolled_back','uncertain')),
  deployment_id INTEGER UNIQUE REFERENCES deployment(id) ON DELETE RESTRICT,
  remote_outcome TEXT NOT NULL CHECK (remote_outcome IN ('not_started','applied','unknown')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  failed_step TEXT,
  safe_error_code TEXT,
  UNIQUE (job_id, attempt_number),
  FOREIGN KEY (lease_id, fencing_token, job_id)
    REFERENCES product_app_lease(lease_id, fence, job_id) ON DELETE RESTRICT,
  FOREIGN KEY (build_slot_lease_id, build_slot_fence, job_id)
    REFERENCES product_worker_lease(lease_id, fence, job_id) ON DELETE RESTRICT
);
CREATE INDEX idx_product_attempt_job ON product_deploy_attempt(job_id, attempt_number);
CREATE INDEX idx_product_attempt_deployment ON product_deploy_attempt(deployment_id);

CREATE TABLE product_history_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  attempt_id TEXT REFERENCES product_deploy_attempt(attempt_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  safe_summary_json TEXT NOT NULL
);
CREATE INDEX idx_product_history_app_cursor
  ON product_history_event(controller_id, app_id, event_id);
```

`product_app_lease` and `product_worker_lease` are lease histories: released rows remain immutable except heartbeat/release timestamps, and partial unique indexes allow one active lease per app and one host-wide build slot. Attempts reference both leases. The global slot is claimed before the per-app lease and both are held across the deploy attempt.

### Transaction pseudocode

**Observe/enqueue poll**

```text
BEGIN IMMEDIATE
  assert app ownership is Product and controller_id matches
  read source_generation + config_sha256 + ownership_generation
  compare full tip with last observation for (app, generation, ref)
  if unchanged: update poll_checked_at only; COMMIT; no job
  else:
    seq = previous observation_sequence + 1
    insert immutable observation(app, generation, ref, seq, full_sha)
    if full_sha != verified_live_sha for same config generation:
      supersede only queued/unclaimed older tip jobs
      insert job with key poll:generation:seq and captured generations/hash
    else:
      write observation event/no-op result; no deployment job
COMMIT
```

**Claim and attempt**

```text
BEGIN IMMEDIATE
  select eligible queued job (or retry_wait whose available_at <= now)
  validate Product owner + controller + ownership/source generation/hash
  claim global build slot and increment its durable fence
  increment durable per-app fence; create both lease UUIDs/expiry/heartbeat
  CAS job queued -> claimed; insert attempt(n = previous + 1, same job)
COMMIT
before each remote mutation: re-check lease/fence/generations, then remote lock + fence marker
```

**Finalize**

```text
BEGIN IMMEDIATE
  UPDATE attempt/job/current deployment only where lease_id + fence + generations
    still match and states are expected
  insert sanitized history event/outbox in same transaction
  if affected row count != expected: rollback DB transaction; remote result becomes uncertain
COMMIT
publish notification only after commit
```

No terminal success event is emitted before a successful commit. DB rollback cannot undo a remote deployment; on a commit failure, compare remote runtime/history read-only and reconcile the same attempt. Never repeat remote write solely because final DB commit failed.

## Enrollment/API dependency (separate checkpoint)

P3b-1 defines no endpoint, token, enrollment ceremony, tunnel, or UI. Split later work:

1. **P3b-2 — persistence/migration implementation:** after contract review, add forward migration and repositories; test fresh/upgrade, foreign keys, duplicate idempotency keys, concurrent claim, stale fence, history cursor and import collision.
2. **P3b-3 — controller enrollment and authenticated client contract:** define controller identity provisioning, SSH client identity, read/action scopes, revocation/rotation, tunnel lifecycle, request idempotency transport and audit. Contract review before endpoint/runtime. No public admin API by default.
3. **P3c — controller bootstrap/read-only polling:** only after persistence and enrollment boundaries approved; no deployment writes at this phase.

Until those gates complete, local deploy, Git manual, existing IPC/schema and Desktop mode stay unchanged. No controller runtime or mode switch is implied by this document.

## Checks and limits

- Type validation PASS: from `app/`, `pnpm exec tsc --noEmit --strict --target ES2022 --moduleResolution node ../docs/contracts/product-auto-deploy.ts`. Tool used Node `v24.16.0`; pnpm emitted the repo engine warning (`>=22 <23`). Node 22-specific gate was not run.
- DDL syntax PASS: extracted proposal executed against in-memory SQLite with only stub `app`/`deployment` parent tables. This checks syntax/FK declaration only; no data migration or runtime database was changed.
- Scenario table/manual cross-check PASS for unchanged poll, A→B→A, live-tip no-op, duplicate manual key, two same-SHA manual keys, safe retry, failed build/health then manual request, config generation change and coalescing.
- Scoped ESLint was attempted from `app/`; ESLint exited 0 with one warning that the contract file is outside its base path and was ignored. This is not reported as a lint pass.
- `git diff --check` PASS.
- No integration/migration tests were run because this checkpoint is contract-only. No controller, credential enrollment, API, UI, VPS or deploy action was run.

## Nhật ký / bàn giao

- START 22/10 — Đọc task-discipline, ADR-011, docs/31, P3a, board, schema/IPC/deploy-event contracts và source Git/deploy/lock liên quan.
- DESIGN 22/10 — Bỏ unique vĩnh viễn `(app_id, SHA)`; job idempotency theo request key, poll key gồm source generation + observation sequence; manual UUID, retry attempt thuộc job. Chốt DDL proposal, queue transition, lease/fence/uncertain, cutover/import collision và tách enrollment/API.
- GATES 22/10 — Strict TypeScript check PASS (Node 24.16.0, engine warning), SQLite syntax parse của DDL proposal PASS bằng stub in-memory DB, scenario cross-check PASS, `git diff --check` PASS. ESLint scoped file bị ignore do ngoài base path, không tính PASS. Migration/runtime/API/VPS NOT_RUN theo scope.
- Content commit: `5248e204f4d8326270f692d8d24b6368139c7d33`. SHA được ghi trong task note/board bằng commit metadata tiếp theo. Không push/PR/merge; không thao tác VPS.
