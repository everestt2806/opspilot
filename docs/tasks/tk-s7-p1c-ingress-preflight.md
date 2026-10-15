# TK-S7 P1c — Ingress ownership and read-only preflight

> Trạng thái: CHỜ REVIEW. Theo hợp đồng P1a; không cài/chạy Caddy, sửa config, mở firewall, ghi VPS hoặc đánh dấu domain active.

## Phạm vi đã triển khai

- `preflightSharedIngress()` nhận `SshManager` và VPS ID, chỉ gọi bảy lệnh cố định qua SSH đã ghim fingerprint: đọc TCP listener 80/443, unit `opspilot-caddy.service`, marker, tồn tại/khả năng đọc config, phiên bản binary Caddy và trạng thái UFW. Không ghép dữ liệu người dùng vào lệnh; không trả stdout/stderr thô.
- Marker ownership được quy ước là `/etc/opspilot/caddy/OWNER` với nội dung `opspilot-shared-ingress-v1`; config phải đọc được tại `/etc/opspilot/caddy/Caddyfile`; unit phải active, có fragment `/etc/systemd/system/opspilot-caddy.service` và `ExecStart` có executable `/usr/bin/caddy` cùng `argv[]` chỉ tới đúng config path đó. Listener PID phải khớp `MainPID`. Tên process `caddy` riêng lẻ hoặc đường dẫn chỉ chứa chuỗi mong đợi không đủ.
- Listener chỉ được kết luận trống khi `ss` thành công và stdout rỗng chính xác; trạng thái cổng (`ports_status`) được tách khỏi quyền ghi ingress (`install_assessment`/`local_assessment`). Có thể báo cổng trống nhưng assessment vẫn `unknown` nếu unit hiện diện nhưng chưa xác minh, marker sai/không đọc được hoặc config tồn tại mà chưa chứng minh OpsPilot sở hữu. `clear` chỉ có khi unit OpsPilot đã xác minh hoặc host sạch (unit vắng, marker vắng, config vắng) và UFW đã biết; không suy ra an toàn ghi từ cổng trống đơn thuần.
- Mọi dòng `ss` không parse trọn vẹn đều thành `unknown`/`INGRESS_OWNER_UNKNOWN`. UFW giữ trạng thái riêng IPv4/IPv6; rule `(v6)` không chứng minh IPv4, rule chồng hành động hoặc output lạ trả `unknown`. Với default allow, DENY/REJECT theo nguồn hẹp cũng trả `unknown` vì chưa chứng minh phạm vi và thứ tự áp dụng. `route_activation` luôn `not_evaluated`; `clear` không xác nhận cloud firewall, DNS, route hay HTTPS.
- `buildSharedIngressConfig()` là builder thuần cho tập route OpsPilot được truyền vào; chuẩn hóa/validate hostname, validate port, từ chối hostname trùng hoặc dữ liệu chèn, sort ổn định và render upstream loopback. Caller phải cung cấp toàn bộ route OpsPilot muốn giữ; builder không đọc hay sửa config của proxy khác.

## Gate

- Node 22.23.3 focused Vitest `src/main/domain/ingress/preflight.test.ts` và `routeBuilder.test.ts`: 37/37 PASS.
- Node 22.23.3 `pnpm --dir app typecheck`: PASS.
- Node 22.23.3 `pnpm --dir app build`: PASS.
- `git diff --check`: PASS.
- VPS development survey: đã chạy một lần chỉ đọc qua `SshManager` với fingerprint ghim, trên profile cô lập tạo bằng SQLite backup API. Kết quả đã khử nhạy cảm: 0 listener; service OpsPilot `absent`; ownership `ports_free`; UFW `unknown`. Kết quả public không phân biệt lệnh UFW không đọc được với format chưa nhận diện; không lưu output SSH để phân loại sâu hơn. Không lưu credential hay fingerprint; không sửa profile nguồn hoặc VPS.

## Giới hạn còn lại

Preflight hiện chỉ là module main-process, chưa có IPC/UI. UFW là trạng thái firewall trên host; cloud firewall, DNS, route thực tế và external HTTPS probe chưa được kiểm tra. Chưa cài/reconcile Caddy và chưa có hostname route nào được áp dụng.

## UPDATE P1c — fail-closed review

- `ss` chỉ suy ra `ports_free` từ lệnh thành công với output rỗng; mọi dòng listener không parse chắc chắn cho `unknown`.
- `ExecStart` được kiểm tra theo executable tuyệt đối, argv executable và đúng một `--config` với config path tuyệt đối; active service không có listener là `unknown`.
- UFW IPv4/IPv6 được báo tách biệt. Rule Anywhere (v6) không suy ra IPv4; allow/deny chồng nhau và định dạng không nhận diện được giữ `unknown`.
- Live survey chỉ đọc trên bản profile cô lập với SSH fingerprint ghim: 0 listener, service absent, ownership `ports_free`, UFW `unknown` (không phân biệt được lỗi đọc với format lạ từ kết quả công khai). Đây là quan sát host hiện tại, không phải bằng chứng DNS/cloud firewall/HTTPS.
- Gates Node 22.23.3: focused tests 31/31 PASS; typecheck PASS; build PASS; `git diff --check` PASS.

## UPDATE P1c — phân biệt cổng trống và an toàn ghi

- Kết quả tách `ports_status` (`free`/`occupied`/`unknown`) khỏi `install_assessment` (`safe`/`blocked`/`unknown`); `local_assessment=clear` chỉ khi ingress hiện có đã xác minh là của OpsPilot hoặc unit, marker và config đều vắng trên host sạch.
- Bổ sung lệnh chỉ đọc `test -e` cho Caddyfile. Unit inactive nhưng còn được cài, marker sai/không đọc được, hoặc config tồn tại khi chưa xác minh ownership đều giữ `local_assessment=unknown`, dù cổng trống.
- Với UFW default allow, DENY/REJECT theo nguồn cụ thể không còn được coi là truy cập được từ mọi nơi; trạng thái là `unknown` khi phạm vi/thứ tự chưa chứng minh.
- Không chạy khảo sát live mới và không thay đổi VPS; bằng chứng live trước đó được giữ nguyên như lịch sử, không dùng để suy luận trạng thái hiện tại sau thay đổi này.
- Gates Node 22.23.3: focused tests 37/37 PASS; typecheck PASS; build PASS; `git diff --check` PASS.
