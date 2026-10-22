# TK-S7 P3b-3 — Product controller enrollment and API contract

| Owner | Date | Branch | Status | Base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3b-2e code `ef15e77196ca502eddf8889b0a6d11c4a6f766ef`, dossier `a9df123d66868aeb7b9454076c61b7021c91de32` (Leader approved) |

## Scope

Contract and design docs only: enrollment, authenticated loopback API, credential lifecycle, authorization/idempotency, error behavior and implementation gaps. No runtime, migration, UI, production DB, VPS connection, installation, deployment, DNS or firewall change.

P3b-2e review acceptance is recorded here and in its source dossier: Leader approved code `ef15e77` / dossier `a9df123`. That checkpoint proves Product DB persistence, equality of executor-supplied snapshot metadata, and a durable one-shot dispatch marker only. It does not prove a Git fetch, remote command, or working Product auto deployment.

## Requirement ledger

| Requirement | Decision / artifact | Gate / evidence | State |
|---|---|---|---|
| Controller/client/app identity and secure connection | Separate IDs and scopes; loopback API over strict pinned SSH tunnel; enrollment binds expected controller ID and SSH endpoint pin | Contract typecheck and design review of route/auth mismatch matrix | PASS |
| Enrollment and credential lifecycle | SSH-admin bootstrap, RFC 6750 opaque bearer, OS CSPRNG, main-process-only custody, expiry/rotation/revoke/restore behavior | Contract typecheck and design review of credential flow/no-secret rules | PASS |
| Read/action API contract | Typed endpoints for health/status/capabilities/apps/jobs/deployments/history/logs/redeploy/pause/resume; bounded payload/page/log; safe errors | Strict TS route/security parity and typed request/response/error DTOs | PASS |
| Authorization, idempotency and uncertain transport | Current DB ownership per request, generation preconditions, UUID idempotency scope/body digest, timeout lookup/no fallback; document schema gap | Scenario design review; no runtime tests in this docs checkpoint | PASS |
| Existing P3b contracts and P3c–P3f boundaries | P3b state machine remains authoritative; identify API request-dedup persistence gap and map remaining code to existing checkpoints | Cross-reference source/docs and record P3b-2e review | PASS |
| Typecheck, scenario review, diff check, board/task/decision update, local commit | Strict TS contract check, matrix, repository status and local commit | Node 22.23.4 strict TS PASS; scenario matrix reviewed against P3a, ADR-011, Product contracts/migrations 016–018; staged diff check PASS | PASS |
| Runtime enrollment/API/authentication test | Not applicable to contract-only checkpoint; no runtime changed | Explicitly NOT_RUN; implementation gates assigned to P3c–P3f | N/A |

## Identity and transport

- `controller_id` identifies one installed control plane and persists over service restarts. It is distinct from `client_id` (one enrolled desktop installation) and from `app_id`/`product_app_control` ownership. The controller is the Product-mode source of truth; the desktop is a cache/client and never a second Product writer.
- API binds only `127.0.0.1:8768` on the controller (or a later approved local Unix socket). `/healthz` returns only API version and process state; every identity, capability, app, history, log and action route requires auth. No public admin listener, Docker socket or firewall opening is permitted.
- Desktop main opens an SSH local forward using strict host-key checking and the controller SSH pin already confirmed by the operator. Store expected `(controller_id, host, port, SSH user, key algorithm, fingerprint)` as an enrollment binding. Before each API session it reads authenticated controller identity and exact-compares `controller_id`; mismatch, unknown pin or changed host key closes the tunnel and rejects the request. No auto-learning/`ssh-keyscan` trust and no renderer tunnel/token access.
- The desktop-to-controller bearer credential is separate from the controller-to-target SSH key. Controller target key is controller-owned Linux secret material under service-only `0700` directory / `0600` file and is not derived from or copied from desktop credentials. Windows `safeStorage` ciphertext is platform-bound and is never moved to Linux.

## Enrollment and credential lifecycle

1. An operator explicitly selects a controller profile with independently verified SSH pin and authenticates to that controller with an authorized SSH administrator identity, then confirms the enrollment action. Enrollment is a bounded stdin/stdout framed SSH operation executed by the controller CLI/forced command under an allowlisted OS identity; there is no unauthenticated HTTP enrollment route and no self-registration token exposed over the network.
2. Desktop main generates a display label and asks for `read`, `deploy:manual`, and/or `policy:write` scopes. Controller applies its local allowlist; the request cannot grant itself extra scope. Controller creates a fresh `client_id`, at least 256 bits of random opaque access token using the OS CSPRNG, and a server-side token record. Token follows OAuth 2.0 Bearer usage (RFC 6750 `Authorization` header); do not invent a signing/encryption scheme. Store only a standard SHA-256 digest of the high-entropy token at controller; persist the token on desktop only through the platform's Electron `safeStorage`, accessed by main. If secure OS storage is unavailable, enrollment is blocked rather than falling back to plaintext. Return token once to the main-process handoff; do not write it to terminal, SSH/app logs, argv, URL, history, exception, renderer IPC or reports.
3. Desktop persists the non-secret expected controller identity/pin and `client_id`; token expiry is 30 days. Main refreshes by explicit credential rotation over the same verified SSH-admin channel before expiry. Rotation issues a new token once and leaves the old one valid for at most 1 hour; after main stores and verifies the new token, it confirms `rotation_id` over SSH, causing immediate old-token revocation. If confirmation is lost, the old token expires at the stated grace deadline. SSH write operations carry a stable UUID `request_key`; retrying enrollment/rotation never creates another client/token, and an outcome whose one-time secret was lost must be explicitly revoked/cancelled before a new operation key is accepted. Rotation response secrets are never rendered/logged.
4. Revoke a client immediately with authenticated SSH administrator CLI (or the same client credential while valid if a later route is implemented). Lost desktop token/key requires authenticated SSH re-enrollment; do not recover a token from DB backup. Host-key pin rotation requires independent confirmation of the new fingerprint and updates the enrollment binding only after verification.
5. A DB backup restore is not ready for writes by itself. The documented restore procedure creates an external, non-backed-up `restore-required` marker before restoring. On marker presence, controller serves only minimal health/read state, rejects actions and invalidates all restored desktop token records. Operator verifies controller identity, target SSH pins and live deployment state, then re-enrolls clients and clears the marker. Restoring a DB without the marker is unsupported; no claim is made that SQLite alone can detect a copied backup.

Controller-to-VPS SSH deploy keys are a separate credential class: generate on Linux using standard OpenSSH tooling, store private material only in the protected controller directory, and install the public key on a target only via an already pinned/admin-authorized SSH path. `authorized_keys` has no native expiry, so controller policy sets a maximum 90-day use period and refuses a locally expired key. Rotation installs and validates the new public key, then removes/revokes the old key; overlap is at most 24 hours. Lost key means mark target credential revoked-pending, block mutations, and remove its public key through a still-authorized path; do not claim remote revocation until confirmed. This procedure belongs to P3e/P3f and is not exercised here.

## API surface and shared rules

Typed route/DTO/error shapes are in [`docs/contracts/product-controller-api.ts`](../contracts/product-controller-api.ts). HTTP API paths are beneath `/v1/controllers/{controller_id}` except the loopback-only minimal `/healthz`. Client enrollment, rotation, confirmation and revocation use pinned SSH-admin framed operations, never HTTP. Use `Authorization: Bearer …`; never put bearer credentials in query/path. Successful reads return `ProductControllerApiMeta` with controller, request ID, sampling timestamp and freshness. Desktop marks its cached state stale after 30 seconds without a successful read. This is controller-recorded state, not proof of live VPS health.

| Route group | Contract |
|---|---|
| `GET /healthz` | Unauthenticated minimal liveness only: API version and process state; no controller/app data. |
| `GET /identity`, `/status`, `/capabilities` | Authenticated, verify enrolled controller ID and current service/API capability; status reports bounded counters/reason codes, not logs/secrets. |
| `GET /requests/{request_key}` | Authenticated lookup scoped to the current client/controller; returns recorded outcome/job or `found:false` so the main process can retry the exact same key/body only when no durable record exists. |
| `GET /apps`, `/apps/{id}` | List only apps whose current row is Product-owned by this controller; detail resolves ownership and generations from DB. |
| `GET /apps/{id}/jobs`, `/deployments`, `/history` | Page at most 100 records; reject a cursor whose controller differs from authenticated controller. Deployment rows remain canonical; Product history links to them. |
| `GET /apps/{id}/jobs/{job}/logs` | Verify app/job ownership; sanitized bounded lines only, maximum 200 lines and 64 KiB per response; no raw stdout/stderr or secret fields. |
| `POST /apps/{id}/redeploy` | Requires `deploy:manual`, generation preconditions and `Idempotency-Key`; full SHA/current desired selection is validated against server-owned source/observation. Accepted manual intent durably pauses auto reconciliation and queues one manual job in the same transaction. Response is accepted job identity, never dispatch/executor authority. |
| `POST /apps/{id}/auto-deploy-policy` | Requires `policy:write`, current generations and idempotency key. Pause/resume is explicit/audited; resume persists current owner policy provenance `explicit`, does not bypass uncertain/reconciliation gates, and does not treat a client boolean as proof. A no-op returns `already_in_state`; explicit resume can clear ambiguous `operator_required` provenance only after an authorized request. |
| Client enrollment/revoke/rotate/confirm | SSH-admin framed stdin/stdout commands on a strict pinned connection; no HTTP enrollment surface. Rotation finalization revokes old credential only after main confirms secure storage/use. |

General limits: JSON request body at most 16 KiB; ordinary response at most 1 MiB; list page default 50/max 100; logs separately capped above. Limit each client to 60 requests/minute and write routes to 10/minute, returning safe `RATE_LIMITED` with bounded retry delay. Reject invalid/oversized payload before DB mutation. Errors include stable allowlisted code, safe user message, retryability and request ID; never raw exception, SQL, SSH output, credential or installation plan. For an app not currently owned by this controller return `404 APP_NOT_FOUND` (do not disclose another controller's app); generation mismatch returns `409 OWNERSHIP_STALE` or `SOURCE_GENERATION_STALE` with current generation only.

HTTP mapping: auth/expired/revoked/client-revoked `401`; missing scope `403`; hidden/out-of-scope app `404`; malformed request or wrong-controller cursor `400 REQUEST_INVALID`; enrolled-controller mismatch, stale generation, no desired target, requested SHA unavailable, idempotency conflict, reconciliation-required or capability-blocked `409`; oversized body `413`; rate limit `429`; internal safe failure `500`; unsupported route/capability `501`; controller maintenance/unavailable `503`. Wrong-controller cursor is distinguished from a malformed cursor only when its decoded controller ID is valid and differs from the authenticated controller; cursors also bind app/resource/offset.

Every route, including reads, authenticates the token, checks its `controller_id`, client active/revoked/expiry state and required scope, then resolves current `product_app_control` and source config from SQLite. For app routes compare controller ownership and Product mode; for writes also compare expected ownership/source generations within the same write transaction. Never accept caller-supplied ownership, target VPS identity, verified flags, source config, shell, evidence, claim, lease, fence, or dispatch token. Controller's own worker-only methods (`claim`, heartbeat, snapshot verification, begin dispatch) are not part of this API. Disable CORS/cookie authentication; only the main-process client sends Bearer headers, and no browser/renderer API surface is exposed.

All HTTP state-changing requests require standard `Idempotency-Key: <UUID>` generated once by main and retained across transport retry. Server binds key to authenticated controller + client + app + action + RFC 8785 canonical validated body SHA-256. Same scope/key/body returns the original job/result; same key with different app/action/body returns `409 IDEMPOTENCY_CONFLICT`. Keep a compact digest/status tombstone for the controller lifetime; payloads/logs may follow retention, but a key must not become reusable. `GET /requests/{request_key}` looks up only the authenticated client's record; `found:false` permits retry only with the exact same key/body, while accepted/blocked/uncertain returns its durable prior outcome. SSH bootstrap writes use `request_key` with equivalent controller/SSH-actor/operation/body binding. Credential secrets are returned once only; replay reports `credential_delivery_unknown` without issuing another token. If the tunnel drops after request transmission, `ProductControllerCallResult` is `outcome_unknown`: query with the same key/current operation state, never issue a new key or invoke Desktop pipeline. `UNSUPPORTED` (501) and `CAPABILITY_BLOCKED` are explicit errors and cannot be rendered as accepted/success.

### Persistence gap (to implement only in its dependent checkpoint)

Migration 016's `(controller_id, app_id, idempotency_key)` uniqueness on `product_deploy_job` is not sufficient for API semantics: it does not bind `client_id`, action, or request-body digest and pause/resume need idempotent outcomes without a job. P3f must add forward schema for enrolled client identities and opaque credential digest/expiry/revocation (no plaintext token), plus an operation-request record, not edit 016–018. The operation key binds controller + actor kind/ID + resource/app/client + action + request key and stores RFC 8785 canonical body SHA-256, outcome/status, optional job/client link and timestamps. Its transaction records dedupe plus queue/policy result atomically. P3d may use the existing job idempotency key for internal scheduler operations but must not claim client-bound API idempotency exists. Never persist token plaintext. Do not claim the present repository already enforces this contract.

## Scenario matrix

| Scenario | Required behavior/status | Evidence in this checkpoint |
|---|---|---|
| Missing, malformed, expired or revoked bearer credential | 401 `AUTH_REQUIRED`, `CREDENTIAL_EXPIRED` or `CREDENTIAL_REVOKED`; no identity/app details and no mutation | Contract review only; no auth runtime |
| Enrollment without authorized, pinned SSH administrator session | No enrollment command accepted; no HTTP enrollment surface or token issued | Contract review only; no enrollment runtime |
| Controller SSH host fingerprint mismatch or host-key algorithm/pin change | Strict SSH fails closed before API request; do not learn a key or send credentials | Contract review only |
| Valid token but URL/controller identity mismatch | Compare authenticated token and enrolled expected ID; 409 `CONTROLLER_MISMATCH`, close tunnel/session, do not retry writes elsewhere | Contract review only |
| Revoked desktop client | Reject all routes (401 `CLIENT_REVOKED`); administrator may re-enroll via pinned SSH | Contract review only |
| App outside controller's current Product ownership | 404 `APP_NOT_FOUND`, no existence disclosure and no action | Contract review only |
| Same request key/scope/body retried after lost response | Return the same job/result; no second queue/policy mutation | Contract review only; needs P3d/P3f dedupe persistence |
| Same key with changed action/body/app | 409 `IDEMPOTENCY_CONFLICT`, no mutation | Contract review only; needs request digest persistence |
| Tunnel drops before/after request send | Before-send can retry same key; after-send is unknown, reconnect and query same key. No fallback to local deploy | Contract review only |
| Ownership or source generation changes after UI read | Write precondition fails 409 with current generation; refresh and require new operator intent/key | Contract review only |
| Rotation interrupted | Both credentials valid only during bounded 1h overlap; use new token then confirm revoke; expiry or SSH admin recovery otherwise | Contract review only |
| Backup restored | External restore marker blocks writes and invalidates restored client grants pending target/identity check and re-enrollment | Contract review only |
| History cursor belongs to another controller | 400 `REQUEST_INVALID`; never reinterpret event ID in this controller. The separate URL/token controller mismatch is 409 `CONTROLLER_MISMATCH` | Contract review only |
| Endpoint not implemented or action gated | 501 `UNSUPPORTED` or explicit blocked capability; never return a fabricated accepted state | Contract review only |

## Remaining runtime boundaries

- **P3c:** Linux controller bootstrap/service identity/data-dir/SQLite startup, loopback-only health/status composition and outbound public-branch polling into the existing observation/reconciliation repository. Local Linux lab, restart and no-executor gates; no desktop exposure or target VPS mutation.
- **P3d:** durable scheduler/queue/action repository, leases/fences, internal job idempotency, timeout/uncertain behavior and worker internal boundaries. No public desktop API or client-bound request ledger until P3f.
- **P3e:** Git snapshot acquisition and deploy executor/pipeline adapter, canonical deployment/history linking, remote app lock/fence and success/failure/rollback/reconciliation. P3b-2e marker alone is not execution evidence.
- **P3f:** SSH-admin enrollment/revoke/rotation CLI, forward schema for desktop client/token digest + client-bound request idempotency, authenticated desktop API/tunnel client, safeStorage handling on each OS, controller-ID mismatch enforcement, desktop Product-mode ownership switch/cache/freshness and no dual writer. Includes restore/rotation operational tooling and offline security tests.
- API binds fixed `127.0.0.1:8768`; startup must fail closed on bind collision (no public bind or opportunistic public-port fallback). A future approved local socket is an implementation alternative only if it preserves the same loopback/tunnel/auth contract.
- Before any live cutover: target-side lock/fence must prevent stale remote writer mutations; direct Desktop/legacy credentials can still bypass a new SQLite ownership flag. Cutover requires removing/restricting old target credentials or another enforced remote boundary and verified drain; do not claim SQLite alone blocks an old binary.

## Gates and status

- Strict TypeScript compile for this contract and imported Product contract, no runtime tests expected in this docs checkpoint.
- Review this scenario matrix and cross-check P3a, ADR-011, Product contract and migrations 016–018; `git diff --cached --check`.
- No auth/API runtime, migration, SSH connection, VPS, UI, pipeline, public listener or production DB test is performed here.

Review result: design review/type checking is local static evidence only. Enrollment, token storage/rotation/revocation, API authorization, idempotency persistence, tunnel behavior, stale-generation CAS and unsupported-capability responses have no runtime implementation or test in this checkpoint.

## Journal

- `START 22/10`: read task discipline, CLAUDE, ADR-011, roadmap, P3a, Product data contract and P3b-2e dossier; recorded the approved base and limitation above. Worktree had only pre-existing untracked files; preserved them.
- `UPDATE 22/10`: added typed route/enrollment/security contracts, one-time SSH bootstrap credential flow, loopback API/error/page limits, per-route scope parity, idempotency and uncertain transport rules, app/generation authorization, restore/rotation policy, scenario matrix and P3c–P3f gap mapping. Updated DECISIONS and recorded P3b-2e approval with the exact evidence limit. Node 22.23.4 strict contract compile (`node.exe app/node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --noUnusedLocals --noUnusedParameters docs/contracts/product-controller-api.ts docs/contracts/product-auto-deploy.ts`) PASS; scenario review and staged `git diff --cached --check` PASS; no compiler warnings. Runtime checks NOT_RUN by scope.
- `HANDOFF-LOCAL 22/10`: contract/design commit `37622202a62df6844c20948ba7c81e0433f9c752`; Node 22.23.4 strict TS PASS, scenario design review PASS, runtime enrollment/API tests NOT_RUN by scope, `git diff --cached --check` PASS. No push/PR/merge.
