# R7h-4c — Chọn PostgreSQL qua Desktop và theo dõi source

START16/11/2026 — basebe3f41d đã push, product-mode/task-discipline. User cho phép tiếp tục app/database, commit/push theo checkpoint; formal ML chờ hai VPS riêng. Serving controller schema37/cc8, appPG7/30006 đã qua4jobs/data/metric/operator dump+restore. Không sửa binary/pin đang phục vụ để vượt gate.

| Requirement | Current evidence | State |
|---|---|---|
| Metadata context của source | readProjectConfigurationContext + sameUID CLI project-configuration-context. 11new tests trong PG50 + source44/env27 =121PASS; native Linux actual SSHD/CLI7checks nonce5aa41df3e00a PASS/cleanup. ENV-before-DB/DB-before-ENV/DB-only, original basis, no secret/write/job; authority drift/wrong key/caller transaction refused. Private bundle00ecf95, không serving | PASS |
| Root admin/CLI có kiểu rõ | Allowlist PG operations, exact artifact/payload pins, sameUID/schema37, bounded metadata/safe error/timeout; không public admin port hoặc implicit migration | OPEN |
| Main durable PG intents | Derive scope từ registered project, prepare/send/check/list/cancel với authenticated body/UUID/CAS; unknown chỉ lookup, binding/profile drift bị chặn; không fake ENV receipt | OPEN |
| Source phối hợp ENV+DB | currentContext chỉ theo receipt do Main sở hữu; source/readiness/first-deploy và ENV sau DB, DB sau ENV hoạt động; inherited refs không bị nhầm request UUID | OPEN |
| IPC/UI | Đồng bộ contract/IPC; chọn DB có confirm và trạng thái trung thực, explicit instance context; không credentials/host paths từ renderer | OPEN |
| Gates và phục vụ | Focused/full/types/lint/build/native admin+Main/actual GUI; candidate phải qua gates mới approve/nâng controller, giữ7app/DB/data; checkpoint/push/Kim coauthor | OPEN |

R7h-4b2 operator/app acceptance gates đã PASS và pushbe3f41d; trạng thái gate ledger cũ được hoàn tất bởi remote HEAD đó. Chưa gọi toàn database feature hoặc release DONE. Bước c1: context readonly cùng kiểm thử, sau đó Root admin/Main intent/UI và rollout riêng có gate.

UPDATE16/11 — c1 foundation: readonly configuration context theo registration basis, canonical plan/repo/root/ref giữ nguyên, current env/DB refs xác minh bằng encrypted vault và immutable bindings. DTO phân biệt prepared/selected, không ready/provisioned claim hay permission adopt source; Main phải xác thực journal riêng. Preflight nhận authority-only type để không bịa artifact/path trong metadata review. CLI có exact37/sameUID/known key/no initializer, readonly SQLite. Native5aa41df3e00a7checks +121focused/types/scopedlint PASS. Test đầu env-before-DB dùng CASgen1 cũ sau khi env đã chuyển gen2 nên fail; fixture sửa theo actual current, không nới source guard. Full/build đang chạy; chưa Root admin/Main/IPC/UI/approval/catalog/VPS mutation.

HANDOFF-LOCAL16/11 — c1 readonly metadata foundation PASS:121focused, full2591PASS+2existingLinuxSKIP/0FAIL/180files, build/typecheck/scripts/live-entry/changedESLint0warnings/diff PASS. Linux production CLI with actual privateSSHD7checks/cleanup PASS5aa41df3e00a/privatepayload00ecf95. No serving descriptor/candidate approval, Root admin/Main durable journal/IPC/UI still OPEN. [Proof](../ui-redesign/r7h4c1-verification.json). Normal checkpoint/push/Kim coauthor rồi tiếp tục c2, không chờ user.
