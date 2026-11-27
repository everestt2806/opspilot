# Gate CLI cấu hình Product — R7h-2a

Chỉ chạy local Linux Node22, cùng UID sở hữu thư mục controller. Không Docker,
SSH, VPS hoặc profile Desktop thật. Cần các module Linux đã được duyệt; không
tải dependency hoặc tạo khóa controller đang dùng.

```sh
export OPSPILOT_R1_MODULES=/path/to/approved-linux/node_modules
export OPSPILOT_R1_ARTIFACT=/path/to/owned-private-workspace/environment-admin.cjs
/path/to/node22 run.mjs --confirm-local-environment-admin
```

Runner build CLI từ source hiện tại với SQL/Python assets, tạo private fixture
và controller key riêng. Sáu kiểm tra gồm:

- CLI thật nhận JSON qua stdin, khởi động tiến trình mới và retry cùng UUID chỉ có một revision.
- Cùng UUID khác body hoặc UUID mới với revision cũ đều bị từ chối.
- Hai tiến trình CLI cạnh tranh cùng UUID chỉ tạo một revision mới.
- SQLite chỉ có ciphertext của snapshot/receipt; không thay source/policy/job.
- Sửa auth tag của receipt bị từ chối ở cả stage và lookup.
- Quyền file key không an toàn hoặc authority hiện hành thay đổi bị từ chối.

Output `app/.out-scripts/product-environment-admin-lab/<nonce>/result.json` chỉ chứa
metadata của gate, hash artifact và trạng thái dọn private scratch. Không raw
request, value, DB/key, stdout/stderr thô hoặc plaintext digest của secret.

Hai command sản phẩm là `stage-project-environment` và `project-environment-state`,
với `--data-dir` bắt buộc; payload theo `docs/contracts/product-environment.ts`
chỉ qua stdin pipe, không argv, biến môi trường hay file plaintext. Administrator
lấy từ UID của tiến trình, không từ payload. Mất reply dùng state với request UUID
để tra metadata; retry stage phải giữ nguyên UUID, toàn body và kỳ vọng nguồn.
Không tự động cấp UUID khác khi kết quả chưa rõ.

Đây là CLI nội bộ cùng UID, chưa mở HTTP, root bridge, IPC hoặc UI. Controller đã
cài trên VPS giữ bản cũ; cần gate phát hành/nâng schema riêng trước khi sử dụng.
Revision vẫn `staged`, không activate hay deploy. Gate này không chứng minh env
render, PostgreSQL, rollback cấu hình, GUI hoặc mất kết nối SSH.
