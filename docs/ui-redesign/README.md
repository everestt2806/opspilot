# Báo cáo Audit & Đặc tả Redesign Giao diện OpsPilot (Giai đoạn UI-0)

> **Tài liệu bàn giao giai đoạn UI-0**: Đánh giá toàn diện hiện trạng giao diện (Audit), xây dựng prototype tương tác (Prototype Redesign), ánh xạ luồng dữ liệu IPC, phân tích dữ liệu còn thiếu (Data Gaps) và bộ tiêu chí nghiệm thu cho giai đoạn hiện thực hóa UI-1.

---

## 1. Tóm tắt điều hành & Triết lý thiết kế mới

### 1.1. Chuyển dịch tư duy: Ứng dụng là trung tâm, VPS là hạ tầng
* **Hiện trạng (VPS-centric)**: Ứng dụng hiện tại đặt Máy chủ VPS ở vị trí đầu tiên trong thanh điều hướng; luồng quản lý và triển khai bị phân mảnh theo từng máy chủ. Người dùng muốn xem trạng thái của ứng dụng phải định vị máy chủ trước, hoặc duyệt qua danh sách ứng dụng bị gò bó trong bố cục danh sách phụ (sub-sidebar).
* **Thiết kế mới (App-centric)**:
  * **Ứng dụng (Applications & Deployments)** trở thành **First-class Citizen** (đối tượng ưu tiên số 1). Mọi phiên bản, trạng thái container, cấu hình biến môi trường, domain/port exposure, và lịch sử rollback đều quy tụ trực tiếp quanh từng ứng dụng.
  * **Máy chủ VPS (Infrastructure Hosts)** lùi về vai trò hạ tầng nền tảng (backing platform). Người dùng chỉ cần quan tâm đến máy chủ khi cần bảo trì hệ thống, kiểm tra dung lượng đĩa/Docker, hoặc cấu hình bảo mật SSH.

### 1.2. Ba cải cách kiến trúc giao diện cốt lõi
1. **Một Sidebar chính duy nhất (Single Main Sidebar)**:
   * Triệt tiêu hoàn toàn các thanh điều hướng lồng nhau (`apps-sidebar` trong trang Ứng dụng, `VpsNavSidebar` và `VpsInfoSidebar` trong trang Chi tiết VPS).
   * Giữ lại duy nhất thanh điều hướng chính bên trái (rộng 230px), phân định ranh giới rõ ràng giữa nhóm dịch vụ ứng dụng và nhóm hạ tầng.
2. **Hệ thống Tab ngang ở trang chi tiết (Horizontal Tabs)**:
   * Thay thế bố cục chia 3 cột chật hẹp bằng thanh tab ngang hiện đại, tối ưu 100% không gian hiển thị theo chiều ngang cho bảng biểu và biểu đồ trên các độ phân giải laptop phổ biến (`1280×800` và `1366×768`).
3. **Thanh tiêu đề Desktop tối giản (Minimalist Desktop Titlebar)**:
   * Loại bỏ việc lặp lại tiêu đề trang ở cả titlebar và page header (ví dụ: `OpsPilot — Ứng dụng` ở trên rồi lại `Ứng dụng` ở dưới).
   * Titlebar mới chỉ đóng vai trò drag-region tinh tế, chứa logo nhỏ, huy hiệu môi trường workspace (`Production`), ngữ cảnh đường dẫn gọn nhẹ (`Ứng dụng / express-api`), và cụm nút điều khiển cửa sổ chuẩn Windows Fluent.
4. **Mô hình trạng thái tin cậy 3 cấp độ (3-Tier Trust & Verification Model)**:
   * Chấm dứt tình trạng gán nhãn "Online" giả tạo cho các máy chủ chưa được đối chiếu an toàn. Phân định rạch ròi 3 trạng thái:
     * **Đã xác minh (Verified / Active)**: SSH ping < 24h, fingerprint `ed25519` khớp kho tin cậy, Docker daemon phản hồi tốt.
     * **Chưa xác minh (Unverified / Stale)**: Quá 24h chưa kiểm tra lại (ví dụ `VM02-Staging` 13 ngày) hoặc host key chưa được quét lại. Bắt buộc hiển thị cảnh báo màu vàng và yêu cầu quét đối chiếu trước khi thực hiện deploy.
     * **Mất kết nối / Hết hạn (Unreachable / Auth Expired)**: Kết nối SSH thất bại hoặc khóa SSH key bị từ chối (ví dụ `VM03-Cloud`). Bật cơ chế khóa an toàn (fail-closed), ngăn chặn hoàn toàn thao tác deploy remote.

---

## 2. Báo cáo Audit hiện trạng (Current Build UI Audit)

### 2.1. Phân tích các điểm nghẽn của bản dựng hiện tại
Dựa trên 24 ảnh chụp thực tế bản dựng hiện tại tại [docs/ui-redesign/screenshots/current/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/):

| Màn hình | Hiện trạng & Bất cập quan sát được | Mức độ nghiêm trọng | Bằng chứng ảnh |
| :--- | :--- | :--- | :--- |
| **Titlebar** | Chứa dòng chữ `OpsPilot — <Tên trang>` ở giữa, lặp lại y nguyên `PageHeader` ngay phía dưới; tốn diện tích dọc và gây rối mắt. | Trung bình | Tất cả ảnh `current-*` |
| **Bảng điều hướng** | Đặt "VPS" lên vị trí đầu tiên (menu key 1), đẩy "Ứng dụng" xuống dưới. Nhầm lẫn giữa công cụ quản trị server và nền tảng quản trị ứng dụng. | Cao | `current-dashboard-*`, `current-vps-*` |
| **Trang Ứng dụng (`AppsPage`)** | Sử dụng layout 2 cột lồng nhau (`apps-workspace` chứa `apps-sidebar` rộng 240px + nội dung tab). Trên màn hình 1280x800, khu vực hiển thị bảng deployment và biến môi trường bị bóp nghẹt. | Cao | `current-apps-*`, `current-apps-detail-*` |
| **Trang Chi tiết VPS (`VpsDetail`)** | Bố cục **3 cột lồng nhau**: Sidebar chính (trái) + `VpsNavSidebar` (giữa-trái) + Khung nội dung (giữa) + `VpsInfoSidebar` (phải). Trên độ phân giải 1366x768 và 1280x800, bảng danh sách container và database bị thu hẹp chỉ còn hơn 400px, dẫn đến tràn chữ và vỡ layout. | Rất cao (Chặn UX) | `current-vps-detail-*` |
| **Danh sách VPS (`FleetSummary`)** | Máy chủ `VM02` (lần ping cuối 13 ngày trước) và `VM03` (mất kết nối SSH) vẫn hiển thị tag xanh "Online" nếu DB lưu trạng thái cũ; không có cờ cảnh báo "chưa xác minh" (unverified) hay kiểm tra thời hạn tin cậy. | Nghiêm trọng (An toàn hệ thống) | `current-vps-*` |
| **Triển khai (`DeployPage`)** | Quy trình deploy bị tách rời thành một màn độc lập, không gắn liền với ngữ cảnh của ứng dụng đang chọn, làm người dùng phải chọn lại máy chủ và ứng dụng thủ công. | Trung bình | `current-deploy-*` |

### 2.2. Danh mục bằng chứng ảnh chụp bản dựng hiện tại (24 ảnh)
Đã chụp pixel-perfect trực tiếp từ native Electron renderer tại [docs/ui-redesign/screenshots/current/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/):
* **Độ phân giải 1280×800 (Dark / Light)**:
  * Tổng quan: [current-dashboard-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-dashboard-1280x800-dark.png), [current-dashboard-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-dashboard-1280x800-light.png)
  * Danh sách ứng dụng: [current-apps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-1280x800-dark.png), [current-apps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-1280x800-light.png)
  * Chi tiết ứng dụng: [current-apps-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-detail-1280x800-dark.png), [current-apps-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-detail-1280x800-light.png)
  * Danh sách VPS: [current-vps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-1280x800-dark.png), [current-vps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-1280x800-light.png)
  * Chi tiết VPS (FlashPanel lồng 3 cột): [current-vps-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-detail-1280x800-dark.png), [current-vps-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-detail-1280x800-light.png)
  * Triển khai: [current-deploy-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-deploy-1280x800-dark.png), [current-deploy-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-deploy-1280x800-light.png)
* **Độ phân giải 1366×768 (Dark / Light)**:
  * Tương ứng đầy đủ 12 ảnh: `current-dashboard-1366x768-*`, `current-apps-1366x768-*`, `current-apps-detail-1366x768-*`, `current-vps-1366x768-*`, `current-vps-detail-1366x768-*`, `current-deploy-1366x768-*`.

---

## 3. Kiến trúc Prototype Redesign & Đánh giá cải tiến

Prototype độc lập tương tác hoàn chỉnh được đặt tại [docs/ui-redesign/prototype/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/):
* File mã nguồn: [index.html](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/index.html), [styles.css](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/styles.css), [app.js](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/app.js).
* Có thể chạy độc lập trên bất kỳ trình duyệt nào hoặc thông qua Electron.

### 3.1. So sánh chi tiết Trước và Sau Redesign

| Thành phần | Giao diện Hiện tại (Current Build) | Thiết kế mới (Redesign Prototype) | Lợi ích đạt được |
| :--- | :--- | :--- | :--- |
| **Sidebar Hierarchy** | Menu VPS đứng đầu; trang con tiếp tục đẻ ra các sidebar cấp 2, cấp 3 lồng nhau. | **Một Sidebar chính**; Ứng dụng (Apps) đứng số 1, Hạ tầng VPS chuyển thành nhóm phụ bên dưới. | Loại bỏ sự phân mảnh, giảm số lần click chuột để tiếp cận ứng dụng từ 3 click xuống 1 click. |
| **Bố cục Chi tiết VPS** | Chia làm 3 cột: Sub-nav (trái) + Nội dung tab (giữa) + Info sidebar (phải). Rất chật chội trên laptop. | **Tab ngang (Horizontal Tabs)**: Tổng quan, Ứng dụng trên máy chủ, Docker & Lưu trữ, Bảo mật Host Key, Nhật ký. | Giải phóng 100% chiều rộng màn hình (tăng 220% diện tích cho bảng dữ liệu và metrics). |
| **Bố cục Chi tiết App** | Cột danh sách app bên trái chiếm 240px cố định, chỉ còn một phần nhỏ cho tab chi tiết. | Danh sách App toàn màn hình dạng Table/Card trực quan; click vào app mở trang Chi tiết App độc lập với hệ tab ngang. | Hiển thị rõ ràng: CPU/RAM metrics, port mapping, commit history, rollback 1-click, doctor probe, live logs. |
| **Xác thực An toàn VPS** | Chỉ có 2 trạng thái `online`/`offline`. Server cũ 13 ngày không check vẫn hiện xanh, không kiểm tra fingerprint. | **3 trạng thái minh bạch**: Đã xác minh (Xanh) - Chưa xác minh/Cũ (Vàng, kèm nút Quét lại) - Mất kết nối (Đỏ, khóa deploy). | Đảm bảo nguyên tắc an toàn Zero-Trust: ngăn chặn deploy vào máy chủ có host key bị trôi hoặc credential hết hạn. |
| **Desktop Titlebar** | Rườm rà, lặp lại tiêu đề trang, chiếm không gian không cần thiết. | Tối giản, tích hợp breadcrumb ngữ cảnh (`Ứng dụng / express-api`), controls gọn nhẹ chuẩn Windows 11. | Thẩm mỹ cao, tinh tế, tiết kiệm không gian làm việc. |

### 3.2. Danh mục ảnh chụp Prototype Redesign (16 ảnh)
Ảnh chụp chất lượng cao lưu tại [docs/ui-redesign/screenshots/redesign/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/):
* **1280×800 (Dark / Light)**:
  * Danh sách Ứng dụng: [redesign-apps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-apps-1280x800-dark.png), [redesign-apps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-apps-1280x800-light.png)
  * Chi tiết Ứng dụng (Tab ngang): [redesign-app-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-app-detail-1280x800-dark.png), [redesign-app-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-app-detail-1280x800-light.png)
  * Danh sách Máy chủ (Thể hiện fixture Chưa xác minh & Mất kết nối): [redesign-vps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-1280x800-dark.png), [redesign-vps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-1280x800-light.png)
  * Chi tiết Máy chủ (Bỏ hẳn nested sidebar): [redesign-vps-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-detail-1280x800-dark.png), [redesign-vps-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-detail-1280x800-light.png)
* **1366×768 (Dark / Light)**:
  * Đầy đủ 8 ảnh tương ứng: `redesign-apps-1366x768-*`, `redesign-app-detail-1366x768-*`, `redesign-vps-1366x768-*`, `redesign-vps-detail-1366x768-*`.

---

## 4. Bản đồ Màn hình → IPC hiện có → Dữ liệu còn thiếu (Data Gaps)

Bảng đối chiếu toàn diện giữa các thành phần giao diện mới với hợp đồng IPC hiện có trong [`app/src/shared/ipc.ts`](file:///D:/Developing/DuAnCNTT/app/src/shared/ipc.ts):

| Màn hình / Tab Redesign | Kênh IPC hiện có trong `ipc.ts` | Dữ liệu IPC đã cung cấp | Dữ liệu còn thiếu (Backend / IPC Data Gaps) | Đề xuất giải pháp bổ sung cho UI-1 |
| :--- | :--- | :--- | :--- | :--- |
| **Shell & Titlebar** | `window:set-titlebar-overlay` | Điều khiển nút minimize/close native | Chưa có thông tin Workspace/Environment hiện tại (ví dụ: Production/Staging/Demo). | Bổ sung channel `app:get-workspace-info` hoặc quản lý local qua Zustand `uiState`. |
| **Danh sách Ứng dụng (`Apps`)** | `app:list`, `vps:list` | `App[]` (gồm `id, vps_id, name, framework, host_port, current_deployment_id, url`) | 1. `App` thiếu thông tin hostname và IP của VPS (UI hiện phải gọi `vps:list` và join thủ công).<br>2. Thiếu trạng thái sống trực tiếp của container (`healthy` / `unhealthy` / `stopped`).<br>3. Thiếu `exposure_status` ở cấp App (đang nằm trong bảng Deployment). | Thêm View Model tổng hợp `AppSummaryView` trả về kèm `vps_name`, `vps_host`, `container_state`, `exposure_status` trong một lần gọi IPC `app:list-summary`. |
| **Chi tiết App: Tổng quan** | `app:get`, `app:runtime-inspect`, `monitor:samples` | `RuntimeState` (`image`, `state`), `MetricSample[]` | 1. Thiếu thông tin uptime container chi tiết (chỉ có state `running`).<br>2. Metric real-time chỉ có khi poller agent chạy ngầm; chưa có endpoint đọc trực tiếp CPU/RAM tức thời qua Docker CLI nếu poller chưa bật. | Bổ sung `app:get-runtime-metrics` đọc nhanh từ `docker stats --no-stream` qua SSH. |
| **Chi tiết App: Lịch sử & Rollback** | `app:versions`, `app:rollback` | `Deployment[]` (version, status, duration, exposure, rollback_of) | Đầy đủ dữ liệu cốt lõi. Tuy nhiên thiếu commit message và thông tin người trigger deploy (hiện chỉ có image tag và timestamp). | Mở rộng schema `deployments` thêm cột `commit_message`, `triggered_by`. |
| **Chi tiết App: Biến môi trường** | `deploy:detect` | Trả về cấu hình mẫu từ repo | Chưa có IPC đọc / sửa trực tiếp file `.env` đã được render trên VPS cho deployment đang kích hoạt. | Thêm IPC `app:get-env` và `app:update-env` (mã hóa các secret nhạy cảm). |
| **Chi tiết App: Bác sĩ & Exposure** | `doctor:diagnose`, `doctor:fix`, `domain:check` | `confidence`, `evidence`, `safe_to_auto_fix` | Đã có hợp đồng Doctor tốt. Cần bổ sung thêm thông tin trạng thái Firewall (UFW) và socket binding của port. | Mở rộng `DoctorEvidenceInput` để nhận thêm thông tin UFW rules. |
| **Chi tiết App: Logs trực tiếp** | *Chưa có IPC phù hợp* | Chỉ có file log lưu cục bộ trên runner hoặc VPS | **Thiếu hoàn toàn kênh IPC stream logs** từ container trên VPS về Renderer (`docker logs -f --tail 200`). | Bổ sung IPC Event streaming: `app:logs-subscribe` và `app:logs-unsubscribe` qua EventEmitter của Electron. |
| **Danh sách Máy chủ (`VPS Fleet`)** | `vps:list` | `Vps[]` (`last_status`, `last_seen_at`, `docker_version`) | 1. **Thiếu trường `verification_status`**: Server cũ quá 24h chưa được phân loại là `stale`.<br>2. **Thiếu fingerprint tin cậy**: Chưa lưu `trusted_fingerprint` trong bảng VPS.<br>3. **Thiếu số lượng ứng dụng**: Phải tính toán lặp qua `app:list`. | Mở rộng `Vps` model: thêm `verification_status: 'verified' \| 'stale' \| 'unreachable'`, `trusted_fingerprint: string`, `apps_count: number`. |
| **Chi tiết VPS: Tổng quan & Specs** | `vps:get-resources`, `vps:scan` | `VpsResources` (RAM total/free, Disk total/free, CPU count, load avg) | Thiếu thông tin đồng bộ thời gian NTP/Chrony và Uptime máy chủ (quan trọng cho tính nhất quán của metrics và thí nghiệm ML). | Bổ sung `time_sync_status: 'synced' \| 'drifted'` và `uptime_seconds` vào `VpsResources`. |
| **Chi tiết VPS: Ứng dụng trên máy** | `app:list(vpsId)` | Danh sách app thuộc VPS | Thiếu thông tin phân bổ tài nguyên CPU/RAM chi tiết theo từng container trên VPS. | Bổ sung `vps:get-container-stats(vpsId)` trả về map `container_name -> { cpu_pct, mem_mb }`. |
| **Chi tiết VPS: Docker & Storage** | *Chưa có IPC chuyên biệt* | `docker_version` trong `vps:list` | Thiếu thông tin Docker disk usage (`docker system df`: images, volumes, reclaimable space) và lệnh Prune. | Thêm IPC `vps:docker-df(vpsId)` và `vps:docker-prune(vpsId)`. |
| **Chi tiết VPS: Bảo mật & Host Key** | `vps:test-connection` | Kiểm tra ping SSH | Thiếu lưu trữ và đối chiếu public host key fingerprint (`ssh-ed25519`). | Thêm IPC `vps:verify-host-key(vpsId, expectedFingerprint)`. |
| **Chi tiết VPS: Nhật ký kết nối** | *Chưa có IPC* | Không có | Thiếu nhật ký lịch sử các phiên kết nối SSH và lần chạy preflight trên máy chủ này. | Bổ sung bảng `vps_audit_logs` và IPC `vps:audit-logs(vpsId)`. |

---

## 5. Tiêu chí Nghiệm thu UI-1 (UI-1 Acceptance Criteria)

Khi tiến hành hiện thực hóa mã nguồn trong giai đoạn UI-1, các tiêu chí sau đây phải được thỏa mãn và kiểm chứng bằng test tự động / screenshot:

### AC-1: Kiến trúc Shell & Điều hướng đơn nhất
* [ ] **AC-1.1**: Toàn bộ ứng dụng chỉ có **duy nhất một thanh Sidebar bên trái**. Không được tồn tại bất kỳ sub-sidebar nào bên trong trang Ứng dụng hay VPS.
* [ ] **AC-1.2**: Nhóm điều hướng chính đặt **Ứng dụng (Apps)** ở vị trí số 1; Máy chủ (VPS) được đặt trong nhóm phân cách **Hạ tầng máy chủ (Infrastructure)**.
* [ ] **AC-1.3**: Thanh Desktop Titlebar chỉ hiển thị brand logo, environment badge, context breadcrumb ngắn gọn và cụm nút điều khiển cửa sổ; không lặp lại nội dung của PageHeader.
* [ ] **AC-1.4**: Bố cục tương thích hoàn hảo, không bị tràn ngang hoặc xuất hiện thanh cuộn ngang không mong muốn ở hai độ phân giải mục tiêu: `1280×800` và `1366×768`.

### AC-2: Quản lý Ứng dụng là trung tâm
* [ ] **AC-2.1**: Trang danh sách Ứng dụng hiển thị dạng bảng/thẻ toàn màn hình, cung cấp đầy đủ: Tên ứng dụng, Framework, Trạng thái chạy (Healthy/Degraded/Stopped), Phiên bản hiện tại, Máy chủ VPS chứa app, Cổng/URL phơi bày, và trạng thái xác minh của VPS đó.
* [ ] **AC-2.2**: Có bộ lọc ứng dụng theo Máy chủ VPS và ô tìm kiếm theo tên/cổng phản hồi tức thì (<100ms).
* [ ] **AC-2.3**: Click vào một ứng dụng lập tức chuyển sang trang Chi tiết Ứng dụng độc lập với hệ thống Tab ngang.

### AC-3: Trang Chi tiết Ứng dụng với Tab ngang
* [ ] **AC-3.1**: Trang Chi tiết Ứng dụng sử dụng hệ thống Tab ngang gồm tối thiểu 5 tab: *Tổng quan & Sức khỏe*, *Lịch sử & Rollback*, *Cấu hình & Biến môi trường*, *Bác sĩ & Exposure*, *Logs trực tiếp*.
* [ ] **AC-3.2**: Tab *Lịch sử & Rollback* hiển thị bảng phiên bản trực quan. Cung cấp nút Rollback 1-click cho các phiên bản cũ với hộp thoại xác nhận an toàn (bắt buộc nhập tên app nếu phiên bản đích đang chạy).
* [ ] **AC-3.3**: Tab *Cấu hình & Biến môi trường* hiển thị danh sách biến `.env` với các trường nhạy cảm (như mật khẩu DB) được che mặt định và có nút bật/tắt hiển thị.
* [ ] **AC-3.4**: Tab *Bác sĩ & Exposure* hiển thị rõ ràng kết quả kiểm tra cổng socket, luật firewall và HTTP healthcheck probe.

### AC-4: Quản lý Hạ tầng & Trạng thái Chưa xác minh (Unverified/Stale)
* [ ] **AC-4.1**: Máy chủ VPS có thời gian kiểm tra cuối (`last_seen_at`) lớn hơn 24 giờ bắt buộc phải hiển thị nhãn màu vàng **"Chưa xác minh (Stale)"**, kèm thông báo thời gian trôi qua và nút **"Quét & Xác minh ngay"**.
* [ ] **AC-4.2**: Máy chủ có lỗi xác thực SSH (sai khóa, timeout) phải hiển thị nhãn màu đỏ **"Mất kết nối / Hết hạn"** và kích hoạt cơ chế khóa an toàn: vô hiệu hóa nút deploy vào máy này cho đến khi kết nối được phục hồi.
* [ ] **AC-4.3**: Quá trình deploy vào một VPS đang ở trạng thái *Chưa xác minh* bắt buộc phải chạy preflight keyscan và kiểm tra tài nguyên trước khi cho phép truyền lệnh build/deploy.

### AC-5: Trang Chi tiết VPS với Tab ngang (Bỏ hoàn toàn Nested Sidebar)
* [ ] **AC-5.1**: Loại bỏ hoàn toàn `VpsNavSidebar` và `VpsInfoSidebar`. Thay thế bằng hệ thống Tab ngang toàn màn hình: *Tổng quan & Tài nguyên*, *Ứng dụng trên máy chủ*, *Docker & Lưu trữ*, *Bảo mật & Host Key*, *Nhật ký kết nối*.
* [ ] **AC-5.2**: Tab *Ứng dụng trên máy chủ* hiển thị bảng tất cả ứng dụng đang chạy trên VPS này, kèm container ID, port binding và liên kết điều hướng trực tiếp sang Chi tiết Ứng dụng.
* [ ] **AC-5.3**: Tab *Bảo mật & Host Key* hiển thị fingerprint khóa host `ed25519`, trạng thái đối chiếu với known_hosts, và trạng thái firewall UFW.

### AC-6: Thiết kế & Trải nghiệm Người dùng
* [ ] **AC-6.1**: Hỗ trợ chuyển đổi mượt mà giữa Giao diện Tối (Dark) và Giao diện Sáng (Light) với bảng màu chuẩn WCAG AA về độ tương phản.
* [ ] **AC-6.2**: Các thẻ code, cổng, IP, fingerprint đều sử dụng font monospace rõ ràng (`Cascadia Code` / `Fira Code` / `Consolas`).
* [ ] **AC-6.3**: Giữ vững các cam kết an toàn: không ghi credential nhạy cảm vào log UI hay màn hình trình chiếu.
