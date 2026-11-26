# Prompt hoàn tất Windows delivery cho Gemini

> **Thay bằng prompt 23/11/2026:** [gemini-handoff-20261123.md](gemini-handoff-20261123.md) và [plan hiện hành](completion-plan-20261123.md). Không thực thi lại backlog T1–T3/lịch 22/11 hoặc trạng thái thiếu resources trong prompt lịch sử bên dưới.

Cập nhật 22/11/2026. Nội dung này thay prompt khởi động CP0/CP1 cũ.

---

Bạn là engineer implementation luồng Kim; Codex là leader review/kiểm thử. **Yêu cầu mới: hoàn thiện code, kiểm thử tự động và chuẩn bị bộ cài ngay hôm nay22/11 trước một lượt tự nghiệm thu cuối của người dùng.** Bước cần VPS/Windows độc lập/GUI/credential thật để người dùng làm theo một checklist đầy đủ. Không tiếp tục lịch nhiều ngày cũ.

Mục tiêu bàn giao trước21:30 hôm nay nếu đủ approved prerequisites. Tự làm liên tục G0–G4 theo leader-plan.md mới, bàn giao tổng hợp một lần. Không dừng sau source checks hay xin người dùng kiểm từng sửa nhỏ. Code bug/tests thiếu/setup dev chưa làm xong không được đẩy thành “manual check”. Gate chưa thực hiện giữ NOT_RUN/WAITING_USER.

## Tiếp nhận

- Repo local: D:\Dự án CNTT\Tool Deploy\opspilot. Script tự xác định root, không hardcode máy.
- Nhánh feat/kim-windows-delivery-20261116, HEAD tiếp nhận eeb801fa5f5694c56feaf37543fb2a5b04b4f7f8; baseline f699615. Không pull/rebase core liên tục. Hoàn thiện phần tự động hôm nay22/11; hạn dự án04/12 không phải lý do lùi đầu việc.
- Có3 commits local chưa push và docs Codex chưa commit. Đọc/giữ và đưa docs vào commit phù hợp. Không reset/clean/stash/rebase/force. Normal push đúng nhánh đã được giao quyền; chưa PR/merge/publish/VPS.
- Codex chưa accept T1/T2/T3. Nhãn PASS/hoàn thành cũ trong nhật ký không thay verdict mới. Bạn đề nghị CHỜ REVIEW, không tự nhận leader đã approve.

Đọc: CLAUDE.md → docs/tasks/README.md → setup hiện hành trên board(chỉ đọc) → docs/tasks/tk-s7-parallel-2026-11-16.md → docs/tasks/tk-s7-kim-windows-delivery.md → docs/delivery/windows-kim/review-eeb801f.md → **leader-plan.md bản22/11** trong cùng thư mục → R11a/b/c tasks và Windows lab README/UPGRADE. Nếu có task-discipline thì đọc; không bịa nội dung file thiếu.

## Phạm vi

Sửa Windows delivery scripts/labs, build-ml-runtime.py, workflow Windows riêng, docs riêng/task Kim theo owner. Được thêm app/scripts/windows-delivery/**. Builder/NSIS/beforePack chỉ sửa delivery bug có repro, giữ verification/pins/identity.

Chỉ đọc app/src/**, contracts/migrations, ML source, package.json/lockfiles/Vite config, controller pins/catalog/build-release scripts khác, board/DECISIONS và core Sơn. Dùng API/CLI production sẵn có. Lỗi ngoài scope ghi bug packet cho Codex/coordinator; không sửa chéo. Không production DB/profile/VPS, dependency chưa duyệt hoặc invent coauthor.

## Làm ngay G0 và G1

Ghi START thực tế trong task và kiểm branch/SHA/status. Trong20phút đầu chốt tất cả external inputs còn thiếu một lượt: approved artifacts/deps và máy người dùng tự kiểm. Environment build local là việc của bạn. Thiếu artifact làm không thể build thì báo BLOCKED_PACKAGE ngay với exact file/hash/nguồn/thao tác cần người dùng, rồi tiếp T1–T3/phần độc lập. Không giấu tới cuối hoặc tự đổi pin cho kịp giờ.

### T1 — Backup/restore bằng implementation thật

Tạo/hoàn thiện backup-profile.ps1 và restore-profile.ps1 trong app/scripts/windows-delivery; runbook/tests gọi chính scripts này. Backup consistent DB/key/ml-state/UI. DB/key required cho supported populated profile; fresh profile chưa có model/UI thì ghi absence rõ; có model phải đủ pair.

Validate toàn bộ format/required inventory/size/hash/path/no-links/no-unlisted files/identity/version **trước khi chuyển profile hiện tại**. Staging mới và verified trước promote, giữ PreRestore, chống collision/overlap; không merge DB/key/model. Rejection giữ hash/vị trí profile hiện tại. Không execute pickle/binary để verify.

Case đang fail: manifest chỉ hash DB nhưng backup còn key/model ngoài manifest; manifest rỗng/thiếu required files. Cả hai phải reject trước thay profile. Chạy positive/tamper/missing/path/link/busy/collision theo matrix plan. Bỏ JS round-trip riêng không kiểm PowerShell thực được bàn giao.

### T2 — Process ownership thật

Không substring *ml-runtime* hoặc wildcard installation. Exact canonical executable thuộc exact installation, từng PID/start-time/parent/listener phù hợp; PID reuse/thiếu evidence thì không dừng. Đóng app bình thường trước. Helper default inspect, stop tường minh. Không kill theo tên chung. D:\UnrelatedApp\ml-runtime\python.exe phải bị từ chối.

### T3 — Dùng production verifier

Không chép contract thành bộ if/regex khác. Dùng exports hiện có của mlRuntime/controllerInstallerCatalog/controllerRelease từ source/build tin cậy. Adapter/bundle riêng dưới scripts/windows-delivery, dependencies đã duyệt; không sửa core/API/pin/catalog.

Thiếu đúng verifier/trusted pin/resource thì INVENTORY_ONLY/NOT_VERIFIED, package_ready=false; source gate vẫn chạy. Không tin stale out hoặc skip parity khi compiled verifier chưa có. Giữ full historical descriptors, không ép9 entries. Parity cả positive/negative: extra empty directory/duplicate entry hiện preflight vẫn nhận nhầm; controller cần verify payload/node/lock/installer/exact inventory, không chỉ metadata.

## G2 source và lỗi ngoài owner

Sau focused tests T1–T3 và lint đạt, khóa candidate SHA và chạy source runner đầy đủ. Leader18/11 có2621 PASS / 21 FAIL / 11 SKIP,8 failed files ngoài diff; đó là index cũ, không phải kết quả HEAD mới. Ngày22/11 implementation chưa đổi, preflight source-ready nhưng package blocked.

Tái hiện21fail, tách EPERM collector/.pytest_cache, PROJECT_SOURCE_UNSUPPORTED và WSL/bash/openssl; bug packet có file/test/command/env/SHA/raw error. Không baseline-only khi chưa đối chứng, không skip tests/delete cache/sửa permissions/core để xanh. Coordinator xử lý phần core. Fail phải propagate nonzero; fast mode incomplete; absent/invalid JSON/spawn/timeout/signal phải FAIL/UNKNOWN và có log.

Không full suite sau mỗi sửa văn bản. Focused meaningful checks trong vòng code; full types/build/full suite khi khóa checkpoint, rerun theo implementation/candidate/failure mới.

## G3/G4 resources và bộ cài

Preflight22/11: build venv 3.12.7, required 3.12.10;5 package lệch; thiếu ml-runtime/controller-releases; chưa có Windows độc lập. Chuẩn bị environment build riêng đúng lock/nguồn đã duyệt; không đổi pin/lock hoặc venv đang dùng. Artifact thiếu phải có exact ID/hash/source/owner/điều kiện gỡ, không tự approve hoặc lấy artifact đang ghi từ worktree khác.

Đủ resource mới production build + beforePack thật + NSIS output nonce mới, publish never; source/compiled/ASAR/exe/installer/manifests hashes. Chạy existing full-app/installer/upgrade labs: SQLite038/safeStorage/bundled ML thật, persistence DB/key/model/UI/trained_at qua cold reopen/repair/supported upgrade, đúng child PID/port, quit không orphan, resource bytes giữ. Synthetic180train/4scores chỉ runtime smoke.

Bạn chạy hết full-app/native/NSIS fixture labs tự động an toàn trên máy local. Người dùng làm phần Windows độc lập/production identity/default profile/shortcuts/UAC và ordinary install/uninstall trong một lượt cuối. Chuẩn bị artifact/hướng dẫn chính xác trước; không cài/gỡ bản đang dùng, không account isolation thay clean OS. NotSigned ghi đúng; không tắt Windows security.

Không tự SSH/kết nối/mutation VPS thật trong đợt này. VPS không cần cho install/ML bundled. Nếu demo cần SSH/deploy/live health, chuẩn bị input/UI hoặc existing CLI/expected result/cleanup đúng fixture để người dùng chạy. Không thêm feature, không đổi controller release/schema để phục vụ demo.

## G4 gói bàn giao và G5 một lượt người dùng

Runbook gọi đúng scripts đã test; backup/restore negative cases và round-trip tự động phải do bạn làm trước. Phần cần Windows identity/GUI/live credential ghi cho người dùng kiểm một lượt. Có log redaction, stop/rollback/cleanup. Demo8–10phút theo exact artifact SHA/feature baseline và ảnh dự phòng thực có.

Đọc và điền docs/delivery/windows-kim/manual-acceptance.md. Bàn giao một thư mục mới gồm installer, SHA256SUMS, report source/artifact identity, automation evidence, scripts đã test và checklist cuối. Điền trước version/hash/path/command/fixture; người dùng chỉ nhập secrets hoặc chọn máy/VPS thật. Không giao checklist trống rồi bắt người dùng làm phần có thể tự động.

Tách LOCAL_PASS, WAITING_USER và BLOCKED_CODE/PACKAGE. READY_FOR_MANUAL_CHECK chỉ khi có artifact thực dùng được và không lỗi code biết trước trong luồng tự nghiệm thu. Full suite còn fail ngoài scope phải báo đúng ảnh hưởng/điều kiện gỡ, không tự miễn hoặc ghi PASS.

Chưa actual artifact/lifecycle thì tài liệu vẫn DRAFT. Không nhận K1/K2/K3 hoặc release tổng hoàn tất từ lint/source tests.

## Bàn giao và tiếp tục

Bên trong từng Gx/Kx vẫn commit/evidence theo scope, nhưng không chờ người dùng duyệt từng checkpoint. G0 báo một danh sách external input thiếu nếu bắt buộc, còn lại tiếp tới gói cuối. Codex review/retest candidate tổng hợp rồi người dùng tự nghiệm thu một lượt. Normal commit/push theo quyền; pipeline fail thì báo fail.

Acceptance run ưu tiên clean candidate. Nếu docs ledger đổi sau test, ghi code SHA đã test và ledger SHA riêng. Dirty/untracked implementation phải hash bytes liên quan, không chỉ git status. Raw logs/DB/key/models/binary ở ignored nonce output, Git chỉ sanitized proof/docs. Không overwrite evidence cũ.

    Gx/Kx — CHỜ REVIEW | BLOCKED
    Code SHA / ledger SHA / branch / push state:
    Đã làm / files / owner:
    Requirement → PASS/FAIL/NOT_RUN/BLOCKED → evidence path + SHA256:
    Commands / exit / actual counts / skips:
    Environment / actual-synthetic-clean OS scope:
    Artifact hashes / persistence / PID-port-registry cleanup:
    Bug/blocker / owner / exact unblock condition:
    Việc đang tiếp tục độc lập:

Bắt đầu G0/G1 ngay. Mục tiêu hôm nay là gói sẵn sàng cho một lượt kiểm cuối: không chỉ source checks, không lịch nhiều ngày, không chuyển code bug thành việc thủ công.
