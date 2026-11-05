# R3b — Protected controller bootstrap and cold recovery

START 06/11/2026 — Tiếp user request “làm hết”, base R3a `1e4df09`, R2 `950b7ae`. R3a adapter đã có local gate; R3b chưa triển khai. Không mở public admin API, không đổi nguồn authority SQLite hoặc tự trust host key.

## Requirement ledger

| Yêu cầu | Gate | State |
|---|---|---|
| Master key và credential binding của controller | `controllerSecrets.ts`: pure AES-GCM reuse; Linux **10/10**, binding/tamper **3/3** PASS, không implicit key regeneration | PASS |
| HMAC key riêng theo app/generation và protected router | [R3b-2 local PASS](tk-s7-release-r3b2-runtime-keys.md): Linux13/13, real router7/7 + cold T1 key retention, full1427 PASS/2 SKIP | PASS |
| Controller SQLite credential → pinned SSH, độc lập Electron | [R3b-3 local PASS](tk-s7-release-r3b3-controller-ssh.md): 25 safety tests, real SSH/Docker7/7, full1452 PASS/2 SKIP; default service chưa bật | PASS |
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

## Implementation R3b-1 — master key và credential binding

- `controllerSecrets.ts` cung cấp explicit create-once và load-only cho `.controller-runtime-key` trong private data directory. Linux-only filesystem API; không nhét Electron safeStorage vào controller. Key 32 bytes, file creation O_EXCL/O_NOFOLLOW/0600/fsync, load xác minh regular file/owner/private mode/nlink/size; thiếu key không tự tạo lại. Buffer key tạm được zero sau khi cipher copy; không tuyên bố mọi JS string secret có thể zero được.
- Reuse `AesGcmCredentialCipher`; authenticated encrypted payload chứa format/controller ID/toàn bộ SSH target binding (VPS ID, host, port, username, auth type, fingerprint, security revision) và credential. Swapping ciphertext giữa profile hoặc đổi metadata không được trả secret; legacy unbound plaintext payload không được nhận như controller credential. Không đổi schema/IPC/Desktop cipher hoặc tự chuyển ciphertext cũ.
- Reject tampered IV/tag/ciphertext, different master key, oversized material/envelope; public errors là stable code, không chứa crypto details, key, decrypted text hoặc path.
- Linux gate `node app/scripts/product-runtime-lab/secrets-check.mjs` dùng bundle `r3b-lab.cjs`: **10/10 PASS** gồm missing key, create/reopen, duplicate init/no rotation, unsafe mode, symlink, hardlink, foreign owner, truncated key, insecure directory và directory symlink. Root lab có chủ đích để thử đổi owner; scratch đã cleanup, không đọc credential của người dùng.
- Vitest `src/main/controlPlane/controllerSecrets.test.ts`: **3/3 PASS**; kiểm binding của mọi field, metadata/controller swap, tamper/key mismatch và legacy/oversize. Các thử nghiệm dùng material tổng hợp, không SSH password/private key thật.
- ESLint scoped, Node/Web/scripts/lab typecheck và electron-vite build PASS. Full regression cuối slice **1417 PASS / 2 SKIP / 0 FAIL** (`app/.out-scripts/release-r3b-key-vitest.json`); hai Linux Caddy tests skip trên Windows như baseline, không nhận HTTPS live/GUI PASS. Không nhận whole R3b hoàn thành; module chưa nối production service.

### Gate commands

Windows Node22.23.3 sau `tools/enter-node22.ps1`; Linux Node22.23.4. `secrets-check` dùng private scratch và cleanup, không dùng profile hiện hành.

```text
pnpm --prefix app exec vitest run src/main/controlPlane/controllerSecrets.test.ts --reporter=dot
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3b-key-vitest.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec electron-vite build
pnpm --prefix app exec eslint src/main/controlPlane/controllerSecrets.ts src/main/controlPlane/controllerSecrets.test.ts scripts/product-runtime-lab/secrets-check.mjs --max-warnings=0
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b-lab.cjs node app/scripts/product-runtime-lab/secrets-check.mjs
git diff --check
```

HANDOFF-LOCAL 06/11 — R3b-1 **CHỜ REVIEW**, implementation commit chứa `controllerSecrets.ts` và hồ sơ này (`git log -1 -- app/src/main/controlPlane/controllerSecrets.ts`). Chưa ship runtime configuration/enrollment/service, chưa nối vault vào DB credential path hoặc tạo per-app HMAC keys. Next code slice: protected HMAC store/router theo app/generation → explicit production enrollment contract/CLI → admission/startup recovery → service-driven Git deploy + OS restart. Live endpoint/pin/domain vẫn thiếu; local tasks tiếp tục theo ledger, không giả nhận whole release DONE. Không push/PR/merge, không credential dump hay VPS write.
