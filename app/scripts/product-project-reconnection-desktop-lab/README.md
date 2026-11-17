# CLI Main xác nhận nhận lại dự án

Chạy Node22/Electron-as-Node với SQLite native của app:

```text
node app/scripts/run-as-node.js app/scripts/product-project-reconnection-desktop-lab/run.mjs --confirm-local-project-reconnection-desktop
```

Dùng hai SQLite, cipher và Desktop vault thật; admin/transport là adapter giả gọi
backend E1, không phải installed Root/SSH/VPS. Fixture nguồn có PostgreSQL đã chọn
ở generation2; Desktop không có lịch sử chọn PG đó. Chỉ consent E2 mới tạo journal
riêng, không chỉnh registration hay tạo selection receipt giả.

Kiểm chứng review/confirm/idempotency, đóng–mở SQLite và dựng lại Main với cùng
cipher, policy drift/re-consent, crypto copying, binding disabled, không ghi
controller DB khi đọc. Fixture và cipher chỉ ở thư mục nonce riêng; dọn khi xong.
Đây không phải GUI, Electron process restart, DPAPI, mạng hoặc serving gate.

## Installed Root/Main gate riêng

Trên Linux có systemd/SSHD, dùng Node22 và modules Linux đã duyệt, chạy
`app/scripts/controller-upgrade-desktop-lab/run.mjs` dưới root với
`OPSPILOT_UPGRADE_BASE_SCHEMA=37` và `OPSPILOT_RECONNECTION_NATIVE_GATE=1`.
Đặt release gốc/candidate cùng hai manifest pin độc lập theo README của lab đó;
candidate phải được build từ source hiện hành. Không dùng thư mục serving.

Gate tạo service/account/SQLite/SSH fixture trong namespace nonce riêng, nâng
controller, rồi seed metadata source2/PG prepared bằng production stores dưới UID
dịch vụ. Repo là `https://github.com/everestt2806/opspilot.git`, nhánh main; Git
poller của service vẫn theo dõi app paused nên gate đợi branch observation thật,
kiểm0jobs và health ready. Có đọc mạng Git công khai, không deploy source đó.
Main thật review/confirm/current qua pinned SSH → installed Root →
setpriv → Python admin → CLI. Kiểm tra consent/idempotency/sai app, legacy receipt,
token/PID và cleanup. Seed không provision PG, không SSH tới target, không gọi
Docker, không xác nhận trạng thái runtime hay GUI. Raw proof ở
`app/.out-scripts/controller-upgrade-desktop/<nonce>/result.json`.
