# TK-S7 P1e-5 — external HTTPS probe và xác nhận domain active

> Trạng thái: CHỜ REVIEW. Backend nội bộ; chưa nối IPC/UI/pipeline và không probe VPS thật.

## START 16/10/2026

- Probe từ desktop với hostname/SNI thật, TLS trust mặc định, IP peer ghim theo DNS propagated, healthcheck path lấy từ app DB, giới hạn timeout/attempt/response, không redirect.
- Chỉ ghi active cho production khi DB inventory, runtime generation/config, DNS, SSH identity và probe sau lần kiểm tra lại còn khớp; dùng transaction/CAS.
- Staging/lab không thể kích hoạt production. Failure giữ app/container và URL HTTP hiện có, trả degraded/pending với reason.
- Thêm test TLS server tạm, migration/schema/CAS/idempotency/stale generation; chạy focused, full Vitest, typecheck, build, lint, diff check bằng Node 22.

## UPDATE 16/10/2026

- Added migration 013. Per-binding route/probe records now carry Caddy config generation, inventory revision, certificate/probe environment, peer IP and HTTP status. Existing active rows are demoted because the older schema did not prove production TLS trust or the public peer.
- Added a bounded HTTPS probe: system trust and normal hostname/time checks remain enabled; actual hostname is retained for SNI/Host; connection lookup is pinned to freshly propagated DNS addresses. Timeout is 6 seconds per attempt, at most two attempts, response capped at 16 KiB. Redirects and non-200/invalid JSON health results fail.
- Health response must be non-empty JSON with no explicit unhealthy marker; empty and non-JSON HTTP 200 responses fail closed. Remote reconcile state must explicitly say `environment=production` before production activation.
- Activation coordinator holds the shared per-VPS mutex, checks app inventory and production reconcile observation, pinned SSH identity, Caddy service ownership, config hash and admin API loaded config before and after probing, then rechecks DNS and calls repository transaction CAS. It rejects changed host/generation/inventory and peer IP mismatches.
- Failed production probes record degraded/failed status with existing typed reason codes; app/container and current HTTP URL are untouched. Same-generation/same-config reconcile preserves existing active/probe evidence; changed environment/generation/config resets it. Staging result is never accepted as production evidence.
- Local TLS tests create and remove short-lived CA/server keys at runtime; no key/certificate is committed. The lab trust path is tagged `lab` and activation refuses it. The system trust success case is covered at coordinator level with a controlled adapter; live public production certificate test is NOT_RUN.
- VPS, Caddy service, DNS, external network probe, IPC/UI/pipeline: NOT_RUN by scope.

## HANDOFF-LOCAL

- Final current-source gates (Node 22.23.3): focused TLS/activation/repository/migration tests PASS (32/32); full Vitest PASS (965 passed, 2 skipped, 87 files: 86 passed/1 skipped); typecheck PASS; build PASS; full ESLint exit 0 with 6,856 warnings and no errors (warnings remain; lint is not warning-free); `git diff --check` PASS.
- The full suite initially hit the default 10-second hook limit while OpenSSL generated the temporary TLS fixture under full-suite load. The fixture setup timeout is now 60 seconds; focused and full suites both pass with the adjustment.
- Public VPS/DNS/HTTPS probe, live Caddy, IPC/UI/pipeline: NOT_RUN by checkpoint scope. Local TLS server uses temporary runtime-generated certificates/keys; no key is tracked.
- Local commit created; task remains CHỜ REVIEW. No push/PR/merge.
