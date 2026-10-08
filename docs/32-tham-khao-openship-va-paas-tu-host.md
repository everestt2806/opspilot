# Tham khảo OpenShip và các nền tảng deploy trên VPS

> Rà soát ngày 08/10/2026. Đây là tài liệu tham khảo cơ chế, không phải bằng chứng OpsPilot đã có các tính năng tương ứng. Trạng thái và gate sản phẩm nằm ở [lộ trình hoàn thiện](31-lo-trinh-hoan-thien-san-pham.md); checkpoint Git đầu tiên nằm ở [TK-S7 G0](tasks/tk-s7-g0-two-source-git.md).

## Kết luận cho OpsPilot

Giữ hai nguồn ngang hàng: **thư mục local** và **Git**. Cả hai tạo một đầu vào bất biến cho cùng pipeline detect → build → deploy → health → publish → record. Mỗi deployment lưu nguồn, cấu hình đã giải quyết và định danh bản nguồn; Git lưu full commit SHA, local lưu định danh/snapshot phù hợp với local, không gán SHA giả. Tự deploy theo push cần control plane luôn chạy theo [ADR-011](14-quyet-dinh-kien-truc.md). G0 chỉ đặt hợp đồng nguồn và lấy snapshot Git công khai; không kéo webhook, proxy, UI hoặc control plane vào G0.

## Cơ chế đáng áp dụng

| Cơ chế | Bằng chứng sản phẩm khác | Áp dụng cho OpsPilot | Thời điểm |
|---|---|---|---|
| Một pipeline cho Git và folder; deployment có snapshot cấu hình đã chốt | [OpenShip README](https://github.com/oblien/openship) mô tả source Git/folder/artifact, detect/build/run/route, snapshot để redeploy/rollback | Tách bước `acquireSource` khỏi pipeline deploy, lưu provenance và cấu hình đã giải quyết theo deployment. Redeploy/rollback không đọc lại branch đang đổi hoặc thư mục clone tạm | G0 hợp đồng nguồn; G1 nối pipeline; P2 cấu hình snapshot đầy đủ |
| Cùng một bộ giải quyết cấu hình cho wizard và tự deploy không có UI | [OpenShip openship.json](https://openship.io/docs/guides/openship-json) dùng detection rồi áp dụng override, kể cả khi push | Xây một resolver dùng chung cho local/Git, manual/auto. Cho phép manifest tối thiểu có kiểm tra schema về sau; không làm wizard thành nơi duy nhất giữ build/start/health config | P2, trước P3 auto deploy |
| Desktop riêng, control plane luôn chạy cho webhook | [OpenShip installation](https://github.com/oblien/openship/blob/main/docs/installation.md) phân biệt desktop và self-hosted; [Coolify architecture](https://coolify.io/docs/core/how-coolify-works) dùng control plane → SSH → VPS đích | Giữ hai mode rõ ràng và một nguồn sự thật history trong Product mode. Control plane quản lý qua SSH, app container tiếp tục chạy khi control plane mất kết nối | ADR-011 đã chốt; P3 triển khai |
| Push theo branch, kiểm chữ ký, chống lặp, queue bền | [OpenShip webhook](https://openship.io/docs/api/webhooks) xác minh HMAC trên raw body, lọc repo/branch và delivery ID; [Coolify auto deploy](https://coolify.io/docs/applications/deployments/automatic-deployments) cho phép chọn push hoặc manual, watch paths | Webhook GitHub phải xác minh chữ ký trước parse, kiểm repo/branch/SHA, lưu delivery ID và job; một deploy/app, retry hữu hạn. UI hiển thị trạng thái webhook và lịch sử delivery | P3, sau manual Git live |
| Reverse proxy và HTTPS trên VPS đích | [OpenShip README](https://github.com/oblien/openship) chạy workload trên loopback và edge cấp TLS; [Coolify architecture](https://coolify.io/docs/core/how-coolify-works) tách đường điều khiển khỏi HTTP traffic | Ingress sở hữu 80/443 sau preflight, route theo domain đến container nội bộ, cấp/renew cert và external HTTPS probe. Lỗi DNS/cert sau health phải giữ app đang chạy và báo publish degraded | P1 |
| Health gate trước khi chuyển traffic | [Dokku zero downtime checks](https://dokku.com/docs/deployment/zero-downtime-deploys/) đợi container mới sẵn sàng rồi đổi route và cho container cũ thời gian drain | Với ingress, đưa bản mới qua health gate rồi đổi upstream; giữ bản cũ và stateful data cho rollback có kiểm chứng | P1/P2 |
| Template và build backend mở rộng | [Coolify product docs](https://coolify.io/docs/core/what-is-coolify) có Git/Dockerfile/Compose/image; [CapRover one-click apps](https://caprover.com/docs/one-click-apps) có catalogue | Ưu tiên hoàn thiện ba Tier 1 và custom Dockerfile trước. Compose/image/catalogue là checkpoint sau, có gate thật cho mỗi loại | P2 và sau P2 |

## Những điểm không nên sao chép nguyên mẫu

- **Không bê nguyên OpenShip stack**: bản self-hosted Compose có PostgreSQL, Redis, API, dashboard, edge và Docker socket trên host theo [README](https://github.com/oblien/openship). OpsPilot đang có Electron/SQLite/SSH; thêm toàn bộ stack đó trước khi có Git deploy chạy thật sẽ tăng gánh vận hành. Đặc biệt Docker socket cho quyền điều khiển host, nên không dùng như mặc định.
- **Không đặt webhook trên domain app của người dùng ở giai đoạn đầu**: [OpenShip](https://openship.io/docs/guides/auto-deploy) hỗ trợ đường `/_openship/hooks/github` qua domain đã xác minh. Với OpsPilot, endpoint riêng của control plane dễ xác định quyền sở hữu, TLS và vận hành hơn; desktop đóng thì không thể nhận webhook.
- **Không dùng webhook URL trần như chứng thực duy nhất**: [CapRover deployment methods](https://caprover.com/docs/deployment-methods.html) hướng dẫn GitHub webhook với ô secret bỏ trống. Với sản phẩm production, OpsPilot phải xác minh HMAC hoặc request có xác thực theo nhà cung cấp. [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) là chuẩn kiểm tra chữ ký.
- **Không coi HTTP 200 là thành công deploy**: [OpenShip webhook API](https://openship.io/docs/api/webhooks) có thể trả 200 cho delivery đã xác minh dù handler báo lỗi trong body; [OpenShip auto deploy guide](https://openship.io/docs/guides/auto-deploy) yêu cầu redeliver thủ công khi trùng deploy đang chạy. OpsPilot nên xác nhận đã **ghi job bền** trước khi ACK, hiển thị trạng thái job tách khỏi delivery và xử lý push đến trong lúc bận bằng queue/debounce có giới hạn.
- **Không triển khai ngay GitHub App, preview PR, monorepo changed paths hoặc đa tenant**: các cơ chế này có giá trị ([OpenShip webhook](https://openship.io/docs/api/webhooks), [Coolify watch paths](https://coolify.io/docs/applications/deployments/automatic-deployments)) nhưng phụ thuộc Git manual, ingress, config resolver và controller ổn định. Đưa vào backlog sau P3.

## Quyết định ảnh hưởng checkpoint hiện tại

**TK-S7 G0 giữ nguyên ranh giới.** Worker phải mô hình hóa `source_kind` và snapshot Git với full SHA/root để G1 dùng chung với nguồn local; không tạo cấu hình chỉ tồn tại trong UI và không buộc migration/redeploy vào thư mục clone tạm. Mọi phát triển webhook, quyền điều khiển VPS, proxy, manifest và job queue thuộc checkpoint sau. Khi review G0, kiểm rõ một deployment Git luôn trỏ tới đúng commit đã checkout dù branch di chuyển.

## Nguồn và giới hạn

Các liên kết trên là README/tài liệu/guide chính thức của dự án, đọc ngày 08/10/2026. Chúng chứng minh cơ chế được mô tả, không chứng minh chất lượng, độ an toàn hoặc mức hoàn thiện thực tế của từng sản phẩm. Các khuyến nghị OpsPilot là suy luận thiết kế từ nguồn và trạng thái repo hiện tại; cần test cục bộ và live trên VPS ở từng checkpoint.
