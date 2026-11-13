# R7h-2a — Quản trị revision cấu hình qua CLI cố định

START 14/11/2026 — Base `179bb5a`; product-mode/task-discipline. R7h-2 được chia 2a backend CLI có idempotency bền và 2b Main/IPC/UI write-only. Lý do: mất reply khi gửi secret không được tạo revision trùng; cần chứng minh transaction/receipt và cold retry trước khi nối UI. User cho phép tiếp tục implementation và normal checkpoint push/Kim coauthor. Không PR/merge/force/reset/clean/stash/rebase, không VPS hoặc production DB trong slice này.

| Yêu cầu | Kiểm chứng | State |
|---|---|---|
| Contract/admin CLI cố định, không giá trị trong reply | Hai command stage-project-environment/project-environment-state, strict payload, same-UID administrator từ OS, stdin bounded/no argv-env secret, mã lỗi cố định | PASS |
| Idempotency nguyên tử và bảo mật | Migration mới receipt mã hóa; CAS/source/owner/target guards; retry cùng key/body trả revision cũ, key khác body từ chối; commit vault+receipt cùng transaction; mất key/tamper không lộ secret | PASS |
| Gate và bàn giao | Focused file-backed/cold retry/race/failure tests, CLI Linux với SQLite/key thật và cleanup, types/lint/build/full regression; board/FR/master/HANDOFF/proof cùng commit | PASS |

Không đổi migration032 đã commit, không plaintext digest của request có secret; dùng encrypted envelope có purpose/scope/admin/request/revision binding để so sánh replay. Staging không activate source/policy/job hoặc mở no-env/noDB pipeline guards. Không thêm HTTP endpoint, installed-root bridge allowlist/pins, Main/IPC/UI trong 2a; cần revision-aware rollout và bridge trong 2b trước khi app người dùng gọi được. R7h-2b/3/4 và toàn env/DB/R7 còn OPEN.

## Kế hoạch gate

UPDATE 14/11 — Thêm contract hai command, migration033 receipt mã hóa và atomic stage/lookup. Ciphertext receipt ràng buộc purpose/controller/administrator/request/app/owner/revision/time và normalized body, không plaintext request/digest. Retry cùng UUID/body trả metadata revision cũ, kể cả đã có revision mới; source/target/owner hiện hành vẫn phải hợp lệ. Sau đọc/decrypt và trước commit recheck authority; authenticate receipt vừa ghi trước trả thành công. Không callback crypto nào được đổi source giữa chừng rồi commit.

Focused đầu 97 PASS; rà soát bổ sung hai ca source đổi trong decrypt và output receipt cipher sai, lượt kế tiếp focused 99 PASS/5files. Native CLI đầu PASS5, bổ sung cạnh tranh hai tiến trình CLI thật, lượt sau PASS6; sau source chỉnh cuối phải chạy lại native/build/full. Typecheck phát hiện fixture truyền role vào vị trí tham số version của runMigrations; lần sửa truyền controller đúng vị trí lại bị role fence chặn vì DB fixture là Desktop. Đã dùng `runMigrations(db)` đúng role fixture, không nới production fence. Không gọi type/full cuối PASS trước kết quả, không phát sinh lỗi sản phẩm đã rollout vì slice chưa rollout.

- Focused vault/admin/migration/CLI tests; cạnh tranh hai kết nối và crash/lost-reply bằng cold process retry.
- Native Linux Node22, SQLite file-backed + controller key thực, gọi CLI bằng stdin, stdout/stderr chỉ metadata/error code, không Docker/SSH/VPS; xóa đúng private scratch sau gate.
- Node/Web/Scripts/lab typecheck, scoped lint/format, production build, full Vitest, diff/contract parity/hash/link/secret review.
- Không gọi config deploy/PostgreSQL/GUI/release gate PASS từ CLI proof.

## HANDOFF-LOCAL 14/11 — DONE scoped R7h-2a / CHỜ REVIEW

- Hai command CLI cố định nhận stdin, administrator từ UID, strict input và metadata-only output đã đạt. Không expose qua installed root bridge/HTTP/Main/IPC/UI trong checkpoint này.
- Atomic revision+encrypted receipt, replay/canonical body, CAS hai kết nối, namespace principal, immutable/tamper/error rollback, source thay trong decrypt và receipt authentication: 24 test mới đạt; focused tổng 99 PASS/5files.
- Native `ea7b0feb647a`: 6 checks PASS, gồm hai tiến trình CLI thật cạnh tranh cùng UUID, cold process retry, ciphertext/authority/key/tamper, private scratch đã xóa. Vault regression native `195e214d891f`: 5 checks PASS/cleanup. Không SSH/Docker/VPS/profile thật.
- Full cuối 2315 PASS+2 existing Linux-only SKIP, 167 files PASS+1 SKIP, 0 FAIL. Lượt trước 2314 PASS+1 FAIL do role fixture, đã sửa đúng Desktop role rồi chạy lại; không nới role fence. Node/Web/Scripts/lab typecheck, scoped ESLint 0 lỗi/0 cảnh báo, Prettier/build/parity/syntax/negative CLI đạt. Không có accepted exception.
- Schema source Desktop/controller 033; controller không chạy 030/031. Installed development VPS vẫn029/releaseb680, không đổi pins/installer/helper/template/dependency. Chưa env-enabled deploy/PostgreSQL hoặc whole R7/release claim.
- Board/FR/master/HANDOFF và [proof/source/raw hashes](../ui-redesign/r7h2a-verification.json) cùng checkpoint. SHA tra `git log -1 -- app/src/main/db/migrations/033_product_environment_request.sql`; normal push được phép/Kim coauthor, không PR/merge.

## Gate tái hiện cuối

- `. ./tools/enter-node22.ps1`: Node22.23.3/pnpm11.1.0.
- `pnpm.cmd --prefix app exec vitest run src/main/db/productEnvironmentAdmin.test.ts src/main/db/productEnvironmentRepository.test.ts src/main/db/migrationRoles.test.ts src/main/db/index.test.ts src/main/db/productMigration.test.ts --maxWorkers=2`: 99 PASS, raw `app/.out-scripts/r7h2a-focused-final3.log`.
- `pnpm.cmd --prefix app exec vitest run --maxWorkers=3`: 2315 PASS+2 SKIP, raw `app/.out-scripts/r7h2a-full-final.log`.
- `pnpm.cmd --prefix app build`: Node/Web typecheck và production build PASS, raw `app/.out-scripts/r7h2a-build-final.log`; Node typecheck sau fixture cuối ở `r7h2a-node-type-final.log`.
- `pnpm.cmd --prefix app exec tsc --noEmit -p tsconfig.scripts.json` và `-p scripts/product-environment-admin-lab/tsconfig.json`: PASS, raw `r7h2a-scripts-type.log`/`r7h2a-lab-type.log`.
- Scoped `eslint`/`prettier --check` cho các file TS/JS đổi: PASS, raw `r7h2a-lint-final.log`/`r7h2a-format-final.log`. `node --check` cả hai runner PASS; admin runner không consent trả exit2 trước scratch, raw `r7h2a-negative.log`.
- [Native admin CLI runbook](../../app/scripts/product-environment-admin-lab/README.md), raw `app/.out-scripts/product-environment-admin-lab/ea7b0feb647a/result.json`; [vault runbook](../../app/scripts/product-environment-lab/README.md), raw `app/.out-scripts/product-environment-lab/195e214d891f/result.json`.
- Contract SQL032/033 exact parity, hashes/relative links/staged secret review/diff check trước commit. Sửa dòng quyết định R7h-1 bị mất dấu tiếng Việt, giữ nguyên ý nghĩa quyết định đã chốt.

## Tiếp theo

R7h-2b: contract cố định cho installed bridge/Main/IPC và UI write-only; local durable intent chỉ giữ UUID/context, không plaintext value/digest. Khi outcome unknown tra metadata receipt bằng UUID trước khi retry; không tự đổi UUID hoặc thay body. Recheck binding/current SSH/source/revision và stale UI replies. Controller release/schema032–033 phải qua upgrade/backup gate, không mở allowlist cho release cũ. Sau đó R7h-3 claim-bound source activation/executor/render/config rollback/native/live, R7h-4 PostgreSQL với data/backup/restore. Toàn bộ env/DB/R7 vẫn OPEN.
