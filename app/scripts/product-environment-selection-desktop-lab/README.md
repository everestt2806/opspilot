# Desktop chọn cấu hình Product — R7h-3c

Chạy Node22 từ root repo:

```
node app/scripts/product-environment-selection-desktop-lab/run.mjs --confirm-local-environment-selection-ui
```

CLI mở Electron thật với production component, preload, Main service, SQLite và AES vault;
SSH/controller transport được mô phỏng nhưng thao tác stage/review/select/lookup dùng
production repository trên SQLite riêng. Không VPS, Root installer hoặc public Git.

Gate kiểm bốn locale/dark-light/layout ở1280×800 và1366×768, form clear/write-only,
lost reply/cold Main+SQLite reopen, chọn đúng một source generation rồi tiếp tục stage;
latest2/selected1 khác nhau. Revision từ administrator khác làm CAS cũ lỗi: chỉ
authoritative negative proof mới chuyển not_applied và cho phép yêu cầu mới. Không
job/deploy/unpause, không values trong DB plaintext/localStorage/result/capture.

Raw result: app/.out-scripts/product-environment-selection-desktop-lab/nonce/result.json.
Ảnh: docs/ui-redesign/screenshots/r7h3c/nonce/. Child dọn private DB/key; parent đợi
Electron thoát rồi xóa đúng profile nonce có kiểm realpath, chốt result với cleanup.
Capture chờ hai animation frames, kiểm bitmap có ít nhất16 màu sample và retry có
giới hạn; ảnh first-frame trống bị từ chối, không dùng DOM-ready thay paint proof.
Cold reopen trong gate là Main/SQLite trong cùng Electron process, không phải restart
hệ điều hành hoặc kiểm DPAPI trên máy Windows khác. Không lấy gate này thay rollout.

Native Linux CLI/Python bridge độc lập: dùng runbook ../product-environment-selection-lab/README.md;
source artifact rebuild từ hiện trạng, ba command review/select/lookup nhận stdin cùng UID.
Controller schema035 bỏ Desktop-only036; Desktop schema036. Installer/schema backup-upgrade,
helper compatibility và deploy cấu hình trên VPS thật thuộc R7h-3d.
