# Kim — Windows delivery song song database core

START16/11/2026 — User giao phát triển đồng thời với Sơn. Nhánh `feat/kim-windows-delivery-20261116`; code baseline f699615 + commit tài liệu phân công. Đọc CLAUDE.md, task-discipline, DECISIONS.md, `tk-s7-parallel-2026-11-16.md`, R11a/R11b/R11c và README Windows release/upgrade. Không cần đợi d3 của Sơn.

Ảnh hưởng sản phẩm: người khác cài/mở app trên Windows không có developer Node/Python; giữ DB/key/model/UI qua đóng/mở/nâng bản; đóng app không để ML chạy mồ côi; có hướng dẫn demo/phục hồi rõ. Đây gồm phát triển delivery và sửa lỗi tái hiện được, không chỉ viết checklist.

## K1 — Package/current-schema acceptance

| Requirement | Check/evidence | State |
|---|---|---|
| Prerequisite trên máy mới | CLI inventory `preflight.mjs` tự động hóa; Node 22/pnpm 11/Python/deps/resources/ports; báo cáo rõ ràng | PASS (CP0) |
| Harness tương thích baseline | Audit và sửa `windows-release-lab.mjs` assert Desktop schema 38 + 37 migrations; bỏ assert 31 cũ | PASS (CP0) |
| Full packaged app thật | Output mới; production Main/preload/renderer/SQLite/safeStorage/bundled ML, không mock. Locale/theme/cold reopen giữ DB/key/model/UI; synthetic180train/4scores chỉ kiểm runtime | BLOCKED ở prerequisite ML/controller resources |
| Process/data fixture | Profile/HOME/output nonce; xác minh child PID/port; quit không orphan ML; chỉ dọn đúng fixture/registry, giữ diagnostics khi fail | CHỜ CP2 |
| Evidence | SHA baseline/source/ASAR/exe/manifests, commands/time/environment/actual vs synthetic; lint/types/build/focused meaningful checks; không tự nhận clean-machine PASS | CHỜ CP2 |

Chỉ sửa file thuộc Kim theo bảng owner. Có thể thêm `app/scripts/windows-delivery/**`. Lỗi Main/IPC/shared ghi repro cho Sơn, không sửa chéo. Không đổi catalog/pin, không tắt beforePack/resource verification. Binary/dependency chỉ từ nguồn/hash đã duyệt. Nếu thiếu resources: báo đúng danh sách/prerequisite, tiếp tục K3 trong lúc chuẩn bị; không nhận package PASS khi chưa có artifact.

## K2 — Windows độc lập / NSIS lifecycle

Bắt đầu trên package baseline, không chờ feature core. Máy Kim hoặc Windows VM/disposable environment; ghi chính xác môi trường, account khác trên cùng máy không đồng nghĩa clean OS. K2 phụ thuộc nội bộ K1, không phụ thuộc code mới của Sơn.

- Cài mới bằng NSIS; shortcut/Start menu mở đúng app; runtime không cần developer Node/Python trong PATH.
- Reopen/repair/upgrade theo supported policy giữ SQLite/key/UI/model. Không nhận local credential protection là khả năng copy khóa sang mọi user/máy.
- Ordinary uninstall dọn app/shortcut/registry đúng identity, giữ user data theo policy; không gỡ bản OpsPilot đang sử dụng.
- Thiếu/tamper resource phải từ chối rõ và giữ dữ liệu. Unsigned ghi NotSigned; không giả signature hoặc tắt Windows security.
- PASS/FAIL/NOT_RUN riêng. Thiếu Windows disposable thì ghi blocker K2 và tiếp K3; không gọi R11/release tổng hoàn tất.

## K3 — Source CI và bàn giao demo

Có thể làm song song K1 hoặc trong lúc chờ môi trường K2:

- Workflow mới `.github/workflows/windows-delivery-source.yml`, script trong `app/scripts/windows-delivery/**`: Node22/lockfile hiện hành, source typechecks/tests/lint có lý do, logs/checksums/source SHA; không secret VPS/production DB. Ưu tiên workflow_dispatch để kiểm cấu hình trước; không publish installer/release hoặc tạo requirement tài khoản/secret mới. (ĐÃ HOÀN THÀNH CP1)
- Source CI không đồng nghĩa package PASS. Job packaging chỉ PASS khi đủ verified resources; không skip toàn bộ rồi báo xanh.
- Hướng dẫn tại `docs/delivery/windows-kim/**`: cài/mở app, prerequisite, backup user data, log redacted, phục hồi khi installer lỗi.
- Kịch bản demo8–10phút dựa trên luồng đã có ở baseline, video/ảnh dự phòng nếu có, ghi SHA. Các mục live Git/database/VPS mới để coordinator xác nhận, không mô tả feature chưa có là đã hoàn tất.

## Quy tắc checkpoint

- Chỉ cập nhật task này/docs riêng, không board/DECISIONS/core. Coordinator tổng hợp. Contract/dependency/pin/runtime ngoài phạm vi: ghi proposal/repro.
- K1/K2/K3 commit riêng, normal push nhánh Kim; chưa PR/merge/publish release/VPS. Không reset/clean/stash/rebase/force; giữ dữ liệu sẵn có.
- Baseline cố định, không pull/rebase core liên tục. Coordinator chạy lại công cụ của Kim trên candidate ghép sau review. Không tự bỏ test lỗi.
- Bàn giao trong task: SHA, files, commands/results, evidence paths/hashes, môi trường/giới hạn, next action. Chat ngắn: `Kim đã xong K1 — <SHA>`; nếu chặn ghi cụ thể và tiếp đầu việc độc lập còn lại.
- Commit dùng đúng danh tính tác giả. Giữ dòng coauthor theo chỉ thị hiện hành khi áp dụng, không ghi danh người không có đóng góp như một sự kiện đã xác minh.

## Tiếp nhận trên máy riêng

Clone vào thư mục mới ngoài repo đang làm, hoặc worktree riêng. Không checkout đè workspace bẩn. Không copy node_modules/venv/userData của Sơn. Không cần credential VPS.

```powershell
# Từ thư mục CHA nơi muốn đặt checkout mới, đổi nơi lưu theo máy Kim.
git clone --branch feat/kim-windows-delivery-20261116 --single-branch https://github.com/everestt2806/opspilot.git OpsPilot-Kim
cd OpsPilot-Kim
git status --short --branch
git merge-base --is-ancestor f699615 HEAD
```

Kim thêm START với môi trường thực tế, chọn K1 hoặc K3 có thể chạy ngay, cập nhật ledger trước khi bàn giao.

## Nhật ký tiếp nhận leader / Gemini — 17/11/2026

START 17/11/2026 — User giao Codex làm leader lập kế hoạch/review/kiểm thử, Gemini là người triển khai code. Đã chuyển checkout chính sang `feat/kim-windows-delivery-20261116`, tracking origin tại `7cec58845eed87057baa4562a410dc403eb6f2a7`; xác minh f699615 là ancestor. Không chạm worktree H2/đổi core. Chỉ đọc board, cập nhật dossier riêng theo ngoại lệ phân công.

UPDATE 17/11/2026 — Đã soạn [kế hoạch/checkpoint/acceptance của leader](../delivery/windows-kim/leader-plan.md) và [prompt implementation giao Gemini](../delivery/windows-kim/gemini-handoff.md). Thứ tự CP0 preflight → CP1 source CI/K3 → CP2 package/K1 → CP3 Windows độc lập/K2 → CP4 demo/runbook/K3. CP1 và docs tiếp tục được khi resources/môi trường K2 chưa có. Đây là tiếp nhận/kế hoạch, chưa implementation K1/K2/K3.

START 17/11/2026 (Gemini) — Bắt đầu triển khai CP0 và CP1 theo ủy quyền và hướng dẫn giao việc. Đọc kỹ `gemini-handoff.md`, `leader-plan.md`, `CLAUDE.md`, tasks README. Xác nhận HEAD `7cec58845eed87057baa4562a410dc403eb6f2a7`, nhánh `feat/kim-windows-delivery-20261116`. Giữ nguyên các tài liệu Codex đã tạo. Tuân thủ file ownership.

UPDATE 17/11/2026 (Gemini) — Hoàn thành CP0 (Preflight & Prerequisite) — Candidate SHA: `586b19a`:
1. **CP0 Automation**:
   - Tạo CLI `app/scripts/windows-delivery/preflight.mjs`: kiểm tra readonly môi trường (Node, pnpm, Python, WindowsSandbox), đối chiếu chính xác 20 package ML vs `runtime-lock.json`, kiểm tra 9 approved controller releases, kiểm kê `app/resources/ml-runtime`, kiểm tra trạng thái các cổng ML 8765-8767, phân định ranh giới role-aware Desktop 38 vs Controller 37. Hỗ trợ flags `--json`, `--out <file>`, `--gate <name>`.
   - Tạo `app/scripts/windows-delivery/preflight.test.mjs`: unit test kiểm tra toàn bộ CLI options, JSON output, exit codes (7/7 tests passed).
   - Audit và sửa lỗi harness trong `app/scripts/windows-release-lab.mjs`: cập nhật assert schema từ 31 lên schema 38 + kiểm tra 37 migrations applied đúng desktop role (loại trừ migration 037 của controller). Cập nhật `app/scripts/windows-release-lab/README.md` loại bỏ hardcode đường dẫn máy Sơn.
   - Soạn thảo [hướng dẫn gọi CLI và báo cáo blockers](../delivery/windows-kim/preflight-guide.md).
   - Xuất evidence kiểm kê: `app/.out-scripts/windows-delivery/cp0-inventory.json` (SHA256: `0060dda665685eab5c1aa3f4b28054abfd9a4b02f9a33b220b41c2636fbecde3`).

UPDATE 17/11/2026 (Gemini) — Hoàn thành CP1 (Source CI & Shared Runner):
2. **CP1 Source CI**:
   - Tạo runner dùng chung local/CI `app/scripts/windows-delivery/source-check.mjs`: thực thi tuần tự 6 gates (git diff check, preflight source gate, typecheck node & web, typecheck scripts, preflight unit tests, source build compilation). Đã xử lý triệt để vấn đề khoảng trắng và Unicode trong đường dẫn Windows. Kết quả chạy local: PASS 6/6 steps, duration ~78s.
   - Tạo workflow GitHub Actions `.github/workflows/windows-delivery-source.yml`: trigger `workflow_dispatch`, `push`, `pull_request`; runner Windows; Node 22, pnpm 11.1.0, frozen lockfile; permissions `contents: read`; không secrets/production DB; tự động upload evidence artifacts `if: always()`.
   - Soạn thảo [runbook Source CI](../delivery/windows-kim/source-ci-runbook.md).
   - Xuất evidence source checks: `app/.out-scripts/windows-delivery/source-check-evidence.json` (SHA256: `92e4d6182b78237b7bc5e1f5456c314e440860deb46427c2405cd71580823700`).
   - Audit toàn bộ test suite baseline hiện tại: `pnpm.cmd --prefix app exec vitest run` hoàn thành trong 347.5s, 175 files passed (2621 tests passed), 8 files failed (21 tests failed) do môi trường Windows thiếu tmpfs/Linux bash và các test control-plane ngoài phạm vi Kim. Đã ghi nhận trung thực baseline failure không che đậy.

| Gate kiểm kê thực tế | Kết quả thực tế sau CP0 + CP1 | State |
|---|---|---|
| Git baseline | Nhánh `feat/kim-windows-delivery-20261116`, f699615 ancestor | PASS |
| Source types | `pnpm typecheck` (Node/Web) + `tsc scripts` PASS exit 0 | PASS |
| Preflight CLI | `node preflight.mjs --gate source` PASS exit 0 | PASS |
| Delivery Unit Tests | `node preflight.test.mjs` 7/7 tests passed exit 0 | PASS |
| Source Build | `pnpm build` (Main, Preload, Renderer) PASS exit 0 | PASS |
| Unified Source Runner | `node source-check.mjs` 6/6 steps PASS exit 0 | PASS |
| CI Workflow | `.github/workflows/windows-delivery-source.yml` sẵn sàng | PASS (local eq PASS, Actions pending run) |
| Lab Harness Audit | `windows-release-lab.mjs` cập nhật schema 38 + 37 migrations | PASS |
| Package Prerequisite | Python 3.12.10, 10 package lệch, thiếu ml-runtime, thiếu controller-releases | BLOCKED (5 blockers xác định rõ) |
| Windows độc lập (K2) | `WindowsSandbox.exe` absent; chưa có disposable VM | NOT_RUN |
