# Gemini — chốt PASS thật phạm vi Kim, 25/11/2026

Bạn code, Codex là leader retest. Tiếp tục nhánh `feat/kim-windows-delivery-20261116` từ actual candidate `f8da4b29b09b1914b2be6b58ef92dd38e767949a`. Đọc [review-f8da4b2.md](review-f8da4b2.md) và task Kim. Chỉ sửa phần delivery thuộc Kim. Yêu cầu user mới nhất: **mọi test thuộc Kim phải PASS thật; phần Sơn phải có bàn giao rõ để Sơn kéo code, tích hợp và tự test lại.**

## 1. Sửa blocker, không mở rộng scope

- Sửa legacy 0.1.0 transaction trong `app/resources/installer.nsh`: inventory/move/rollback phải bao gồm Hidden/System, fail closed khi enumeration/move lỗi; xác minh rollback trước cleanup và giữ recovery nếu chưa hoàn tất. Không xóa backup hoặc nuốt lỗi rồi trả success khi target chưa có đủ payload mới.
- Repro đã có: predecessor thật 0.1.0, Hidden `resources`, native lock `app.asar`; full installer hiện exit 0 nhưng ASAR giữ hash 0.1.0, khác target 0.2.0. Script/evidence ignored được chỉ trong review. Tạo case/output mới có ownership; không ghi đè result cũ, không dùng production installation/profile.
- Sửa việc sinh `candidate_commit_sha`: đọc actual full Git SHA, không tự ghép từ short SHA. Ghi rõ source SHA, dirty diff nếu có và build identity. Metadata và SHA256SUMS phải khớp bundle cuối.

## 2. Build và kiểm thử trên artifact mới

Sau sửa source, chạy scoped lint/standalone; build source và NSIS với resources đã duyệt, `--publish never`. Tạo fixture mới bằng labs hiện có; kiểm include/source/installer hashes, không dùng executable cũ để nhận PASS cho source mới.

| Gate thuộc Kim | Điều kiện bắt buộc |
|---|---|
| Source/build tooling delivery | Scoped lint zero warnings; standalone đủ 12 checks; types/build/source runner có evidence cuối và phân loại lỗi ngoài owner |
| Backup/restore/process | Giữ các native/mocked positive và negative cases đã được leader duyệt; không mất rollback, ownership hoặc listener guards |
| Packaged resources | Actual beforePack/production verifiers controller + ML PASS; ASAR/source identity và inventory khớp |
| Uninstaller + full installer | Cả 8 probes hiện có PASS; rejected cases nonzero, giữ payload/recovery/registry; reinstall/uninstall thật thành công |
| Legacy safety | Predecessor thật: visible/Hidden `resources` + locked ASAR; backup pending, running process, failed move/rollback có bằng chứng; không biến failed cleanup thành success |
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
