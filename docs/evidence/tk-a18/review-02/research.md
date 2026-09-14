# TK-A18 Review 02 — Cơ sở kỹ thuật

## Môi trường đã đối chiếu

- OS local: Windows build `26200.9445`, display version `25H2`.
- Electron cài trong `app`: `39.8.10`; package khai báo `^39.2.6`.
- BrowserWindow hiện dùng `frame: false`, `titleBarStyle: 'hidden'`,
  `titleBarOverlay: false`, `backgroundColor: '#0F1115'`.
- AppTitleBar tự vẽ ba nút bằng Ant icon và IPC; cách này không cung cấp Snap Layout native.
- Dark token hiện dùng flat `#171a1f/#20242a/#2a3038`; font là DM Sans/Inter.

## Tài liệu chính thức

- Electron Custom Title Bar — hidden title bar, Window Controls Overlay native, drag/no-drag và CSS
  environment variables: <https://www.electronjs.org/docs/latest/tutorial/custom-title-bar>
- Electron BrowserWindow — background material, title bar overlay và snapped state:
  <https://www.electronjs.org/docs/latest/api/browser-window>
- Microsoft typography — Segoe UI Variable, Regular body, Semibold title:
  <https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography>
- Microsoft materials — Mica cho long-lived base surface, Acrylic cho transient surface:
  <https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials>
- Microsoft Acrylic:
  <https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic>
- DWM system backdrop và yêu cầu Windows 11 build 22621:
  <https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type>

## Rủi ro phải smoke thật

Electron từng có lỗi background material mất/đổi màu sau maximize/restore ở frameless window. Báo cáo gần
hơn cho biết bản 38 alpha trở lên hoạt động khi Energy Saver tắt, nhưng Energy Saver có thể làm nền xám.
Vì app dùng Electron 39, đây là rủi ro cần kiểm thực tế, không phải kết luận bản hiện tại chắc chắn lỗi:

- <https://github.com/electron/electron/issues/46753>
- <https://github.com/electron/electron/issues/48031>

Fallback CSS là acceptance path chính thức. Worker không được báo Mica PASS chỉ vì option đã set; phải
quan sát normal/maximize/restore/snap trên máy Windows demo.

## Impact code

GitNexus tại index code `c35e797`:

- `createWindow`: upstream risk LOW, một direct file-level caller.
- `AppTitleBar`: upstream risk LOW, hai direct dependents là `App` và test. `App` tham gia các flow
  renderer nên vẫn phải chạy full app regression.
- `themeTokens` không có upstream symbol được index nhận diện, nhưng config tác động toàn renderer;
  thay token phải smoke cả bảy route.

Index chậm hơn HEAD một commit vì HEAD chỉ thêm Review 01; code index vẫn khớp submission.
