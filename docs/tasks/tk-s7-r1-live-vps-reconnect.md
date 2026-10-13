# TK-S7 R1-live — Kiểm chứng gỡ và kết nối lại VPS

## Kết quả ban đầu (trước khi xác nhận profile R3d)

- Trạng thái live: **BLOCKED**. Không chạy luồng gỡ/kết nối lại hay SSH; không sửa database gốc và không tạo bản sao dùng để thao tác.
- Đọc metadata SQLite ở chế độ chỉ đọc: profile hiện có 2 hồ sơ VPS, 2 app và 2 deployment. DB chưa có `schema_version` hoặc cột `vps.archived_at`, nên chưa có schema archive của migration 008.
- Profile còn chứa credential đã mã hóa, nhưng phiên này không có credential được nhập/cấp qua luồng bảo mật trong bộ nhớ. Không thử giải mã, xuất credential hoặc dùng DB gốc làm database thao tác. Cũng chưa có lựa chọn VPS/app cụ thể cùng bằng chứng fingerprint để đối chiếu cho live run.
- Vì không đủ điều kiện an toàn và DB gốc chưa ở schema cần thiết, không tạo bản sao thứ nhất/thứ hai để giả lập kết quả. Không gọi `VpsService`/IPC xóa hoặc thêm, không SSH, không kết nối tới identity giả. Các bước này đều **NOT_RUN**; unit test không thay thế live evidence.
- Không ghi lên VPS, deploy, đổi firewall hay hiển thị credential, secret, raw SSH output hoặc fingerprint đầy đủ.

## Gates

- Node v24.16.0 (package yêu cầu `>=22 <23`): focused `vpsRepository.test.ts`, `service.test.ts`, `ipc.test.ts` **PASS 27/27**.
- `pnpm --filter @opspilot/app typecheck` **PASS** (Node và Web).
- `git diff --check` **PASS**.
- Gate không chạy bằng Node 22 vì PATH hiện chỉ cung cấp Node v24.16.0; không tuyên bố đạt gate Node 22.

## Tiếp tục live

Cần profile được migrate trên **bản sao tạm** với danh tính VPS được chọn và credential cấp qua cơ chế nhập an toàn của ứng dụng. Khi các điều kiện đó có thể được xác minh mà không đụng DB gốc, mới thực hiện qua luồng VpsService/IPC thực tế và SSH chỉ đọc có fingerprint ghim. Test mismatch identity chỉ thao tác trên bản sao thứ hai và tuyệt đối không kết nối mạng.

## UPDATE sau commit `dd19e07` — profile R3d v9

- Đọc R3d xác nhận nguồn `%TEMP%\opspilot-g2-20261009` là profile cô lập có schema migrations 1–9, `archived_at`, một VPS và bốn app. Trước thao tác, app ID/deployment hiện hành là: `1/7` (version 5, `g2-express-20261009:v5`), `2/3` (version 1), `3/4` (version 1), `4/8` (version 1); cả bốn deployment đang `running` trong snapshot DB.
- Tạo hai profile mới (`opspilot-r1live-20261013-a` và `-b`) bằng `better-sqlite3` SQLite backup API, không copy nóng file DB đơn lẻ. Cả hai backup xác minh v9, 1 VPS, 4 app; `credential-master-key.protected` được copy nguyên byte. ACL thư mục/file giới hạn cho SID Windows hiện tại. Hash, kích thước và mtime của DB nguồn trước/sau backup khớp.
- **Bản sao A — BLOCKED trước VpsService.delete/create:** Electron main xác nhận `safeStorage.isEncryptionAvailable() === true`, nhưng giải mã khóa được bảo vệ thất bại với mã an toàn `MASTER_KEY_DECRYPT_FAILED` tại bước `credential-key-unlock`. Không gọi xóa/thêm và không tạo kết nối SSH. Kiểm tra lại DB A: VPS ID 1 vẫn active; app IDs 1–4, deployment IDs 7/3/4/8 và version/image/status như snapshot; không có archive mới. Vì credential không mở được, quét Docker ghim fingerprint là **NOT_RUN**.
- **Bản sao B — PASS identity mismatch tại VpsService/SQLite:** gọi `VpsService.delete/create` với endpoint cũ nhưng fingerprint test khác, dùng cipher fixture không phải credential. Kết quả VPS ID cũ 1 archived, hồ sơ mới ID 2; cả bốn app và deployment/history giữ nguyên trên VPS ID 1, không app nào gắn với ID 2. Không khởi tạo `SshManager`, không SSH tới identity thử nghiệm.
- Không sửa DB nguồn; không ghi VPS, deploy hoặc đổi firewall. Không xuất credential, secret, raw SSH output hay fingerprint.

## Gates sau cập nhật

- Node 22.23.3 qua `C:\Users\everestt28\AppData\Local\pnpm\bin\node.exe`: `vpsRepository.test.ts`, `service.test.ts`, `ipc.test.ts` **PASS 27/27**.
- Node 22.23.3: `pnpm --filter @opspilot/app typecheck` **PASS** (Node/Web).
- `git diff --check` **PASS**.
- Live reconnect và SSH discovery còn **BLOCKED/NOT_RUN** riêng do `safeStorage.decryptString` không giải mã được khóa profile R3d v9 trong Electron runner cùng Windows user. Kết quả này thay thế nguyên nhân profile cũ thiếu schema ở ghi nhận trước, nhưng không xóa lịch sử BLOCKED ban đầu.

## UPDATE sau commit `e272186` — ba gate R1-live

| Gate | Trạng thái | Bằng chứng |
|---|---|---|
| DB cùng identity | **LOCAL_INTEGRATION_PASS** | Trên profile A v9, chạy `VpsService.delete/create` với host/port/fingerprint giống nhau, cipher fixture và credential giả. VPS ID `1 → 1`; app IDs `1–4`, current deployment IDs `7, 3, 4, 8`, versions `5, 1, 1, 1`, image/status và deployment history giữ nguyên. Deployment counts theo app trước/sau là `5, 1, 1, 1`. Hash tất cả bảng ngoài `vps` trước/sau khớp. DB nguồn được mở readonly; hash, size, mtime và nội dung SQLite trước/sau khớp. Kết quả này **không phải** SSH/live pass. |
| DB khác identity | **PASS** (ghi nhận tại `e272186`) | Profile B; endpoint cũ nhưng fingerprint khác tạo VPS ID mới `2`, giữ app/deployment trên VPS archived ID `1`, không app nào gắn vào ID `2`; không khởi tạo SSH. |
| SSH live | **BLOCKED** | Mở khóa credential thất bại trên cả profile nguồn và A, nên không có credential thật trong RAM và không thử SSH. |

### Chẩn đoán mở khóa

- Đối chiếu `app/src/main/index.ts` và R3d: source đặt `userData` trước `whenReady`; sau `whenReady` gọi `electronApp.setAppUserModelId('vn.opspilot.desktop')`, `app.setName('OpsPilot')`, rồi `createCredentialCipher`. Runner lần trước thiếu hai thiết lập app identity. Runner chẩn đoán lần này đã đặt cùng AppUserModelID và tên app đúng thứ tự sau `whenReady`, với Windows process chạy cùng token như phiên gọi; owner SID của file khóa nguồn và A trùng token hiện tại.
- Để không ghi vào profile nguồn, runner đặt Electron `userData` riêng trong thư mục tạm và truyền riêng đường dẫn nguồn/bản sao cho service giải mã chỉ đọc. `safeStorage.isEncryptionAvailable()` là true; file khóa của nguồn và A giống byte-for-byte; `createCredentialCipher` trả **FAIL** cho cả hai với mã `MASTER_KEY_DECRYPT_FAILED`. Thiết lập AppUserModelID/tên app và token Windows không khắc phục lỗi. Không tạo khóa, không ghi đè khóa, không bypass mã hóa.
- DB cùng identity trên A chạy bằng cipher fixture và credential giả sau khi đã thử giải mã; record credential của A giờ là fixture trong bản sao tạm. DB nguồn không thay đổi. Vì không giải mã được credential thật, không khởi tạo SshManager; SSH live giữ **BLOCKED/NOT_RUN**.

### Gate cục bộ

- Node 22.23.3: focused `vpsRepository.test.ts`, `service.test.ts`, `ipc.test.ts` **PASS 27/27**.
- Node 22.23.3: typecheck Node/Web **PASS**.
- `git diff --check` **PASS**.
