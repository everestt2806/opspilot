# R3b — Protected controller bootstrap and cold recovery

START 06/11/2026 — Tiếp user request “làm hết”, base R3a `1e4df09`, R2 `950b7ae`. R3a adapter đã có local gate; R3b chưa triển khai. Không mở public admin API, không đổi nguồn authority SQLite hoặc tự trust host key.

## Requirement ledger

| Yêu cầu | Gate | State |
|---|---|---|
| Protected controller credential/key store | Reuse pure AES-GCM cipher; Linux owner/mode/symlink/hardlink/tamper/binding tests, không implicit key regeneration | OPEN |
| Explicit target enrollment theo app/generation | Pinned SSH; helpers immutable/checksum, HMAC key riêng, lost-response reconciliation, không dùng lab initializer như production proof | OPEN |
| Startup recovery và resource admission | T1 pending settlement đọc bằng exact key/identity; pre-T1 unknown không replay; disk/RAM/Docker readiness trước mutation | OPEN |
| Service composition opt-in + health/status đúng | Queue + per-claim executor/verifier, startup/shutdown/OS restart, polling-only không bị hiểu là auto deploy ready | OPEN |
| Complete standalone controller bundle | templates/collector/requirements + 3 Python helpers + manifest; init/status/run không phụ thuộc repo cwd | OPEN |
| Live controller/VPS acceptance | Endpoint hiện hành + pin độc lập + resource allocation; không chạy fault trên VPS shared | BLOCKED |

## Kết quả kiểm kê chỉ đọc 06/11

- Tìm được `%APPDATA%/OpsPilot/opspilot.db`. Mở bằng `better-sqlite3` **readonly/fileMustExist**, không gọi `initializeDatabase`, không migrate hay sửa profile.
- Metadata chỉ có hai profile VM01/VM02 cũ, cả hai `host_fingerprint=NULL`, mỗi VPS có một app Express; `domain_binding` rỗng. Không đọc cột credential/iv/auth_tag, không giải mã hoặc đưa secret lên terminal.
- Không suy ra VPS cũ đã hết hạn, nhưng chúng **chưa đủ dữ liệu tin cậy để SSH auth** theo policy hiện hành. Không keyscan rồi tự lưu/trust, không dùng fingerprint thiếu hoặc lấy lại từ kết nối chưa xác minh.
- Đã hỏi user IP hiện hành, SHA256 từ console provider và domain; chưa yêu cầu password. Chưa kết nối hay thay đổi VPS, chưa chạy fault/pilot/live deploy. Hạ tầng formal ML vẫn phải theo protocol hai VPS tương đương, riêng workload; chưa tự nhận các profile cũ đáp ứng.

## Thiết kế triển khai đã chọn cho vòng tiếp

1. **Credential store:** reuse `crypto/credentialCipher.ts` (Node pure AES-GCM), không kéo Electron safeStorage vào Linux controller. Master key ở private controller data directory, explicit create-once, owner hiện hành/0700 directory/0600 file/no symlink/hardlink và fsync; missing/tampered key phải fail closed. Credential ciphertext vẫn lưu SQLite; payload authenticated chứa controller/VPS/SSH identity/revision rồi mới trả secret cho SSH resolver. Không chọn plaintext credentials trong argv/env làm cơ chế lưu bền.
2. **Runtime HMAC keys:** riêng theo app + ownership generation, material trong protected encrypted store; mapping lấy từ SQLite ownership, không tạo nguồn authority thứ hai. Service tạo adapter/runtime repository theo claim để không chia sẻ vô điều kiện một key cho mọi target. Giữ key của attempt chưa settle; không rotate khi pending unknown.
3. **Enrollment:** CLI nội bộ qua authenticated SSH/stdin giới hạn kích thước, không public HTTP management; helper path do controller trusted config quyết định, bundle hash/version xác minh. Stage → persist local key → install target marker/key → verify ack/identity → CAS ownership; mất response phải reconcile bằng exact material, không tự enroll/rotate lại. Không promote các hàm có nhãn lab-only thành production bằng cách bỏ comment.
4. **Admission và recovery:** local management resources và remote Docker/RAM/disk/port/permission được đo trước mutation; failure trước dispatch mới dùng retry hữu hạn. Startup scan T1 chưa settle, exact receipt/key/binding rồi read/settle/T2; pre-T1 unknown pause/reconcile. Pin, revision, generation hoặc fence đổi thì không dùng proof cũ để ghi target mới.
5. **Service/CLI:** runtime opt-in chỉ khi config hợp lệ; giữ polling-only mặc định. Composition nhận database/repository/controller và protected resolver, verifier gọi đúng R3a method. Health/status phân biệt disabled/polling/admission-blocked/uncertain/ready, không giả thành hoàn tất deploy. Thử process restart thật trong lab rồi VPS.
6. **Bundle:** builder R3a đã có 3 helpers; còn copy templates/collector/requirements/manifest từ source approved, không copy tests/cache/venv/secrets. Paths tính theo bundle location thay cwd; fresh Linux install/run proof. Desktop management/UI authority theo R3c sau khi CLI độc lập qua gate.

## Gói việc tiếp theo — làm code, không mở rộng audit

- Đầu tiên triển khai `controllerSecrets.ts` + Linux filesystem/crypto tests, dùng scratch và test material tổng hợp. Không sửa crypto contract toàn app khi controller wrapper có thể dùng payload binding.
- Tiếp CLI bootstrap/enrollment contract, trusted resolver/per-claim runtime-key router và composition opt-in; cập nhật DECISIONS trước runtime khi thêm contract. Giữ public API đóng.
- Dùng R1 real lab và R2 crash harness để nghiệm thu service-driven job/real OS restart; thêm Git fetch/poll actual full SHA, không gọi fixture snapshot là live Git.
- Lưu commit theo slice có gate; default service không được bật vì “có adapter”. R4 ML, R7 parity/lifecycle, R9 HTTPS, R10 migrate, R11 installer, R12 CI và R14 acceptance vẫn OPEN theo release plan; không tự cắt phạm vi.

No accepted exception. R3 tổng PARTIAL; local implementation và hạ tầng live có state riêng, không coi thiếu VPS là lý do ngừng mọi việc local.
