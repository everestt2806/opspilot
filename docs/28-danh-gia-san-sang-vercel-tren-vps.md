# Đánh giá năng lực OpsPilot: “Vercel trên VPS riêng”

> Đánh giá gốc: 08/10/2026 tại HEAD `9dcd054`; cập nhật trạng thái 08/10 tại HEAD `fcc3051`.
> Bản kiểm kê Git-first và thứ tự demo mới: [30-audit-git-first-deploy.md](30-audit-git-first-deploy.md).
> VPS phát triển đã qua preflight SSH/Docker/port; deploy qua OpsPilot và pilot ML vẫn `NOT_RUN`.

## 1. Kết luận

OpsPilot đã là một công cụ desktop triển khai ứng dụng lên VPS qua SSH, có theo dõi phiên bản,
rollback, migrate, Doctor và giám sát ML. Năng lực đó tạo một nền tảng kỹ thuật có giá trị.
Tuy nhiên, trải nghiệm cốt lõi “kết nối Git → push → deployment → URL HTTPS → quan sát → khôi phục”
chưa liền mạch. Hiện tại chỉ nên mô tả là **desktop VPS deploy operator**, chưa nên giới thiệu là
“Vercel trên VPS” đã hoàn thiện.

Lệnh kiểm chứng cục bộ trong phiên review: `pnpm --prefix app lint` PASS,
`pnpm --prefix app typecheck` PASS, `pnpm --prefix app test` **68 file / 626 test PASS**
(Node 22.23.3). Các gate này không thay cho deploy thật, HTTPS thật hay restore thật trên VPS.

## 2. Chuẩn so sánh

- [Vercel Git deployments](https://vercel.com/docs/git): push vào nhánh tạo deployment,
  có môi trường preview và production, gắn commit với bản chạy.
- [Vercel rollback](https://vercel.com/docs/instant-rollback): rollback một deployment đã từng
  gắn với domain production.
- [Dokploy Applications](https://docs.dokploy.com/docs/core/applications),
  [Auto Deploy](https://docs.dokploy.com/docs/core/auto-deploy) và
  [Domains](https://docs.dokploy.com/docs/core/domains): quản lý nguồn Git/image,
  tự deploy theo thay đổi, log, metrics và route domain qua reverse proxy.
- [Coolify Applications](https://coolify.io/docs/applications/),
  [Preview Deployments](https://coolify.io/docs/applications/deployments/preview-deployments)
  và [Database Backups](https://coolify.io/docs/databases/backups): quản lý vòng đời container,
  preview độc lập và backup có lịch. Đây là các năng lực tham chiếu, không phải yêu cầu sao chép toàn bộ.

## 3. Ma trận năng lực hiện tại

| Năng lực | Bằng chứng trong repo | Đánh giá |
|---|---|---|
| VPS onboarding và deploy qua SSH | `app/src/main/vps/`, `app/src/main/deploy/pipeline.ts` | VPS phát triển qua preflight; deploy qua OpsPilot vẫn `NOT_RUN` |
| Detect và build 3 loại app | `app/src/main/detectors/` cho Next.js, Express, static SPA | Có phạm vi hẹp, chưa là build platform tổng quát |
| Nguồn Git, commit SHA, push-to-deploy | `DeployPage` chọn thư mục; `pipeline.ts` yêu cầu `source_path` tồn tại trên máy desktop và upload | Chưa có đường Git product; `remote_source_path` là đường relay của migrate |
| URL public sau deploy | `deploy/exposure.ts` reconcile UFW và probe `app.url` | Có kiểm tra IP:port; chưa là domain HTTPS mặc định |
| Domain, HTTPS, ingress 80/443 | `domain/assistant.ts` lập hướng dẫn; `domain/dns.ts` hỗ trợ Cloudflare DNS; ADR-006 bỏ proxy ở v1 | Chưa có ingress/ACME do app quản lý; DNS không tự định tuyến port |
| Version, rollback, migrate | `app:versions`, `app:rollback`, `migrate/service.ts` | Có trong code; cần live gate cho đường chính |
| Deploy logs và runtime logs | `deploy:event` và `DeployTerminal` có log quá trình deploy; `docker logs --tail` chỉ lấy khi healthcheck lỗi | Chưa có màn runtime logs theo app |
| Runtime env và secrets | Wizard nhận `env`; SSH secret mã hóa cục bộ | Chưa có vòng đời đọc/sửa/rotate env sau deploy |
| Quan sát và tự xử lý | `monitor/`, `doctor/`, `ml-service/` | Điểm khác biệt tiềm năng; tính liên tục phụ thuộc tiến trình desktop đang chạy |
| Backup thường kỳ và restore thử | `migrate/service.ts` dùng `pg_dump` cho một job migrate | Chưa có lịch backup, offsite retention và restore drill độc lập |
| Trust SSH host | `ssh/manager.ts` kiểm tra fingerprint SHA256 khi bắt tay, migration 006 lưu fingerprint | Có trong code và đã thử SSH thật bằng key; test-connection/UI đã qua gate cục bộ |
| Database tab VPS | `VpsDatabaseTab` mặc định `supported=false`; không có handler `db:*` | GAP AC-3.2 đã bàn giao backend DB-1 |
| Tự động deploy và giám sát khi desktop đóng | `MonitorScheduler` khởi động trong Electron main và dừng khi app thoát | Chưa có control plane luôn chạy; đây là giới hạn kiến trúc, không phải lỗi UI |

## 4. Thứ tự phát triển đề xuất

### P0 — Giữ vững sản phẩm và đồ án hiện tại

1. Hoàn thành Git source thủ công và một deploy thật qua app trước 14/10 theo [kế hoạch demo](29-ke-hoach-demo-14-10.md).
2. Chạy pilot ML khi có VPS đáp ứng ngưỡng 40 GB, với bằng chứng deploy, publish, rollback, monitor và migrate. VPS phát triển hiện có 25 GB, không dùng số test mock để tuyên bố đã chạy thực tế.
3. Hoàn tất hồ sơ trạng thái sản phẩm: `LOCAL_PASS`, `VPS_PREFLIGHT_PASS`, `VPS_DEPLOY_NOT_RUN`, `VPS_PASS`, cùng đường xử lý lỗi.

### P1 — Hoàn thiện vòng đời app sau Git deploy

1. **Mở rộng Git source sau lát cắt demo:** repo riêng với deploy key/GitHub App, hỗ trợ nhiều provider và kiểm soát credential. Repo công khai, chọn branch/SHA và deploy thủ công thuộc P0 của sprint 14/10.
2. **Ingress HTTPS**: chọn một cách route nhiều app qua 80/443 (proxy hoặc named tunnel), quản lý
   certificate, DNS và rollback cấu hình; external probe xác nhận URL cuối cùng.
3. **Vòng đời app sau deploy**: runtime logs có giới hạn và redaction, đọc trạng thái container,
   chỉnh env có preview tác động và redeploy rõ ràng, hiển thị deployment gắn commit/domain.

**DoD P1:** từ một commit Git và VPS đã cấu hình, người dùng tạo một deployment, nhận URL HTTPS,
xem được runtime logs, rồi rollback về bản trước; toàn bộ được thử trên VPS thật, kể cả nhánh lỗi.

### P2 — Tự động hóa và an toàn dữ liệu

1. Quyết định control plane khi máy desktop đóng: giữ sản phẩm desktop vận hành thủ công, hoặc
   cho phép một thành phần luôn chạy để nhận webhook, chạy lịch và gửi cảnh báo. Không gọi luồng
   chỉ hoạt động khi mở app là “auto deploy liên tục”.
2. Sau quyết định trên: webhook có chữ ký, chống phát lại, hàng đợi/debounce deploy theo nhánh,
   giới hạn song song và ghi nguồn sự kiện. Preview cần môi trường, domain, env và dữ liệu tách
   production, có cleanup khi PR đóng.
3. Backup PostgreSQL có lịch, bản sao ngoài VPS, retention và bài kiểm tra restore độc lập.

### P3 — Mở rộng sau khi lát cắt P1/P2 ổn định

Mở thêm Git provider, Dockerfile/Compose/image, monorepo, nhiều framework, tài nguyên/quotas,
thông báo và tài khoản nhóm nếu thị trường mục tiêu thật sự cần. Không nên ưu tiên các mục này
trước Git + HTTPS + runtime operations.

## 5. Quyết định kiến trúc phải chốt trước khi Worker viết code

`CLAUDE.md` và ADR-006 hiện cố ý giới hạn app ở Electron + ML service, không agent, không
authentication, không mở proxy 80/443 và không có auto-update. Các giới hạn này phục vụ đồ án.
Để đạt mức P1/P2 ở trên, cần ghi quyết định mới về: (a) sản phẩm chỉ vận hành khi desktop mở
hay có control plane luôn chạy; (b) ingress/proxy và cổng 80/443; (c) nguồn Git, credential và
trust SSH; (d) phạm vi vẫn là đồ án trước 20/11/2026 hay nhánh sản phẩm sau đồ án.

Khuyến nghị: giữ nhánh đồ án ưu tiên pilot và dữ liệu ML; triển khai lát cắt P1 theo các checkpoint
độc lập sau khi các quyết định liên quan được duyệt. DB-1 chỉ giải quyết một tab còn thiếu, không
phải đường găng để đạt lời hứa “Vercel trên VPS”.
