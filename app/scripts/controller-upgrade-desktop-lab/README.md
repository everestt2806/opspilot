# Lab Main journal → SSH → controller upgrade

R3c-6h4c-2a: chạy root Linux systemd/Node22, loopback8768 đang trống. Không chạy đồng thời Windows ControllerService tests hoặc controller khác dùng8768.

Đầu vào trusted:

- `OPSPILOT_CONTROL_PLANE_MODULES`: Linux dependencies đã duyệt.
- `OPSPILOT_CONTROLLER_RELEASE_OUTPUT` và `OPSPILOT_CONTROLLER_RELEASE_PIN`: original release/pin độc lập, không đọc pin do receiver tự báo.
- `OPSPILOT_UPGRADE_RELEASE` và `OPSPILOT_UPGRADE_RELEASE_PIN`: candidate release/pin độc lập, cùng schema029/helper/dependency lock.

```sh
env OPSPILOT_CONTROL_PLANE_MODULES=/path/to/approved/node_modules \
  OPSPILOT_CONTROLLER_RELEASE_OUTPUT=/path/to/original/release \
  OPSPILOT_CONTROLLER_RELEASE_PIN=<original-pin> \
  OPSPILOT_UPGRADE_RELEASE=/path/to/new/release \
  OPSPILOT_UPGRADE_RELEASE_PIN=<new-pin> \
  /path/to/node22 app/scripts/controller-upgrade-desktop-lab/run.mjs
```

Fixture tạo root/account/unit riêng theo nonce, original transfer namespace và upgrade namespace độc lập. SSH2 server dùng host/client key sinh trong RAM; Python-only SSH PATH, receiver/Root installer/service UID/systemd/SQLite là thật. Main DB030 khác controller DB029. Không ghi key hoặc credential vào receipt; cold subprocess nhận key tạm qua stdin, chỉ trả metadata.

Phép thử: prepare idempotent/readonly absent status; verify transfer/tool pins; lost upgrade reply; mở một tiến trình Main mới để inspect cùng UUID, PID không đổi; không cho upgrade lần hai hoặc tự sửa API binding; explicit rollback giữ original receipt/identity/key/DB inode; archive VPS chặn dispatch. Cleanup kiểm realpath/marker/unit bytes/account rồi chỉ dọn fixture nonce.

Giới hạn:0Productapps/targets, không Docker app deployment/OS reboot/production VPS hoặc UI/Electron. c-2b còn upgraded admin/current API binding, explicit authority rebind và IPC/UI. Raw result/progress trong `app/.out-scripts/controller-upgrade-desktop/<nonce>/`; sanitized proof trong hồ sơ task.
