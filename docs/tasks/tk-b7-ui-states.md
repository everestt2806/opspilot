# TK-B7 — UI VPS connection + resource: đủ 4 state

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A (nhận 19/08, trước là B) | 22/08/2026 | feat/ui-connection-states | `docs/prompts/m10-ui.md`, `docs/02-ui-ux-spec.md` | P1 |

## Mục tiêu

Màn VPS List (khung do A tạo ở TK-A2) đủ 4 state: loading / empty / success / error cho hai
thao tác "kiểm tra kết nối" và "xem tài nguyên" (CPU/RAM/disk). A đã có handler thật
`vps:test-connection` + `vps:get-resources` — B nối trực tiếp, không cần mock toàn bộ.

**Scope thêm (TK-A10, quyết định 19/08):** hiển thị trường `diagnosis` mới của
`VpsConnectionCheck` — khi kết nối lỗi, UI in nguyên nhân + hướng dẫn sửa tiếng Việt
(case mẫu: firewall chặn SSH) theo UX lỗi `docs/02` quy tắc 3.

## Được sửa

- `app/src/renderer/**` (của B; A làm trong tuần demo — docs/20 cập nhật 19/08).

## Không được sửa

- `app/src/main/**`, `app/src/shared/**` — type thiếu thì báo A, không tự sửa.

## Definition of Done

- [ ] 4 state hiển thị đúng, có test fixture cho từng state
- [ ] Không import Node/Electron trong renderer; mọi thứ qua typed IPC
- [ ] Payload khớp type `app/src/shared`, không hard-code khác contract
- [ ] Ảnh/video ngắn hoặc component test làm bằng chứng
- [ ] Nối handler thật chạy được với VPS của A (sau TK-S2)

## Nhật ký

- START 21/08 — dự kiến; có thể làm sớm bằng mock typed (đúng quy trình docs/20 mục 2) mà
  không cần chờ VPS.
- UPDATE 19/08 — B bận → **A nhận từ 19/08** (quyết định: A làm hết tuần này); hạn dời 22/08.
  Khoá theo `VpsConnectionCheck` + `diagnosis` của TK-A10 (PR TK-A10 merge trước).

## Lệnh tái hiện

```bash
pnpm dev   # mở màn VPS, chạy kiểm tra kết nối + xem tài nguyên trên VPS thật
```

## PR

— (chưa có)