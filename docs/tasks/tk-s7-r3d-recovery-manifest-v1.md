# TK-S7 R3d — Recovery manifest v1 cho app cũ

## Thay đổi cục bộ

- Thêm service/IPC `vps:write-recovery-manifest` để tạo manifest v1 từ hồ sơ app và deployment hiện hành trong DB gốc.
- Từ chối thiếu hồ sơ/deployment, app đã nhập từ VPS, deployment không chạy, fingerprint thiếu, runtime không khớp hoặc manifest hiện có khác/không hợp lệ.
- Không ngắt kết nối của SshManager dùng chung. SshManager đọc lại VPS record trước mỗi lệnh và buộc kết nối mới khi endpoint hoặc fingerprint thay đổi; mọi handshake xác minh fingerprint SHA256 đã lưu. Discovery xác minh Docker name/image/state/port và Compose labels (service, working directory, config file).
- Git locator lấy đúng từ DB và qua allowlist `createAppManifest`; local source không ghi đường dẫn. Manifest không mang ID DB, commit, env hoặc secret.
- Ghi temp mode `0600`, sau đó tạo đích bằng hard link POSIX nguyên tử, không ghi đè file đã có.
- Cho phép gọi lại nếu manifest v1 parse hợp lệ và toàn bộ trường khớp nội dung chuẩn; trả `{ created: false }`. Nội dung khác/lỗi xác minh bị từ chối, không ghi đè.
- Tách `ln` nguyên tử và `rm` temp; lỗi `ln` báo thất bại, lỗi dọn temp sau khi `ln` thành công không báo sai là tạo manifest thất bại.
- Đồng bộ IPC contract trong `docs/contracts/ipc-contract.ts`. Có CLI nội bộ `OPSPILOT_R3D_*` chỉ chạy profile dưới temp, từ chối cùng source/target DB và app/cổng đích đã dùng trước mọi ghi, không mở GUI/monitor, không nhận credential qua args và chỉ xuất kết quả đã lọc.
- Test: thành công, runtime lệch, hồ sơ thiếu, nội dung hiện có khớp (idempotent), manifest xung đột, lỗi write, lỗi `ln`, lỗi cleanup sau `ln`, và không ngắt phiên SSH dùng chung.

## Gate cục bộ (Node 22.23.3)

| Gate | Kết quả | Bằng chứng |
|---|---|---|
| Focused recovery/import tests | PASS | Node 22.23.3, `vitest run src/main/vps/importService.test.ts`: 13/13 |
| Typecheck | PASS | Node 22.23.3, `pnpm typecheck` |
| Lint toàn repo | PASS có cảnh báo | `pnpm lint`: exit 0, 0 errors, còn 6.080 warnings hiện hữu. Các file source/test thuộc R3d lint scoped: 0 warning/error. |
| Build | PASS | Node 22.23.3, `pnpm build` |
| `git diff --check` | PASS | sau thay đổi |

## Kiểm chứng live

| Bước | Trạng thái | Bằng chứng/giới hạn |
|---|---|---|
| Profile cô lập và fingerprint ghim | PASS | Source `%TEMP%\\opspilot-g2-20261009`; target `%TEMP%\\opspilot-r3c2-isolated-20261013`. CLI source chỉ nhận profile dưới temp; SshManager nạp credential trong profile và dùng fingerprint lưu để xác minh handshake. Không ghi credential/fingerprint vào output/note. |
| Quét mới và đối chiếu hồ sơ/runtime | PASS | Qua CLI/service thật. Candidate `g2-express-20261009` ban đầu `legacy`; DB gốc clone: app chưa import, current deployment OpsPilot `running`, version/image v5, port mapping khớp Docker và Compose identity. |
| Tạo manifest | PASS | `write_created=true`; chỉ ghi `/opt/opspilot/g2-express-20261009/.opspilot-app.json`, temp mode `0600`, hard link no-clobber. Không sửa container/Compose/firewall. |
| Quét lại | PASS | IPC/service discovery trả `verified` sau ghi. |
| Import thử và baseline | PASS | Import vào target SQLite cô lập: `imported_from_vps=1`, current deployment v5 / `g2-express-20261009:v5`, `origin=vps_import`; `started_at`, env, commit null. Không tạo lịch sử giả. |
| Monitor và DB integrity | PASS | `monitor_target_excluded=true`; DB target `foreign_key_check` rỗng, `integrity_check=ok`. |
| DB chính/tài nguyên VPS | PASS | DB chính không mở; chỉ target clone được ghi. Không sửa container, Compose, firewall hoặc file VPS ngoài một manifest recovery. |

Không push/PR/merge. Code và live gate R3d đã hoàn tất; còn 6.080 lint warnings định dạng hiện hữu trong repo, nhưng không có warning mới trong các file source/test thuộc R3d.
