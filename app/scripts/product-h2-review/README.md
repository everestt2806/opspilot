# Nghiệm thu target H2 trên Linux

Từ root repository, Node 22 và Docker Linux đang chạy với image cached `python:3.12-slim`:

```powershell
node app/scripts/product-h2-review/run.mjs
```

CLI không tự start Docker, pull/install hoặc đổi setup host. Container test dùng network none, không Docker socket, subject/fixtures read-only và tmpfs riêng. Guard/flock/file permissions/fsync/HMAC/Python runtime là code thật; các lệnh Docker bên trong suite là fake có state và command journal. Đây là 23 controlled tests, không phải full SSH/Docker deployment proof.

Các ca kiểm: success, build fail giữ V1/collector, first failure, rollback/B0/R0, wrong image, collector build failure, stale fence, live child, app/collector/HTTP/config drift trước seal, durable-write failure/retry, metric path/generation đúng monitor, private secret/symlink, explicit enrollment, bad signature/domain, ACK durable trước idle và recovery idempotent/no replay.

`fixtures.json` chỉ chứa dữ liệu tổng hợp công khai và golden vectors; key test là bytes 0..31, không dùng cho enrollment thật. Script ghi report redacted trong `.out-scripts/h2-runtime-review/<nonce>` (ignored), kiểm source hash trước/sau và cleanup theo label/ID chính xác; không chạm resource khác.

Exit 0 nghĩa suite controlled PASS và cleanup/source hash hợp lệ. Không dùng kết quả này để tuyên bố full H2/G4 PASS: vẫn cần runtime CLI end-to-end qua pinned SSH, Docker/collector thật, từng điểm crash và artifact smoke. Các Python helpers được khai báo `extraResources/product-target` trong electron-builder; `electron-vite build` đơn lẻ không tạo installer hoặc xác minh ABI Electron.
