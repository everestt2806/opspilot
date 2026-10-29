# TK-S7 P3b-1 — contract dữ liệu auto deploy Product mode

| Owner | Date | Branch | Status | Base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3a design `15fae0457e91b757257d78e4c3c4ec4cab946fbf`, ADR-011 |

## Requirement ledger

| Requirement | Bằng chứng trong hồ sơ | State |
|---|---|---|
| Identity/state/transition, durable desired state và history cursor | `docs/contracts/product-auto-deploy.ts`, DDL và state machine dưới đây | PASS |
| Idempotency/coalescing, unchanged-tip reconcile, A→B→A, manual pause/resume and crash recovery | Timeline table, desired revision/epoch and transaction pseudocode; reviewer cases cross-checked | PASS |
| Lease/fence, crash/uncertain và remote command đang chạy | Chính sách scheduler/recovery và pseudocode | PASS |
| Product ownership/cutover/import collision/enforcement giới hạn | Phần ownership và cutover; nêu rõ giới hạn binary cũ | PASS |
| DDL dự kiến, constraints/indexes/transactions; không tuyên bố migration đã áp dụng | SQL proposal parse trong SQLite in-memory với stub `app`/`deployment`; không migration | PASS |
| Enrollment/API tách riêng; Desktop/Git manual giữ nguyên | P3b-3 tách riêng; phạm vi unchanged được nêu | PASS |
| Type/cú pháp, đối chiếu tình huống, diff check, commit local | Node 22 strict typecheck, DDL proposal syntax, scenario/timeline cross-check, final newline và `git diff --check` PASS; correction content commit `b67c9551ce2cb1a763abc3a52f4754931e63772e` | PASS |

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

- **Poll:** chỉ tạo immutable observation và tăng `observation_sequence` khi SHA khác tip gần nhất của cùng source generation/ref. Mỗi lần tip đổi, cùng transaction cập nhật durable desired row. Job key ổn định là `auto:<source_generation>:<observation_sequence>:<reconcile_epoch>`; unique `(controller_id, app_id, idempotency_key)` chặn lần enqueue lặp. Tip poll không đổi không tạo observation hoặc đổi key, nhưng vẫn chạy reconciliation trên desired row đang `pending`/`queued`/`in_progress`.
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
| A live; B auto job queued; quan sát A trước claim | Desired revision thành A; B auto queued/retry_wait bị supersede trong transaction; desired A được đánh dấu satisfied theo live A; không tạo job A |
| A live; B auto job deploying; quan sát A; B hoàn tất | Desired A giữ trạng thái pending; không hủy B. Finalize B không thể đánh dấu A satisfied. Reconciler tạo job A sau khi B terminal |
| Crash ngay sau commit B ở ca trên, trước callback/reconcile | Desired A và pending state vẫn bền; startup scan/repeated unchanged-tip poll tạo đúng job A theo observation sequence/epoch cũ |
| Manual rollback/redeploy được nhận khi có auto queue | Cùng transaction bật durable `auto_paused`; auto queued/retry_wait không claim được; manual job không bị supersede. Job auto đang mutate được hoàn tất trước manual |
| Poll cùng tip trong khi manual pause hoặc desired pending | Không tạo observation/job trùng; không claim auto; vẫn refresh desired reconciliation state khi chưa pause và scan pending |
| Explicit resume sau manual rollback, desired SHA cũ đã deploy thành công trước đó | So sánh live SHA; nếu khác desired thì tăng `reconcile_epoch`, tạo một auto job mới. Không tự xảy ra trước resume |
| Resume khi job desired cùng revision failed/uncertain | Không tạo job mới/replay; failed cần intent mới, uncertain cần read-only reconciliation rồi quyết định có kiểm soát |

## State machine và transition

```text
branch tip changed → observed(seq, sha) → queued → claimed(lease, fence)
                                                   ↓ exact snapshot SHA/config
                                                deploying(deployment_id?)
                                                   ├─ succeeded
                                                   ├─ failed (build/health or exhausted)
                                                   ├─ rolled_back (rollback verified)
                                                   └─ uncertain (remote/DB outcome unclear)
queued/retry_wait → superseded (auto job obsolete) | cancelled
claimed/deploying → retry_wait → queued (only after safe no-write proof)
desired state: pending → queued/in_progress/satisfied; manual intent → paused; explicit resume → pending
```

- `queued → claimed`: atomic transaction claims oldest eligible job only if app remains Product-owned by the same controller and ownership/source generations match. Claim creates lease UUID, fence `previous_fence+1`, expiry and attempt row.
- `claimed → deploying`: heartbeat/lease valid; detached source snapshot matches full SHA and source config hash; acquire remote app lock; verify mode marker/remote generation. Create/link deployment history before the first remote mutation.
- `queued/retry_wait → superseded`: chỉ auto job không còn khớp desired `(source_generation, ref, observation_sequence, reconcile_epoch)` hoặc config generation. Không cập nhật job `manual_*`. Preserve row và reason for audit.
- `claimed → superseded`: chỉ được nếu kiểm tra ngay trước remote dispatch cho thấy auto job đã stale/paused và chắc chắn chưa gửi lệnh ghi; attempt kết thúc `abandoned_before_write`, lease nhả sau khi process/SSH không còn chạy. Không hủy job đã bước vào mutate.
- `claimed/deploying → retry_wait`: only a classified transient failure with positive evidence no remote mutation was dispatched/applied, remaining retry budget, same config/ownership generations. Each retry increments attempt number and fence.
- `deploying → succeeded`: candidate build and runtime health pass, pipeline commits deployment/current pointer, then job/attempt/outbox finalize using lease+fence CAS. External exposure degradation stays distinct from app health per existing deploy contract.
- `deploying → failed/rolled_back`: build/health failure retains verified previous live runtime; `rolled_back` only if prior runtime restoration was verified. Failure/rollback failure where actual remote state is unknown becomes `uncertain`.
- `claimed/deploying → uncertain`: controller crash/SSH timeout after write dispatch, lost remote lock, lease expiry with live child, DB commit uncertainty, or failed ownership/generation CAS after remote work. No automatic retry or second write until explicit read-only reconciliation proves outcome.
- `uncertain` is terminal for automatic worker transitions. Audited operator reconciliation may resolve it to succeeded, failed, or retry-eligible only with matching DB/remote SHA/runtime and ownership; uncertain is never reset to queued by polling.
- `succeeded`, `failed`, `rolled_back`, `superseded`, `cancelled` are terminal. A new manual intent is a new job. Do not rewrite terminal provenance.

Retry policy: maximum **3 attempts total** per job (initial + at most two retries), for safe transient pre-write failures only, with delays 30 seconds then 2 minutes and jitter. Exhaustion → `failed`. Build and health failure do not auto-retry. Git poll errors are separate: exponential delay 30 seconds, 1, 2, 5, then 15 minutes maximum with jitter; no new job until a valid tip is read. These are proposed contract defaults and should be config-bounded, not caller-controlled.

Push coalescing: desired branch state is a durable row per `(app_id, source_generation, ref)` containing latest full SHA, observation sequence, reconciliation epoch, state, pause and job link. A new tip transaction supersedes only stale auto `queued`/`retry_wait` rows. If current live SHA already equals the new desired SHA and config generation matches, mark desired revision satisfied without deployment. If an older auto job is claimed/deploying, keep the newest desired revision pending and never cancel mutation; its completion cannot mark a different desired revision satisfied.

The reconciler runs at startup, after each poll even when the SHA is unchanged, after lease/job recovery and after every terminal job transaction. The database row is authoritative; callbacks merely wake the reconciler. A durable scan selects `pending` rows and compares latest desired revision, live SHA/config generation, active job and auto-pause. It atomically links/enqueues the matching auto job or marks the revision satisfied. Thus a crash after deployment B commits but before an in-memory callback cannot erase a newer desired A. Force-push compares full SHA, not ancestry. Deleted/unavailable branch creates no desired deployment and leaves live app unchanged.

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
  reconcile_epoch INTEGER,
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
  CHECK ((trigger = 'branch_poll' AND reconcile_epoch IS NOT NULL AND reconcile_epoch >= 0) OR
         (trigger <> 'branch_poll' AND reconcile_epoch IS NULL)),
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

CREATE TABLE product_desired_branch (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  ref TEXT NOT NULL,
  desired_observation_sequence INTEGER NOT NULL CHECK (desired_observation_sequence >= 1),
  desired_sha TEXT NOT NULL CHECK (length(desired_sha) = 40 AND desired_sha NOT GLOB '*[^0-9a-f]*'),
  reconcile_epoch INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_epoch >= 0),
  reconciled_observation_sequence INTEGER,
  reconciled_epoch INTEGER,
  reconciliation_state TEXT NOT NULL CHECK (reconciliation_state IN
    ('pending','queued','in_progress','satisfied','paused','failed','uncertain')),
  reconciliation_job_id TEXT REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  auto_paused INTEGER NOT NULL DEFAULT 0 CHECK (auto_paused IN (0,1)),
  pause_reason TEXT CHECK (pause_reason IS NULL OR pause_reason IN ('manual_action','operator')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, source_generation, ref),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT,
  CHECK ((auto_paused = 0 AND pause_reason IS NULL) OR
         (auto_paused = 1 AND pause_reason IS NOT NULL)),
  CHECK ((reconciled_observation_sequence IS NULL AND reconciled_epoch IS NULL) OR
         (reconciled_observation_sequence IS NOT NULL AND reconciled_epoch IS NOT NULL))
);
CREATE INDEX idx_product_desired_pending
  ON product_desired_branch(reconciliation_state, updated_at);

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
  if changed:
    seq = previous observation_sequence + 1
    insert immutable observation(app, generation, ref, seq, full_sha)
    upsert desired row with (seq, full_sha, state=pending); keep reconcile_epoch;
      clear reconciliation_job_id and the reconciled watermark for this revision
    supersede only stale auto queued/retry_wait jobs for same app/generation/ref
  else: update poll_checked_at only; do not create observation or increment seq/key
  ALWAYS reconcile the durable desired row before COMMIT, including unchanged tip:
    if paused: set state=paused; stop
    if any app attempt is uncertain: state=uncertain; block all deploy writes; stop
    if claimed/deploying job owns app: keep state=pending; stop
    if desired revision equals verified live SHA + config generation:
      state=satisfied; reconciled=(desired seq, epoch); job_id=NULL; stop
    if matching auto job exists queued/retry_wait/claimed/deploying:
      link it and set queued/in_progress; do not insert a duplicate; stop
    if matching job is failed/uncertain/rolled_back terminal:
      set failed/uncertain; do not replay; stop
    insert one auto job with key auto:generation:seq:epoch;
    set state=queued, reconciled=(seq,epoch), job_id=new job
COMMIT
```

Reconciliation state `queued` means a durable matching job exists; `satisfied` means this exact desired revision/config is already the verified live state. `pending` means a newer desired revision has not yet reached either outcome (usually because an older job owns the app). `failed` and `uncertain` are durable stop states, not retry queues.

**Claim and attempt**

```text
BEGIN IMMEDIATE
  select eligible manual job first; otherwise auto queued/retry_wait whose available_at <= now
  for auto job, require !auto_paused and exact match to desired gen/ref/seq/epoch/SHA
  stale unclaimed auto row -> superseded; never supersede manual job
  validate Product owner + controller + ownership/source generation/hash
  claim global build slot and increment its durable fence
  increment durable per-app fence; create both lease UUIDs/expiry/heartbeat
  CAS job queued -> claimed; insert attempt(n = previous + 1, same job)
COMMIT
before first remote mutation: re-check lease/fence/generations AND desired revision; if stale
  and definitely no write dispatched, abandon attempt/supersede; otherwise do not cancel
then acquire remote lock + fence marker; repeat lease/fence check before every write phase
```

**Finalize**

```text
BEGIN IMMEDIATE
  UPDATE attempt/job/current deployment only where lease_id + fence + generations
    still match and states are expected
  if auto-paused: leave desired state=paused
  else if desired revision still equals this job and succeeded live SHA/config match:
    desired state=satisfied; reconciled=(seq,epoch)
  else if desired revision is newer:
    leave desired state=pending (do not mark it satisfied from the older job)
  insert sanitized history event/outbox in same transaction
  if affected row count != expected: rollback DB transaction; remote result becomes uncertain
COMMIT
publish notification only after commit
```

Startup and each poll run `reconcileDesired()` from SQLite; the scan includes pending desired rows and matching queued/retry-wait jobs so that terminal finalization and explicit resume are both recovered. After finalize, the worker may also run it immediately, but correctness relies on the durable desired/reconciliation row. A crash after commit and before the wakeup is recovered by startup scan; a repeated unchanged-tip poll invokes the same idempotent routine. The unique auto idempotency key and existing-job lookup ensure one job per `(generation, observation sequence, reconcile epoch)`.

**Manual priority and pause/resume**

```text
BEGIN IMMEDIATE on a new manual request key
  set desired.auto_paused=1, pause_reason='manual_action', state=paused
  insert (or return existing idempotent) manual job
  do not alter manual jobs; do not cancel claimed/deploying work
COMMIT
claim order: finish active mutation → manual jobs FIFO → eligible auto jobs

explicit operator resume transaction:
  auto_paused=0; reconcile against latest durable desired and verified live
  if same revision job is queued/retry_wait: make it eligible, keep same key/budget
  if desired already live: mark satisfied; no deployment
  if previous same-revision job succeeded but manual action changed live:
    increment reconcile_epoch; mark pending; create one new auto request
  if no job exists for this desired revision and live differs: create its current-epoch auto request
  if failed/uncertain exists: preserve terminal stop; require explicit safe resolution
COMMIT
```

Polls while paused continue updating desired SHA/sequence and supersede stale auto queued/retry_wait jobs, but they do not clear the pause or enqueue a new auto job. The pause persists after the manual action completes. An explicit resume is the only operation that allows the branch policy to reconcile again. An unresolved uncertain attempt blocks both auto and manual writes until read-only recovery; resuming cannot bypass it.

## Durable timeline and crash points

Notation: `L` = verified live SHA; desired row `D=(seq, SHA, reconcile_state, epoch)`; jobs show `trigger/state/seq`. Every transaction below commits observation, desired row and job state atomically where stated.

| Case / boundary | Durable state before | Transaction and durable state after | Crash/restart outcome |
|---|---|---|---|
| **A live → observe B → B queued → observe A before claim** | `L=A`, `D=(1,A,satisfied,0)`, no jobs | T1 poll B: observation 2; `D=(2,B,queued,0)`; auto `B/queued/seq2`. T2 poll A before claim: observation 3; `D=(3,A,satisfied,0)` because `L=A`; `B→superseded`; no A job. Only stale auto `queued/retry_wait` may be superseded. | Crash after T1: on next tip read A, T2 is performed before claim if it arrives first; claim and pre-write checks also validate job seq/epoch against D. Crash after T2: B remains superseded; no A deployment is enqueued. Manual jobs untouched. |
| **A live → B deploying → observe A → B succeeds** | `L=A`, `D=(2,B,in_progress,0)`, `B/deploying/seq2` owns lease/fence | T1 poll A while B mutates: observation 3; `D=(3,A,pending,0)`; B remains deploying. T2 finalize B: B succeeds and `L=B`; because D seq3 != B seq2, T2 leaves D pending. | Crash immediately after T2, before callback: startup scan sees `D=pending`, `L=B`, no active lease; T3 inserts one `A/queued/seq3` job with same stable key, sets D queued. Crash before T3 commit leaves D pending; restart repeats T3. Crash after T3 commit leaves durable A job; unchanged-tip poll finds it and does not duplicate. |
| **Same tip poll while D pending** | `D=(3,A,pending,0)`, `L=B` | Poll observes same A: no new observation/sequence/key; reconciliation still runs and creates/finds the one seq3 job, or remains pending if another job owns app. | Restart does not depend on an in-memory “deploy finished” callback; pending state is scanned. |
| **Manual rollback/redeploy while auto B queued** | `L=A`, `D=(2,B,queued,0)`, auto B queued | Manual request transaction sets `auto_paused=1`, D paused, inserts manual job with caller idempotency key. Auto B is not claimed; manual job is not superseded. | Poll of same/changed tip updates latest desired and stale auto rows only; remains paused. Manual is processed after any already-mutating job. After manual terminal, pause remains. |
| **Resume after manual rollback** | `L=A`, paused, desired B; prior B auto job may be absent, queued, succeeded, failed, or uncertain | Explicit resume compares latest D with live. Matching queued/retry job becomes eligible with same key/budget; live==desired becomes satisfied; no prior job + mismatch creates current-epoch job; prior succeeded + live mismatch increments epoch and creates one new job. Failed/uncertain remains stopped. | Polling alone never resumes or undoes manual result. Crash before resume commit leaves paused; after commit durable pending/job is recovered by startup. |

T1/T2 above are SQLite transactions; Git tip resolution occurs before the poll transaction and is bound by source/ownership generation checks inside it. Commit of a remote deployment and final DB commit cannot be one atomic cross-host transaction; `desired_branch` is specifically the durable intent/recovery record across that boundary.

No terminal success event is emitted before a successful commit. DB rollback cannot undo a remote deployment; on a commit failure, compare remote runtime/history read-only and reconcile the same attempt. Never repeat remote write solely because final DB commit failed.

## Enrollment/API dependency (separate checkpoint)

P3b-1 defines no endpoint, token, enrollment ceremony, tunnel, or UI. Split later work:

1. **P3b-2 — persistence/migration implementation:** after contract review, add forward migration and repositories; test fresh/upgrade, foreign keys, duplicate idempotency keys, concurrent claim, stale fence, history cursor and import collision.
2. **P3b-3 — controller enrollment and authenticated client contract:** define controller identity provisioning, SSH client identity, read/action scopes, revocation/rotation, tunnel lifecycle, request idempotency transport and audit. Contract review before endpoint/runtime. No public admin API by default.
3. **P3c — controller bootstrap/read-only polling:** only after persistence and enrollment boundaries approved; no deployment writes at this phase.

Until those gates complete, local deploy, Git manual, existing IPC/schema and Desktop mode stay unchanged. No controller runtime or mode switch is implied by this document.

## Checks and limits

- Correction type validation PASS on Node `v22.23.3`: `pnpm dlx node@22 node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --moduleResolution node ../docs/contracts/product-auto-deploy.ts` (run from `app/`).
- DDL syntax PASS: extracted proposal executed against in-memory SQLite with only stub `app`/`deployment` parent tables. This checks syntax/FK declaration only; no data migration or runtime database was changed.
- Timeline/scenario cross-check PASS: A live→B queued→A observed before claim supersedes only B and no-ops A; B in-flight→A preserves pending desired through finalize/crash/restart; unchanged-tip poll reconciles; manual pause survives terminal and polls; explicit resume handles current/latest branch; failed/uncertain remains stopped; retry budget holds; mutation is never cancelled.
- Final newline byte check PASS (exactly one LF, no blank line); `git diff --check` PASS. The first inline Python byte assertion was misquoted through PowerShell and failed; rerunning via a PowerShell here-string passed, with no source issue.
- Earlier scoped ESLint invocation was ignored because the contract is outside its base path; it is not counted as a lint pass and lint was not required for this correction.
- No integration/migration tests were run because this checkpoint is contract-only. No controller, credential enrollment, API, UI, VPS or deploy action was run.

## Nhật ký / bàn giao

- START 22/10 — Đọc task-discipline, ADR-011, docs/31, P3a, board, schema/IPC/deploy-event contracts và source Git/deploy/lock liên quan.
- DESIGN 22/10 — Bỏ unique vĩnh viễn `(app_id, SHA)`; job idempotency theo request key, poll key gồm source generation + observation sequence; manual UUID, retry attempt thuộc job. Chốt DDL proposal, queue transition, lease/fence/uncertain, cutover/import collision và tách enrollment/API.
- CORRECTION 22/10 — Thêm durable desired branch/reconciliation state và epoch; unchanged-tip poll/startup scan tiếp tục reconcile pending intent; obsolete auto queued/retry_wait bị supersede, manual intent pause auto tới explicit resume; claim/pre-write/finalize kiểm tra desired revision. Timeline ghi state trước/sau transaction và crash points cho A→B→A, B-in-flight→A và manual pause/resume.
- GATES 22/10 — Node 22.23.3 strict TypeScript PASS; SQLite syntax parse DDL proposal PASS bằng stub in-memory DB; timeline/scenario cross-check PASS; final newline và `git diff --check` PASS. No migration/runtime/API/VPS action by scope.
- Baseline contract commit: `5248e204f4d8326270f692d8d24b6368139c7d33`; correction content commit: `b67c9551ce2cb1a763abc3a52f4754931e63772e`. Ghi nhận metadata commit tiếp theo. Không push/PR/merge; không thao tác VPS.
