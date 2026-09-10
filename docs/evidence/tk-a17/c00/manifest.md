# C00 manifest — target dự kiến

Ngày kiểm tra: 11/09/2026 (Asia/Bangkok). Đây là manifest read-only cho C00; chưa phải
quyền deploy và chưa cấp `app_id`, deployment ID hoặc host port. C01 phải lấy các giá trị
đó từ allocator/service, không hardcode.

| Trường | Giá trị | Trạng thái/ghi chú |
| --- | --- | --- |
| VPS | VM02 / `221.121.1.80` / `deploy` / SSH 22 | SSH read-only PASS; VM01 timeout |
| App slug dự kiến | `a17-notes-0911` | Target riêng; path/container/network đều FREE tại thời điểm kiểm tra |
| VPS workspace | `/opt/opspilot/a17-notes-0911` | Chưa tạo; không chạm app B |
| Container prefix | `a17-notes-0911` | Chưa tạo; không trùng container B đã inventory |
| Network prefix | `a17-notes-0911` | Chưa tạo; không trùng network B đã inventory |
| Host port | Chưa cấp | C01 allocator/service quyết định trong dải contract |
| Current deployment | Chưa có | C01 tạo bằng pipeline thật |
| Release/image/marker | Chưa có | C04 chuẩn bị release thật; không tạo fixture ở C00 |
| Public access | `221.121.1.80:30001` timeout | Đây là port app B; không dùng làm URL A17 |
| Local presentation fallback | SSH loopback `127.0.0.1:39011` → VM02 `127.0.0.1:30001` | Chỉ GET app B, tunnel đã đóng sau kiểm tra |

## Ownership and safety

- Local DB mở `mode=ro`: `app=[]`, `running_experiments=[]`; không sửa DB.
- VM02 inventory thấy `express-demo-app` healthy và `express-demo-collector` running;
  cả hai restart count 0. Không suy healthcheck riêng cho collector. Đây là app/dữ liệu
  của B, không phải website A17.
- VM02 target path, container và network đều chưa tồn tại. Không deploy, restart, stop,
  fault, rollback hoặc reset trong C00.
- Secret/key path không đưa vào manifest public; raw SSH evidence giữ command nhưng không
  in nội dung private key hoặc DSN.
