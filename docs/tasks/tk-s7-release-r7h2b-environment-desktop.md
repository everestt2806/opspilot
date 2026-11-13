# R7h-2b — Nhập cấu hình Product từ Desktop

START 14/11/2026 — Base `128ba1b`, product-mode/task-discipline. Nối CLI staged config vào admin bridge → Main → typed IPC → UI write-only. Không bật deploy env/DB/source activation trong checkpoint này. User cho phép implementation, commit và normal checkpoint push/Kim coauthor; không PR/merge/force/reset/clean/stash/rebase, không production profile/VPS write hoặc thay installed pins trong local gate.

| Yêu cầu | Gate | State |
|---|---|---|
| Context/admin transport cố định | Controller derive target từ app/expected owner/source/security revision; stdin streaming bounded, exact error codes/metadata-only, binding fences và old release không được giả hỗ trợ | PASS |
| Durable Main intent và bảo mật | Desktop-only migration mới; OS-safe desktop cipher bảo vệ toàn snapshot để cold retry cùng UUID/body, không plaintext/digest secret; CAS, quyền ghi trước/sau await, response correlation và unknown→lookup | PASS |
| Typed IPC và UI | Nhập runtime/public scope, public warning, staged-only status, không secret readback/localStorage; retry/reconcile/cancel đúng trạng thái, stale replies/unmount/binding và 4 locale | PASS |
| Kiểm chứng/bàn giao | Focused failure/crypto/journal/UI tests, CLI native và Electron thực/private profile, types/lint/build/full tests; board/FR/master/HANDOFF/proof cùng commit/push | PASS |

Điều chỉnh so với ghi chú 2a: local journal giữ metadata **và ciphertext snapshot**, không chỉ UUID/context. Không lưu plaintext body hoặc digest của secret. Lý do: cold retry phải giữ chính xác body để tránh dead end khi server chưa có receipt hoặc thay body cho UUID cũ; dùng cipher Desktop hiện có, envelope purpose + immutable intent binding, không dependency/key mới. UI không nhận ciphertext/value đọc lại. Snapshot giữ encrypted trong lịch sử để chứng minh replay; retention có task vận hành riêng. Thay đổi này nằm trong scope config production user đã cho phép, không đổi chính sách Desktop deploy .env cũ.

Root bridge chỉ bổ sung operation cố định trong source mới. Installed release/pins cũ giữ nguyên và vẫn có thể từ chối capability; local PASS không thay release/schema-upgrade/backup/live gate. Controller source max033, Desktop-only034; không chạy migration Desktop trên controller. Luồng mới tạo staged revision, không deploy/active/source/policy/job mutation.

UPDATE 14/11 — Đã nối context derive tại controller (app/owner/source/target-security CAS), ba fixed admin operations, bounded Python stdin streaming cho body lớn và exact error-code allowlist. Main có prepare/send/check/list/cancel với encrypted immutable snapshot, pending uniqueness, beforeSend/current binding và scope guards sau await; read-only project snapshot hỗ trợ synchronous transaction của journal nhưng giữ guard transaction của API cũ. Sáu IPC được đồng bộ contract/shared/handler; UI bốn locale runtime password/public build warning, whole-snapshot consent, form reset sau prepare, unknown→check/same-UUID retry. Không source activation hoặc env/DB execution.

UPDATE 14/11 — Focused cuối 298 PASS/13files (gồm detector CLI thực). Native admin `b3672c83266e` PASS7checks: large stdin qua Python→CLI thật, derived context, safe conflict code, cold retry/two-process race và receipt/key/authority guards; private scratch dọn. Native vault `9880be452d60` PASS5checks/cleanup. Electron `c577a5cf4ea5` PASS4checks/13captures, Main service+production preload/private SQLite thật với synthetic SSH/controller transport; cold DB/Main recreation dùng cùng cipher trong process, không claim full OS/DPAPI restart hoặc SSH/VPS gate. Đã xem ảnh vi dark/light và saved state; layout không cuộn ngang. Final full đang chạy sau shared DTO fix; chưa gọi PASS trước kết quả.

Các lỗi trong quá trình kiểm chứng và sửa:

- Fixture prepare thiếu await khiến các test Main không khởi tạo được; đã sửa, test Main/UI mới đạt 24/24. Các thư mục fixture thất bại được xác minh chỉ có host `controller.test`/`target.test`, 0intent/0job rồi dọn, không đụng profile thật.
- JSX thiếu một brace, locale key phải `jp`, test close button trùng icon và AntD chèn khoảng trắng giữa hai chữ CJK: sửa source/test phù hợp; không bỏ locale hoặc check.
- ESLint bắt control regex, unused imports/return type; sửa hoặc dùng charCode validation. JS runner không còn unused disable. Python dùng bounded exception tuple thay blind catch.
- Electron cleanup profile khi process còn chạy bị Windows khóa DIPS. Parent runner dọn chính xác nonce/profile sau process close; private DB đóng/xóa trước. Lượt giả định localStorage phải rỗng sai vì UI preferences hợp lệ; thay bằng kiểm không chứa secret/key env, không tắt persistence của sản phẩm. Failed captures/private profiles đã dọn đúng phạm vi.
- Full trước có 2334 PASS/10 SKIP nhưng 1suite FAIL: shared DTO re-export contract ngoài scripts rootDir khiến 8 detector CLI tests không chạy. Chuyển thành shared DTO copy có parity contract; script typecheck và detector thực đã PASS, final full phải chạy lại. Không tăng skip hoặc nới rootDir để né lỗi.

## HANDOFF-LOCAL 14/11 — DONE local R7h-2b / CHỜ REVIEW

- Requirement ledger cả 4 hàng PASS trong phạm vi local đã chốt; không accepted exception. Installed rollout/upgrade và env execution vẫn task sau, không phải gate bị miễn.
- Final full `pnpm.cmd --prefix app exec vitest run --maxWorkers=3`: 2342 PASS+2 existing Linux-only SKIP, 169 files PASS+1 SKIP, 0 FAIL; raw `app/.out-scripts/r7h2b-full-final2.log`. Focused 298 PASS/13files, raw `r7h2b-focused-final.log`.
- `pnpm.cmd --prefix app build` PASS; Node/Web/Scripts/lab `tsc --noEmit`, ESLint/Prettier/Ruff/syntax và CLI thiếu consent exit2 PASS. Exact SQL032/033/034/shared DTO/6IPC parity và staged source/raw/capture hashes gate đạt.
- Native admin `b3672c83266e` PASS7, vault `9880be452d60` PASS5. Electron `c577a5cf4ea5` PASS4/13captures; ảnh VI dark/light và saved state đã xem; synthetic SSH/controller transport được ghi rõ. Private DB/profile/fixtures đã dọn; không VPS hoặc production profile.
- [Proof](../ui-redesign/r7h2b-verification.json), [Electron runbook](../../app/scripts/product-environment-desktop-lab/README.md), [CLI runbook](../../app/scripts/product-environment-admin-lab/README.md). SHA bằng `git log -1 -- app/src/main/controlPlane/desktopProductEnvironment.ts`; normal checkpoint push/Kim coauthor, không PR/merge.

## Bước tiếp theo

R7h-3 cần bind encrypted config revision vào source generation/claim, activate có CAS và quiescence; render runtime/public build đúng scope, redact build/runtime errors, rollback và restart giữ đúng config. Trước VPS cần supported schema029→033 backup/upgrade/rollback policy, protected controller/installer release mới và native actual SSH/admin gate; không mở allowlist/pin hoặc bỏ schema guard của bản đã cài để né acceptance. Sau native/release/live config mới mở UI readiness env deploy. R7h-4 PostgreSQL/data/backup/restore giữ nguyên scope. Toàn env/DB/R7 và release còn OPEN.
