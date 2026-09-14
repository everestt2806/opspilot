# TK-A18 visual evidence

- `after/` contains the local Electron smoke capture: all 7 screens at `1366x768`, plus Deploy and Migrate at `1920x1080`.
- The capture is render-only. Host/IP text is scrubbed to `host.local`; no credential, secret, or live deploy/migrate mutation was used.
- `capture.json` records the page list and `exitCode: 0`.
- Baseline screenshots under `before/` were not captured before this worker session. This remains an explicit visual DoD gap for local review.
- `review-02/` chứa cơ sở kỹ thuật và ba ảnh hiện tại được khóa làm baseline trước lượt Fluent mới.
  Worker sẽ ghi ảnh after cùng viewport/DPR/data state cho Dashboard, VPS và Settings tại đây.
