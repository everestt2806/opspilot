# TK-A18 Review 02 evidence

- Before: `before/dashboard-1366x768.png`, `before/vps-1366x768.png`, `before/settings-1366x768.png`.
- After: `after/` contains seven route captures at `1366x768`, plus Deploy/Migrate at `1920x1080`.
- Metadata: CSS viewport `1366x768`, DPR `1.5`, PNG pixel dimensions, and `MICA_FALLBACK` are recorded in `after/capture.json`.
- Host/IP values are scrubbed to `host.local`; capture uses a temporary Electron user-data profile and `OPSPILOT_C01_DEPLOY_ONLY=1`.
- Leader review tại `d99d7c5` phát hiện after bị trễ/sai route và khác data state; bộ ảnh này không được
  dùng làm acceptance evidence. Xem `leader-review.md` và `docs/tasks/tk-a18/review-02-result.md`.
