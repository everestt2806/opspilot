# Review, tích hợp PR #33 và #34 — 05/11/2026

START 05/11 — User yêu cầu merge các PR đang mở rồi kiểm kê phần còn thiếu. Leader nhận review, sửa lỗi chặn tích hợp và merge theo thứ tự #33 → #34. Không deploy VPS, không sửa production DB hoặc dữ liệu experiments. Giữ file cá nhân/untracked và nhánh H1 local cũ.

## Đầu vào

- Main trước phiên: `bc9b005`; PR #33 head `d1ad3cc`, PR #34 head `072ff82`.
- #34 bao gồm #33; H2 chỉ là checkpoint PARTIAL và CLI còn polling-only.
- GitHub không có CI checks cho hai PR. Dùng kiểm chứng source/integration cục bộ; không bỏ qua protected check/review nếu GitHub yêu cầu.
- PR #34 tự ghi Ruff còn 38 diagnostics trên 5 file và thiếu full runtime pinned SSH/Docker/collector/crash matrix. Phải phân biệt lỗi chất lượng có thể sửa với chức năng chưa hoàn tất.

## Requirement ledger

| Yêu cầu | Bằng chứng / hành động | State |
|---|---|---|
| Review diff, phụ thuộc, caller/contract và gate hai PR | #34 kế thừa #33; local git diff do GitHub >300 file. Graph chỉ tham khảo, dùng source/rg xác minh caller/contract | PASS |
| Sửa lỗi chặn tích hợp, giữ runtime executor mặc định tắt | Ruff sạch; Vitest/Node discovery, fixture poller, CLI migrations, H2 preflight và tmpfs lab đã sửa; CLI vẫn polling-only | PASS |
| Merge #33 rồi #34, không force hoặc mất dữ liệu local | #33 MERGED tại `267915369cd48d62375cfcd5ef9a3497d9670154`; #34 đang cập nhật nền và gates | IMPLEMENTED |
| Kiểm chứng nhánh tích hợp/main | Node 22 typecheck/build/full Vitest, Python 365/365, QA 25/25, controlled 23/23 và Docker health 5/5; xác minh tree sau merge | IMPLEMENTED |
| Kiểm kê phần còn thiếu, task/ưu tiên/checkpoint rõ | [Danh sách N1–N10](tk-s7-next-checkpoints-2026-11-05.md), hai luồng runtime/ML và gate demo/release | PASS |

## Nhật ký / kết quả

- Đang review trên branch riêng `review/pr33-pr34-20261105`; nhánh local `feat/product-h1-build` giữ nguyên tại `0f27648`.

### Findings và sửa trước merge

1. **H1 Python lint/cleanup**: Ruff helper 13 diagnostics + test fixture 5 diagnostics; exception cụ thể thay blind catch, cleanup CLI có bounded wait, không log output thô. Patch nền `caf0873` đã đi cùng PR #33.
2. **Full Vitest discovery**: lần đầu 1396 tests pass nhưng fail vì `runner.test.mjs` dùng Node test runner. Exclude đúng file khỏi Vitest, vẫn chạy riêng 12 Node tests (không tắt/bỏ test). Full Vitest đã chạy lại trên cấu hình sửa.
3. **Python poller fixture lỗi schema**: full Python trước sửa 364 pass / 1 fail (`a.imported_from_vps` thiếu). Fixture thêm các cột monitor cần; full pytest chạy lại **365/365 PASS**.
4. **CLI migration packaging**: `prepare-cli.js` dừng ở schema 006 trong khi code dùng tới 019/020. Duyệt forward migration từ source; checkout #33 compile/prepare 19 migrations PASS, #34 có thêm 020. Không đổi file SQL cũ.
5. **H2 dispatch trước preflight**: pipeline H2 mở session/cấp deployment trước kiểm tra plan/source. Thêm preflight trước dispatch; regression xác nhận unsupported app không mở SSH, không tạo deployment và giữ `remote_outcome=not_started`.
6. **H2 controlled lab permissions**: tmpfs `/opt/opspilot` mặc định mode 1777 khiến guard từ chối writer lạ, 8/23 tests pass. Đặt mode 0755 của fixture (không nới runtime security check), chạy lại **23/23 PASS**.
7. **H2 Ruff**: import/type-only Self, exception cụ thể, cleanup và flatten argv linear. Không thêm ignore/disable rule; helpers/tests được kiểm Ruff sạch. `Self` import trong TYPE_CHECKING để không tạo runtime dependency ở target Python cũ.

### Phạm vi review / giới hạn công cụ

- #33 thay đổi 306 file nền, #34 thêm 47 file/hunks so với #33. Không xem toàn bộ 68k dòng là chức năng mới đã được nghiệm thu live.
- GitNexus index cũ 367 commits; đã analyze lại (10,461 nodes / 300 flows). FTS extension không khả dụng; một context trả lỗi LadybugDB và graph có symbol IDs không hợp lệ. Không dùng blast-radius count của graph làm chứng cứ chính xác; review bằng git diff/source/callers và tests. Không thay GitNexus configuration để che lỗi.
- Xác minh CLI/ControllerService tạo worker không có executor; H2 không được tự chạy production sau merge. Target runtime chỉ Express không DB, publish hiện `not_checked`. HMAC enrollment vẫn explicit lab; API quản trị/enrollment production chưa nối.
- Monitor `reconcilePrepared` còn cần đối soát ownership Product/Desktop trước bật executor: full integration phải chứng minh không dùng đường Desktop promote/abort thay fenced finalizer. Không suy ra an toàn chỉ từ fake SSH tests.

### Kiểm chứng hiện tại

- Node 22.23.3, pnpm 11.1.0; `pnpm --prefix app typecheck`, scripts typecheck và `electron-vite build` PASS.
- Full Vitest sau discovery fix: **1397 passed, 2 skipped, 0 failed**, 109 test files; JSON `app/.out-scripts/pr34-review-vitest.json` (ignored). Không tính skipped là PASS. JSDOM có warning getComputedStyle/canvas; không phải test GUI native.
- `ml-service/.venv/Scripts/python.exe -m pytest experiments collector/tests ml-service/tests -q -p no:cacheprovider` — **365 passed**, 112.66s. Ruff experiments/collector/ml-service PASS.
- `node --test app/scripts/h2-independent/tool.check.mjs app/scripts/product-docker-lab/runner.test.mjs` — **25/25 PASS** (13 QA + 12 L0); không nhầm self-tests của QA là nghiệm thu runtime.
- Linux build helper **7/7**, H0 transfer **8/8** PASS qua WSL Python 3.12.
- `node app/scripts/product-h2-review/run.mjs` — **23/23 PASS**, cleanup/source unchanged true, nonce `6339b2cf3984`. Guard/files/HMAC/fsync thật, Docker trong controlled suite là fake stateful.
- `node app/scripts/review-h2-live-health.mjs` — **5/5 PASS**, cleanup true, nonce `9ebbacbf54a9`; exact-CID health dùng Docker thật, chưa pinned SSH/collector/full deploy.
- L0 happy Docker ở cả checkout #33 và integration: HTTP 200, no leaked resources. Chỉ xóa exact resource của run.
- Đã khởi động Docker Desktop local, pull hai base image công khai và build image fixture theo README. Những lần đầu thiếu cached image được ghi là setup failures, chạy lại sau chuẩn bị đã pass; không dùng VPS/production DB.
- Full ESLint: **0 errors / 5999 warnings**, không báo lint warning-free toàn repo; chủ yếu format lịch sử ngoài scope. Ruff Python scoped và experiments/collector/ml-service PASS. Không format lại toàn bộ repo để xóa warning trong task merge này.
- #33 merge commit `2679153`. Cập nhật vào H2 tại `f7bbe1e`, xử lý đúng hai conflict helper cleanup bằng cách giữ runtime cleanup H2 cùng cleanup build đã sửa ở #33. `git diff --quiet d8a8406 f7bbe1e -- app experiments collector ml-service templates` exit 0: runtime source sau tích hợp **giống hệt** source vừa chạy full gates; chỉ bổ sung hồ sơ/board từ PR nền.
- CLI artifact dưới Node 22.23.3 compile/prepare PASS với **20 migrations**, không còn `?raw`; không chạm DB thật. Một lần lệnh setup dùng cwd sai đã chạy dưới Node 24, bị loại khỏi bằng chứng; đã chạy lại đúng Node 22 thành công.

### Lệnh gate chính để tái hiện

Từ repo root sau `. ./tools/enter-node22.ps1`:

```powershell
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/pr34-review-vitest.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec electron-vite build
pnpm --prefix app exec eslint . --format json --output-file .out-scripts/pr34-review-eslint.json
ml-service/.venv/Scripts/python.exe -m pytest experiments collector/tests ml-service/tests -q -p no:cacheprovider
ml-service/.venv/Scripts/python.exe -m ruff check experiments collector ml-service
ml-service/.venv/Scripts/python.exe -m ruff check app/src/main/controlPlane app/scripts/product-h2-review/test_runtime.py app/scripts/review-h2-live-health.py app/scripts/test_product_build_helper.py app/scripts/test_guarded_ssh_transfer.py
wsl python3 app/scripts/test_product_build_helper.py
wsl python3 app/scripts/test_guarded_ssh_transfer.py
node --test app/scripts/h2-independent/tool.check.mjs app/scripts/product-docker-lab/runner.test.mjs
node app/scripts/product-h2-review/run.mjs
node app/scripts/review-h2-live-health.mjs
git diff --check
```

Các Docker script cần cached images như README; `.out-scripts`/scratch chứa raw reports, không commit DB/key. `pnpm test` không tính hai Node suites vào Vitest sau sửa discovery; chúng vẫn được chạy riêng.

### Gate còn mở của sản phẩm (không chặn merge checkpoint mặc định tắt)

- H2 live pinned SSH + SQLite + Docker/collector thật, happy/build fail/health fail/rollback/first deploy/collector fail/restore fail và attribution B0/R0.
- Crash/disconnect/lease expiry quanh seal → T1 → ACK → idle → T2; restart recovery không replay/duplicate; chỉ bật executor sau gate đầy đủ.
- Installer/Electron ABI smoke máy sạch, UI→IPC→runtime smoke và diễn tập demo.
- Auto-deploy khi desktop tắt, enrollment/credential/authenticated administration và ownership isolation còn cần integration; polling Git không phải auto-deploy đã hoàn tất.
- ML pilot/fault runs/đánh giá định lượng, migrate hai VPS, shared ingress/HTTPS live và parity ba template phải kiểm kê tiếp theo ở task plan dưới đây.
