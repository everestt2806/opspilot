# TK-S7 G0 — Hợp đồng hai nguồn và lấy snapshot Git công khai

> Quy trình/trạng thái: [README.md](README.md), [board.md](board.md). Task này là lát cắt đầu của [roadmap sản phẩm](../31-lo-trinh-hoan-thien-san-pham.md), [kiểm kê Git](../30-audit-git-first-deploy.md) và [rà soát OpenShip/các PaaS](../32-tham-khao-openship-va-paas-tu-host.md). **G0 không triển khai agent/control plane; việc đó đã được cho phép nhưng có checkpoint Product mode riêng theo ADR-011.**

| Chủ | Hạn mục tiêu | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| Worker | 09/10/2026; mục tiêu, không cắt gate để kịp demo | `feat/deploy-reachability` | Tài liệu này + `docs/30-audit-git-first-deploy.md` | P0 |

## Mục tiêu

Người dùng có thể chọn deploy trực tiếp từ thư mục hoặc từ Git ở G1. G0 tạo hợp đồng dữ liệu/IPC tương thích bản ghi cũ và module lấy snapshot từ **repository GitHub công khai qua HTTPS**, trả full commit SHA bất biến cùng root directory có thể đưa vào detector. G0 chưa nối UI/deploy runtime; không báo tính năng Git đã dùng được trên app.

## Được sửa

- **Pha A, commit riêng trước khi code:** `docs/contracts/ipc-contract.ts`, `docs/contracts/schema.sql`, `docs/contracts/deploy-events.md` khi cần và `DECISIONS.md` để khóa mô hình `local | git`, provenance từng deployment và tương thích dữ liệu cũ; không ấn định số migration trước khi đối chiếu chuỗi hiện có. Tuân thủ quy tắc 10/11 trong `CLAUDE.md`.
- `app/src/shared/ipc.ts`, `app/src/main/db/migrations/`, `app/src/main/db/index.ts` và test migration tương ứng.
- **Pha B sau contract:** module Git mới trong `app/src/main/` cùng test, CLI thử độc lập nếu cần; `app/package.json`/scripts config chỉ khi CLI thật sự yêu cầu.
- Hồ sơ task này và dòng TK-S7 trong `docs/tasks/board.md`.

## Chưa thuộc G0

- Wizard/renderer, `deploy:detect`/precheck/start runtime, live VPS, HTTPS/domain, private Git, webhook, controller Product mode.
- Không thay `app.source_path` local hiện có bằng URL Git hoặc đường clone tạm. Migrate Git app và redeploy được thiết kế ở contract G0, nối/kiểm thử runtime ở G1.
- Không push, mở PR, merge, reset, clean, stash hoặc ghi secret vào test/log/commit.

## Definition of Done

- [x] Contract phân biệt `local | git`; dữ liệu local cũ còn đọc được. Bản Git có URL canonical không chứa credential, ref/root ở app và repo URL/full SHA của từng deployment. Không tạo Git SHA giả cho local. Ghi rõ quyết định nguồn sự thật khi chuyển snapshot sang G1 và cách migrate không phụ thuộc clone tạm.
- [x] Pha A contract/DECISIONS được commit riêng và review diff trước Pha B; mỗi commit độc lập vẫn qua gate liên quan, không để trạng thái code và contract lệch trong cùng checkpoint.
- [x] Snapshot Git công khai: kiểm URL HTTPS GitHub, ref/root; khóa full SHA; checkout vào thư mục riêng; root không thoát snapshot qua `..`/symlink. `spawn` với argv, `GIT_TERMINAL_PROMPT=0`, tắt credential helper; timeout, hủy, giới hạn dung lượng và cleanup. Không chạy submodule/LFS trong lát cắt này.
- [x] Test có fixture/repo local cho đường đúng và ca URL có credential, scheme sai, ref không tồn tại, branch đổi, root traversal, cancel/timeout, clone lỗi, cleanup; test SQLite migration từ schema cũ và case local. Có CLI thử với repo demo công khai đã nêu ở docs/30, không dùng working tree hiện hành làm bằng chứng Git.
- [x] Snapshot commit riêng compile được; lint/typecheck Node/Web/Scripts, test module Git + DB, full Vitest và build pass; `git diff --check` sạch. Nếu gate fail, ghi đúng lỗi và dừng, không tự bỏ gate.
- [x] Cập nhật nhật ký task/board theo quy trình. Commit cục bộ, giữ file công cụ local ngoài Git. Worker chỉ trả cho người dùng câu **“Worker đã xong”**; Leader sẽ tự review SHA/diff/gate trong repo.

## Nhật ký

- PLAN 08/10 — Leader tạo brief sau khi người dùng chốt hai nguồn deploy ngang hàng, Product mode cho phép control plane và demo 14/10 theo bằng chứng thực tế. Worker ghi START khi nhận task.
- START 08/10 — Khóa contract local/Git và DECISIONS trong commit Pha A; sau đó triển khai snapshot công khai, migration/IPC và CLI, chạy đủ gate G0.
- UPDATE 08/10 — Pha A contract/DECISIONS commit `78ebb00`; Pha B thêm migration 007, provenance IPC, snapshot detached full SHA và CLI. CLI public demo trả SHA `8af16e1f9165a31557288adbc23acc420244938f`, root `demo-apps/express-api`. Fixture local xác nhận branch move không đổi snapshot; migration v6→v7 giữ local path và không sinh provenance Git. Gate Node/Web/Scripts typecheck, lint, focused + full Vitest (70 file/641 test), build và diff check PASS.
- HANDOFF-LOCAL 08/10 — Code commit `c4e3823c3b386caeda0be274e611bc8ed28f5079`; chưa push. Node `v24.16.0`, pnpm `11.1.0`. Lệnh đã chạy: `pnpm exec tsc --noEmit --strict --target ES2022 --moduleResolution bundler --module preserve docs/contracts/ipc-contract.ts`; `pnpm exec vitest run src/main/git/snapshot.test.ts src/main/db/index.test.ts` (11 pass); `pnpm test` (70 files, 641 pass); `pnpm lint`; `pnpm typecheck:node`; `pnpm typecheck:web`; `pnpm exec tsc -p tsconfig.scripts.json --noEmit`; `pnpm build`; `pnpm try:git-snapshot https://github.com/everestt2806/opspilot.git main demo-apps/express-api`; `git diff --check`. Tất cả gate pass.

## Lệnh tái hiện

Worker ghi lệnh thực chạy, phiên bản Node/pnpm, SHA và kết quả vào UPDATE/HANDOFF-LOCAL. Không đưa credential hoặc URL có token vào nhật ký.

## PR

Chưa được phép push, mở PR hoặc merge.

- HANDOFF-LOCAL — local `c4e3823` · chưa push; Leader review diff/gate theo quy trình.
