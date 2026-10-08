# Đánh giá năng lực OpsPilot: “Vercel trên VPS riêng”

> Đánh giá gốc: 08/10/2026 tại HEAD `9dcd054`; cập nhật trạng thái 08/10 tại HEAD `fcc3051`.
> Bản kiểm kê Git-first và thứ tự demo mới: [30-audit-git-first-deploy.md](30-audit-git-first-deploy.md).
> VPS phát triển đã qua preflight SSH/Docker/port; deploy qua OpsPilot và pilot ML vẫn `NOT_RUN`.
> Rà soát sản phẩm lần hai tại HEAD `d22873a` ngày 08/10/2026: mục 6–9 bên dưới. Các số test ở mục 1 là kết quả lịch sử của lần review trước, không phải gate chạy lại tại HEAD này.

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

## 6. Định nghĩa sản phẩm cần đạt và khoảng cách còn lại

Mục tiêu thực tế của OpsPilot là **đưa một repo lên VPS của người dùng và vận hành app đó qua một giao diện**. Vercel là chuẩn tham chiếu cho trải nghiệm Git → deployment bất biến → URL → quan sát → rollback; Dokploy và Coolify là chuẩn tham chiếu sát hơn về container, VPS, ingress và vận hành. Không cần sao chép toàn bộ dịch vụ của họ, nhưng cần một đường đi trọn vẹn và có thể kiểm chứng trên VPS thật.

| Khâu trong vòng đời | Hiện trạng OpsPilot tại HEAD | Mức thiếu | Tiêu chí đạt tối thiểu |
|---|---|---|---|
| Kết nối VPS an toàn | Có SSH host fingerprint pin, lưu credential cục bộ, preflight VPS phát triển đã qua | Cần live deploy qua app | Kết nối bằng host key đã xác minh, test lỗi khóa sai/thiếu, không lộ credential |
| Tạo project từ Git | `DeployPage.tsx` chỉ chọn folder; `deploy:detect` nhận path; pipeline dùng `existsSync(source_path)` | **P0, chặn lời hứa sản phẩm và UC-02 gốc** | URL repo, ref, root directory; snapshot khóa bằng full SHA từ Git từ xa; người dùng xem được trước Deploy |
| Build và phát hành | Detector Next.js/Express/Vite, build Docker trên VPS, loopback health, external probe, rollback; chưa thấy bước chạy test source theo FR-B5 | **P0 cho lát cắt Git, P1 cho tính tổng quát** | Build đúng SHA; log build và lỗi rõ; policy chạy test tùy chọn được khai báo, có timeout; bản mới chỉ active sau health |
| Danh tính bản triển khai | Lưu phiên bản/image và history, nhưng deployment chưa lưu repo/ref/SHA | **P0** | Mỗi deployment có source provenance bất biến; redeploy/migrate/rollback không dựa vào clone tạm hoặc working tree local |
| URL và domain | IP:port có exposure probe; Domain Assistant/DNS Cloudflare hỗ trợ kế hoạch và record | **P1** | Một domain thực route đến đúng app qua 80/443, certificate hợp lệ, external HTTPS probe; DNS record một mình không đủ |
| Vận hành app | Có runtime inspect, history và rollback; IPC `app:start`/`app:stop` chỉ khai báo, chưa có handler; runtime logs chưa có màn/handler | **P1** | Xem log runtime giới hạn/redact; start/stop/restart có trạng thái và quyền; lỗi trả về rõ |
| Env và dữ liệu | Env nhập lúc deploy, `.env` trên VPS; chưa có vòng đời sửa/rotate; tab Database mặc định unsupported, `db:*` chưa có handler | **P1/P2** | Chỉnh env có kiểm soát và redeploy; DB tab chỉ bật khi backend thật; backup/restore có bằng chứng |
| Push, preview, giám sát liên tục | MonitorScheduler sống cùng Electron; chưa có webhook receiver luôn chạy, queue hoặc preview PR | **P2, quyết định kiến trúc** | Nhận push có xác thực khi desktop tắt, chống lặp, queue, preview cô lập và cleanup; hoặc ghi rõ sản phẩm chỉ deploy thủ công |
| An toàn khi build mã ngoài | Public Git sẽ chạy code trong Docker build trên VPS của người dùng | **P0 về guardrails** | Giới hạn thời gian/dung lượng/tài nguyên, URL/ref/path hợp lệ, không cấp secret không cần thiết, lỗi và log được khử nhạy cảm |

`docs/00-de-tai-goc.md` UC-02 đã nêu **“thư mục source/Git URL”**; Git URL là yêu cầu gốc chưa hoàn thành, không phải ý tưởng mới. FR-B5 còn nêu “chạy test (nếu có)”; pipeline hiện chưa có bước cấu hình/chạy test của source app. Hai điểm này phải được đánh dấu riêng trong hồ sơ nghiệm thu thay vì cộng vào số test nội bộ của OpsPilot.

## 7. Quyết định kiến trúc trước khi mở rộng Git

1. **Project/source và nơi chạy là hai khái niệm khác nhau.** Hiện bảng `app` gắn một `vps_id`, `source_path` và deployment hiện tại. Với demo một repo → một VPS, có thể mở rộng bảng này để tiết kiệm thời gian, nhưng phải lưu rõ `source_kind`, URL/ref/root và provenance từng deployment. Không dùng đường clone tạm làm định danh lâu dài. Khi thêm staging, preview hoặc cùng repo trên nhiều VPS, tách `project/source` khỏi `environment/target` thay vì cố kéo dài `app` hiện tại.
2. **Snapshot Git là đầu vào bất biến.** UI detect/precheck/start phải dùng cùng SHA đã khóa. Phân biệt “deploy latest của branch” (resolve SHA mới rồi tạo deployment mới) với “redeploy cùng SHA”. `MigrateService` phải xử lý Git app khi cache checkout cũ không còn.
3. **HTTPS cần chọn một ingress thực.** `domain:plan` có thể gợi ý shared ingress/named tunnel; `domain:upsert` chưa tự dựng proxy hoặc tunnel. Trước khi hứa URL đẹp, chọn một phương án có lifecycle, chứng chỉ, port 80/443, rollback cấu hình và external probe. Điều này thay đổi giới hạn ADR-006 hiện có, nên cần quyết định kiến trúc tường minh.
4. **Push-to-deploy cần một bộ phận luôn chạy.** Electron chỉ nhận sự kiện khi đang mở. Có thể đặt control plane riêng hoặc chọn kiến trúc agent/service có giới hạn rõ; cả hai cần xem lại NFR-1 của đề tài. Không dùng một script CI deploy thẳng lên VPS rồi gọi đó là luồng OpsPilot nếu nó bỏ qua SQLite/history/Doctor.
5. **Giữ an toàn trên VPS.** Public Git không đồng nghĩa code đáng tin. Luồng fetch/build cần timeout, quota, cleanup và kiểm soát Docker build; private Git sau đó cần cơ chế quyền đọc tối thiểu, secret không nằm trong URL/DB/log.

## 8. Thứ tự làm lại theo giá trị sản phẩm

| Thời điểm | Lát cắt | Vì sao ưu tiên | Bằng chứng chấp nhận |
|---|---|---|---|
| Trước 14/10 | Git công khai → chọn branch/root → khóa SHA → deploy thủ công Express lên VPS phát triển → IP:port `/health` → history hiển thị SHA | Hoàn thành UC-02 còn thiếu và cho thấy đường Git-to-VPS thật | Ảnh/video Electron + HTTP ngoài VPS + repo/ref/full SHA/ID deployment khớp; lỗi được báo trung thực |
| Sau khi Git live ổn | Redeploy từ branch, rollback bản cũ, runtime logs, test source tùy chọn, env update có kiểm soát | Làm app dùng được sau lần deploy đầu tiên | Hai SHA trong history, rollback đúng image, log sau deploy, ca lỗi test/build/health |
| Lát cắt public URL | Ingress HTTPS cho một domain, certificate, DNS, external HTTPS probe | Đưa URL đáng dùng và không nhầm DNS với routing | URL HTTPS thật, certificate hợp lệ, app đích đúng, rollback ingress an toàn |
| Sau quyết định kiến trúc | Private Git, webhook push, preview PR, queue, giám sát khi desktop đóng | Đạt trải nghiệm tự động như chuẩn tham chiếu | Push khi desktop tắt vẫn tạo deployment đúng SHA; preview cô lập và dọn được |
| Sau nền vận hành | DB operations, backup offsite và restore drill, thêm build modes/framework, team access | Mở rộng phạm vi sau khi luồng lõi đã tin cậy | Restore thật và test phân quyền/tài nguyên; không chỉ có tab hoặc contract |

**Phạm vi nói với giảng viên ngày 14/10:** “OpsPilot bản thử nghiệm triển khai Git lên VPS riêng qua ứng dụng desktop, phát hiện framework, build, kiểm tra sức khỏe, ghi nhận phiên bản và hỗ trợ rollback/Doctor.” Chỉ nói các bước nào đã qua live gate. Không giới thiệu push-to-deploy, HTTPS tự động, private Git, Database tab hay pilot ML là đã hoàn thành khi chưa có bằng chứng tương ứng.

## 9. Checkpoint trước khi giao Worker

Giữ prompt G0 cũ ở trạng thái **chờ sửa**. Nó đã đi đúng hướng public Git nhưng ấn định migration 007 và trường dữ liệu trước khi chốt mô hình project/source, tương thích `MigrateService` và nguồn dữ liệu cho redeploy. Checkpoint kế tiếp cần khóa hợp đồng dữ liệu/IPC và các bất biến trên bằng một review ngắn; sau đó mới giao acquisition + pipeline/UI theo [kiểm kê Git-first](30-audit-git-first-deploy.md) và [lịch demo](29-ke-hoach-demo-14-10.md). Chưa có bằng chứng live deploy qua OpsPilot; preflight VPS chỉ chứng minh hạ tầng sẵn sàng để thử.
