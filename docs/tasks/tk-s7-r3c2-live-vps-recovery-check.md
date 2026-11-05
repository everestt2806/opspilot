# TK-S7 R3c-2 — Kiểm chứng khôi phục chỉ đọc trên VPS phát triển

## Phạm vi và an toàn

- Dùng hồ sơ OpsPilot biệt lập, không mở hoặc sửa SQLite chính. Tạo bản sao SQLite trong profile `r3c2-isolated-20261013`, giữ VPS record và thông tin bảo vệ cần thiết, xóa app/deployment chỉ trong bản sao để thử lại trạng thái mất hồ sơ.
- DB kiểm chứng sau chuẩn hóa migration 009: 1 VPS, 0 app, 0 deployment, 0 app nhập, `foreign_key_check` rỗng, `integrity_check=ok`.
- Không ghi fingerprint, credential, raw manifest, raw stdout/stderr hay giá trị bí mật. Fingerprint SHA256 đã có trong record biệt lập; `vps:discover-apps` thành công qua SshManager dùng host verifier ghim fingerprint đã lưu. Không chấp nhận host key mới.
- Tác vụ từ xa chỉ đọc Docker inventory và manifest cố định. Không deploy, dừng/sửa container, sửa file, firewall hoặc cấu hình VPS.

## Bằng chứng quét

Quét `vps:discover-apps` qua API preload/IPC thật từ renderer, VPS record biệt lập ID 1. Thời điểm: 2026-10-13, khoảng 08:17 UTC. Docker cho thấy các container đang chạy; manifest không tồn tại cho cả bốn candidate. Không có candidate `verified`.

| Candidate | Image/version quan sát | Port host → container | Docker state | Recovery status/reason |
| --- | --- | --- | --- | --- |
| `g2-express-20261009` | `g2-express-20261009:v5`, v5 | 30000 → 3000 | running | `legacy` / `manifest_missing` |
| `g2b-next-20261009` | `g2b-next-20261009:v1`, v1 | 30002 → 3000 | running | `legacy` / `manifest_missing` |
| `g2b-vite-20261009` | `g2b-vite-20261009:v1`, v1 | 30001 → 80 | running | `legacy` / `manifest_missing` |
| `sannhabooking` | `sannhabooking:v1`, v1 | 30003 → 3000 | running | `legacy` / `manifest_missing` |

`manifest_missing` nghĩa là không tìm thấy `/opt/opspilot/<validated-name>/.opspilot-app.json`. Vì thiếu manifest nên framework/source/healthcheck và các metadata manifest khác đều null; không thể đối chiếu hay khôi phục metadata dựa trên suy đoán. Không tạo hoặc sửa manifest để ép import.

## Kết quả và gate

| Hạng mục | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| DB/OpsPilot profile cô lập | PASS | SQLite snapshot riêng; schema v9; 1 VPS, 0 app/deployment/import; FK check sạch; integrity check `ok` |
| SSH host fingerprint ghim | PASS | Record có fingerprint; scan qua SshManager trả thành công. Giá trị fingerprint không lưu trong note |
| Docker + manifest scan read-only | PASS | IPC trả bốn candidate trong bảng; cả bốn `legacy / manifest_missing`; không đọc/ghi file app, container hay firewall |
| Import IPC/service | NOT_RUN | Không có candidate `verified`; điều kiện tối thiểu thiếu là manifest v1 hợp lệ tại đường dẫn cố định cho candidate |
| Baseline version/image sau import | NOT_RUN | Không import do điều kiện trên |
| Monitor không poll app nhập (live) | NOT_RUN | Không có app nhập để quan sát; regression R3c-1 đã kiểm tra guard bằng migration 009 |
| UI app sau import | NOT_RUN | Không có app nhập; không kiểm tra hậu nhập UI |
| Focused tests | PASS | Node 22.23.3: discovery, import service và `VpsAppsTab` — 24/24 |
| Typecheck | PASS | Node 22.23.3: `pnpm typecheck` |
| Lint/build/full Vitest | NOT_RUN | Checkpoint chỉ xác minh luồng live và tài liệu; không đổi source |
| `git diff --check` | PASS | Chạy trước commit |
| VPS mutation / main DB | NOT_RUN | Không có thao tác ghi trên VPS; không mở/sửa SQLite chính |

Không push/PR/merge. Kết quả live không chứng minh import thành công; bước đó cần candidate có manifest hợp lệ và được quét lại.
