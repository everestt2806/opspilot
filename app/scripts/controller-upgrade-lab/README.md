# Lab nâng cấp controller — R3c-6h4c-1

Chạy bằng root trên Linux systemd và Node22. Lab dùng cổng loopback8768, vì vậy không chạy đồng thời controller khác hoặc Windows ControllerService tests. Không dùng VPS phát triển hay Desktop DB hiện hữu.

## Đầu vào

- `OPSPILOT_CONTROL_PLANE_MODULES`: thư mục Linux dependencies đã duyệt (esbuild/better-sqlite3).
- Golden release cũ tại `app/resources/controller-releases/linux-x64-node22-20261110/release`, pin độc lập `96a6a5b46ebede6d8c2e6cb0141028748b98278777cdba8648a89d00d83d15cd`.
- `OPSPILOT_UPGRADE_RELEASE`: release Linux mới do `build-control-plane.mjs` và `build-controller-release.mjs` tạo; `OPSPILOT_UPGRADE_RELEASE_PIN` phải là pin độc lập của release đó. Không lấy pin do receiver trả về làm nguồn tin cậy.

```sh
env OPSPILOT_CONTROL_PLANE_MODULES=/path/to/approved/node_modules \
  OPSPILOT_UPGRADE_RELEASE=/path/to/new/release \
  OPSPILOT_UPGRADE_RELEASE_PIN=<independent-sha256> \
  /path/to/node22 app/scripts/controller-upgrade-lab/run.mjs
```

Lab tạo `/opt/opspilot-controller-upgrade-lab-<nonce>`, account `opsup<nonce>` và unit riêng. Sau khi kiểm tra realpath/marker/unit bytes/account ownership, cleanup chỉ xóa tài nguyên thuộc nonce đó. Receipt không chứa token, key bytes hay DB rows; raw result nằm trong `app/.out-scripts/controller-upgrade/<nonce>/result.json`.

## Phép thử và giới hạn

- Installer thật → account non-root, SQLite/key riêng và systemd sandbox thật.
- SIGKILL sau staging/stop/unit switch/start/commit; inspect và duplicate không replay effect.
- Service restart mô phỏng khởi động lại trong stop/switch phase; không phải reboot hệ điều hành.
- Candidate maintenance chặn authenticated policy write, kể cả pause, cho đến root activation marker.
- Thêm credential sau commit mất phản hồi; recovery giữ dữ liệu và PID hiện hành.
- Hai revision liên tiếp; rollback mất tiến trình trước/sau khi parent chạy; thêm credential tại mỗi ranh giới và kiểm tra vẫn xác thực được khi trở lại bản gốc.
- Candidate lỗi startup không mở gate; rollback tường minh khôi phục bản gốc. Old install receipt/runtime, identity/key và DB/key inode giữ nguyên; old inspector hợp lệ lại sau rollback.
- HTTP fixture độc lập vẫn phục vụ qua các lần chuyển. Có **0 Product app/target** trong DB lab; chưa chứng minh Docker app deployment, target enrollment, OS reboot, VPS rollout hoặc Desktop UI.

## R7h-3d — Schema29→35 có bảo vệ

Lab hiện kiểm thêm18 phép thử trên bản ứng viên có cùng Node/dependency lock, với exact helper transition R7h đã qua runtime gates. Snapshot29/35 và projection29 dùng cùng dữ liệu/key/DB inode; không nhận schema khác hoặc Desktop migrations.

- Backup SQLite nhất quán được Root seal0440 trong directory0550; service không thể ghi đè. SIGKILL sau seal nhưng trước journal vẫn phục hồi đúng request.
- SIGKILL sau migration commit, khởi động candidate maintenance và phục hồi cùng UUID không lặp migration hay mất dữ liệu cũ.
- Variant lab riêng ngắt tiến trình ngay trong migration033: outer transaction hoàn tác cả032/033, DB vẫn đúng29, sau đó recover và rollback thành công. Variant này không vào catalog hoặc VPS.
- SIGKILL sau reverse commit; khởi động candidate không tự migrate29. Recover hủy systemd restart đang chờ và chỉ công bố parent sau khi kiểm fresh projection29.
- Credential tạo sau activation và giữa các lần rollback vẫn xác thực được. Không restore backup lên DB đang dùng.
- Một app/nguồn/env ciphertext giả lập chỉ phục vụ phép thử cuối: khi bảng env có dữ liệu, rollback bị từ chối trước stop/unit switch; PID và service ready giữ nguyên.
- Cleanup chỉ unit/account/root thuộc nonce đã xác minh. Có0 Docker Product deployment; HTTP fixture độc lập không được gọi là Docker/VPS acceptance. Chưa chứng minh OS reboot, target helper upgrade, packaged catalog, Desktop upgrade UI hay live env rollout.

Log các lần chạy lỗi và bản pass giữ riêng trong `app/.out-scripts/controller-upgrade/<nonce>/`; phải chạy lại trên source/bundle cuối, không lấy lần pass cũ thay gate cuối.
