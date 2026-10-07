# Báo cáo Audit & Đặc tả Redesign Giao diện OpsPilot (Giai đoạn UI-0)

> **Tài liệu bàn giao giai đoạn UI-0 (Chốt phương án trước UI-1)**: Đánh giá hiện trạng giao diện dựa trên 24 ảnh chụp thực tế (`current-*`), hoàn thiện prototype độc lập tương tác (`docs/ui-redesign/prototype/`), chụp 16 ảnh thiết kế mới (`redesign-*`), phân định rạch ròi IPC hiện có vs Backlog Backend riêng, và chốt bộ tiêu chí nghiệm thu tinh chuẩn cho giai đoạn hiện thực hóa UI-1.

---

## 1. Tóm tắt điều hành & Định hướng Redesign

### 1.1. Chuyển dịch tư duy: Ứng dụng là trung tâm, VPS là hạ tầng nền tảng
* **Hiện trạng bản dựng cũ (VPS-centric)**: Ứng dụng đặt Máy chủ VPS ở vị trí ưu tiên số 1 trên thanh điều hướng; quy trình quản lý và triển khai bị chia cắt theo từng máy chủ. Bố cục trang ứng dụng bị gò bó trong danh sách phụ bên trái, gây khó khăn cho việc theo dõi trạng thái triển khai tổng thể.
* **Định hướng thiết kế mới (App-centric)**:
  * **Ứng dụng (Applications & Deployments)** trở thành **First-class Citizen** (đối tượng ưu tiên số 1). Mọi trạng thái container, cấu hình cổng, lịch sử phiên bản và thao tác rollback đều xoay quanh từng ứng dụng.
  * **Máy chủ VPS (Infrastructure Fleet)** lùi về vai trò hạ tầng nền tảng (backing platform). Người dùng chỉ tương tác với máy chủ khi cần bảo trì, kiểm tra cấu hình SSH hoặc dịch vụ cơ sở dữ liệu.

### 1.2. Bốn cải cách kiến trúc giao diện cốt lõi
1. **Duy nhất một thanh Sidebar chính (Single Main Sidebar)**:
   * Chốt cố định **5 mục điều hướng**: `Tổng quan`, `Ứng dụng`, `Máy chủ`, `Hoạt động`, `Cài đặt`.
   * Nút `+ Triển khai` là nút hành động toàn cục (Action Button), mở `DeployPage`/wizard hiện có và truyền preselect khi có app/VPS; không tạo modal chạy deploy mới.
   * Loại bỏ triệt để mọi sub-sidebar lồng nhau (`apps-sidebar` trong trang Ứng dụng, `VpsNavSidebar` và `VpsInfoSidebar` trong trang Chi tiết VPS).
2. **Hệ thống Tab ngang tại các trang chi tiết (Chỉ làm các tab dùng được bằng IPC hiện có)**:
   * **Chi tiết Ứng dụng**: Gồm đúng 3 tab: `Tổng quan`, `Lịch sử & Rollback`, `Bác sĩ & Exposure`.
   * **Chi tiết VPS**: Gồm đúng 4 tab: `Tổng quan & Tài nguyên`, `Ứng dụng trên máy chủ`, `Cơ sở dữ liệu`, `Hoạt động`.
   * Các tính năng chưa có IPC (Env editor, live logs, Docker storage, host-key verification) nằm ở Backlog Backend riêng; không yêu cầu tab hoạt động hoặc dữ liệu mẫu trong app thật.
3. **Thanh Desktop Titlebar tối giản & Native Window Controls**:
   * Prototype chỉ minh họa layout titlebar và vùng kéo thả (drag region).
   * **Giao diện sản phẩm thật**: Giữ nguyên tính năng `titlebarOverlay` native của Electron trong cấu hình `BrowserWindow`, tuyệt đối không sao chép hay tự vẽ lại nút điều khiển cửa sổ (Minimize / Maximize / Close) bằng HTML/CSS giả.
4. **Mô hình trạng thái kiểm tra trung thực (Honest Status Model)**:
   * Đối với VPS đã lưu trong hệ thống, thao tác quét và cập nhật trạng thái sử dụng IPC `vps:scan(vpsId)`; kênh `vps:test-connection` chỉ dùng cho form thêm/sửa VPS có `VpsInput`.
   * Nhãn thời gian dựa trên `last_seen_at`:
     * Hiển thị: **"Đã kiểm tra lúc..."** (nếu trong vòng 24 giờ qua).
     * Hiển thị: **"Chưa kiểm tra gần đây"** (nếu quá 24 giờ qua).
     * Mốc 24 giờ chỉ là quy tắc hiển thị độ mới dữ liệu (freshness display rule), **không phải bằng chứng an toàn** và **không gọi là "đã xác minh"** về mặt bảo mật host key.
   * Lệnh `ssh-keyscan` chỉ lấy public key từ remote (Trust On First Use - TOFU), không có giá trị xác minh nếu không đối chiếu với nguồn tin cậy ngoài.

---

## 2. Báo cáo Audit hiện trạng (Current Build UI Audit)

### 2.1. Phân tích hiện trạng dựa trên 24 ảnh chụp thực tế
Toàn bộ 24 ảnh chụp bản dựng hiện tại trong [docs/ui-redesign/screenshots/current/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/current/) đã được ghi lại bằng Electron tự động với cơ chế kiểm tra xác nhận heading và tab đặc trưng trước khi chụp (trong đó ảnh `current-apps-1280x800-dark` đã được xác nhận cả heading lẫn mục sidebar đang chọn đều là `Ứng dụng`):

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

### 3.1. Các điểm cải tiến nổi bật trong Prototype & UI-1a Shell
1. **Sidebar cố định 5 mục & Nút Action Deploy**: `Tổng quan`, `Ứng dụng`, `Máy chủ`, `Hoạt động`, `Cài đặt`. Nút `+ Triển khai` (icon `+` cùng nhãn `Triển khai`, không lặp dấu cộng) điều hướng sang màn `DeployPage` hiện có kèm preselect app/VPS. Lối vào MigratePage được bố trí qua nút hành động trên trang Máy chủ (`VpsPage`), giữ sidebar tinh giản đúng 5 mục chính.
2. **Sửa nút Ops Fleet chuẩn CSS**: Nút chọn fleet trong sidebar được đồng bộ màu nền và viền theo biến theme (`var(--bg-card-subtle)`), không còn bị trắng mặc định trên nền tối.
3. **Nhãn Prototype gọn, dễ thấy**: Đặt nhãn `Prototype · Dữ liệu mẫu` trực quan trên thanh tiêu đề. Các thông báo tương tác (alert) đều ghi rõ tiền tố `[Mô phỏng Prototype]` để xác nhận chỉ là mô phỏng giao diện.
4. **Tìm kiếm và Lọc VPS hoạt động kết hợp đồng thời**:
   * Người dùng có thể vừa nhập từ khóa tìm kiếm (tên app, cổng, framework) vừa chọn lọc theo từng VPS cụ thể từ dropdown (AND logic).
5. **Nội dung trang chi tiết đồng bộ đối tượng và đúng phạm vi UI-1**:
   * Khi mở `express-api`, `next-blog` hoặc `vite-dashboard`, hiển thị đúng 3 tab: `Tổng quan`, `Lịch sử & Rollback`, `Bác sĩ & Exposure`.
   * Khi mở `VM01-Prod`, `VM02-Staging` hoặc `VM03-Cloud-Expired`, hiển thị đúng 4 tab: `Tổng quan & Tài nguyên`, `Ứng dụng`, `Cơ sở dữ liệu`, `Hoạt động`. Nút quét gọi `vps:scan(vpsId)`.

### 3.2. Danh mục ảnh chụp Prototype Redesign (16 ảnh)
Ảnh chụp chất lượng cao lưu tại [docs/ui-redesign/screenshots/redesign/](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/):
* **Độ phân giải 1280×800 (Dark / Light)**:
  * Danh sách Ứng dụng: [redesign-apps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-apps-1280x800-dark.png), [redesign-apps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-apps-1280x800-light.png)
  * Chi tiết Ứng dụng (Tab ngang): [redesign-app-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-app-detail-1280x800-dark.png), [redesign-app-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-app-detail-1280x800-light.png)
  * Danh sách Máy chủ (Trạng thái kiểm tra trung thực): [redesign-vps-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-1280x800-dark.png), [redesign-vps-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-1280x800-light.png)
  * Chi tiết Máy chủ (Tab ngang, 4 tab UI-1): [redesign-vps-detail-1280x800-dark.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-detail-1280x800-dark.png), [redesign-vps-detail-1280x800-light.png](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/screenshots/redesign/redesign-vps-detail-1280x800-light.png)
* **Độ phân giải 1366×768 (Dark / Light)**:
  * Đầy đủ 8 ảnh tương ứng: `redesign-apps-1366x768-*`, `redesign-app-detail-1366x768-*`, `redesign-vps-1366x768-*`, `redesign-vps-detail-1366x768-*`.

---

## 4. Ranh giới IPC Hiện có vs Backlog Backend riêng (Data Gaps & Separation of Concerns)

Nhằm đảm bảo giai đoạn hiện thực hóa UI-1 tập trung tuyệt đối vào tái cấu trúc giao diện và không bị phình phạm vi (scope creep) sang hạ tầng backend, ranh giới dữ liệu được phân định rõ ràng như sau:

### 4.1. Hợp đồng IPC hiện có sẵn sàng cho UI-1
Các kênh IPC đã có sẵn trong [`app/src/shared/ipc.ts`](file:///D:/Developing/DuAnCNTT/app/src/shared/ipc.ts):
* **Ứng dụng**:
  * `app:list`, `app:get`: Lấy danh sách và thông tin cấu hình ứng dụng (lưu ý: `app:get` trả về bản ghi `App`, không trả trạng thái runtime; trạng thái runtime thuộc về `app:runtime-inspect`).
  * `app:versions`, `app:rollback`: Xem lịch sử phiên bản triển khai và kích hoạt rollback.
  * `doctor:diagnose`, `doctor:fix`, `domain:check`: Chẩn đoán cấu hình mạng, binding cổng và domain exposure.
* **Máy chủ VPS**:
  * `vps:list`: Lấy danh sách máy chủ, địa chỉ IP, cổng SSH, người dùng, `last_seen_at`.
  * `vps:scan(vpsId)`: Quét và cập nhật công cụ cơ bản (SSH, Docker, Compose, Git, Workdir) cho máy chủ đã lưu trong hệ thống (lưu ý: `vps:scan` không trả CPU/RAM).
  * `vps:get-resources(vpsId)`: Đọc tài nguyên CPU count, RAM, Disk của VPS từ cache/scan.
  * Cơ sở dữ liệu: `database:list` và `database:types` không tồn tại; hợp đồng IPC khai báo `db:list-databases` nhưng cần kiểm tra lại handler main trước khi gọi để đảm bảo dùng được (tránh lỗi khi handler main chưa đăng ký).
  * `vps:test-connection(input: VpsInput)`: **Chỉ dùng** cho form thêm mới hoặc chỉnh sửa VPS chưa lưu (truyền thông số kết nối mới).

### 4.2. Danh mục chuyển sang Backlog Backend riêng (Ngoài phạm vi UI-1)
Các tính năng sau đây **không thuộc phạm vi UI-1**; app thật trong UI-1 không tạo tab hoạt động hoặc dữ liệu mẫu cho các tính năng này:

1. **Trình chỉnh sửa biến môi trường Runtime (Runtime Env Editor)**:
   * *Lý do*: Backend hiện tại chỉ có `deploy:detect` để nhận diện cấu hình repo; chưa có IPC đọc hay ghi đè file `.env` đã được render trên VPS cho container đang chạy.
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
5. **Nhật ký kết nối chi tiết (Connection Audit Logs)**:
   * *Lý do*: Chưa có bảng lưu trữ lịch sử kết nối SSH và lần quét riêng biệt trong backend DB.
   * *Backlog task*: Bổ sung schema `connection_audit_logs` và IPC truy vấn tương ứng.

---

## 5. Tiêu chí Nghiệm thu UI-1 (UI-1 Acceptance Criteria)

> **Kết quả nghiệm thu thực tế (UI-1k-c)**: Đạt **14 PASS / 1 GAP** (tỷ lệ 93.3%). Tiêu chí duy nhất chưa đạt là **AC-3.2** (GAP lỗi P2 do tab Cơ sở dữ liệu chưa có handler IPC backend). Toàn bộ chi tiết kiểm chứng và bằng chứng xem tại [ui-1k-acceptance.md](./ui-1k-acceptance.md).

### AC-1: Khung vỏ Desktop Shell & Titlebar
* [x] **AC-1.1 (Sidebar đơn nhất)**: **[PASS]** Toàn bộ ứng dụng chỉ có **duy nhất một thanh Sidebar bên trái** (rộng cố định 230px). Tuyệt đối không xuất hiện bất kỳ sub-sidebar nào lồng bên trong trang Ứng dụng hay Máy chủ.
* [x] **AC-1.2 (Native Titlebar Overlay)**: **[PASS]** Giữ nguyên cấu hình `titlebarOverlay: true` của Electron BrowserWindow. Không sao chép hay render nút cửa sổ bằng mã HTML/CSS. Thanh titlebar chỉ đóng vai trò drag-region, hiển thị brand logo và context breadcrumb ngắn gọn.
* [x] **AC-1.3 (Độ phân giải & Bố cục)**: **[PASS]** Giao diện hiển thị sắc nét, không bị tràn viền hoặc xuất hiện thanh cuộn ngang ngoài ý muốn ở hai độ phân giải mục tiêu: `1280×800` và `1366×768`.

### AC-2: Hệ thống Điều hướng 5 mục & Nút Action Deploy
* [x] **AC-2.1 (5 mục điều hướng)**: **[PASS]** Sidebar chứa đúng 5 mục: `Tổng quan`, `Ứng dụng`, `Máy chủ`, `Hoạt động`, `Cài đặt`. Thứ tự hiển thị đặt `Ứng dụng` lên vị trí ưu tiên cao hơn `Máy chủ`.
* [x] **AC-2.2 (Nút Action Deploy)**: **[PASS]** Nút `Triển khai` (có icon `+` PlusOutlined, không lặp dấu cộng) là nút hành động nổi bật trên sidebar. Khi bấm, điều hướng sang màn `DeployPage` hiện có (gọi `setActivePage('deploy')`) và truyền preselect (`appId`, `vpsId`) nếu đang ở ngữ cảnh ứng dụng hoặc máy chủ; không tạo modal chạy deploy mới. Lối vào MigratePage nằm tại nút hành động trên trang Máy chủ.
* [x] **AC-2.3 (Loại bỏ dead menus)**: **[PASS]** Không giữ lại bất kỳ menu nào chỉ hiển thị hộp thoại `alert()` hoặc trang trống (ví dụ: gộp chức năng Doctor vào trang chi tiết tương ứng thay vì để menu riêng lẻ).

### AC-3: Bố cục Tab ngang tại các trang chi tiết (Chỉ làm tab dùng được bằng IPC hiện có)
* [x] **AC-3.1 (Chi tiết Ứng dụng - Đúng 3 tab)**: **[PASS]** Trang Chi tiết Ứng dụng sử dụng hệ thống Tab ngang gồm đúng 3 tab được hỗ trợ bởi IPC hiện có:
  1. *Tổng quan*: Hiển thị thông tin cấu hình (`app:get`), trạng thái runtime (`app:runtime-inspect`), metrics (`monitor:samples`), cấu hình cổng và link VPS.
  2. *Lịch sử & Rollback*: Bảng deployment (`app:versions`) kèm nút Rollback gọi IPC `app:rollback` với hộp thoại xác nhận an toàn.
  3. *Bác sĩ & Exposure*: Chẩn đoán kết nối và kiểm tra domain (`doctor:diagnose`, `domain:check`).
* [ ] **AC-3.2 (Chi tiết Máy chủ VPS - Đúng 4 tab)**: **[GAP - Lỗi P2]** Trang Chi tiết VPS sử dụng hệ thống Tab ngang gồm đúng 4 tab được hỗ trợ bởi IPC hiện có:
  1. *Tổng quan & Tài nguyên*: Thông số CPU, RAM, Disk từ IPC `vps:get-resources` và nút quét công cụ `vps:scan(vpsId)` (lưu ý: `vps:scan` không trả CPU/RAM).
  2. *Ứng dụng trên máy chủ*: Bảng các ứng dụng thuộc VPS này từ IPC `app:list(vpsId)` kèm liên kết điều hướng sang chi tiết app.
  3. *Cơ sở dữ liệu*: Danh sách database từ `db:list-databases(vpsId)` (cần kiểm tra lại handler main trước khi gọi; không có `database:list` hay `database:types`). *(Thực tế hiện tại: Tab 3 hiển thị thông báo chưa hỗ trợ và backend chưa đăng ký các handler IPC `db:*`)*.
  4. *Hoạt động*: Lịch sử deployment và sự kiện gần đây trên VPS từ DB SQLite.
* [x] **AC-3.3 (Loại bỏ triệt để Sub-sidebars)**: **[PASS]** Xóa bỏ hoàn toàn `apps-sidebar` trong trang Ứng dụng, cũng như `VpsNavSidebar` và `VpsInfoSidebar` trong trang Chi tiết VPS.
* [x] **AC-3.4 (Backlog rõ ràng)**: **[PASS]** Env editor, live logs, Docker storage, host-key verification và connection audit được giữ ở backlog backend; không yêu cầu tab hoạt động hoặc dữ liệu mẫu trong app thật của UI-1.

### AC-4: Nhãn trạng thái trung thực (Honest Status Model)
* [x] **AC-4.1 (Minh bạch dữ liệu IPC & Phân biệt vps:scan vs vps:test-connection)**: **[PASS]**
  * Với VPS đã lưu, thao tác quét kiểm tra phải sử dụng đúng IPC `vps:scan(vpsId)`.
  * Kênh `vps:test-connection` chỉ dùng cho form thêm/sửa VPS có `VpsInput`.
* [x] **AC-4.2 (Nhãn thời gian last_seen_at)**: **[PASS]**
  * Máy chủ có `last_seen_at` trong vòng 24 giờ hiển thị nhãn: **"Đã kiểm tra lúc..."**.
  * Máy chủ có `last_seen_at` quá 24 giờ hiển thị nhãn màu vàng: **"Chưa kiểm tra gần đây"** (kèm thời gian trôi qua).
  * Mốc 24 giờ chỉ là quy tắc hiển thị độ mới dữ liệu (freshness display rule), **không phải bằng chứng an toàn**.
* [x] **AC-4.3 (Không gọi "Đã xác minh" về host key)**: **[PASS]**
  * Tuyệt đối không dùng cụm từ "Đã xác minh" (Verified) để mô tả tính bảo mật của host key khi hệ thống chưa có kênh tin cậy đối chiếu fingerprint.
  * Không coi kết quả từ `ssh-keyscan` là bằng chứng xác minh host.
  * Máy chủ lỗi SSH ping / timeout hiển thị nhãn màu đỏ **"Mất kết nối"**.

### AC-5: Tương tác Tìm kiếm & Bộ lọc kết hợp
* [x] **AC-5.1 (Combined Filter)**: **[PASS]** Trên trang danh sách Ứng dụng, ô tìm kiếm văn bản và dropdown lọc theo VPS hoạt động kết hợp đồng thời (AND logic), cập nhật danh sách và bộ đếm kết quả tức thì.
* [x] **AC-5.2 (Nội dung chi tiết đồng bộ đối tượng)**: **[PASS]** Khi click vào bất kỳ ứng dụng hoặc máy chủ nào, trang chi tiết phải hiển thị đúng toàn bộ thông số, cấu hình cổng và danh sách triển khai của đối tượng đó.
