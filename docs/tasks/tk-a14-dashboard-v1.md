# TK-A14 — Dashboard v1: tổng quan VPS + lịch sử + log deploy live (xterm)

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 23/08/2026 | feat/ui-dashboard-v1 | `docs/02-ui-ux-spec.md` 3.3–3.4, `docs/prompts/m10-ui.md` | P0 |

## Mục tiêu

Màn "đinh" thứ 3 của demo 24/08 (sau chẩn đoán kết nối và DeployPage):
1. **DashboardPage** thứ thiệt thay placeholder: hàng thẻ tổng quan (VPS online/tổng, app
   đang quản lý, deploy 24h, lần deploy gần nhất) + bảng "Hoạt động gần đây" từ `action_log`
   (`history:list` — đúng contract, UC-09) + empty state hướng dẫn hành động kế tiếp
   (quy tắc UX #4).
2. **Deploy Log nâng cấp xterm** (spec 3.3): terminal xterm.js giữ nguyên ANSI color thay
   cho khối text thuần ở TK-A13, toolbar [Sao chép] [Xuống dòng] [Tìm], auto-scroll + nút
   "↓ Xuống cuối" khi user cuộn lên; banner thành công thêm nút "Xem dashboard"; banner lỗi
   giữ trích dòng log cuối của bước fail.
3. **HistoryPage** cơ bản theo spec 3.7: bảng + lọc hành động/VPS + Drawer chi tiết
   `detail_json` dạng key–value.

Phần chart metric + bảng điều khiển model (tầng 1–2 đầy đủ của spec 3.4) **không làm** —
collector/M7 lùi W2 theo `docs/20`, board ghi rõ "không chart metric".

## Được sửa

- `app/src/main/` (thêm handler `history:list` + service nhỏ), `app/src/renderer/src/pages/`
  (DashboardPage, HistoryPage, DeployPage — nâng xterm), `App.tsx` (nút điều hướng giữa
  màn), `strings.ts`, `main.css`, test các phần trên.

## Không được sửa

- `docs/contracts/**` — kênh `history:list` đã có sẵn trong ipc-contract, không đổi gì.
- `experiments/**`, `ml-service/**`, `collector/**`, `src/main/deploy/**` (logic pipeline),
  `demo-apps/**`.

## Definition of Done

- [ ] DashboardPage: thẻ tổng quan sống từ DB thật (VM01/VM02 + deploy v1 đã có), bảng
      hoạt động gần đây hiện đúng hành động deploy/rollback, empty state đúng quy tắc
- [ ] `history:list` hạ cánh đúng contract (filter actions/vps_id/thời gian/limit/offset, lỗi 3 phần)
- [ ] Deploy Log: xterm giữ ANSI color, 3 nút toolbar hoạt động, auto-scroll ngắt khi cuộn
      lên + nút xuống cuối, banner thành công có "Xem dashboard" điều hướng được
- [ ] HistoryPage: bảng + filter + drawer key–value (không dump JSON thô)
- [ ] Unit test: history service, reducer run deploy (ANSI giữ nguyên), DashboardPage happy
      path + empty state, DeployPage test cập nhật theo cấu trúc xterm (mock xterm)
- [ ] lint/typecheck sạch, toàn bộ test pass
- [ ] Board + tk cập nhật cùng commit/PR của task

## Nhật ký

- START 20/08 — Demo 24/08 còn 4 ngày: Dashboard là màn đinh thứ 3. Đã đọc spec 3.3–3.4,
  contract ipc (kênh `history:list` có sẵn), docs/09 (xterm + addon-fit/addon-search đã duyệt,
  đã cài trong package.json). Lưu ý: TK-A13 đang strip ANSI trong reducer — phần xterm phải
  chuyển sang giữ nguyên để màu hiện đúng.
- UPDATE 20/08 — Chunk 1 xong: `HistoryService.list` (validate bằng zod, filter
  actions/vps_id/from_ts/to_ts/limit/offset) + handler `history:list` trong `ipc.ts` theo
  đúng ipc-contract; `DashboardPage` thay placeholder (4 thẻ tổng quan từ `vps:list` +
  `app:list` + `history:list`, bảng hoạt động gần đây, empty state "Thêm VPS" trỏ sang màn
  VPS, error Alert + nút Thử lại); `App.tsx` điều hướng hai chiều deploy↔dashboard; banner
  thành công DeployPage thêm nút "Xem dashboard"; util `format.ts` (`relativeTime`,
  `localDateTime` theo quy tắc UX #5). Test: history service 3, format 2, DashboardPage 3 —
  toàn bộ suite 116/116, lint/typecheck sạch. Còn: xterm (chunk 2) + HistoryPage (chunk 3).
  Lệnh tái hiện: `cd app && pnpm exec vitest run src/main/history/service.test.ts src/renderer/src/utils/format.test.ts src/renderer/src/pages/DashboardPage.test.tsx`

## Lệnh tái hiện

```bash
cd app && pnpm test
pnpm dev      # menu Dashboard -> thẻ tổng quan + bảng hoạt động; Deploy -> log xterm
```

## PR

- (chưa mở)