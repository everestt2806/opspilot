# R7h-3e1 — Retained target helper upgrade review

START 15/11/2026 — Base25c8f7f. Product-mode, task-discipline. Checkpoint đầu tiên của explicit helper updater: CLI quản trị chỉ đọc, không phải apply hoặc quyền dispatch. App cũ cần nâng helper trước khi chọn env; không tự re-enroll hoặc thay historical pin. Không VPS mutation trong checkpoint này. Giữ personal files; normal commit/push và Kim coauthor, không PR/merge/reset/clean/stash/rebase/force.

| Requirement | Change / required evidence | State |
|---|---|---|
| Exact supported upgrade review | Pin verified destination bundle; authenticated stored and remote source enrollment; chỉ runtime eb5c→f591 cho Express hoặc98b0→f591 cho Express/SPA/Next, guard khác giữ nguyên; unknown/downgrade/tamper bị chặn | PASS |
| Authority and quiescence | Paused Product owner/current target + source/enrollment/deployment snapshot trước/sau SSH; active/unknown jobs, attempts, leases, unsettled terminal, prepared activation/experiment từ chối. Review không cấp apply capability | PASS |
| No mutation or secret output | Không enrollment begin/complete, không create/rotate key, không ghi SQL/remote helpers; credential/HMAC key chỉ existing store→RAM→bounded stdin, zero/disconnect finally. Output hashes/metadata only | PASS |
| Independent CLI and gates | Production CLI command bounded stdin; focused negative/race/cleanup tests, Linux CLI + actual SSH/SQLite lab; full app tests/types/scripts/lint/build/diff và portable proof | PASS |
| Handoff | Board/FR/master/HANDOFF ghi đúng scope, explicit journaled apply/recovery và real VPS rollout vẫn OPEN; checkpoint commit/push | PASS |

Design decision: dùng bootstrap `inspect` hiện có để xác minh exact historical helper bytes/HMAC mà không gọi repository.begin/complete. Review hash là snapshot để người quản trị đọc, không phải capability hoặc consent token. Apply sau này phải có contract/journal, acquire enrollment + runtime locks, recheck authority và recovery; không dùng review để mở đường overwrite trong normal enroll.

UPDATE15/11 — Production CLI `review-target-helper-upgrade` kiểm exact controller035 trước khi mở readonly SQLite, không qua normal migration/bootstrap opener. Focused41tests/3files PASS, gồm22newtests:4forward pairs, invalid/current/unknown guards, paused/job/worker/activation/experiment/unknown attempt/unsettled execution, stored+remote HMAC, before/after SSH race, sanitized exceptions và key zero/close. Fixture test đầu gặp NOT NULL provenance do setup sai; đã giữ explicit provenance khi unpause và rerun PASS. Không sửa production schema/guard để làm test xanh. Native four-pair retained runtime + full quality gates đang chạy. Review chỉ xác minh enrollment/material và SQL quiescence tại thời điểm kiểm tra; không giữ runtime exclusive lock và không phải chứng nhận quiescence cho apply.

## Independent CLI

`node <verified-controller-artifact> review-target-helper-upgrade --data-dir <private-controller-dir>`

Bounded JSON stdin theo `docs/contracts/product-target-helper-upgrade.ts`: trusted destination artifact + independent manifest pin và exact retained manifest lấy từ inventory hiện hữu. Không gửi SSH password/key hoặc env values trong command args/input; CLI lấy existing encrypted credential và runtime key trong store riêng. Stdout chỉ metadata/hash, `apply_available:false`. Exact schema035 cần được upgrade theo protected controller installer riêng trước; review không tự migrate DB. Command hiện có ở source/private lab candidate, chưa được approve catalog/install trên VPS.

## Next checkpoints

1. R7h-3e2: contract và durable apply/recovery journal. Explicit administrator consent neo review; source/target/owner/source-generation/enrollment revision CAS. Giữ lịch sử old/new manifest và receipt; không overwrite normal enrollment hoặc rotate key.
2. R7h-3e3: target apply giữ enrollment + runtime exclusive locks, exact approved bytes, fsync/journal/crash recovery và authenticated post-proof; SQL chỉ cập nhật current pin khi remote outcome đã chứng minh. Lost reply không replay write; mọi unknown chặn dispatch. Linux SIGKILL/race/tamper gates trước UI hoặc VPS.
3. R7h-3e4: Main/UI explicit review/confirm, approved release/Root+Main gates và fresh VPS attestation. Upgrade từng app cũ, giữ key/fence/container IDs rồi env deploy/rollback thật; không gọi lại record3b/3d đã PASS. Managed DB/PG, ML/report và final packaging/demo vẫn là các mục release riêng.

## HANDOFF-LOCAL15/11 — R7h-3e1

Status: DONE cho **local admin readonly upgrade review**, CHỜ REVIEW. Không claim helper updater/apply đã hoàn thành hoặc installed controller đã có command mới. Không accepted exceptions. Normal checkpoint commit/push, Kim coauthor; không PR/merge.

| Ledger cuối | Current-session evidence | State |
|---|---|---|
| Exact transition + authentication | Four native pairs: Express eb5c và98b0, SPA/Next98b0 → f591; exact SQL pin + retained manifest/helper bytes + persisted/remote HMAC. Current/unknown/other guard/runtime rejected. No normal enroll overwrite | PASS |
| Authority/quiescence | 22new unit tests gồm pause/job/worker/prepared activation/experiment/unknown attempt/unsettled runtime, stored/remote tamper, before-packet/after-proof authority CAS. Không giữ transaction qua SSH, không cấp mutation authority | PASS |
| Readonly / cleanup | Native CLI40checks/8fixture apps: repeat stable output, all SQL rows + retained key/helper/receipt/manifest/marker digests unchanged, wrong manifest/remote receipt/unpaused rejected. Existing store key load-only, zero/disconnect finally; output metadata only. Native tamper là fixture riêng có restore đúng bytes trước runtime | PASS |
| Regression / required gates | Focused41tests/3files PASS; full178files/2493PASS,2existingLinux-onlySKIP,0FAIL. Types Node/Web/scripts,eslint0warnings,format,build,diff đều exit0. Four retained suites28attempts,cold recovery,unknown barrier,no replay/cleanup PASS | PASS |
| Handoff / scope | Board/FR/master/HANDOFF cập nhật, portable source/raw hashes và normal checkpoint push. Public HTTP cả6VPSports200; không SSH,VPS mutation,release catalog/install/schema/helper change | PASS |

Native retained records: d6e2e6e35b13 /7d6afc908d01 /ae85b6e8ff31 /07b61b83bce3. Review records `app/.out-scripts/r7h3e1-native-{express-original,express-r7b,spa-r7b,next-r7b}.json`. Review chỉ đọc trước khi runtime fixture có job; sau đó existing lab chạy deploy/rollback/cold recovery thật với retained material. Không gán runtime attempts đó thành helper apply tests. Exact private candidate payload4873fae4; không approve hoặc install candidate này lên VPS. Portable [proof](../ui-redesign/r7h3e1-verification.json) embeds metadata observations và23raw file hashes, source hashes normalizedLF. Full suite có jsdom canvas/pseudo-style diagnostics như baseline, không có assertion fail; lint0warnings riêng.

Next: R7h-3e2/3e3 journaled explicit apply/recovery với runtime exclusive lock và source/enrollment revision fencing, sau đó Main/UI/Root+Main approved rollout/fresh VPS attestation. Không dùng review_sha256 như consent/capability hoặc bỏ qua gate env capability của app cũ. VPS giữ releaseeb08d06/schema35,6apps; fresh SSH attestation trước mọi mutation tiếp. PG/ML/packaging/demo vẫn OPEN.
