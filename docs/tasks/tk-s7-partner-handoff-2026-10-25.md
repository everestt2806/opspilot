# Bàn giao partner — 25/10/2026

## Điểm vào

- Người nhận: Võ Thị Thiên Kim. Chủ dự án dự kiến vắng 3–4 ngày.
- Nhánh làm việc: `feat/deploy-reachability`. Không làm trực tiếp trên `main`.
- Code source/render: `d8b932935dcc5475d3c4021afa3a6bdf07b25c94`; hồ sơ Worker: `e8b4d9d`.
- P3e-3a đã được Leader duyệt tại `2cf6541` / `ee2a878`.
- **P3e-3b tổng thể PARTIAL/BLOCKED. Source/render mới chạy happy path trong lab, chưa được Leader duyệt vì hai finding bên dưới. Không có deployment Product thật.**
- Controller mặc định vẫn polling-only. Không bật executor production hoặc dùng VPS/DB thật trong đợt bàn giao này.
- [Hồ sơ chi tiết P3e-3b](tk-s7-p3e-3b-product-pipeline-guarded-session.md), [board](board.md), [roadmap](../31-lo-trinh-hoan-thien-san-pham.md).

## Ledger bàn giao

| Yêu cầu | Bằng chứng / trạng thái | Kết quả |
|---|---|---|
| Review source/render và kiểm chứng độc lập | 247 tests / 19 files, Node 22 typecheck, diff check; Linux localhost SSH source/render lab PASS | PASS |
| Không nhầm happy path với gate an toàn hoặc deployment | Finding H0-01/H0-02 tái hiện bằng Python thật trong scratch; chưa build/activate/health/rollback/publish/finalization | PASS |
| Task có thứ tự, DoD và giới hạn cho partner | H0 → H1 → H2; Docker có nhánh xử lý riêng | PASS |
| Hướng dẫn máy mới và giữ dữ liệu riêng | Không dùng `/var/tmp` hay credential từ máy Leader; không stage file untracked | PASS |
| Push sau khi chốt checkpoint theo yêu cầu chủ dự án | Chưa chốt source/render. Cần sửa H0 hoặc chủ dự án chỉ định push WIP để partner tiếp nhận các finding | OPEN |

## Finding bắt buộc sửa trước — H0

### H0-01 — `request_id` có thể trở thành đường dẫn file tạm

- File: `app/src/main/controlPlane/target_guarded_ssh_helper.py`, `TransferState.begin_file`.
- Tên temporary được ghép từ `path[-1]` và `request['request_id']`; helper hiện chỉ kiểm tra request ID là chuỗi không rỗng.
- Repro độc lập: tạo source directory `.victim.X` qua một file hợp lệ; gửi `begin_file` với path `victim` và ID `X/../../../../../../escaped`. Sau một chunk, `escaped.part` được tạo ở scratch ngoài deployment staging.
- Repro chỉ ghi một byte trong scratch do reviewer tạo; không tác động dữ liệu thật. Đây là helper/filesystem proof, chưa phải kiểm thử tấn công qua SSH.
- DoD: request ID có validation thống nhất trước I/O; filename tạm do target tự sinh, không nhúng identifier từ wire làm path. Regression phải kiểm tra đường thoát qua ID dù trường `path` hợp lệ, qua Linux SSH thật; không file nào ngoài staging xuất hiện.

### H0-02 — quota khai báo chưa ràng buộc bytes thực tế

- `begin_scope(total_bytes=0, file_count=1)` rồi `begin_file(size=1)` và một chunk hiện được chấp nhận; `finish_file` ghi file một byte. Đến `complete_scope` mới phát hiện mismatch là quá muộn để bảo vệ dung lượng.
- DoD: kiểm tra tổng file sizes/actual bytes của scope và session trước khi mở file/ghi chunk, gồm file đang truyền. Không ghi byte vượt ngân sách khai báo hoặc quota tuyệt đối. Giữ checksum/count/manifest checks khi complete.
- Regression: zero-byte scope, exact-boundary, một file vượt declared total, nhiều file cộng dồn vượt tổng, source + render cộng dồn, disconnect; dùng dữ liệu nhỏ, không tạo file lớn để chứng minh quota.

### Giao task H0

- Owner: Kim / Worker trên máy Kim. Trạng thái: TUẦN NÀY.
- Phạm vi: helper/session/contract nếu cần, regression và hồ sơ; không sửa build/deploy pipeline.
- Đọc `CLAUDE.md`, ADR-011 và áp dụng `task-discipline`. Đây là ủy quyền sửa hai finding và đồng bộ contract liên quan; không cần xin duyệt lại việc thêm operation validation.
- Hai repro phải thất bại trên bản cũ, pass trên bản sửa. Chạy focused tests, typecheck, ESLint/Ruff, artifact/helper build và Linux localhost SSH lab.
- Chỉ sau khi gate này đạt mới ghi source/render `READY_FOR_REVIEW`; không đổi P3e-3b tổng thể thành DONE.

## Các task sau H0 — làm tuần tự

### H1 — Product build qua cùng session

- Owner: Kim / Worker. Trạng thái: BACKLOG, phụ thuộc H0.
- Bổ sung typed operation build, dùng Dockerfile/compose/source đã staging và được xác minh; không raw shell từ client/repo metadata.
- **Seam cần sửa:** `stageProductSourceAndRender()` hiện đóng session trong `finally`. Tách operation dùng session do caller sở hữu để source → render → build giữ cùng lock; không reopen guard/clear unknown để chạy bước tiếp theo. Giữ wrapper source-only nếu lab cần.
- **Seam cần sửa:** render hiện dùng image tag `<app>:product-source-render`; build phải dùng tag/version canonical của deployment, không dùng placeholder làm version production.
- Docker command chạy bằng argv có validation. Đường dẫn build context phải nằm trong staging đúng app/deployment; không mở channel ghi thứ hai.
- Kết quả build phân biệt thành công, lỗi xác định, timeout/disconnect unknown. Chưa activate/promote/current-pointer hoặc terminal finalize.
- DoD: Linux SSH + Docker thật build image Express của đúng source SHA, kiểm tra labels/tag/deployment identity và failure path; DB vẫn một deployment. Docker thiếu thì code/controlled tests có thể tiến hành, real Docker gate phải ghi BLOCKED.

### H2 — Activate / health / rollback / terminal state

- Trạng thái: BACKLOG, phụ thuộc H1 và Docker lab khả dụng.
- Chốt typed operations và Product-safe finalization trước khi nối mutation. Tái sử dụng pipeline/template/policy hiện có, giữ Desktop behavior.
- Health fail phải giữ/khôi phục bản live đã xác minh; exposure fail không rollback app healthy.
- Promote current deployment và release leases chỉ qua fenced transaction với kết quả có bằng chứng, không dùng đường Desktop trực tiếp. Desired revision đến muộn phải còn được reconcile; không tạo row/version thứ hai.
- Đóng channel, hết lease, crash hoặc mất receipt sau mutation vẫn unknown/reconciliation; không auto-replay, không dùng TTL làm bằng chứng remote đã dừng.
- DoD: Express v1 → v2 healthy; build fail; health fail; mất phản hồi và restart; live URL/image/history khớp; một deployment/attempt và không duplicate. Ghi rõ đây là lab hay VPS; chưa live cutover.
- Nếu chưa đủ thời gian chứng minh finalization/recovery, bàn giao PARTIAL với commit và gap cụ thể; không bật executor production.

## Docker và setup trên máy partner

1. Đọc `docs/09-moi-truong-dev.md`, dùng Node 22, pnpm theo repo; kiểm tra `node --version` trước gates. Cài dependency theo lockfile. Không dùng Node 24 thay bằng chứng Node 22.
2. Windows unit/typecheck là bằng chứng riêng với Linux SSH/filesystem/container integration.
3. Linux lab cần Git, Python 3, OpenSSH client/server và Node 22. Native `better-sqlite3` phải được cài trong Linux runtime riêng; không reuse/rebuild đè Windows `node_modules`.
4. Copy `app/control-plane-runtime/package.json` và `package-lock.json` vào runtime directory Linux của riêng Kim, chạy `npm ci` ở đó. Chỉ dùng Docker lab local; không dùng VPS production để thay môi trường test.
5. Khởi động Docker Desktop Linux engine + WSL integration nếu có, hoặc dùng Linux Docker lab riêng. Gate là cả `docker info` và `docker compose version` thành công; chỉ có CLI chưa đủ. Không mở Docker socket public. Không tự cài/chỉnh dịch vụ production.
6. Biến runtime/lab dùng đường dẫn của máy Kim; các `/var/tmp/opspilot-p3e...` trong hồ sơ cũ là evidence trên máy Leader, không phải dependency cần copy.

### Chạy kiểm chứng hiện hành

Từ repo root trên Windows (sau khi cài dependency):

```powershell
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/main/db src/main/controlPlane src/main/git src/main/ssh src/main/deploy/pipeline.test.ts src/main/deploy/precheck.test.ts
pnpm --prefix app typecheck
git diff --check
```

Trên Linux, đặt các biến bằng đường dẫn tuyệt đối trên máy partner:

```sh
export OPSPILOT_CONTROL_PLANE_MODULES=/absolute/path/to/linux-runtime/node_modules
export OPSPILOT_CONTROL_PLANE_OUTPUT=/absolute/path/to/linux-runtime/dist/control-plane.cjs
export OPSPILOT_P3E3A_MODULES="$OPSPILOT_CONTROL_PLANE_MODULES"
export OPSPILOT_P3E3A_LAB_ARTIFACT=/absolute/path/to/linux-runtime/product-lab.cjs
export OPSPILOT_P3E3A_HELPER_DIR=/absolute/path/to/linux-runtime/dist/target-helper
export NODE_PATH="$OPSPILOT_CONTROL_PLANE_MODULES"
export OPSPILOT_TEMPLATES_DIR=/absolute/path/to/repo/templates
cd /absolute/path/to/repo/app
node ../app/scripts/build-control-plane.mjs
node scripts/build-p3e3a-ssh-lab.mjs
node scripts/p3e3a-guarded-ssh-linux-lab.mjs
```

- Đặt đúng cwd/template path: reviewer chạy lab từ repo root mà không set templates đã gặp ENOENT; chạy từ `app` pass. Packaging templates/collector cho runtime độc lập vẫn cần kiểm chứng trước release.
- Lab tự sinh credential tạm và daemon SSH loopback; không paste key/password/fingerprint của VPS vào repo, terminal transcript hay báo cáo.
- Lab source/render PASS không chứng minh Docker/deployment. Hiện CLI vẫn không wire Product executor.

## Bằng chứng review tại mốc bàn giao

- Windows Node 22.23.3: 19 files / 247 tests PASS; main typecheck và diff check PASS.
- Linux Node 22.23.4 + actual localhost OpenSSH/SQLite: `P3E3B_SOURCE_RENDER_SSH_LAB_PASS`; 5 source files / 71,909 bytes, 3 render files, checksum, một session/lock, một deployment; pipeline execution chưa triển khai.
- Supplemental Python/filesystem repro: quota 0 vẫn ghi một byte; request ID traversal tạo file ngoài staging. Hai finding này chưa được sửa trong code hiện tại. Không chạy lại baseline suite để gọi đó là proof đã sửa.
- Không SSH VPS, production DB, Docker deploy, DNS/firewall hoặc ML state bị thay đổi trong review/handoff.

## Nhịp bàn giao 3–4 ngày

- Ngày 1: sửa H0, chạy gate; setup Docker lab và ghi readiness.
- Ngày 2: H1 và bằng chứng build thật nếu Docker khả dụng.
- Ngày 3–4: H2 theo thứ tự dependencies; ưu tiên một luồng Express chạy trọn vẹn. Nếu chưa xong, giữ status PARTIAL và bàn giao commit/gate/gap chính xác.
- Không mở rộng UI/framework/private Git/webhook trong đợt này. ML/thực nghiệm vẫn là phần bắt buộc cho đồ án; ghi readiness/data needs riêng, không đợi Product xong mới bắt đầu chuẩn bị và không tự nhận pilot đã chạy.
- Mục tiêu demo 7–10 phút; chốt kịch bản 10/11, khóa build demo 13/11, diễn tập ít nhất ba lần trong 14–19/11. Đây là mốc mục tiêu, chưa phải DEMO_READY.

## Git và báo cáo

- Commit theo task/file cụ thể, không `git add .`; giữ nguyên file cá nhân/untracked. Không reset/clean/stash/rebase hoặc force push lịch sử chia sẻ.
- Partner bắt đầu bằng `git status`, `git fetch origin`, checkout branch bàn giao; nếu local có thay đổi hoặc nhánh lệch, giữ dữ liệu và đối chiếu trước khi fast-forward. Không ghi đè checkout đang có việc.
- User đã yêu cầu chuẩn bị task và push để partner tiếp nhận. Review mới phát hiện H0 nên quyền push một WIP chưa duyệt cần được phân biệt với yêu cầu push sau khi chốt checkpoint. Không tự suy ra quyền merge/deploy/force push.
- Mỗi bàn giao ghi: task, implementation SHA, tests/evidence, status, blocker và task kế tiếp. Test sửa H0 phải chứng minh helper từ chối đúng input, không chỉ mock session.
- Giữ author chính. Commit triển khai theo yêu cầu chủ dự án có trailer:

```text
Co-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>
```
