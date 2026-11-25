# Gemini — chốt PASS thật phạm vi Kim, 25/11/2026

> **Mốc hiện hành 723af02 / R11:** Đọc [review-723af02.md](review-723af02.md). Tất cả ca lỗi cũ đã retest PASS: metadata, UTF-8/output guards, Hidden/locked payload, cleanup pre-lock, C4 và C5. Các chỉ dẫn sửa e2d599d/R10 bên dưới là lịch sử, không tự làm lại.

## Việc còn lại đúng theo evidence R11

Chỉ xử lý **P1 POST_STAGING_CLEANUP**: native lock sau khi directory đã rename sang `_b_trash`; setup hiện exit 2 và mất 3,393/3,401 old files trên union install/backup/trash. Script/evidence và SHA fixture được chỉ trong review hiện hành. Đây là nhánh mới, không phải báo lại pre-lock R10 đã PASS.

Không vá bằng thêm pre-check/rename trước recursive delete: lỗi phát sinh trong delete vẫn không rollback được các file đã xóa. Đổi đúng lifecycle/commit point: giữ full recovery cho tới khi target mới đã cài và được xác minh đầy đủ; xử lý cleanup sau commit và ownership/retry/reinstall/uninstall theo trạng thái thực. Gemini tự đọc template/hooks electron-builder đang dùng và chọn cách nhỏ nhất trong scope Kim. Không sửa core/predecessor/pins/contracts.

Tiêu chí: nếu setup nonzero trước commit, đủ old hashes trong install hoặc recovery được chỉ rõ; nếu success, đủ new target inventory/ASAR hash, registry và profile/key/model/migration đúng. Không kiểm mỗi exit code/executable, không đổi assertion để nhận partial payload. Nếu thay đổi expected outcome vì dời cleanup sau commit, mô tả rõ semantics và thêm mạnh postconditions xác minh target, persistence, retry, thay vì miễn lỗi.

Chạy native post-staging fault và giữ pre-lock controls; rebuild NSIS/bundle mới, retest affected supported upgrade + 8 standard probes + 12 standalone + scoped lint. Những gates đã đạt giữ nguyên, không mở lại từ ký ức/review cũ. Ghi actual SHA/source/artifact, evidence mới, trạng thái từng case. Sơn giữ packet riêng; manual thật WAITING_USER; không tự push/publish/VPS/private commit. Bàn giao Codex retest đúng candidate mới.

## Các vòng trước — chỉ để tra lịch sử

## Lịch sử chỉ dẫn sau retest e2d599d / R10

Đọc [review-e2d599d.md](review-e2d599d.md). Actual HEAD mới `e2d599d7e28326c8f25beb7d634a889abc299724`. Hidden resources + locked ASAR và full SHA metadata đã leader PASS. Không làm lại phần đã đóng chỉ để đổi vòng báo cáo.

**P1 còn thật:** cleanup backup trong `installer.nsh:125` xóa 3,059/3,067 old files trong fixture khi native file lock nằm ở backup; setup exit 2 nhưng chỉ còn 8 files recovery. Giữ backup đầy đủ cho tới commit cài đặt/khả năng phục hồi được xác minh; cleanup failure không được làm mất bản sao duy nhất. Dùng native repro v2 trong review, tạo case mới có ownership; không lấy case v1 chưa bắt được lock để báo PASS/FAIL. Rerun rejected upgrade và kiểm union install+recovery hashes, cùng happy upgrade đúng target và rollback failure/backup-pending controls.

**P2 probe:** sửa `windows-legacy-locked-probe.py` để validate owner/path/GUID/hash/provenance trước mọi mutation, từ chối output có sẵn mà không ghi đè owner/xóa `install`, và thiết lập UTF-8 stdout/stderr. Bổ sung negative tests invalid fixture/foreign owner/existing output bảo toàn marker và không spawn installer. Sửa trong scope Kim; không chuyển cho Sơn.

Sau sửa: build NSIS và bundle mới, rerun gates bị ảnh hưởng, giữ đủ 8 standard probes + 12 standalone + scoped lint đạt thực tế. Khi lab nặng tranh tài nguyên, chạy kiểm tra source tuần tự để phân biệt timeout môi trường; không nới budget/skip checks chỉ để xanh. Cập nhật provenance source report: run hiện tại thực là f8da4b2+dirty, không clean e2d599d. Dossier/bundle ghi đúng 21 files của R10 và trạng thái leader, không tự nhận KIM_SCOPE_PASS trước retest.

Leader đã chạy lại standalone riêng: 12/12 PASS, 205.25s. Standard probes có 6 rejection cases PASS, C4 timeout 180s và C5 NOT_RUN; cần chạy C4/C5 tuần tự trên fixture mới sau sửa và lưu thời gian/postconditions thật. Fixture 1aec6a5f4c96 hiện có partial files sau timeout, registry/process 0; lệnh recursive cleanup đã bị automatic policy chặn, giữ diagnostic ignored. Không chạy lại script trên fixture đó theo giả định “clean install”; không đổi cách xóa để vượt chặn. Dùng nonce mới thay vì phụ thuộc partial state.

21 core failures/8 files vẫn bàn giao Sơn theo packet, không chặn làm Kim độc lập. Không cần sửa core hoặc rerun full Vitest cho mỗi thay đổi docs; khi khóa candidate source cuối, giữ evidence/provenance đúng và chạy required checks theo plan dưới đây. Bàn giao local cho Codex với từng gate PASS/FAIL/NOT_RUN; private resources/log/binaries chỉ ignored, không tự push/VPS/publish.

## Kế hoạch nền và checklist phạm vi

Bạn code, Codex là leader retest. Tiếp tục nhánh `feat/kim-windows-delivery-20261116` từ actual candidate `e2d599d7e28326c8f25beb7d634a889abc299724`. Đọc [review-e2d599d.md](review-e2d599d.md) và task Kim. Chỉ sửa phần delivery thuộc Kim. Yêu cầu user mới nhất: **mọi test thuộc Kim phải PASS thật; phần Sơn phải có bàn giao rõ để Sơn kéo code, tích hợp và tự test lại.**

## 1. Sửa blocker, không mở rộng scope

- Sửa thời điểm/cơ chế cleanup của legacy transaction theo P1 hiện hành: giữ đủ dữ liệu khôi phục khi cleanup lỗi hoặc chưa commit target. Tiếp tục giữ Hidden/System/fail-closed guards đã đạt.
- Thêm regression native sau move: lock executable ở backup, installer nonzero vẫn phải bảo toàn toàn bộ inventory trong install/recovery. Sửa output guard/UTF-8 của probe và kiểm negative controls như chỉ dẫn đầu file. Không ghi đè result cũ, không dùng production installation/profile.
- Giữ cách lấy full `candidate_commit_sha` đã đạt; ghi source SHA/dirty diff/build identity đúng cho từng report, không nhận precommit evidence là clean HEAD.

## 2. Build và kiểm thử trên artifact mới

Sau sửa source, chạy scoped lint/standalone; build source và NSIS với resources đã duyệt, `--publish never`. Tạo fixture mới bằng labs hiện có; kiểm include/source/installer hashes, không dùng executable cũ để nhận PASS cho source mới.

| Gate thuộc Kim | Điều kiện bắt buộc |
|---|---|
| Source/build tooling delivery | Scoped lint zero warnings; standalone đủ 12 checks; types/build/source runner có evidence cuối và phân loại lỗi ngoài owner |
| Backup/restore/process | Giữ các native/mocked positive và negative cases đã được leader duyệt; không mất rollback, ownership hoặc listener guards |
| Packaged resources | Actual beforePack/production verifiers controller + ML PASS; ASAR/source identity và inventory khớp |
| Uninstaller + full installer | Cả 8 probes hiện có PASS; rejected cases nonzero, giữ payload/recovery/registry; reinstall/uninstall thật thành công |
| Legacy safety | Predecessor thật: visible/Hidden `resources` + locked ASAR; backup pending, running process, failed move/rollback/cleanup có bằng chứng; rejected setup giữ đủ inventory tại install/recovery, không chỉ kiểm nonzero |
| Legacy happy path | Upgrade 0.1.0→0.2.0 cài đúng target payload; schema 38/note/key/model/scores giữ đúng; cold reopen/uninstall đúng |
| Full app/installer lifecycle | Chạy labs positive 5/7 checks theo README hiện hành trên artifact mới; persistence, child ML, reinstall và cleanup đúng |
| Final bundle | Bundle mới, full source identity đúng, signature ghi thực tế, đủ scripts/checklist/evidence, manifest bao phủ và khớp mọi file |

Chạy checks phù hợp thay đổi; evidence cũ chỉ được viện dẫn khi ghi rõ source/hash không đổi và thời điểm đã kiểm. Case mới và gates bị ảnh hưởng bắt buộc chạy trên build mới. Không sửa assertion, bỏ test, skip/xfail hoặc gắn nhãn “ngoài phạm vi” cho lỗi installer/packaging để có PASS. Không dùng JSON report đơn thuần thay cho việc xác nhận tiến trình và postconditions thực tế.

## 3. Tách bàn giao Sơn

Đọc [son-integration-handoff-20261125.md](son-integration-handoff-20261125.md). Khi khóa candidate cuối, chạy source runner đầy đủ một lần theo CLI hiện có, lưu JSON/log/provenance ignored; cập nhật packet theo kết quả thực tế. Nếu còn 21 failures hoặc kết quả khác, ghi đúng số/test/error, không lấy số lịch sử làm kết quả mới.

Mỗi lỗi Sơn cần: file/test, repro command, expected/actual, môi trường, source SHA/evidence, owner và điều kiện chạy lại sau tích hợp. Phân biệt EPERM/cache với lỗi source và thiếu Linux/WSL/bash/openssl; không mặc định tất cả là bug sản phẩm. Không sửa core/contracts/migrations/pins/package/lock/board/DECISIONS ngoài quyền.

Một lỗi phát sinh sau sửa delivery hoặc chặn chính luồng cài/restore/upgrade của Kim vẫn phải điều tra trong phạm vi Kim; không chuyển trách nhiệm chỉ vì stack trace nằm trong core. Sơn sẽ xử lý phần core/tích hợp sau khi kéo, không cần chờ Sơn để hoàn tất các gate Kim độc lập.

## 4. Bàn giao Codex

Cập nhật task Kim/manual checklist thành một trạng thái hiện hành rõ ràng, lịch sử để riêng. Report: actual candidate SHA; từng gate PASS/FAIL/NOT_RUN; installer/bundle/hash; evidence; phần Kim còn lại; packet Sơn và lệnh retest sau tích hợp. Chỉ đề nghị `KIM_SCOPE_PASS` khi không còn failure/NOT_RUN bắt buộc thuộc Kim; Codex sẽ retest trước khi xác nhận. Phần chưa tích hợp để `SON_INTEGRATION_PENDING`, không báo whole CI xanh.

Manual Windows độc lập/GUI/UAC/default identity/DPAPI/credential thật và VPS thật theo luồng người dùng chọn ghi riêng `WAITING_USER`; không chuyển việc sửa code/test tự động sang user. Chưa tự nhận user acceptance.

Private input/resources/raw logs/bundle/binaries chỉ local ignored, tuyệt đối không commit/push/upload thư mục `docs/secrect docs` hay nội dung của nó. Giữ bundle cũ nguyên trạng. Không merge/reset/clean/stash/force, không tự kết nối VPS/publish. Không push thêm từ prompt này; chỉ chuẩn bị source/docs sanitized theo owner và bàn giao local cho Codex.
