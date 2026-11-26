# Kế hoạch hoàn tất Windows delivery

> **Kế hoạch hiện hành 23/11/2026:** [completion-plan-20261123.md](completion-plan-20261123.md). User đã cung cấp private resources; 9 required releases verified, nhưng input catalog có 10 entries cần staging đúng compiled catalog. Dùng plan mới và [prompt Gemini mới](gemini-handoff-20261123.md). Nội dung 22/11 dưới đây là lịch sử, không còn là chỉ dẫn thực thi hiện hành.

Cập nhật theo yêu cầu mới **22/11/2026: hoàn thiện phần tự động trong hôm nay, trước một lượt tự nghiệm thu của người dùng**. Codex lập kế hoạch/review/kiểm thử; Gemini triển khai. Lịch nhiều ngày trước đây đã được thay bằng lịch trong ngày ở mục4. Tiếp tục từ eeb801fa5f5694c56feaf37543fb2a5b04b4f7f8 trên feat/kim-windows-delivery-20261116, giữ baseline f699615. Hạn dự án04/12 chỉ là bối cảnh, không dùng để kéo dài đầu việc này.

## 1. Đầu ra phải hoàn tất

Đầu ra trước lượt tự nghiệm thu hôm nay: code đã sửa lỗi biết trước, kiểm thử local có evidence, bộ cài từ verified resources khi đủ prerequisite, và một gói bàn giao duy nhất có checklist Windows/VPS/thao tác thủ công. Gemini làm hết phần có thể tự động; người dùng chỉ thực hiện phần cần máy/GUI/credential/VPS thật theo một checklist cuối.

Không chuyển code bug, thiếu tests hoặc setup dev chưa làm xong thành “người dùng tự kiểm”. Lab tự động với profile/output/identity fixture riêng vẫn do Gemini chạy. Người dùng làm production install/uninstall trên môi trường thử, GUI và kết nối/mutation VPS thật. K2/live gates giữ NOT_RUN/WAITING_USER tới khi thực hiện; code-ready không phải release PASS.

Nguồn yêu cầu: [task Kim](../../tasks/tk-s7-kim-windows-delivery.md), [bảng owner](../../tasks/tk-s7-parallel-2026-11-16.md), [review T1–T3](review-eeb801f.md). Không viết lại phần source tooling đã có chỉ để thêm một plan.

## 2. Hiện trạng xác minh ngày22/11

| Hạng mục | Hiện trạng | Việc cần làm |
|---|---|---|
| Git | HEAD eeb801f, remote nhánh Kim586b19a; local ahead3; có docs review chưa commit | Giữ docs, tiếp đúng nhánh; không pull/rebase core liên tục |
| Source tooling | Có preflight,12 probes, lint/types/build, source gate, workflow, logs/checksums | Chốt T1/T2/T3 và kiểm trên candidate mới |
| Full suite gần nhất | Leader18/11: 2621 PASS / 21 FAIL / 11 SKIP;8 failed files ngoài diff delivery; runner exit1 | Khoanh lỗi, coordinator/core xử lý; chưa có whole CI PASS |
| Preflight22/11 | source_ready=true, package_ready=false | Source-ready không chứng minh package đạt |
| Build Python | Venv 3.12.7, yêu cầu3.12.10;5 versions lệch: idna/narwhals/numpy/typing-inspection/uvicorn | Environment build riêng đúng approved lock |
| Resources | Thiếu app/resources/ml-runtime và controller-releases | Chuẩn bị artifact đúng nguồn/hash đã duyệt |
| Windows độc lập | Không phát hiện Sandbox; chưa xác nhận máy/VM riêng | Kim/coordinator xác định ngay G0 |
| Runbook/demo | Có draft, T1/T2 còn fail | Dùng script thật, negative tests và diễn tập trên artifact |

Ngày22/11 chỉ chạy mới preflight, không rerun full suite khi implementation chưa đổi. Số test trên thuộc18/11. Core remote đã tiến tiếp; luồng Kim vẫn ghim baseline, candidate ghép được kiểm riêng khi coordinator cho phép.

## 3. Quyền sửa và phối hợp

Gemini sửa Windows labs/build-ml-runtime.py cùng các delivery files được giao trong bảng owner; được thêm app/scripts/windows-delivery/**, sửa workflow Windows riêng, docs riêng/task Kim. Builder/NSIS/beforePack chỉ sửa lỗi delivery có repro và giữ verification/pin/identity.

app/src/**, contracts/migrations, ML source, package.json/lockfiles/Vite config, controller pins/catalog/build-release scripts khác, board/DECISIONS thuộc Sơn/coordinator. Chỉ đọc và dùng API/CLI sẵn có. Lỗi ngoài owner phải có bug packet; không sửa chéo hoặc nới guard. Không production profile/DB/VPS; không reset/clean/stash/rebase/force hoặc PR/merge/publish. Normal checkpoint push đúng nhánh đã được giao quyền. Dùng đúng danh tính tác giả/coauthor thực tế.

Gemini chạy checkpoint liên tục và lưu evidence từng phần, bàn giao tổng hợp một lần; không chờ người dùng duyệt từng sửa nhỏ. Codex nhận candidate cuối để review/retest trước lượt tự nghiệm thu. Chỉ báo sớm một danh sách tổng hợp khi có prerequisite bên ngoài thật sự chặn và tiếp phần độc lập ngay. Không có theo dõi nền hay phối hợp agent tự động giữa các phiên.

## 4. Lịch mục tiêu và gates

Mục tiêu bàn giao phần tự động trước **21:30 hôm nay22/11**, dành thời gian người dùng tự nghiệm thu trong ngày. T là lúc Gemini bắt đầu; ngân sách khoảng4–5giờ khi đủ approved artifacts. Thời gian là mục tiêu, không thay bằng chứng PASS. Thiếu prerequisite phải báo ngay, không hứa đã có bộ cài.

| Mốc | Đầu ra Gemini phải giao | Điều kiện nghiệm thu |
|---|---|---|
| G0 ·T+0–20phút | Rà source/resources và chốt toàn bộ external inputs còn thiếu một lần; chuẩn bị checklist cuối | Exact artifact/pin/source/owner; không hỏi thiếu từng món cuối ngày |
| G1 ·T+20–120phút | Sửa T1/T2/T3, targeted tests; chuẩn bị environment/resources ở mức không tranh output | Matrix mục6 đạt trên implementation thật, không thêm feature |
| G2 ·T+120–180phút | Khóa candidate; lint/types/build/full suite; xử lý hoặc đối chứng lỗi local | Không lỗi delivery còn biết; nonzero đúng scope; code bug không đẩy sang manual |
| G3 ·T+180–240phút | Verified resources, unpacked/NSIS mới, full-app/fixture lifecycle smoke | BeforePack/source/payload/hash/native/persistence/ownership đạt |
| G4 ·T+240–270phút | Review nội bộ và đóng gói installer/scripts/evidence/checklist/demo | Một bundle theo mục10, command/input/expected/stop rõ |
| G5 ·Một lượt của người dùng trong hôm nay | Windows độc lập/GUI và live VPS nếu cần luồng demo | Đi một checklist và ghi kết quả; agent chưa tự nhận PASS |

G0 phải xác định approved artifact/Python có sẵn hay không. Thiếu artifact khiến không thể tạo bộ cài thì ghi BLOCKED_PACKAGE ngay, gồm exact file/hash/kênh cung cấp/thao tác cần người dùng; không ém tới G4. Environment build local và deps từ nguồn đã duyệt là việc Gemini, không bắt người dùng setup dev sau khi nhận bộ cài.

Gemini xử lý/đối chứng failures trong phạm vi local/owner. Bug core thật ngoài owner phải báo leader/coordinator ngay và giữ blocker kỹ thuật, không chuyển thành manual check. Chỉ gate thực sự cần Windows độc lập/VPS/credential/GUI thật mới để WAITING_USER. Lỗi source chưa giải thích không biến thành PASS vì tới giờ bàn giao.

## 5. G1 sửa dứt điểm ba lỗi

### T1 · Backup và restore phải là script thật

Đưa implementation vào backup-profile.ps1 và restore-profile.ps1 dưới app/scripts/windows-delivery (hoặc tên tương đương chốt trong runbook). Tests/runbook phải gọi chính scripts này, không giữ thuật toán JS copy/restore khác chỉ làm round-trip xanh.

Đóng app/ML đúng ownership trước khi backup nhất quán DB/WAL/SHM, protected key, ml-state và UI storage. DB/key là required với supported populated profile. Model/UI có thể chưa tồn tại trên fresh profile nhưng manifest ghi absence rõ; khi có state phải giữ đủ state.pkl/meta.json. Manifest có format/version, inventory/size/hash và identity/compatibility cần thiết; report không chứa bytes nhạy cảm.

Restore xác minh toàn bộ backup trước khi chuyển profile hiện tại: required items, schema, exact inventory, size/hash, canonical paths, không absolute/traversal/duplicate/link hoặc file ngoài manifest. Không execute pickle/source/binary để verify. Copy đúng inventory đã verify sang staging mới, kiểm staging rồi promote; giữ PreRestore và chống collision/overlap. Negative cases không đổi hash/vị trí profile hiện tại. Không ghép DB/key/model giữa các bản; không tạo tính năng export/re-key, giữ giới hạn DPAPI.

### T2 · Xác minh đúng process ownership

Bỏ substring/wildcard *ml-runtime*. Dùng exact canonical executable thuộc exact installation và bằng chứng PID/start-time/parent/listener phù hợp. Query listener, xét từng PID riêng; PID/path đổi hoặc thiếu evidence thì từ chối. Default chỉ inspect; stop tường minh chỉ trên owned process. Không kill theo tên chung, process ứng dụng khác hoặc bản cài đang dùng khác.

### T3 · Dùng production verifier

Dùng exports hiện có từ source/build tin cậy: verifyMlRuntime/verifyPackagedMlResources và verifyPackagedControllerResources/ControllerInstallerResources.verify. Có thể thêm adapter/bundler riêng dưới scripts/windows-delivery với dependencies đã duyệt; không sửa core/contract hoặc sao chép thành bộ if/regex khác.

Source gate vẫn chạy khi thiếu resource. Chưa có đúng verifier/trusted pin/resource thì INVENTORY_ONLY/NOT_VERIFIED và package_ready=false. Không dùng stale out hoặc skip parity khi compiled verifier chưa có. Không nhận SHA tự kê của artifact lạ làm approval. Giữ full trusted catalog/historical descriptors; không hardcode9 entries. Package gate phải cùng verdict với beforePack, gồm payload/node/lock/installer/exact inventory.

## 6. Matrix kiểm thử G1

| Phần | Cases bắt buộc | Expected |
|---|---|---|
| Restore positive | Supported profile đầy đủ, manifest đúng, restore fixture; so DB/key/model/meta/UI hashes | Consistent; marker-only không gọi DPAPI/ML native PASS |
| Restore negative | Empty/missing manifest, thiếu DB/key, missing model pair, hash/size mismatch, unlisted file/dir, traversal/absolute/duplicate/link, busy profile, collision/overlap, unsupported identity/version | Reject trước đổi profile; hash/vị trí hiện tại nguyên vẹn |
| Process | Owned child đúng, app khác có path ml-runtime, installation sibling, nhiều PID/port, PID reuse/start mismatch, thiếu evidence | Chỉ owned case được thao tác; negative không kill |
| ML parity | Positive; wrong .pth; missing/modified/extra files; extra empty dir; duplicate entry; link/traversal; wrong/missing pin; malformed manifest | Adapter/preflight và production cùng verdict |
| Controller | Approved positive; tamper payload/node/lock/manifest/installer; missing/unknown/duplicate/historical resource; link/layout | Same production verdict, không chỉ metadata |
| Runner | Source gate fail, failing test/lint, skipped suite, timeout/spawn/signal, absent/invalid JSON, output collision, dirty/untracked source | Fail/incomplete/unknown đúng scope và có logs/errors/hashes; không false PASS |

Fixture nonce có scope guard; fail giữ diagnostics; cleanup chỉ owned scope. Chạy focused meaningful checks trong vòng code, không full suite sau mỗi sửa văn bản. Khóa code candidate ở G2 rồi chạy source/types/build/full suite. Rerun rộng hơn khi implementation/candidate thay đổi hoặc failure mới yêu cầu.

## 7. G0/G2 xử lý blocker thực tế

- Python/deps: environment riêng Python 3.12.10 AMD64 và closure20 packages theo runtime-lock, nguồn đã duyệt và versions/hashes rõ. Không pip install -U, sửa lock hoặc venv đang dùng; thiếu source/pin thì coordinator cung cấp/duyệt.
- Controller resources: xuất exact release ID, release/installer pins, files cần và nguồn từ trusted compiled catalog/source descriptors. Nhận artifact qua kênh được duyệt rồi passive verify. Không lấy artifact đang ghi hoặc copy node_modules/venv/userData từ worktree Sơn.
- Windows: Kim/coordinator xác định máy/VM disposable, account/OS/build/arch, trạng thái không developer Node/Python. Account mới trên máy dev chỉ là isolation. Chưa có máy thì ghi điều kiện gỡ và chuẩn bị checklist chuyển môi trường.
- 21 test ngoài owner: dùng JSON/log18/11 làm index rồi tái hiện focused trên source hiện hành. Tách EPERM collector/.pytest_cache, PROJECT_SOURCE_UNSUPPORTED, WSL/bash/openssl. Nếu đối chứng thì dùng source checkout riêng/environment đúng; không delete cache/chmod hoặc sửa core chỉ để xanh. Bug packet gồm file/test/error/command/env/SHA/proposed owner. Không skip hoặc tự gọi baseline-only.

K1/package và runbook có thể tiến tiếp khi core/coordinator xử lý lỗi ngoài owner nếu các gate đó được kiểm độc lập. Không giấu source failures bằng scoped package PASS. Candidate ghép/integration do coordinator quyết định, deadline không tự miễn gate.

## 8. G3 tự động và G5 người dùng kiểm artifact/lifecycle

Đủ prerequisite mới build source và NSIS vào output nonce mới trong ignored .out-scripts, publish never, giữ beforePack thật. Ghi source SHA và compiled Main/preload/renderer, ASAR/exe/installer/resource manifest hashes. Dùng full production app/SQLite038/safeStorage/bundled ML thật, không mock/surrogate thay full app. Theo existing Windows release/installer/upgrade labs và README.

Cold reopen giữ DB/key/model/trained_at/UI; synthetic180train/4scores chỉ delivery runtime smoke. Child PID/executable/listener thuộc app, hai lần quit giải phóng process/port; resource bytes không đổi. Missing/tamper fail rõ và giữ data. Same-version repair và supported predecessor upgrade là hai cases riêng; theo trusted R11c policy, không đổi version/retrain để né preservation.

Người dùng kiểm Windows độc lập/GUI theo [checklist một lượt](manual-acceptance.md): production identity/default profile/shortcuts, OS/build/user context/checksum; mở bình thường không profile/debug override; không Node/Python dev. Ordinary uninstall dọn exact app/shortcut/registry và giữ data theo policy, không gỡ bản đang dùng trên máy dev. Ghi NotSigned đúng thực tế, không tắt Windows security. Chưa có môi trường thì K2 NOT_RUN.

## 9. Bàn giao và chốt hoàn thành

Mỗi checkpoint: tự kiểm → commit code candidate local → acceptance run trên code SHA rõ → cập nhật ledger với code SHA và ledger SHA nếu chỉ docs đổi → normal push đúng nhánh khi scoped checkpoint đạt. Giữ docs Codex đang local; không reset/stash/clean để có source sạch. Dirty/untracked implementation phải hash nội dung files, không chỉ tên trong git status; ưu tiên clean candidate.

Báo blocker và exact unblock condition ngay; quá30phút ghi task rồi tiếp phần độc lập. Codex nhận SHA/evidence để review/retest. Technical acceptance theo requirements thực có; merge/main/publish toàn dự án theo quyền/quy trình riêng.

    Checkpoint Gx/Kx — CHỜ REVIEW | BLOCKED
    Code SHA / ledger SHA / branch / push state:
    Changed files và owner:
    Requirement → PASS/FAIL/NOT_RUN/BLOCKED → evidence path + SHA256:
    Commands / exit / actual counts / skips:
    Environment và actual/synthetic/clean OS scope:
    Artifact hashes / persistence / PID-port-registry cleanup:
    Bug còn mở / owner / exact unblock condition:
    Việc đang tiếp tục độc lập:

G4 chuẩn bị scripts đã test và demo8–10phút; người dùng làm phần GUI/live ở G5. Feature live Git/database/VPS chỉ theo baseline/phạm vi đã xác nhận. Proof bundle sanitized; DB/key/pickle/binaries ở ignored/private. Chưa có observations thật thì phần đó vẫn DRAFT/NOT_RUN.

## 10. Một gói bàn giao trước tự nghiệm thu

Gemini chuẩn bị một thư mục output mới gồm installer thực, SHA256SUMS, source/artifact identity, automation report, scripts backup/restore/process đã test và checklist một lượt. Binary/raw logs ở ignored output, ghi absolute path trong hồ sơ. Không commit binary/DB/key/model. Chốt code SHA trước acceptance run, không đổi payload âm thầm sau khi phát checklist.

- Tóm tắt một trang: local PASS gì, WAITING_USER gì, có BLOCKED_CODE/PACKAGE hay không. READY_FOR_MANUAL_CHECK chỉ khi có artifact dùng được và không lỗi code biết trước trong luồng đó.
- Checklist có thứ tự, command/UI action cụ thể, input người dùng thật sự phải nhập, expected output, stop/rollback và chỗ lưu log. Gemini điền version/hash/path/fixture IDs trước, không bắt người dùng tự đoán command/artifact.
- VPS không cần cho install/ML bundled local. Chỉ thêm live VPS khi cần luồng SSH/deploy/demo đã chọn. Gemini không tự SSH/mutation/production DB trong đợt này; chuẩn bị exact existing CLI/UI steps và cleanup đúng test fixture cho người dùng.
- Người dùng đi một checklist cuối; nếu external input thật sự bắt buộc thì G0 báo sớm một lượt tổng hợp. Không yêu cầu duyệt code theo từng checkpoint.
- Sau manual FAIL: sửa và kiểm lại phần bị ảnh hưởng, không bắt làm lại toàn bộ nếu không có lý do. Không hứa mọi gate PASS trước kết quả thực.

Prompt hiện hành: [gemini-handoff.md](gemini-handoff.md).
