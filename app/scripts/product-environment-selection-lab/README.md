# Chọn revision cấu hình — R7h-3a

Linux Node22, modules Linux đã được duyệt; không SSH/Docker/VPS/profile Desktop.

```sh
export OPSPILOT_R1_MODULES=/path/to/approved-linux/node_modules
export OPSPILOT_R1_ARTIFACT=/path/to/owned-private-workspace/environment-selection.cjs
/path/to/node22 run.mjs --confirm-local-environment-selection
```

CLI sản phẩm: `select-project-environment --data-dir <private-controller-dir>`,
payload chỉ từ stdin theo `ProductEnvironmentSelectionInput` trong contract.
Administrator lấy từ UID; không nhận command/path/secret từ argv hoặc env.

Gate tạo controller/key/SQLite riêng và seed một app Git Next.js không DB. Lưu
snapshot mã hóa, chọn revision vào source generation mới, rồi chạy CLI trong
tiến trình mới và hai tiến trình cạnh tranh cùng UUID. Chỉ một generation mới
được tạo cho mỗi UUID/body; body khác bị từ chối. Kiểm tra source/audit không
có value/tên biến/hash secret, giữ deployment/pause policy, FK/role/migration035,
binding bất biến và từ chối replay báo paused sai khi operator đã resume.

Source có `environment` reference bị preflight từ chối trước source IO/SSH vì
renderer/runtime còn ở checkpoint sau. Đây là **desired source selection**,
không phải deploy hoặc activate cấu hình vào container. Không mở HTTP/root admin
bridge/Main/IPC/UI selection hoặc nới installed release/schema upgrade guard.

Kết quả đã khử dữ liệu tại
`app/.out-scripts/product-environment-selection-lab/<nonce>/result.json`; chỉ
hash artifact/check names/cleanup flags, không DB/key/raw stdin. Runner đóng DB
và chỉ dọn scratch do chính nó tạo trong temp. Thiếu flag từ chối trước scratch.
