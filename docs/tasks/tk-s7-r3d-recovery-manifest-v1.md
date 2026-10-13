# TK-S7 R3d — Recovery manifest v1 cho app cũ

## Thay đổi cục bộ

- Thêm service/IPC `vps:write-recovery-manifest` để tạo manifest v1 từ hồ sơ app và deployment hiện hành trong DB gốc.
- Từ chối thiếu hồ sơ/deployment, app đã nhập từ VPS, deployment không chạy, fingerprint thiếu, runtime không khớp hoặc manifest hiện có khác/không hợp lệ.
- Ép ngắt kết nối SSH cũ trước khi discovery để handshake tiếp theo dùng fingerprint hiện lưu trong profile. Discovery xác minh Docker name/image/state/port và các Compose labels (service, working directory, config file).
- Git locator lấy đúng từ DB và qua allowlist `createAppManifest`; local source không ghi đường dẫn. Manifest không mang ID DB, commit, env hoặc secret.
- Ghi temp mode `0600`, sau đó tạo đích bằng hard link POSIX nguyên tử, không ghi đè file đã có.
- Thêm test cho thành công, runtime lệch, hồ sơ thiếu, manifest xung đột, và lỗi ghi.

## Gate cục bộ (Node 22.23.3)

| Gate | Kết quả | Bằng chứng |
|---|---|---|
| Focused recovery/import tests | PASS | `vitest run src/main/vps/importService.test.ts`: 11/11 |
| Full Vitest | PASS | `pnpm exec vitest run`: 755/755 (75 files). Lần chạy song song trước đó có một lỗi assertion `DeployPage` thoáng qua; chạy riêng test và chạy full lại đều PASS. |
| Typecheck | PASS | `pnpm typecheck` |
| Lint toàn repo | PASS có cảnh báo | `pnpm lint`: exit 0, 0 errors, còn 6.080 warnings Prettier/CRLF trên các file hiện có. Lint các file source/test R3d: 0 warnings/errors. |
| Build | PASS | `pnpm build` |
| `git diff --check` | PASS | chạy trước commit |

## Kiểm chứng live

| Bước | Trạng thái | Bằng chứng/giới hạn |
|---|---|---|
| Profile nguồn cô lập, DB chỉ đọc | PASS | `%TEMP%\\opspilot-g2-20261009`; query `readonly/query_only`. Có 4 app gốc, `imported_from_vps=0`, mỗi app có current deployment `origin=opspilot`, `status=running`; profile chứa fingerprint nhưng giá trị đã khử khỏi note. |
| Ứng viên dự kiến | Chưa xác minh live | `g2-express-20261009` có Git source với GitHub locator công khai đã lưu trong DB; image/version/port trong DB khớp inventory R3c-2. Cần quét lại bằng SSH ghim trước khi xem là đủ điều kiện. |
| SSH scan và manifest write | BLOCKED | Electron dev process mở bằng profile cô lập với monitor scheduler tắt, nhưng computer-use session báo không có app/browser target; không có đường IPC renderer khả dụng để gọi thật. Không gọi SSH scan, không tạo/đổi manifest trên VPS. Không coi dữ liệu R3c-2 cũ là bằng chứng live mới. |
| Rescan verified, import vào SQLite cô lập, UI/monitor | NOT_RUN | Không có kết quả scan mới `verified`; do đó không import hoặc khởi chạy bước phụ thuộc. |
| Main DB/VPS files, containers, Compose, firewall | PASS | Chỉ đọc SQLite clone; không sửa DB chính hoặc tài nguyên VPS. |

Không push/PR/merge. Live R3d còn BLOCKED đến khi có phiên IPC/UI khả dụng để xác minh lại runtime qua fingerprint đã ghim và hoàn tất đúng một lần ghi + import thử cô lập.
