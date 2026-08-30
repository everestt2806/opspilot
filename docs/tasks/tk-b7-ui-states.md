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

- [x] 4 state hiển thị đúng, có test fixture cho từng state
- [x] Không import Node/Electron trong renderer; mọi thứ qua typed IPC
- [x] Payload khớp type `app/src/shared`, không hard-code khác contract
- [x] Component test làm bằng chứng (16 test renderer mới, fixture từng state)
- [x] Nối handler thật chạy được với VPS của A; đã xác nhận bằng mắt với VM01 trong demo.

## Nhật ký

- START 21/08 — dự kiến; có thể làm sớm bằng mock typed (đúng quy trình docs/20 mục 2) mà
  không cần chờ VPS.
- UPDATE 19/08 — B bận → **A nhận từ 19/08** (quyết định: A làm hết tuần này); hạn dời 22/08.
  Khoá theo `VpsConnectionCheck` + `diagnosis` của TK-A10 (PR TK-A10 merge trước).
- START 19/08 — A kéo sớm sau khi xong TK-B2 (hạn 20/08) và TK-A10 đã merge.
- UPDATE 19/08 — **Xong phần code + test, PR #16.** Chi tiết:
  - Bảng VPS đủ 4 state: empty ("Chưa có VPS nào…") / loading / error (Alert có nút thử lại) /
    success; cột **CPU/RAM/Disk** mới (`VpsResourcesCell`: empty → spinner kiểm tra → 3
    progress bar của `vps:get-resources` → lỗi có nút thử lại từng hàng). Nút **"Kiểm tra lại"**
    ở đầu bảng đọc lại tài nguyên mọi hàng (đúng spec 3.1: làm mới khi mở màn + khi bấm).
  - Tag **Trạng thái**: Đang kiểm tra (khi đang đọc tài nguyên) / Online / Offline / Chưa kiểm
    tra — suy ra từ tài nguyên live, ưu tiên hơn `last_status` trong DB (`rowDisplayStatus`
    thuần, có test).
  - **"Kiểm tra kết nối" nằm trong modal Thêm/Sửa VPS** (đúng spec 3.1): 4 state idle →
    đang kiểm tra → kết quả từng bước `✓ SSH → ✓ Docker x.y → ✓ ghi được /opt/opspilot`;
    thiếu Docker → cảnh báo vàng; sửa VPS phải nhập lại credential để check (app không đọc
    lại credential đã lưu); thay đổi form là reset kết quả cũ.
  - **Hiển thị `diagnosis` TK-A10**: `DiagnosisPanel` — title + cause + danh sách cách sửa +
    mã lỗi, kèm nút "Kiểm tra lại" (case mẫu firewall WiService được test bằng fixture thật).
  - State dữ liệu IPC chuyển sang Zustand `vpsStore` (docs/10 mục 8); component >200 dòng thì
    tách (page ghép cell + panel).
  - Test mới: `@testing-library/react` + `jsdom` (quyết định ghi DECISIONS 19/08, docs/09):
    16 test renderer (fixture 4 state của từng thao tác), tổng suite 66/66 xanh, lint +
    typecheck sạch.
  - Smoke `pnpm dev`: electron boot sạch, ML service lên 8765, không lỗi. Chưa click-through
    với VPS thật vì DB app trống — đóng khi người dùng thêm VM01 trước demo.
  - **Chưa có nút "Cài Docker ngay"** (spec 3.1): `vps:install-docker` chưa có handler ở main
    (đã grep toàn bộ main) — nằm ngoài scope renderer, theo dõi ở TK-A13.
- DONE 30/08 — Đã dùng handler thật với VM01 trong luồng demo; UI hiển thị trạng thái/tài nguyên
  và diagnosis đúng. Nút cài Docker/scan môi trường đã hạ cánh qua TK-A13/PR #22.

## Lệnh tái hiện

```bash
cd app && pnpm test                  # 66/66, trong đó 16 test renderer mới
pnpm dev                             # mở màn VPS: thêm VPS -> Kiem tra ket noi (xem diagnosis)
```

## PR

- #16 — 4 state + tai nguyen + diagnosis (merge 19/08).
