# Báo cáo Audit & Đặc tả Redesign Giao diện OpsPilot (Giai đoạn UI-0)

> **Tài liệu bàn giao giai đoạn UI-0 (Cập nhật sau Review)**: Đánh giá hiện trạng giao diện dựa trên 24 ảnh chụp thực tế (`current-*`), hoàn thiện prototype độc lập tương tác (`docs/ui-redesign/prototype/`), chụp 16 ảnh thiết kế mới (`redesign-*`), lập bản đồ ranh giới IPC hiện có vs Backlog Backend riêng, và viết lại bộ tiêu chí nghiệm thu tinh chuẩn cho giai đoạn hiện thực hóa UI-1.

---

## 1. Tóm tắt điều hành & Định hướng Redesign

### 1.1. Chuyển dịch tư duy: Ứng dụng là trung tâm, VPS là hạ tầng nền tảng
* **Hiện trạng bản dựng cũ (VPS-centric)**: Ứng dụng đặt Máy chủ VPS ở vị trí ưu tiên số 1 trên thanh điều hướng; quy trình quản lý và triển khai bị chia cắt theo từng máy chủ. Bố cục trang ứng dụng bị gò bó trong danh sách phụ bên trái, gây khó khăn cho việc theo dõi trạng thái triển khai tổng thể.
* **Định hướng thiết kế mới (App-centric)**:
  * **Ứng dụng (Applications & Deployments)** trở thành **First-class Citizen** (đối tượng ưu tiên số 1). Mọi trạng thái container, cấu hình cổng, lịch sử phiên bản và thao tác rollback đều xoay quanh từng ứng dụng.
  * **Máy chủ VPS (Infrastructure Fleet)** lùi về vai trò hạ tầng nền tảng (backing platform). Người dùng chỉ tương tác với máy chủ khi cần bảo trì, kiểm tra cấu hình SSH hoặc dung lượng lưu trữ.

### 1.2. Bốn cải cách kiến trúc giao diện cốt lõi
1. **Duy nhất một thanh Sidebar chính (Single Main Sidebar)**:
   * Chốt cố định **5 mục điều hướng**: `Tổng quan`, `Ứng dụng`, `Máy chủ`, `Hoạt động`, `Cài đặt`.
   * Nút `+ Triển khai` là nút hành động toàn cục (Action Button), mở wizard/hộp thoại triển khai; loại bỏ các mục điều hướng chỉ hiện alert hoặc trang trống.
   * Loại bỏ triệt để mọi sub-sidebar lồng nhau (`apps-sidebar` trong trang Ứng dụng, `VpsNavSidebar` và `VpsInfoSidebar` trong trang Chi tiết VPS).
2. **Hệ thống Tab ngang tại các trang chi tiết (Horizontal Tabs Layout)**:
   * Thay thế bố cục chia 3 cột chật hẹp bằng hệ thống tab ngang toàn màn hình, tận dụng tối đa chiều rộng cho bảng biểu và thông tin kỹ thuật trên các độ phân giải laptop phổ biến (`1280×800` và `1366×768`).
3. **Thanh Desktop Titlebar tối giản & Native Window Controls**:
   * Prototype chỉ minh họa layout titlebar và vùng kéo thả (drag region).
   * **Giao diện sản phẩm thật**: Giữ nguyên tính năng `titlebarOverlay` native của Electron trong cấu hình `BrowserWindow`, tuyệt đối không sao chép hay tự vẽ lại nút điều khiển cửa sổ (Minimize / Maximize / Close) bằng HTML/CSS giả.
4. **Mô hình trạng thái trung thực (Honest Trust Model)**:
   * Phân định rạch ròi trạng thái dựa trên dữ liệu thực tế:
     * **Đã kết nối (Reachable)**: Ping SSH thành công, Docker daemon phản hồi tốt.
     * **Chưa xác minh / Cũ (Stale)**: Quá 24 giờ chưa kiểm tra lại (như `VM02-Staging` 13 ngày chưa quét) hoặc chưa đối chiếu fingerprint tin cậy. Hiển thị nhãn cảnh báo màu vàng.
     * **Mất kết nối (Unreachable / Timeout)**: Không kết nối được TCP/22 hoặc SSH handshake timeout (như `VM03-Cloud-Expired`).
   * **Không đánh đồng `ssh-keyscan` là xác minh host**: Lệnh `ssh-keyscan` chỉ lấy public key từ remote (Trust On First Use - TOFU), không có giá trị xác minh nếu không đối chiếu với nguồn tin cậy.

---

## 2. Báo cáo Audit hiện trạng (Current Build UI Audit)

### 2.1. Phân tích hiện trạng dựa trên 24 ảnh chụp thực tế
Toàn bộ 24 ảnh chụp bản dựng hiện tại trong [docs/ui-redesign/screenshots/current/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/) đã được ghi lại bằng Electron tự động với cơ chế kiểm tra xác nhận heading và tab đặc trưng trước khi chụp:

| Màn hình | Hiện trạng & Bất cập quan sát được từ ảnh thật | Mức độ ảnh hưởng | Bằng chứng ảnh chụp |
| :--- | :--- | :--- | :--- |
| **Desktop Titlebar** | Chứa dòng chữ `OpsPilot — <Tên trang>` ở giữa, lặp lại tiêu đề ngay phía dưới của `PageHeader`; chiếm diện tích dọc không cần thiết. | Trung bình | Tất cả 24 ảnh `current-*` |
| **Thanh điều hướng** | Đặt menu "VPS" ở vị trí đầu tiên (menu key 1), đẩy "Ứng dụng" xuống dưới. Nhầm lẫn trọng tâm giữa công cụ quản trị server và nền tảng quản trị ứng dụng. | Cao | `current-dashboard-*`, `current-vps-*` |
| **Danh sách Ứng dụng (`AppsPage`)** | Bố cục 2 cột lồng nhau (`apps-sidebar` rộng 240px cố định bên trái + khung nội dung tab). Trên màn hình `1280×800`, bảng deployment và danh sách biến môi trường bị bóp nghẹt, gây tràn chữ. | Cao | `current-apps-*`, `current-apps-detail-*` |
| **Chi tiết VPS (`VpsDetail`)** | Bố cục **3 cột lồng nhau**: Sidebar chính (trái) + `VpsNavSidebar` (giữa-trái) + Khung nội dung (giữa) + `VpsInfoSidebar` (phải). Trên độ phân giải `1366×768` và `1280×800`, bảng container và thông tin máy chủ bị ép co cụm chỉ còn ~420px, làm vỡ bố cục và che khuất thông tin quan trọng. | Rất cao (Chặn UX) | `current-vps-detail-*` |
| **Danh sách VPS (`FleetSummary`)** | Máy chủ `VM02` (lần ping cuối 13 ngày trước) và `VM03` (mất kết nối SSH) trong DB cũ vẫn có thể hiển thị tag xanh "Online"; thiếu nhãn cảnh báo thời hạn kiểm tra và trạng thái xác minh tin cậy. | Nghiêm trọng | `current-vps-*` |
| **Triển khai (`DeployPage`)** | Màn triển khai nằm tách rời khỏi ngữ cảnh ứng dụng, buộc người dùng phải chọn lại máy chủ và ứng dụng thủ công. | Trung bình | `current-deploy-*` |

### 2.2. Danh mục bằng chứng ảnh chụp bản dựng hiện tại (24 ảnh)
Được lưu trữ tại [docs/ui-redesign/screenshots/current/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/):
* **Độ phân giải 1280×800 (Dark / Light)**:
  * Tổng quan (Dashboard): [current-dashboard-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-dashboard-1280x800-dark.png), [current-dashboard-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-dashboard-1280x800-light.png)
  * Danh sách Ứng dụng (AppsPage - Tab Tổng quan): [current-apps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-1280x800-dark.png), [current-apps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-1280x800-light.png)
  * Chi tiết Ứng dụng (Tab Phiên bản & Rollback): [current-apps-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-detail-1280x800-dark.png), [current-apps-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-apps-detail-1280x800-light.png)
  * Danh sách Máy chủ VPS: [current-vps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-1280x800-dark.png), [current-vps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-1280x800-light.png)
  * Chi tiết Máy chủ VPS (3 cột lồng nhau): [current-vps-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-detail-1280x800-dark.png), [current-vps-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-vps-detail-1280x800-light.png)
  * Triển khai: [current-deploy-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-deploy-1280x800-dark.png), [current-deploy-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/current-deploy-1280x800-light.png)
* **Độ phân giải 1366×768 (Dark / Light)**:
  * Tương ứng đầy đủ 12 ảnh: `current-dashboard-1366x768-*`, `current-apps-1366x768-*`, `current-apps-detail-1366x768-*`, `current-vps-1366x768-*`, `current-vps-detail-1366x768-*`, `current-deploy-1366x768-*`.

---

## 3. Kiến trúc Prototype Redesign & Đánh giá cải tiến

Prototype tương tác độc lập được lưu trữ tại [docs/ui-redesign/prototype/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/):
* Các file mã nguồn: [`index.html`](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/index.html), [`styles.css`](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/styles.css), [`app.js`](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/prototype/app.js).

### 3.1. Các điểm cải tiến nổi bật trong Prototype
1. **Sidebar cố định 5 mục**: `Tổng quan`, `Ứng dụng`, `Máy chủ`, `Hoạt động`, `Cài đặt`. Bổ sung nút hành động `+ Triển khai` nổi bật ở đầu sidebar để mở modal wizard.
2. **Tìm kiếm và Lọc VPS hoạt động kết hợp đồng thời**:
   * Người dùng có thể vừa nhập từ khóa tìm kiếm (tên app, cổng, framework) vừa chọn lọc theo từng VPS cụ thể từ dropdown.
   * Logic kết hợp đồng thời (AND filter), cập nhật số lượng kết quả ngay tức thì.
3. **Nội dung trang chi tiết hiển thị đúng đối tượng được chọn**:
   * Khi mở `express-api`, `next-blog` hoặc `vite-dashboard`, toàn bộ thông số cổng, phiên bản, biến môi trường và log hiển thị tương ứng với ứng dụng đó.
   * Khi mở `VM01-Prod`, `VM02-Staging` hoặc `VM03-Cloud-Expired`, toàn bộ thông số phần cứng, trạng thái xác thực và danh sách app chạy trên máy đó được render chính xác (không còn tình trạng hardcode dữ liệu của một máy duy nhất).
4. **Ghi rõ dữ liệu mẫu và ý tưởng tương lai (Mock Notice & Tags)**:
   * Tất cả các khối tính năng chưa có IPC backend (live logs, chỉnh sửa env runtime, CPU/RAM container tức thời, Docker storage prune, đối chiếu fingerprint ed25519) đều được gắn nhãn `[Dữ liệu mẫu / Ý tưởng tương lai — Thuộc Backend Backlog]`.
   * Titlebar hiển thị rõ nhãn minh họa layout, xác nhận UI sản phẩm thật sẽ dùng native `titlebarOverlay` của Electron.

### 3.2. Danh mục ảnh chụp Prototype Redesign (16 ảnh)
Ảnh chụp chất lượng cao lưu tại [docs/ui-redesign/screenshots/redesign/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/):
* **Độ phân giải 1280×800 (Dark / Light)**:
  * Danh sách Ứng dụng: [redesign-apps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-apps-1280x800-dark.png), [redesign-apps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-apps-1280x800-light.png)
  * Chi tiết Ứng dụng (Tab ngang): [redesign-app-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-app-detail-1280x800-dark.png), [redesign-app-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-app-detail-1280x800-light.png)
  * Danh sách Máy chủ (Fixture Stale & Unreachable): [redesign-vps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-1280x800-dark.png), [redesign-vps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-1280x800-light.png)
  * Chi tiết Máy chủ (Tab ngang, bỏ 3 cột lồng): [redesign-vps-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-detail-1280x800-dark.png), [redesign-vps-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-detail-1280x800-light.png)
* **Độ phân giải 1366×768 (Dark / Light)**:
  * Đầy đủ 8 ảnh tương ứng: `redesign-apps-1366x768-*`, `redesign-app-detail-1366x768-*`, `redesign-vps-1366x768-*`, `redesign-vps-detail-1366x768-*`.

---

## 4. Ranh giới IPC Hiện có vs Backlog Backend riêng (Data Gaps & Separation of Concerns)

Nhằm đảm bảo giai đoạn hiện thực hóa UI-1 tập trung tuyệt đối vào tái cấu trúc giao diện và không bị phình phạm vi (scope creep) sang hạ tầng backend, ranh giới dữ liệu được phân định rõ ràng như sau:

### 4.1. Hợp đồng IPC hiện có sẵn sàng cho UI-1
Các kênh IPC đã có sẵn trong [`app/src/shared/ipc.ts`](file:///D:/Developing/DuAnCNTT/app/src/shared/ipc.ts):
* `app:list`, `app:get`: Lấy danh sách và thông tin chi tiết ứng dụng.
* `app:versions`, `app:rollback`: Xem danh sách phiên bản triển khai và thực hiện rollback về deployment cũ.
* `vps:list`: Lấy danh sách máy chủ VPS, địa chỉ IP, cổng SSH, người dùng, `last_seen_at`.
* `vps:test-connection`: Kiểm tra kết nối SSH ping tới máy chủ.
* `vps:get-resources`: Lấy thông tin tài nguyên cơ bản (CPU count, RAM, Disk).
* `doctor:diagnose`, `doctor:fix`, `domain:check`: Chẩn đoán sự cố triển khai và domain exposure.

### 4.2. Danh mục chuyển sang Backlog Backend riêng (Ngoài phạm vi UI-1)
Các tính năng sau đây **không triển khai trong UI-1** mà được chuyển thành các task backlog backend độc lập:

1. **Trình chỉnh sửa biến môi trường Runtime (Runtime Env Editor)**:
   * *Lý do*: Backend hiện tại chỉ có `deploy:detect` để nhận diện cấu hình repo; chưa có IPC đọc hay ghi đè file `.env` đã được render trên VPS cho deployment đang hoạt động.
   * *Backlog task*: Bổ sung API/IPC `app:get-env` và `app:update-env` (mã hóa các secret nhạy cảm) vào Backend Runner.
2. **Kênh phát trực tiếp Log container (Container Live Logs Streaming)**:
   * *Lý do*: Chưa có cơ chế stream stdout/stderr từ remote Docker container về Electron Renderer theo thời gian thực (`docker logs -f --tail 200`).
   * *Backlog task*: Bổ sung IPC Event streaming `app:logs-subscribe` và `app:logs-unsubscribe` qua EventEmitter.
3. **Xác minh Khóa Host bằng Fingerprint tin cậy (Host Key Verification)**:
   * *Lý do*: Bảng `vps` trong SQLite hiện chưa có trường `trusted_fingerprint`. Lệnh `ssh-keyscan` đơn thuần không thể coi là xác minh host vì chỉ mang tính chất TOFU (Trust On First Use) và có nguy cơ bị tấn công Man-In-The-Middle nếu không đối chiếu với nguồn tin cậy ngoài.
   * *Backlog task*: Thêm trường `trusted_fingerprint` vào DB schema, bổ sung logic đối chiếu fingerprint ed25519 nghiêm ngặt trong runner adapter.
4. **Dung lượng lưu trữ Docker & Lệnh Prune (Docker Storage & Prune)**:
   * *Lý do*: Chưa có IPC gọi lệnh `docker system df` hay thực hiện `docker system prune` an toàn trên VPS.
   * *Backlog task*: Bổ sung IPC `vps:docker-df` và `vps:docker-prune`.
5. **Cơ chế Khóa Deploy an toàn (Deploy Guard / Lock)**:
   * *Lý do*: Cơ chế chặn deploy khi máy chủ có trạng thái *Chưa xác minh* hoặc *Lỗi xác thực* cần được enforced ở tầng backend runner (fail-closed), UI chỉ đóng vai trò hiển thị trạng thái bị khóa.
   * *Backlog task*: Bổ sung validation chặn runner ở backend khi host chưa qua preflight tin cậy.
6. **Thông số CPU/RAM tức thời của từng container**:
   * *Lý do*: Cần endpoint gọi nhanh `docker stats --no-stream` khi poller daemon nền không hoạt động.

---

## 5. Tiêu chí Nghiệm thu UI-1 (UI-1 Acceptance Criteria)

Bộ tiêu chí nghiệm thu UI-1 được định nghĩa tinh gọn, tập trung hoàn toàn vào shell, điều hướng, bố cục tab ngang và nhãn trạng thái trung thực dựa trên các kênh IPC hiện có:

### AC-1: Khung vỏ Desktop Shell & Titlebar
* [ ] **AC-1.1 (Sidebar đơn nhất)**: Toàn bộ ứng dụng chỉ có **duy nhất một thanh Sidebar bên trái** (rộng cố định 230px). Tuyệt đối không xuất hiện bất kỳ sub-sidebar nào lồng bên trong trang Ứng dụng hay Máy chủ.
* [ ] **AC-1.2 (Native Titlebar Overlay)**: Giữ nguyên cấu hình `titlebarOverlay: true` của Electron BrowserWindow. Không sao chép hay render nút cửa sổ bằng mã HTML/CSS. Thanh titlebar chỉ đóng vai trò drag-region, hiển thị brand logo và context breadcrumb ngắn gọn.
* [ ] **AC-1.3 (Độ phân giải & Bố cục)**: Giao diện hiển thị sắc nét, không bị tràn viền hoặc xuất hiện thanh cuộn ngang ngoài ý muốn ở hai độ phân giải mục tiêu: `1280×800` và `1366×768`.

### AC-2: Hệ thống Điều hướng 5 mục & Nút Action Deploy
* [ ] **AC-2.1 (5 mục điều hướng)**: Sidebar chứa đúng 5 mục: `Tổng quan`, `Ứng dụng`, `Máy chủ`, `Hoạt động`, `Cài đặt`. Thứ tự hiển thị đặt `Ứng dụng` lên vị trí ưu tiên cao hơn `Máy chủ`.
* [ ] **AC-2.2 (Nút Action Deploy)**: Nút `+ Triển khai` được thiết kế dưới dạng nút hành động (Action Button) nổi bật trên sidebar, khi click sẽ mở hộp thoại/modal chọn app và chạy deploy; không tồn tại dưới dạng một menu item hay trang trống.
* [ ] **AC-2.3 (Loại bỏ dead menus)**: Không giữ lại bất kỳ menu nào chỉ hiển thị hộp thoại `alert()` hoặc trang trống (ví dụ: gộp chức năng Doctor vào trang chi tiết tương ứng thay vì để menu riêng lẻ).

### AC-3: Bố cục Tab ngang tại các trang chi tiết
* [ ] **AC-3.1 (Chi tiết Ứng dụng)**: Trang Chi tiết Ứng dụng sử dụng hệ thống Tab ngang toàn màn hình gồm: *Tổng quan & Sức khỏe*, *Lịch sử & Rollback*, *Cấu hình & Biến môi trường*, *Bác sĩ & Exposure*, *Logs trực tiếp*.
* [ ] **AC-3.2 (Chi tiết Máy chủ VPS)**: Trang Chi tiết VPS sử dụng hệ thống Tab ngang gồm: *Tổng quan & Tài nguyên*, *Ứng dụng trên máy chủ*, *Docker & Lưu trữ*, *Bảo mật & Host Key*, *Nhật ký kết nối*. Loại bỏ hoàn toàn `VpsNavSidebar` và `VpsInfoSidebar`.
* [ ] **AC-3.3 (Bảng phiên bản & Rollback)**: Tab *Lịch sử & Rollback* hiển thị bảng phiên bản từ IPC `app:versions`, cung cấp nút Rollback gọi IPC `app:rollback` kèm hộp thoại xác nhận.

### AC-4: Nhãn trạng thái trung thực (Honest Trust Model)
* [ ] **AC-4.1 (Minh bạch dữ liệu IPC)**: Trạng thái máy chủ phải phản ánh trung thực dữ liệu từ `vps:list` và `vps:test-connection`:
  * Máy chủ có `last_seen_at` quá 24 giờ phải hiển thị nhãn màu vàng **"Chưa xác minh (Stale)"** kèm thông tin thời gian trôi qua.
  * Máy chủ lỗi SSH ping phải hiển thị nhãn màu đỏ **"Mất kết nối"**.
* [ ] **AC-4.2 (Không giả mạo xác minh)**: Tuyệt đối không hiển thị nhãn "Host Key Verified" khi chưa có cơ chế đối chiếu fingerprint với kênh tin cậy ngoài. Không coi `ssh-keyscan` là đã xác minh.
* [ ] **AC-4.3 (Ghi rõ tính năng chưa có IPC)**: Đối với các tab Logs trực tiếp, Chỉnh sửa biến môi trường, Docker Storage và CPU/RAM tức thời: giao diện phải ghi rõ nhãn dữ liệu mẫu/chờ backend, không đánh lừa người dùng rằng tính năng đang hoạt động thực tế.

### AC-5: Tương tác Tìm kiếm & Bộ lọc kết hợp
* [ ] **AC-5.1 (Combined Filter)**: Trên trang danh sách Ứng dụng, ô tìm kiếm văn bản và dropdown lọc theo VPS hoạt động kết hợp đồng thời (AND logic), cập nhật danh sách và bộ đếm kết quả tức thì.
* [ ] **AC-5.2 (Nội dung chi tiết đồng bộ đối tượng)**: Khi click vào bất kỳ ứng dụng hoặc máy chủ nào, trang chi tiết phải hiển thị đúng toàn bộ thông số, cấu hình cổng và danh sách triển khai của đối tượng đó.
