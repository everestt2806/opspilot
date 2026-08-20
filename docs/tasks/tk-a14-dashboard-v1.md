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

- [x] DashboardPage: thẻ tổng quan sống từ DB thật (VM01/VM02 + deploy v1 đã có), bảng
      hoạt động gần đây hiện đúng hành động deploy/rollback, empty state đúng quy tắc
- [x] `history:list` hạ cánh đúng contract (filter actions/vps_id/thời gian/limit/offset, lỗi 3 phần)
- [x] Deploy Log: xterm giữ ANSI color, toolbar [Sao chép][Tìm] hoạt động (nút "Xuống dòng"
      của spec bỏ — xterm v6 đã xoá option wrap, xem nhật ký 20/08), auto-scroll ngắt khi cuộn
      lên + nút xuống cuối, banner thành công có "Xem dashboard" điều hướng được
- [x] HistoryPage: bảng + filter + drawer key–value (không dump JSON thô)
- [x] Unit test: history service, reducer run deploy (ANSI giữ nguyên), DashboardPage happy
      path + empty state, DeployPage test cập nhật theo cấu trúc xterm (mock xterm)
- [x] lint/typecheck sạch, toàn bộ test pass
- [x] Board + tk cập nhật sau khi PR merge; trạng thái và bằng chứng khớp `main`

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
- UPDATE 20/08 — Chunk 2 xong: log deploy nâng cấp xterm. Tách reducer ra module thuần
  `deployRun.ts` (`applyEvent` giờ GIỮ NGUYÊN ANSI + `\r`, buffer nối chunk thô — xterm tự
  render màu và thanh tiến trình) + test `deployRun.test.ts` (5 case, gồm ANSI không bị
  lọc). Component `DeployTerminal.tsx`: Terminal v6 + FitAddon + SearchAddon, toolbar
  [Sao chép][Tìm] kèm ô tìm (Enter tìm xuống), auto-scroll theo viewport — cuộn lên thì
  hiện nút "↓ Xuống cuối" (scrollToBottom). **Lệch spec có ghi nhận**: nút "Xuống dòng"
  không làm được vì xterm v6 (đã chốt trong docs/09) xoá hẳn option lineWrapping từ v4,
  không có API thay thế — đã bỏ nút, ghi vào DoD. Test DeployPage mock xterm bằng class
  giả (ghi nhận qua `term.write`), 121/121 test, lint/typecheck sạch. Còn: HistoryPage
  (chunk 3). Lệnh tái hiện: `pnpm dev` → Deploy → log có màu ANSI, thử tìm + sao chép.
- UPDATE 20/08 — Chunk 3 xong: `HistoryPage` theo spec 3.7 — bảng 5 cột (thời gian tương
  đối + tooltip tuyệt đối, Tag hành động, Badge trạng thái, message ellipsis), filter
  multi-select hành động + VPS + RangePicker ngày, click hàng mở Drawer với Descriptions
  và `detail_json` dạng key–value (không dump JSON thô, parse an toàn). Test 3 case
  (happy + drawer, lỗi hiện Alert + nút Thử lại, filter gọi lại `history:list` với
  `actions`). 124/124 test toàn repo, lint/typecheck/prettier sạch. Xong toàn bộ DoD.
  Lệnh tái hiện: `pnpm dev` → menu Lịch sử → lọc + bấm hàng xem drawer.
- DONE 20/08 — PR [#18](https://github.com/everestt2806/opspilot/pull/18) merged vào `main` ·
  124/124 test, lint/typecheck/prettier sạch · TK-B9 sẽ tái sử dụng `history:list` và
  formatter/component lịch sử cho tab Hoạt động của VPS Control Panel.

## Lệnh tái hiện

```bash
cd app && pnpm test
pnpm dev      # menu Dashboard -> thẻ tổng quan + bảng hoạt động; Deploy -> log xterm
```

## PR

- [#18](https://github.com/everestt2806/opspilot/pull/18) — merged 20/08/2026.
