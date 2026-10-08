# Hoàn thiện OpsPilot thành nền tảng deploy trên VPS riêng

> Rà soát ngày 08/10/2026 tại HEAD `1cd5959`. Đây là chuẩn nghiệm thu sản phẩm sau demo, không thay thế [đề tài gốc](00-de-tai-goc.md) hoặc [lịch demo 14/10](29-ke-hoach-demo-14-10.md). Trạng thái là đánh giá mã và hồ sơ hiện có; test cục bộ không được tính là live gate trên VPS mới.
> Chuẩn tham chiếu: [Vercel Git](https://vercel.com/docs/git), [Dokploy GitHub](https://docs.dokploy.com/docs/core/github), [Dokploy Domains](https://docs.dokploy.com/docs/core/domains), [Coolify Automatic Deployments](https://coolify.io/docs/applications/deployments/automatic-deployments), [Coolify Domains](https://coolify.io/docs/core/networking/domains).

## 1. Lời hứa sản phẩm và định nghĩa hoàn thành

Người dùng chọn **Deploy trực tiếp từ thư mục trên máy** hoặc **Deploy từ Git**. Sau khi cấu hình VPS hợp lệ, họ có thể triển khai, nhận URL truy cập được, xem trạng thái/log, cập nhật phiên bản, rollback và migrate qua giao diện. Với dự án Git, họ có thể bật tự deploy theo push. Cả hai nguồn dùng chung pipeline và lịch sử; bản Git lưu repo/ref/full SHA, bản thư mục không có Git SHA giả.

Một mục chỉ được đánh dấu `PRODUCT_PASS` khi có đủ UI → IPC → runtime/DB, kiểm thử nhánh lỗi, bằng chứng chạy thật trên VPS phù hợp và hướng dẫn sử dụng. Ghi riêng `CODE_PRESENT`, `LOCAL_PASS`, `LIVE_PASS`, `BLOCKED`, `NOT_RUN`. [Ma trận truy vết cũ](05-truy-vet-yeu-cau.md) có dấu ✅ của các phiên trước (như UC-02/FR-B5), nhưng chưa bao trùm nhánh Git, test của source và VPS mới; phải đối soát bằng chứng trước khi chốt trạng thái hiện hành.

## 2. Tự động hóa kết nối, deploy và cổng mạng

| Công việc | Hiện có trong mã | Người dùng vẫn cần làm / giới hạn | Tiêu chí sản phẩm |
|---|---|---|---|
| Kết nối VPS | Profile, SSH test, pin host fingerprint, credential mã hóa cục bộ, scan và nút cài Docker | Cung cấp IP/credential/fingerprint lấy độc lập; bảo đảm SSH đến được VPS. App không thể sửa firewall nhà cung cấp qua SSH nếu SSH ban đầu bị chặn | Wizard nêu từng bước, xác minh host key trước auth, cài Docker khi người dùng chọn và kiểm lại; lỗi rõ ràng |
| Cấp cổng app | Precheck cấp port; `SshExposureManager` dùng `sudo -n ufw allow <port>/tcp` khi UFW active; probe từ ngoài | Cần quyền sudo. Adapter DigitalOcean có file/test nhưng chưa nối vào `DeployService` production; provider VPS hiện dùng chưa có adapter. Cloud firewall có thể cần thao tác dashboard | Tự xử lý tầng app/UFW khi có quyền; provider có API thì dùng scoped token; provider khác hiển thị đúng rule cần thêm và nút kiểm tra lại; chỉ báo reachable khi probe pass |
| Domain/HTTPS | Có Domain Assistant, DNS check và Cloudflare DNS upsert | Chưa tự dựng ingress/proxy hoặc certificate; DNS trỏ IP không làm `https://domain` route vào app | Một ingress 80/443 quản lý route/chứng chỉ/lifecycle, external HTTPS probe; không cần mở từng port 30000–30999 ra Internet khi dùng ingress |
| Deploy từ thư mục | Wizard, detector, upload/build/health/history/rollback có mã | Chưa có live gate trên VPS mới cho ba Tier 1 | Ba stack chạy thật từ thư mục, có URL/log/rollback và ca lỗi |
| Deploy từ Git thủ công | Chưa có acquisition/UI/provenance | Hiện chỉ chọn folder | Chọn repo/ref/root, khóa SHA trước detect, deploy và lưu provenance; private repo sau với credential scoped |
| Tự deploy theo push | Chưa có webhook/poller Git và bộ điều phối luôn chạy | Electron đóng thì không nhận push; nút Redeploy thủ công không phải auto deploy | Push vào branch đã chọn tạo đúng một deployment theo SHA, queue/idempotency/log, lỗi giữ bản live, vẫn chạy khi desktop đóng |

Không thể hứa “nhập IP là mọi thứ tự xong” với mọi provider. Lần đầu cần xác thực host key, credential, quyền SSH và có thể phải mở SSH ở panel provider. Sau onboarding, app tự làm tối đa những gì có quyền; phần không có API phải được chỉ dẫn chính xác, kiểm tra lại tự động và ghi rõ nguyên nhân chưa public.

## 3. Danh mục bắt buộc từ đề tài gốc và phần sản phẩm cần bổ sung

| Nhóm | Tình trạng đã kiểm được | Gate hoàn thành |
|---|---|---|
| UC-01 / FR-A: VPS | CRUD/test/scan/Docker install, host key pin có mã; VPS mới qua preflight | Onboarding live trên VPS mới; thử quyền/cài lỗi/firewall SSH/reconnect |
| UC-02/03 / FR-B: deploy và redeploy | Pipeline và ba detector Tier 1 có mã/test; local là nguồn duy nhất hiện tại | Cả local và Git; Next.js, Express, Vite SPA deploy thật; build/test source nếu khai báo; env/thiếu config được giải thích; đo NFR-4; redeploy fail giữ bản cũ |
| FR-B8 / template linh hoạt | Template Next.js, Express, static SPA; chưa có custom Dockerfile/Compose/image | Chứng minh thêm detector không sửa lõi; hỗ trợ ít nhất custom Dockerfile cho repo ngoài ba mẫu. Compose/image có task/gate riêng, không gọi ba template là mọi stack |
| UC-04 / FR-E1: rollback thủ công | Có handler/pipeline và smoke lịch sử | Trên VPS mới rollback v2→v1; xác nhận image, URL, dữ liệu, history và ca image đã mất |
| UC-05 / FR-C: migrate | Có backup/transfer/restore/verify/cancel trong mã | Hai VPS thật: app + PostgreSQL + volume/config; checksum/row count/target health; giữ nguồn đến xác nhận; cố ý ngắt giữa transfer và chứng minh rollback. Git app không phụ thuộc clone tạm |
| UC-06/08/09 / FR-D, E3: monitor/ML/history | Collector, poller, ML, alert/label/action log có mã/test | Metric/score/alert/label/action log từ run thật; pilot 75 phút trên VPS đủ 40 GB và phân tích đúng giao thức |
| UC-07 / FR-E2: auto rollback do monitor/ML | `auto_rollback`, trusted method và threshold có trong schema/setting; chưa thấy poller/service gọi pipeline rollback khi alert đạt ngưỡng | Chọn alert tin cậy, số lần liên tiếp, cooldown, khóa theo app, rollback + verify + audit, test chống lặp và live fault injection. Phân biệt với rollback khi deploy healthcheck fail |
| Vận hành sản phẩm | Runtime inspect, deploy log event, Doctor/DNS Assistant có mã; thiếu runtime log UI, `app:start`/`app:stop` handler, DB tab backend và env lifecycle | Xem runtime logs, start/stop/restart, chỉnh env an toàn, backup/restore định kỳ nếu quản lý DB, domain HTTPS thật; không hiển thị chức năng giả |
| NFR/release | Build Electron và test cục bộ có lịch sử; chưa có installer smoke máy sạch và đủ số lần live | Installer trên máy không có Node; đo deploy ≥5 lần/stack; ba stack ≥5 lần; secret redaction; hồ sơ live và số liệu ML tái lập |

Tier 2 Flask/Django là **mở rộng tùy điều kiện** theo FR-B2/NFR-7 gốc. Nếu nâng lên cam kết sản phẩm, phải có task và live gate riêng. “Hoàn thiện chức năng đã hứa” trước hết là toàn bộ Tier 1 và UC-01…09, không đồng nghĩa nhận mọi framework trên thị trường.

## 4. Tự deploy thực sự cần kiến trúc luôn chạy

[Vercel](https://vercel.com/docs/git) tạo deployment theo Git push; [Dokploy](https://docs.dokploy.com/docs/core/github) và [Coolify](https://coolify.io/docs/applications/deployments/automatic-deployments) cũng có kết nối Git/trigger tự động. OpsPilot dùng SQLite trên desktop và `MonitorScheduler` sống cùng Electron. Vì vậy thêm webhook handler vào Electron **không bảo đảm deploy khi desktop tắt**.

Người dùng đã cho phép control plane trên VPS. [ADR-011](14-quyet-dinh-kien-truc.md) chọn một control plane trên VPS quản lý, điều phối các VPS đích qua SSH thay vì agent trên từng VPS. Hai chế độ có nhãn rõ:

1. **Desktop mode:** deploy thủ công từ local/Git; có thể kiểm tra Git định kỳ khi app mở, nhưng chỉ ghi “tự deploy khi OpsPilot đang chạy”. Giữ NFR-1/CLAUDE.md hiện tại.
2. **Product mode:** một control plane tự host trên VPS quản lý, có queue/trạng thái bền và đồng bộ history cho desktop; nhận sự kiện Git có xác thực hoặc poll outbound, điều khiển VPS đích qua SSH. Không mở Docker API công khai. Người dùng đã chốt cho phép service này, thay giới hạn NFR-1/không agent của bản đồ án trong phạm vi Product mode; nguồn sự thật dữ liệu, credential, API quản trị và hợp đồng triển khai phải được khóa trong checkpoint thiết kế riêng trước khi viết controller. Không được để hai hệ thống cùng tuyên bố là nguồn lịch sử deployment chuẩn.

Hợp đồng auto deploy: project chọn production branch; push nhận full SHA; chống giả mạo/replay nếu webhook; queue bền, một deploy/app, debounce và idempotency theo SHA, retry giới hạn; test/build/health/public probe xong mới active; thất bại giữ bản cũ và ghi log; rollback gắn đúng nguồn; chạy được khi desktop đóng. Preview PR cần môi trường/port/domain/env tách và cleanup khi PR đóng, sau production auto deploy.

## 5. Checkpoint giao Worker và cổng nghiệm thu

| Thứ tự | Checkpoint | Hoàn thành khi |
|---|---|---|
| P0, trước demo 14/10 | Khóa hợp đồng hai nguồn; public Git manual; giữ local; live Express Git trên VPS hiện có | Repo/ref/full SHA trong history, URL ngoài truy cập được, local regression; demo nói đúng giới hạn |
| P1 | Onboarding/publish: Docker, port/UFW, provider boundary, ingress HTTPS và domain | VPS mới đi từ profile → app có URL HTTPS; provider không có API có hướng dẫn chính xác và probe lại |
| P2 | Template/build/lifecycle: ba Tier 1, source tests, custom Dockerfile, logs, env, redeploy/rollback | Ma trận local/Git × ba stack trên VPS; lỗi build/health giữ bản cũ; logs và env hoạt động sau deploy |
| P3 | Tự deploy production theo push | ADR always-on mode, queue và đồng bộ state; push khi desktop tắt tạo đúng SHA, lỗi không thay bản live |
| P4 | Migrate và dữ liệu | Hai VPS thật, PostgreSQL/volume/config, verify/rollback/cancel; backup/restore drill và Git-source migration |
| P5 | Monitor/Doctor/ML auto rollback và hồ sơ đồ án | Fault injection live, trusted method/cooldown/verify/audit; pilot đủ điều kiện, FR/UC/NFR đối soát lại |

Mốc 14/10 là demo trung gian. Hoàn tất P1–P5 trước hạn nộp 20/11 phải theo tiến độ/gate thực tế, đặc biệt hai VPS cho migrate và VPS ≥40 GB cho pilot. Không cắt bỏ chức năng cũ vì demo gần; nếu thiếu hạ tầng, ghi `BLOCKED` hoặc `NOT_RUN` thay vì `PASS`.
