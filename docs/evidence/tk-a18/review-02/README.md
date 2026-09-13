# TK-A18 Review 02 evidence

## Titlebar fix 05 — native whole-window evidence

- `after/titlebar-native-controls.png` được chụp từ toàn bộ cửa sổ Windows của production build
  `30747f1`, vì `webContents.capturePage()` không chứa các nút caption native.
- Ảnh xác nhận brand và caption nằm trong WCO available rectangle, ba nút minimize/maximize/close ở
  vùng native bên phải, không chồng lớp drag và không có block màu lệch tại đường nối.
- Profile smoke là profile tạm; không đọc hoặc sửa VPS thật. Snap Layout tiếp tục được ghi manual-only.

## Owner polish 04 — fresh evidence

- Bộ `after/` hiện tại được chụp lại từ production build của code checkpoint `ef3b530` sau yêu cầu
  sửa nhanh UI cho demo.
- Capture gồm đủ bảy route ở 1366×768 và Deploy/Migrate ở 1920×1080. Metadata ghi DPR 1.5,
  `MICA_FALLBACK`, native resize/maximize-restore PASS và Snap Layout manual-only.
- Kiểm tra ảnh xác nhận selected navigation chỉ dùng rail 2 px, page wrapper không còn card lớn,
  tiêu đề đã thu gọn và action/selector/steps nằm trong pane.
- Capture dùng profile tạm, scrub host/IP và không thực hiện live deploy, migrate hay mutation VPS.

## Review-Fix 03 acceptance note

- Capture now asserts the selected menu and `[data-page-key]` marker, waits for a compositor frame, records DPR/dimensions, copies the local DB fixture when available, and scrubs host/IP values.
- Native resize and maximize/restore smoke are recorded in `after/capture.json`; Mica is reported as `MICA_FALLBACK`.
- Snap Layout is explicitly `NOT_AUTOMATED_MANUAL_WINDOWS_SMOKE_REQUIRED`; no unsupported PASS claim is made.

- Before: `before/dashboard-1366x768.png`, `before/vps-1366x768.png`, `before/settings-1366x768.png`.
- After: `after/` contains seven route captures at `1366x768`, plus Deploy/Migrate at `1920x1080`.
- Metadata: CSS viewport `1366x768`, DPR `1.5`, PNG pixel dimensions, and `MICA_FALLBACK` are recorded in `after/capture.json`.
- Host/IP values are scrubbed to `host.local`; capture uses a temporary Electron user-data profile and `OPSPILOT_C01_DEPLOY_ONLY=1`.
- Leader review tại `d99d7c5` phát hiện after bị trễ/sai route và khác data state; bộ ảnh này không được
  dùng làm acceptance evidence. Xem `leader-review.md` và `docs/tasks/tk-a18/review-02-result.md`.
