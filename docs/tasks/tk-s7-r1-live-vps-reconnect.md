# TK-S7 R1-live — Kiểm chứng gỡ và kết nối lại VPS

## Kết quả

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
