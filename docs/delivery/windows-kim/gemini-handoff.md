# Prompt giao Gemini — Windows delivery của Kim

Sao chép nội dung từ mục bên dưới vào Gemini có quyền đọc/sửa repo local. Đây là giao việc implementation; không yêu cầu Gemini chỉ trả một kế hoạch khác.

---

Bạn là engineer triển khai Windows delivery cho OpsPilot. Codex là leader chịu trách nhiệm plan, review, chạy kiểm thử độc lập và nghiệm thu. Bạn viết code trong phạm vi Kim, tự test và bàn giao từng checkpoint bằng SHA/evidence; không tự nhận leader đã approve.

## Bối cảnh và yêu cầu bắt buộc

- Repo hiện tại: `D:\Dự án CNTT\Tool Deploy\opspilot`. Đây là đường dẫn máy Kim; script bạn tạo phải suy ra repo root, không hardcode đường dẫn này.
- Nhánh bắt buộc: `feat/kim-windows-delivery-20261116`, tracking origin cùng tên. HEAD lúc tiếp nhận `7cec58845eed87057baa4562a410dc403eb6f2a7`; code baseline `f699615`. Baseline cố định, không pull/rebase core liên tục. Deadline hiện hành04/12/2026.
- Mục tiêu: người khác cài và chạy OpsPilot Windows không có developer Node/Python; DB/key/model/UI giữ qua reopen/repair/supported upgrade; quit không orphan ML; có source CI, runbook và demo thật8–10phút.
- Bạn được sửa/test/commit và normal push đúng nhánh theo ủy quyền task và lời giao việc trong ảnh. Chưa PR/merge/publish release/VPS. Không reset/clean/stash/rebase/force. Không xóa file local có sẵn.
- Không tự đổi contract/schema/API/pin/model/thuật toán/dependencies. Không thêm mock/backdoor vào Main/IPC để lab đạt.
- Chỉ đúng danh tính tác giả; không thêm coauthor không có đóng góp đã xác nhận.

## Đọc trước khi code

1. `CLAUDE.md`, `docs/tasks/README.md`, phần setup hiện hành trên `docs/tasks/board.md` (chỉ đọc).
2. `docs/tasks/tk-s7-parallel-2026-11-16.md` và `docs/tasks/tk-s7-kim-windows-delivery.md`.
3. `docs/delivery/windows-kim/leader-plan.md` — phạm vi, checkpoint, acceptance, ledger và báo cáo.
4. `docs/tasks/tk-s7-release-r11a-portable-ml-runtime.md`, `tk-s7-release-r11b-windows-installer.md`, `tk-s7-release-r11c-upgrade-compatibility.md` trong cùng thư mục task.
5. `app/scripts/windows-release-lab/README.md`, `UPGRADE.md`, `app/scripts/ml-runtime-lab/README.md`, phần liên quan trong `DECISIONS.md` và `docs/09-moi-truong-dev.md`.
6. Đọc các script/config/role-aware migrations được tham chiếu trước khi chỉnh lab. Tìm `task-discipline` nếu tồn tại; leader không tìm thấy file đó trong checkout, không bịa nội dung. Áp dụng task cụ thể về ownership và ngoại lệ không sửa board.

## File ownership

Được sửa:

- `app/scripts/windows-release-lab.mjs`, `windows-installer-lab.mjs`, `windows-upgrade-lab.mjs`, `windows-upgrade-baseline.py`, `legacy-ml-upgrade-lab.py`, `legacy-ml-upgrade.ps1`, `build-ml-runtime.py` và `app/scripts/windows-release-lab/**`.
- File mới trong `app/scripts/windows-delivery/**` và `.github/workflows/windows-delivery-source.yml`.
- `app/electron-builder.yml`, `app/resources/installer.nsh`, `app/scripts/controller-installer-before-pack.cjs` chỉ nếu có bug delivery tái hiện được, giữ resource verification/pin/production identity.
- `docs/delivery/windows-kim/**`, `docs/tasks/tk-s7-kim-windows-delivery.md`.

Chỉ đọc: `app/src/**`, `docs/contracts/**`, migrations, ML source, collector/templates/experiments, package.json/lockfile/Vite config, catalog/pins và controller release scripts khác, board/DECISIONS/task core. Bug ngoài owner thì ghi repro/expected/actual/file gợi ý + evidence trong task riêng rồi giao leader/coordinator; không tự sửa.

## Dữ kiện leader đã xác minh — phải kiểm kê lại

- Node22.17.0, pnpm11.1.0; venv Python3.12.7 trong khi runtime-lock yêu cầu3.12.10.
- 5package lệch lock: idna3.19 thay3.18, narwhals2.25.0 thay2.24.0, numpy2.5.2 thay2.5.1, typing-inspection0.4.4 thay0.4.2, uvicorn0.52.4 thay0.52.1. Không sửa lock hoặc nâng dependencies để khớp máy.
- Thiếu `app/resources/ml-runtime` và `app/resources/controller-releases`; binary ignored không tự có sau fetch/clone.
- Source đăng ký Desktop038/controller037 nhưng `windows-release-lab.mjs` còn `assert` schema31. Phải audit harness theo baseline/role và inventory migration đúng; không chỉ suy expected từ artifact đang thử.
- `pnpm.cmd --prefix app typecheck` đã exit0 cho Node/Web; invocation có chạy native postinstall. Chưa chạy full suite/build/NSIS/GUI. Số test R11 cũ không phải baseline này.
- Không thấy WindowsSandbox.exe trên máy hiện tại, chưa xác nhận Windows độc lập. Không gọi máy dev/profile riêng/account khác trên máy dev là clean OS.
- Trong workspace có worktrees H2 riêng và worktree khác có code chưa commit. Không chạm các worktree đó. Hai file plan/prompt và task update của Codex có thể đang chưa commit: đọc và giữ chúng, đưa vào commit docs đầu nếu phù hợp, không reset/stash/clean.

## Thực thi theo checkpoint

**Bắt đầu ngay CP0, rồi CP1; không dừng ở việc trả plan.** Ghi START thực tế vào task riêng và kiểm `git status`, branch/upstream/source SHA trước mọi mutation.

### CP0 — Preflight và prerequisite

Tạo CLI inventory trong `app/scripts/windows-delivery/**` và docs hướng dẫn gọi. Mặc định kiểm tra readonly: environment, versions/closure vs lock, resource inventory/pins, role-aware expected schema, nguồn artifact còn thiếu, process/port có thể ảnh hưởng lab. Output có trạng thái từng gate và dữ liệu JSON phù hợp lưu evidence; thiếu prerequisite cho package không được nhận package-ready.

Không tự spawn app/ML, download, reinstall venv hiện có hoặc ghi đè output chỉ để inventory. Chuẩn bị kế hoạch môi trường build riêng đúng approved Python/deps; nếu nguồn/hash binary chưa được duyệt, ghi danh sách cần coordinator cung cấp, không tự approve. Xử lý path có khoảng trắng/Unicode; không phụ thuộc đường dẫn máy Sơn hoặc LOCALAPPDATA Node mặc định của helper cũ.

Chỉ thêm checks meaningful cho CLI guard/path/status/exit-code hoặc bug đã tái hiện; không tạo hàng loạt unit test chỉ mirror implementation.

### CP1 — K3 source CI, làm được khi thiếu resources

Tạo `.github/workflows/windows-delivery-source.yml` với workflow_dispatch, Windows runner, Node22, pnpm11.1.0/frozen lockfile, không secret mới hoặc release publish. Script source checks dùng chung local/CI phải lan exit code fail. Có typechecks Node/Web/scripts, full Vitest, lint có phạm vi và lý do. Nếu sửa Python lab thì Ruff và affected checks bằng environment riêng đã duyệt.

Lưu source SHA, environment versions, commands/exit codes/raw logs/checksums; collect evidence kể cả fail. Không upload DB/key/model/secret. Source compilation không đồng nghĩa packaging PASS. Không skip toàn bộ packaging rồi báo xanh, không dùng continue-on-error che gate. Nếu không chạy/quan sát Actions được thì ghi NOT_RUN và giao local equivalent có bằng chứng.

Bàn giao CP0/CP1 sớm bằng commit phù hợp; không cần chờ K2 để leader review. Vẫn tiếp tục phần độc lập đã được giao; báo rõ source SHA của candidate chờ review để tránh nhầm evidence với code sau đó.

### CP2 — K1 package current baseline

Audit/sửa lỗi harness thuộc owner (schema31, migration inventory, paths và lifecycle). Không đổi core/schema để chiều lab. Khi đủ verified resources: build full source và NSIS vào output nonce mới, `--publish never`; giữ actual beforePack và mọi pin/history verification.

Chạy full production Main/preload/renderer/native SQLite/safeStorage/bundled ML thật; schema38/integrity/applied migrations đúng desktop role. Profile/HOME riêng; locale/theme và DB/key/model/trained_at giữ qua cold reopen; synthetic180train/4scores chỉ runtime smoke. Xác minh child PID/executable/listener thuộc app, hai lần quit không orphan; resource hashes không đổi. Chạy fixture NSIS repair/lifecycle và negative CLI/traversal/missing/tamper trong phạm vi riêng; dữ liệu giữ nguyên khi từ chối.

Không dọn diagnostics của record FAIL hoặc kill theo tên process chung. Chỉ cleanup đúng fixture có marker và đường dẫn tuyệt đối đã kiểm phạm vi; không gỡ OpsPilot đang dùng.

### CP3 — K2 Windows độc lập / upgrade

Chỉ chạy production identity/default profile/shortcut/ordinary uninstall trên Windows thử độc lập không có bản đang dùng. Ghi OS/build/arch, Node/Python absent, installer SHA và trạng thái môi trường. Không dùng debug/profile override để thay production launch gate. Giữ DB/key/model/UI qua reopen/repair/supported upgrade, ordinary uninstall giữ user data theo policy và dọn đúng app/process/registry/shortcut.

Supported predecessor theo policy d302ee3/0.1.0; old source rebuild còn phụ thuộc dev Python phải ghi rõ. Không đổi version để giả upgrade, không coi repair cùng version là upgrade, không hứa mọi binary cũ tương thích. Negative missing/tamper trên copy/fixture, giữ dữ liệu. Ghi NotSigned đúng thực tế, không tắt Windows security để nhận PASS.

Nếu Windows độc lập/resources chưa có: ghi BLOCKED/NOT_RUN với điều kiện gỡ cụ thể; tiếp CP1/CP4. Không chờ im lặng và không nhận K2/R11/release tổng hoàn tất.

### CP4 — Runbook và demo

Trong `docs/delivery/windows-kim/**`, viết hướng dẫn prerequisite build khác prerequisite end-user, cài/mở app, backup userData có DB/key/model/UI (đóng app trước, giữ nhất quán và khả năng restore cùng Windows identity), log redaction và phục hồi khi installer abort. Không gửi DB/key/pickle trong evidence.

Demo8–10phút có timeline, expected output, đường lui khi môi trường lỗi, SHA và ảnh/video dự phòng nếu thực có. Chỉ mô tả feature baseline đã xác nhận. Live Git/database/VPS mới phải để coordinator xác nhận; không dùng production VPS/credentials trong task này.

## Lệnh nền tảng và quy tắc evidence

Chạy từ repo root với Node22 đã xác minh; dùng command/script thật phù hợp môi trường, không chạy build package khi preflight chưa đủ:

```powershell
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor f699615 HEAD
node --version
pnpm.cmd --version
pnpm.cmd --prefix app typecheck
pnpm.cmd --prefix app exec tsc -p tsconfig.scripts.json --noEmit
pnpm.cmd --prefix app exec vitest run
git diff --check
```

Không chạy root `pnpm test` rồi tự kết luận Python đạt nếu script hardcode `.venv` không khớp environment. Tên CLI mới, focused checks và lint list do bạn chốt sau audit, ghi đầy đủ trong runbook để leader chạy lại. Không bịa số test.

Evidence raw/binary ở ignored `app/.out-scripts/windows-delivery/<nonce>` hoặc output riêng của existing lab; docs chỉ commit bản sanitized, SHA256 và ảnh không lộ dữ liệu. Ghi rõ source commit + dirty diff hash nếu kiểm trước commit; nếu source thay đổi sau test phải đánh giá/chạy lại affected gates trước khi gắn PASS vào HEAD mới.

## Format bàn giao bắt buộc

Cập nhật task riêng trong cùng checkpoint. Không sửa board/DECISIONS; coordinator tổng hợp. Mỗi checkpoint commit riêng và normal push đúng nhánh khi gates tương ứng đạt; nếu chỉ partial thì nói partial, không đánh dấu task hoàn thành. Giữ lịch sử FAIL, skips và NOT_RUN. Báo blocker quá30phút kèm cách gỡ, tiếp phần độc lập.

Trả báo cáo ngắn:

```text
CPx/Kx — CHỜ REVIEW hoặc BLOCKED
SHA, branch, files changed và trạng thái push:
Đã làm:
Commands / exit code / actual test counts:
Requirement → PASS/FAIL/NOT_RUN/BLOCKED → evidence path + SHA256:
Environment và giới hạn actual/synthetic/clean OS:
Artifact hashes; PID/port/registry cleanup; preservation (nếu đã chạy):
Lỗi còn mở / repro / owner / điều kiện gỡ:
Việc tiếp theo:
```

Leader chỉ nghiệm thu sau đọc diff và kiểm thử lại. Bắt đầu CP0/CP1 ngay với workspace hiện tại; không viết thay core của Sơn và không trả một lời hứa chung “đã hoàn thiện Windows”.
