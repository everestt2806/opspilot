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

Release này chỉ nâng payload với cùng Node/dependency lock/schema/helper/template/collector. Schema/dependency drift bị từ chối; không chạy migration hoặc phục hồi DB bằng bản sao.
