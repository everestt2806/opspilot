# Review tiến độ eeb801f — 18/11/2026

Candidate `eeb801f`, nhánh `feat/kim-windows-delivery-20261116`. Source sạch trước kiểm tra, local ahead3 so với remote586b19a quan sát được. **Chưa nghiệm thu toàn bộ Windows delivery**. Có tiến triển đáng kể ở source tooling/CI và tài liệu, nhưng chưa có package/Windows độc lập, và các guard dưới đây vẫn cần sửa.

## Đã làm được

- Preflight đọc môi trường/build interpreter, pin pnpm, baseline/ref, schema Desktop038 và liệt kê thiếu resources.
- Lab schema so exact applied migrations `[1..36,38]`; đường build output độc lập máy dev.
- Source runner có lint max-warnings0, source-readiness gate bắt buộc,12standalone checks, Node/Web/scripts types, source build và full Vitest.
- Fast mode không còn được coi full PASS; lỗi spawn/timeout có signal/error metadata; phân biệt outside-scope với proven baseline; có logs/nonces/source provenance/checksums.
- Runbook đã bổ sung DB/key/ml-state/UI, checksum manifest, giữ profile cũ trước restore, sửa log path và đánh dấu CP4 là draft. Bỏ lệnh kill theo tên chung; positive/negative ML `.pth` cơ bản đã đúng hơn.

Leader đã đối chiếu19/19hash của evidence Gemini `source-runs/run-1795002724530-24256-aef0bf`: tất cả khớp. Report đó ghi sourceffe7fe6+dirty diff (trước commit cuối), Node22.17.0/pnpm11.5.1; không lấy nó làm bằng chứng sạch của eeb801f. Trong evidence đó full suite thực sự có JSON:184files/175PASS/8FAIL/1SKIP;2653tests/2621PASS/21FAIL/11SKIP.0Vitest suites thuộc đường dẫn delivery fail là quan sát theo phân loại, không chứng minh source delivery không còn bug.

## Còn lỗi phải sửa

### T1 — Restore chưa xác minh đúng tập dữ liệu trước khi thay profile

`demo-runbook.md:172–213` kiểm hash các item *được liệt kê* nhưng sau đó copy cả DB/key/ml-state/Local Storage từ backup, gồm các file không có trong manifest. Thiếu required items/manifest rỗng cũng chưa bị từ chối trước khi Move-Item profile đang dùng.

Leader chạy **chính script PowerShell trong runbook** trên profile giả, APPDATA riêng thuộc ignored review directory; chỉ thêm guard kiểm absolute source/destination của Move-Item trong fixture. Không động profile thật:

| Case | Kết quả thực tế |
|---|---|
| Manifest chỉ hash DB, backup còn key/model ngoài manifest | Exit0; key/model chưa được xác minh vẫn được restore |
| Manifest items=[] và backup thiếu DB/key | Exit1 nhưng profile cũ đã bị chuyển, profile hiện hành đã được tạo rỗng |

Profile cũ được giữ ở PreRestore là điểm tốt, nhưng failure phải xảy ra **trước khi thay profile hiện hành**. Probe là marker files, không giả nhận SQLite/DPAPI/ML native PASS.

Yêu cầu: validate format/required set/size/hash/paths/no-links/no-unlisted files trước mọi mutation; copy đúng inventory đã verify. Kiểm process đã dừng và identity/compatibility. Ưu tiên đưa backup/restore vào `.ps1` thuộc `app/scripts/windows-delivery/**`, runbook gọi script đó; probes gọi chính implementation này, không kiểm một thuật toán JS khác. Test positive và tamper/missing/empty-manifest, giữ profile nguyên vị trí khi reject.

### T2 — Process ownership vẫn nhận đường dẫn không thuộc OpsPilot

`demo-runbook.md:310` dùng điều kiện substring `expectedDir` hoặc bất cứ đường dẫn nào chứa `ml-runtime`. Predicate nhận **D:\UnrelatedApp\ml-runtime\python.exe** là process OpsPilot. Đây là probe string-only; leader không chạy Stop-Process.

Yêu cầu: xác minh exact canonical executable path trong exact installation và PID/start/parent ownership phù hợp. Query listener, xử lý từng PID riêng, không dựa vào mảng socket hoặc substring chung. Path ứng dụng khác có `ml-runtime` phải bị từ chối; không kill toàn bộ Python hoặc bản OpsPilot khác.

### T3 — Resource checker chưa tương đương production verifier

Preflight vẫn tự triển khai verifier riêng. `.pth` đã sửa nhưng còn false positives. Leader tạo passive fixtures15files và trusted manifest pin, không chạy binary:

| Fixture | Production verifyMlRuntime | Preflight eeb801f |
|---|---|---|
| Positive đúng contract | ACCEPTED | VERIFIED |
| Thêm thư mục rỗng ngoài manifest, pin giữ nguyên | REJECTED | VERIFIED |
| Manifest có duplicate file entry | REJECTED | VERIFIED |

Controller đã đọc đúng release-manifest.json nhưng vẫn chỉ kiểm metadata/hash manifest và installer, **không verify từng payload file/node/lock/exact release inventory** bằng production verifier. Catalog chưa đối chiếu exact descriptor/pin set và đang ép đúng9entries, không giữ được historical entries khác nếu trusted build cần chúng.

Yêu cầu: dùng lại passive production verifiers từ đúng source/build tin cậy. Nếu chưa verify được thì ghi INVENTORY_ONLY/NOT_VERIFIED và không cấp package_ready. Không sửa core/pin/catalog để chiều lab. Source preflight có thể báo thiếu artifacts mà vẫn kiểm source được; acceptance tài nguyên phải giữ độc lập. Không tiếp tục bổ sung từng if để “khớp tương đương” một contract thứ hai.

## Các việc sau khi chốt guard

1. Gỡ các failing tests ngoài scope delivery cùng core/coordinator; chưa được coi full CI xanh. Không bỏ test hoặc gọi baseline-only khi chưa đối chứng.
2. Chuẩn bị approved Python3.12.10/dependencies theo lock và generated ML/controller resources có nguồn/hash xác định; giữ environment hiện có.
3. CP2: dựng package/NSIS mới trên source đã chốt, actual beforePack, SQLite/safeStorage/bundledML, persistence và child PID/port checks.
4. CP3: Windows độc lập/default profile/production identity/shortcuts, repair/supported upgrade/uninstall, dữ liệu giữ và không orphan process.
5. CP4: cập nhật runbook bằng kết quả thực tế, restore round-trip có credential decrypt/ML inference khi đủ môi trường, diễn tập demo8–10phút trên đúng artifact SHA.
6. Normal push các checkpoint đạt review; hiện3commits còn local. Actions chưa có run quan sát được; chưa PR/merge/publish.

## Kết quả leader chạy lại

Raw local: `app/.out-scripts/windows-delivery/leader-final-review-20261118T120505Z/`; context ghi exact HEAD và source sạch trước review.

| Check | Trạng thái |
|---|---|
| Lint/source gate/12probes/Node-Web-scripts types | PASS qua default runner leader chạy |
| Source build | PASS |
| Restore negative cases | FAIL guard như T1 |
| Process ownership predicate | FAIL như T2 |
| ML resource parity positive/negative | Positive PASS; hai negative FAIL như T3 |
| Full runner/Vitest trên eeb801f | Hoàn tất, runner exit1/PARTIAL_OUTSIDE_SCOPE_FAILURES;7/8steps PASS;184files:175PASS/8FAIL/1SKIP;2653tests:2621PASS/21FAIL/11SKIP |
| Actual NSIS / clean Windows / Actions | NOT_RUN |

Kết quả trên do leader chạy lại đúng source eeb801f, không tái dùng số test của Gemini hay lượt trước. Full suite không timeout, có JSON hoàn chỉnh;8failedfiles đều trong src/** ngoài diff delivery (EPERM/source verification/WSL-bash-openssl như hồ sơ trước), nhưng chưa có baseline comparison để gọi là lỗi được miễn. Không có Vitest delivery suite fail theo path classification;12probes PASS không bao phủ hết lỗi T1–T3 mà leader đã tái hiện. Raw report và logs có checksum manifest được đối chiếu trước bàn giao.

Nhận định tiến độ: CP0/CP1 đã có implementation dùng được để kiểm source và ghi evidence, chưa accept tổng vì T3 và full-suite failures; CP2 blocked prerequisite; CP3 chưa chạy; CP4 là draft có nội dung nhưng T1/T2 còn mở. Không đổi thành % hoàn thành khi chưa có artifact/lifecycle evidence.
