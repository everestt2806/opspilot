# Bàn giao partner — 25/10/2026

## Điểm vào

- Người nhận: Võ Thị Thiên Kim. Chủ dự án dự kiến vắng 3–4 ngày.
- Nhánh làm việc: `feat/deploy-reachability`. Không làm trực tiếp trên `main`.
- Code source/render: `d8b932935dcc5475d3c4021afa3a6bdf07b25c94`; hồ sơ Worker: `e8b4d9d`.
- H0 fix + regression + kế hoạch song song: `900ad77`, đã push lên `origin/feat/deploy-reachability`. Nhận HEAD mới nhất của nhánh để có cả hồ sơ closeout.
- P3e-3a đã được Leader duyệt tại `2cf6541` / `ee2a878`.
- **H0/source-render đã qua review và lab sau sửa hai finding. P3e-3b tổng thể PARTIAL/BLOCKED; chưa có build/activate/health/rollback/publish/finalization hoặc deployment Product thật.**
- Controller mặc định vẫn polling-only. Không bật executor production hoặc dùng VPS/DB thật trong đợt bàn giao này.
- [Hồ sơ chi tiết P3e-3b](tk-s7-p3e-3b-product-pipeline-guarded-session.md), [board](board.md), [roadmap](../31-lo-trinh-hoan-thien-san-pham.md).

## Ledger bàn giao

START 25/10 — User giao Leader sửa H0, kiểm chứng checkpoint source/render và push để Kim tiếp tục; đồng thời yêu cầu setup làm song song. Leader sở hữu helper/contract và tích hợp. Orca run `run_5523be8bbf78`: worker regression `task_e02b8d864032` chưa chạy vì `agent-update-prompt`; dispatch `ctx_f32475f0bba7` failed trước readiness, terminal đã release. Không có Worker đang sửa file.

| Tiêu chí phiên hiện tại | Bằng chứng | State |
|---|---|---|
| Chặn request-ID traversal và quota trước I/O | H0-01/H0-02 đã sửa, baseline cũ fail 6/8; bản sửa pass 8/8 filesystem tests | PASS |
| Regression filesystem và Linux SSH thật cùng gates liên quan | Linux SSH pass gồm 3 raw-frame regressions mới; Windows 247 tests/typecheck, ESLint, Ruff, artifact/helper builds | PASS |
| Chia task song song có owner/file/checkpoint, giữ thứ tự tích hợp | Bảng wave và prompt bên dưới; Worker tự động chưa chạy do update prompt | PASS |
| Commit và push feature branch, giữ dữ liệu cá nhân | H0 commit `900ad77` push fast-forward thành công từ `d24d2e0`; không PR/merge; file cá nhân vẫn ngoài index | PASS |

| Yêu cầu | Bằng chứng / trạng thái | Kết quả |
|---|---|---|
| Review source/render và kiểm chứng độc lập | 247 tests / 19 files, Node 22 typecheck, diff check; Linux localhost SSH source/render lab PASS | PASS |
| Không nhầm source/render với deployment | H0-01/H0-02 đã sửa và phủ regression; chưa build/activate/health/rollback/publish/finalization | PASS |
| Task có thứ tự, DoD và giới hạn cho partner | H0 → H1 → H2 theo integration; L0 Docker lab và H2 design được chuẩn bị song song | PASS |
| Hướng dẫn máy mới và giữ dữ liệu riêng | Không dùng `/var/tmp` hay credential từ máy Leader; không stage file untracked | PASS |
| Push sau khi chốt checkpoint theo yêu cầu chủ dự án | `git push origin HEAD:refs/heads/feat/deploy-reachability` thành công tới `900ad77`; hồ sơ closeout cập nhật tiếp trên cùng branch | PASS |

## Finding H0 — đã sửa, giữ lại repro để đối chiếu

### H0-01 — `request_id` có thể trở thành đường dẫn file tạm

- File: `app/src/main/controlPlane/target_guarded_ssh_helper.py`, `TransferState.begin_file`.
- Bản cũ ghép tên temporary từ `path[-1]` và `request['request_id']`, chỉ kiểm tra request ID không rỗng. Bản sửa chặn ID ngoài `[A-Za-z0-9_-]{1,128}` trước I/O và dùng `tempfile.mkstemp` sinh tên độc lập tại target.
- Repro độc lập: tạo source directory `.victim.X` qua một file hợp lệ; gửi `begin_file` với path `victim` và ID `X/../../../../../../escaped`. Sau một chunk, `escaped.part` được tạo ở scratch ngoài deployment staging.
- Repro ban đầu chỉ ghi một byte trong scratch, không tác động dữ liệu thật. Bản sửa đã có cả regression filesystem và raw-frame localhost SSH thật; không tạo file ngoài staging.
- DoD: request ID có validation thống nhất trước I/O; filename tạm do target tự sinh, không nhúng identifier từ wire làm path. Regression phải kiểm tra đường thoát qua ID dù trường `path` hợp lệ, qua Linux SSH thật; không file nào ngoài staging xuất hiện.

### H0-02 — quota khai báo chưa ràng buộc bytes thực tế

- Bản cũ nhận `begin_scope(total_bytes=0, file_count=1)` rồi `begin_file(size=1)` và ghi một byte; chỉ phát hiện mismatch ở `complete_scope`. Bản sửa kiểm tra cumulative file sizes trước tạo file và actual bytes trước chunk, ở cả scope và session.
- DoD: kiểm tra tổng file sizes/actual bytes của scope và session trước khi mở file/ghi chunk, gồm file đang truyền. Không ghi byte vượt ngân sách khai báo hoặc quota tuyệt đối. Giữ checksum/count/manifest checks khi complete.
- Regression: zero-byte scope, exact-boundary, một file vượt declared total, nhiều file cộng dồn vượt tổng, source + render cộng dồn, disconnect; dùng dữ liệu nhỏ, không tạo file lớn để chứng minh quota.

### Giao task H0

- Owner closeout: Leader. Trạng thái: CHỜ REVIEW/merge theo quy trình board; gate source/render đã được kiểm chứng. Kim bắt đầu H1/L0, không cần sửa lại H0.
- Phạm vi: helper/session/contract nếu cần, regression và hồ sơ; không sửa build/deploy pipeline.
- Đọc `CLAUDE.md`, ADR-011 và áp dụng `task-discipline`. Đây là ủy quyền sửa hai finding và đồng bộ contract liên quan; không cần xin duyệt lại việc thêm operation validation.
- Hai repro phải thất bại trên bản cũ, pass trên bản sửa. Chạy focused tests, typecheck, ESLint/Ruff, artifact/helper build và Linux localhost SSH lab.
- Chỉ sau khi gate này đạt mới ghi source/render `READY_FOR_REVIEW`; không đổi P3e-3b tổng thể thành DONE.

## Setup làm song song sau H0

Ảnh hưởng app: H1 cho phép build image từ source Git đã xác minh; H2 mới chạy app, kiểm tra health, khôi phục bản trước và ghi kết quả deploy. L0 chuẩn bị môi trường để kiểm chứng các bước này bằng Docker thật. UI hiện hành không thay đổi trong đợt này.

| Luồng / checkpoint | Owner đề xuất | Có thể bắt đầu | Phạm vi ghi file | Điều kiện chốt |
|---|---|---|---|---|
| H1 — Build runtime | Worker core | Ngay sau nhận branch có H0 | Helper/session/adapter, contract build và tests liên quan | Một session/lock, canonical image/version; build thành công/lỗi/unknown; real Docker gate với L0 |
| L0 — Docker lab readiness | Kim / Worker thứ hai | Song song H1 | Chỉ `app/scripts/product-docker-lab/**` mới và `docs/tasks/tk-s7-product-docker-lab.md` | `docker info`, `docker compose version`, image/container Express fixture local, cleanup đúng tài nguyên fixture; ghi rõ chưa phải Product pipeline |
| H2-D — Thiết kế activate/finalize | Kim sau L0 hoặc người thứ ba | Song song H1, chỉ proposal | Chỉ `docs/tasks/tk-s7-product-h2-design.md` | State transitions, typed operation proposal, fenced finalization và failure matrix review được; chưa sửa contract/runtime |
| H2-I — Tích hợp deployment | Worker core | H1 + L0 đạt gate, H2-D được duyệt | Runtime/contract/tests do một owner nhận | V1 → V2, health fail giữ/khôi phục V1, publish degraded không rollback healthy, unknown không replay |

Đây là ngoại lệ user chốt 25/10 cho giới hạn một Worker trong kế hoạch cũ: cho phép nhiều task độc lập, **mỗi file/contract mutation chỉ có một owner**. Không chia hai người cùng sửa helper/session/adapter; H2 chưa được nối runtime khi H1 chưa đạt gate. Leader giữ quyền sửa board, hồ sơ chung, tích hợp và push; Worker chỉ cập nhật dossier riêng.

### Tách checkout cho người/agent cùng máy

Sau khi nhận branch đã push, từ repo sạch (máy khác có thể dùng clone riêng):

```powershell
git fetch origin
git worktree add -b feat/product-h1-build ../opspilot-h1-build origin/feat/deploy-reachability
git worktree add -b feat/product-docker-lab ../opspilot-docker-lab origin/feat/deploy-reachability
```

- Kiểm tra branch/directory chưa tồn tại; nếu tồn tại, đọc `git worktree list` và dùng checkout sẵn đúng owner, không xóa/reset để chạy lại lệnh.
- Hai worktree cài dependency riêng theo lockfile, không dùng chung output artifact/SQLite/staging/runtime hoặc rebuild native module của nhau. Linux runtime và Windows dependencies vẫn tách biệt.
- Không `git pull`/cherry-pick khi còn sửa dở. Mỗi owner chốt commit và evidence; Leader review, tích hợp L0 cùng H1, chạy lại gate trên **commit tích hợp**, rồi mới giao H2-I. Không suy ra hai branch xanh riêng là nhánh tích hợp đã xanh.
- Chưa tạo những worktree này trên máy Leader: Worker launch bị update prompt, không có agent được giao ghi ở các nhánh đó. Đây là lệnh setup trên máy tiếp nhận, không phải báo cáo đã có hai Worker hoạt động.

### Prompt chuyển cho Worker core

> Đọc CLAUDE.md, ADR-011, task-discipline và handoff 25/10. Nhận H1 Product build qua cùng guarded SSH session, trên branch `feat/product-h1-build` từ handoff đã push. Đọc chi tiết H1 dưới đây; sở hữu runtime/helper/session/adapter và contract/tests build, không sửa thư mục `product-docker-lab` hoặc board/handoff chung. Đồng bộ contract trước implementation; dùng canonical deployment/version, không mở session thứ hai, không activate/finalize. Lưu dossier riêng `docs/tasks/tk-s7-product-h1-build.md`. Báo gate thật/lỗi/unknown và SHA; Docker thiếu ghi BLOCKED, không nhận deployment đã chạy. Commit cục bộ theo file cụ thể với co-author Kim; không push/PR/merge, không VPS/production DB, không reset/clean/stash/rebase. Chạy gates H1 rồi bàn giao Leader review.

### Prompt chuyển cho Kim / Worker lab

> Nhận L0 Docker lab readiness trên branch `feat/product-docker-lab` từ cùng handoff. Đọc CLAUDE.md và task-discipline; chỉ ghi file mới `app/scripts/product-docker-lab/**` và `docs/tasks/tk-s7-product-docker-lab.md`. Không sửa helper/session/adapter/contract/dependency/board/handoff chung. Kiểm tra Docker daemon và Compose thật; tạo fixture Express local có nhãn/tên tài nguyên riêng, build/run/health/cleanup đúng tài nguyên vừa tạo, không global prune hoặc production VPS. Ghi commands, phiên bản, kết quả và lỗi cụ thể. Nếu thiếu daemon ghi BLOCKED, bàn giao hướng setup, không dùng mock làm proof Docker. Commit cục bộ với co-author Kim; không push/PR/merge. Đây là readiness cho H1, chưa chứng minh Product pipeline. Bàn giao SHA và evidence để Leader tích hợp.

## Chi tiết các task runtime sau H0

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
wsl python3 app/scripts/test_guarded_ssh_transfer.py -v
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
- H0 final: 8 Linux filesystem tests pass; 6/8 fail khi import helper cũ `d8b9329` từ scratch. SSH lab mới pass cả malformed request ID, scope zero-byte và cumulative overrun; cùng 247 tests/typecheck/lint/build pass. Xem dossier H0 để tái hiện.
- Không SSH VPS, production DB, Docker deploy, DNS/firewall hoặc ML state bị thay đổi trong review/handoff.

## Nhịp bàn giao 3–4 ngày

- Ngày 1: nhận H0 đã kiểm chứng; H1 và L0 bắt đầu song song; chuẩn bị proposal H2-D khi có người.
- Ngày 2: H1 và bằng chứng build thật nếu Docker khả dụng.
- Ngày 3–4: H2 theo thứ tự dependencies; ưu tiên một luồng Express chạy trọn vẹn. Nếu chưa xong, giữ status PARTIAL và bàn giao commit/gate/gap chính xác.
- Không mở rộng UI/framework/private Git/webhook trong đợt này. ML/thực nghiệm vẫn là phần bắt buộc cho đồ án; ghi readiness/data needs riêng, không đợi Product xong mới bắt đầu chuẩn bị và không tự nhận pilot đã chạy.
- Mục tiêu demo 7–10 phút; chốt kịch bản 10/11, khóa build demo 13/11, diễn tập ít nhất ba lần trong 14–19/11. Đây là mốc mục tiêu, chưa phải DEMO_READY.

## Git và báo cáo

HANDOFF 25/10 — H0 `900ad77` đã push; source/render slice accepted trong Linux lab, P3e-3b overall PARTIAL/BLOCKED. Kim nhận H1 và L0 theo bảng song song; chưa Worker nào chạy tự động. Pull/fetch HEAD mới nhất của feature branch trước tạo checkout task. Không yêu cầu partner dùng DB/credential/runtime từ máy Leader.

- Commit theo task/file cụ thể, không `git add .`; giữ nguyên file cá nhân/untracked. Không reset/clean/stash/rebase hoặc force push lịch sử chia sẻ.
- Partner bắt đầu bằng `git status`, `git fetch origin`, checkout branch bàn giao; nếu local có thay đổi hoặc nhánh lệch, giữ dữ liệu và đối chiếu trước khi fast-forward. Không ghi đè checkout đang có việc.
- User đã yêu cầu Leader sửa H0 rồi push cho partner, sau đó chốt yêu cầu setup song song. Quyền push feature branch có hiệu lực sau gate source/render; không có quyền merge/deploy/force push. Partner có thể tiếp tục code/commit local theo H1/L0/H2, báo Leader trước tích hợp/push.
- Mỗi bàn giao ghi: task, implementation SHA, tests/evidence, status, blocker và task kế tiếp. Test sửa H0 phải chứng minh helper từ chối đúng input, không chỉ mock session.
- Giữ author chính. Commit triển khai theo yêu cầu chủ dự án có trailer:

```text
Co-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>
```
