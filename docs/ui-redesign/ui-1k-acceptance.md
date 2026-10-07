# Báo cáo Nghiệm thu Giao diện UI-1k-a (Interface Acceptance Audit)

> **Checkpoint**: UI-1k-a<br>
> **Tài liệu đối chiếu**: [README.md](./README.md) (Mục 5: Tiêu chí Nghiệm thu AC-1 đến AC-5)<br>
> **Môi trường thẩm định**: Electron runtime thực tế (v35 / Chromium / Node 22), Windows<br>
> **Độ phân giải kiểm thử**: 1280×800 và 1366×768 (cả Dark Theme và Light Theme)<br>
> **Nguyên tắc checkpoint**: Chỉ kiểm tra & lập biên bản nghiệm thu; **không sửa mã nguồn** trong checkpoint này.<br>
> **Giới hạn môi trường**: Toàn bộ kiểm thử và kiểm tra giao diện chạy trong môi trường cục bộ sử dụng dữ liệu giả lập (fixtures/mocks theo hợp đồng IPC) hoặc SQLite cục bộ; **không sử dụng VPS thật** để kết nối SSH đường dài trong checkpoint này.

---

## 1. Tổng quan Kết quả Nghiệm thu (Executive Summary)

Đếm chi tiết đầy đủ **15 tiêu chí nghiệm thu (AC)** theo đúng Mục 5 của [README.md](./README.md):

| Nhóm tiêu chí | Nội dung tiêu chí | Đánh giá tổng hợp | Số lượng PASS | Số lượng GAP | Số lượng NOT_RUN |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **AC-1** | Khung vỏ Desktop Shell & Titlebar (AC-1.1 → AC-1.3) | **PASS** | 3 / 3 | 0 | 0 |
| **AC-2** | Hệ thống Điều hướng 5 mục & Nút Action Deploy (AC-2.1 → AC-2.3) | **GAP (P1)** | 2 / 3 | 1 | 0 |
| **AC-3** | Bố cục Tab ngang tại các trang chi tiết (AC-3.1 → AC-3.4) | **GAP (P2)** | 3 / 4 | 1 | 0 |
| **AC-4** | Nhãn trạng thái trung thực (Honest Status Model) (AC-4.1 → AC-4.3) | **PASS** | 3 / 3 | 0 | 0 |
| **AC-5** | Tương tác Tìm kiếm & Bộ lọc kết hợp (AC-5.1 → AC-5.2) | **PASS** | 2 / 2 | 0 | 0 |
| **TỔNG CỘNG** | **15 tiêu chí thành phần độc lập** | **13 PASS / 2 GAP** | **13** | **2** | **0** |

*Ghi chú*:
- Lỗi thiếu bản dịch `backToList` trên 3 ngôn ngữ (VI/CN/JP) được tách khỏi phép đếm của tiêu chí **AC-4.2** và theo dõi độc lập như một lỗi bản địa hóa giao diện ở mức ưu tiên **[P3]** trong Danh sách Khiếm khuyết Ưu tiên. Do đó, **AC-4.2** được đánh giá trọn vẹn là **PASS** dựa trên việc thực thi đúng mô hình nhãn trạng thái trung thực theo độ mới dữ liệu.
- Tiêu chí **AC-3.2** được đánh giá là **GAP** do tab Cơ sở dữ liệu trong thực tế chỉ hiển thị trạng thái "Chưa hỗ trợ cơ sở dữ liệu" và tiến trình chính backend chưa triển khai các kênh IPC `db:*`.

---

## 2. Bảng Đánh giá Chi tiết 15 Tiêu chí Nghiệm thu (AC-1 → AC-5)

### AC-1: Khung vỏ Desktop Shell & Titlebar (3 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-1.1** | **Sidebar đơn nhất**:<br>• Duy nhất một thanh sidebar bên trái rộng cố định 230px.<br>• Tuyệt đối không có sub-sidebar lồng bên trong trang Apps hoặc VPS. | **PASS** | • Chiều rộng cố định: Class `.app-sidebar` trong [../../app/src/renderer/src/App.css](../../app/src/renderer/src/App.css) được định nghĩa `width: 230px`.<br>• Loại bỏ sub-sidebar: Mã nguồn của [../../app/src/renderer/src/pages/AppsPage.tsx](../../app/src/renderer/src/pages/AppsPage.tsx) và [../../app/src/renderer/src/pages/VpsPage.tsx](../../app/src/renderer/src/pages/VpsPage.tsx) đã xóa hoàn toàn các component sidebar lồng (`apps-sidebar`, `VpsNavSidebar`, `VpsInfoSidebar`).<br>• Ảnh chụp đã commit: [screenshots/ui-1a/](screenshots/ui-1a/) ghi nhận cấu trúc sidebar đơn nhất.<br>• Test đã commit: [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx) xác nhận hiển thị đúng 5 mục điều hướng chính trên thanh sidebar đơn. |
| **AC-1.2** | **Native Titlebar Overlay**:<br>• Giữ nguyên cấu hình `titlebarOverlay: true` của Electron BrowserWindow.<br>• Không vẽ nút cửa sổ giả bằng HTML/CSS.<br>• Titlebar là drag-region, hiển thị brand "OpsPilot" và context breadcrumb ngắn gọn. | **PASS** | • Cấu hình BrowserWindow: [../../app/src/main/index.ts](../../app/src/main/index.ts) khởi tạo với `titleBarStyle: 'hidden'`, `titleBarOverlay: true`. Kênh IPC `window:set-titlebar-overlay` đồng bộ màu động theo Dark/Light theme.<br>• Không vẽ nút giả: Không có nút min/max/close giả nào được render trong DOM renderer.<br>• Drag region: Phần tử `.app-titlebar` có CSS `-webkit-app-region: drag`, chứa brand "OpsPilot" và breadcrumb theo trang.<br>• Ảnh chụp đã commit: Xem bộ ảnh titlebar trong [screenshots/ui-1a/](screenshots/ui-1a/). |
| **AC-1.3** | **Độ phân giải & Bố cục**:<br>• Không tràn viền, không xuất hiện thanh cuộn ngang ngoài ý muốn ở 1280×800 và 1366×768 (Dark/Light). | **PASS** | • Xác nhận qua bộ ảnh chụp Electron thực tế đã commit ở cả 2 độ phân giải (1280×800 và 1366×768) trên Dark/Light theme:<br>  - Shell & Trang chủ: [screenshots/ui-1a/](screenshots/ui-1a/)<br>  - Danh sách máy chủ: [screenshots/ui-1b/](screenshots/ui-1b/)<br>  - Danh sách & Chi tiết ứng dụng: [screenshots/ui-1c/](screenshots/ui-1c/)<br>  - Chi tiết máy chủ: [screenshots/ui-1d/](screenshots/ui-1d/)<br>  - Lịch sử triển khai & Rollback: [screenshots/ui-1e/](screenshots/ui-1e/)<br>  - Deploy wizard & Terminal: [screenshots/ui-1f/](screenshots/ui-1f/), [screenshots/ui-1g/](screenshots/ui-1g/), [screenshots/ui-1h/](screenshots/ui-1h/)<br>  - Cài đặt: [screenshots/ui-1i/](screenshots/ui-1i/)<br>  - Di chuyển (Migrate): [screenshots/ui-1j-b/](screenshots/ui-1j-b/)<br>• Không có trang nào phát sinh thanh cuộn ngang ngoài ý muốn. |

---

### AC-2: Hệ thống Điều hướng 5 mục & Nút Action Deploy (3 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-2.1** | **5 mục điều hướng**:<br>• Sidebar chứa đúng 5 mục: Tổng quan, Ứng dụng, Máy chủ, Hoạt động, Cài đặt.<br>• Thứ tự hiển thị: Ứng dụng đặt trước Máy chủ. | **PASS** | • Danh sách mục `.app-sidebar-item` được cấu hình theo thứ tự: `dashboard` (Tổng quan) → `apps` (Ứng dụng) → `vps` (Máy chủ) → `activity` (Hoạt động) → `settings` (Cài đặt).<br>• Mục `apps` đặt trước `vps`.<br>• Test đã commit: [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx) kiểm tra nhãn hiển thị và thứ tự đạt 100% trên cả 4 ngôn ngữ (EN, VI, CN, JP). |
| **AC-2.2** | **Nút Action Deploy**:<br>• Nút "Triển khai" có icon `+` (PlusOutlined, không lặp dấu cộng) nổi bật trên sidebar.<br>• Khi bấm, điều hướng sang `DeployPage` hiện có (`setActivePage('deploy')`) và truyền preselect (`appId`, `vpsId`) nếu đang ở ngữ cảnh app/VPS.<br>• Không tạo modal deploy mới.<br>• Lối vào MigratePage nằm tại nút hành động trên trang Máy chủ. | **GAP**<br>*(Lỗi P1)* | • **Điểm đạt**: Nút `.app-sidebar-deploy-btn` hiển thị icon `+`, nhãn "Triển khai", không trùng dấu cộng. Bấm nút chuyển sang `DeployPage` thật, không sinh modal mới. Lối vào Migrate nằm ở nút "Di chuyển" trên trang Máy chủ ([../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx)). Các nút Deploy nội bộ trang (`AppsPage`, `VpsPage`, `VpsAppsTab`) đều truyền preselect thành công (xem [../../app/src/renderer/src/pages/DeployPage.test.tsx](../../app/src/renderer/src/pages/DeployPage.test.tsx)).<br>• **Ghi nhận GAP (GAP-1)**: Nút `+ Triển khai` trên sidebar toàn cục ([../../app/src/renderer/src/App.tsx](../../app/src/renderer/src/App.tsx#L87-L95)) chỉ gọi `onClick={() => setActivePage('deploy')}` mà **không truyền ngữ cảnh preselect** của trang người dùng đang mở. Khi người dùng đang xem chi tiết app hoặc VPS mà bấm nút này ở sidebar, trang Deploy mở ở trạng thái trắng chưa chọn máy chủ hay ứng dụng. |
| **AC-2.3** | **Loại bỏ dead menus**:<br>• Không giữ lại menu nào chỉ hiển thị `alert()` hoặc trang trống. | **PASS** | • Không tồn tại menu hoặc nút bấm nào gọi `alert()`, `confirm()` rỗng hay dẫn tới trang trống.<br>• Chức năng Doctor được tích hợp trực tiếp vào tab `Bác sĩ & Exposure` trong [../../app/src/renderer/src/pages/AppsPage.tsx](../../app/src/renderer/src/pages/AppsPage.tsx) và màn xử lý lỗi của DeployPage.<br>• Test đã commit: [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx). |

---

### AC-3: Bố cục Tab ngang tại các trang chi tiết (4 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-3.1** | **Chi tiết Ứng dụng - Đúng 3 tab**:<br>1. *Tổng quan*: Thông tin cấu hình (`app:get`), runtime (`app:runtime-inspect`), metrics, cổng, link VPS.<br>2. *Lịch sử & Rollback*: Bảng deployment (`app:versions`), nút Rollback an toàn (`app:rollback`).<br>3. *Bác sĩ & Exposure*: Chẩn đoán mạng, domain (`doctor:diagnose`, `domain:check`). | **PASS** | • Bố cục tab trong [../../app/src/renderer/src/pages/AppsPage.tsx](../../app/src/renderer/src/pages/AppsPage.tsx): Gồm đúng 3 tab ngang `overview`, `history`, `doctor`.<br>• Test đã commit: [../../app/src/renderer/src/pages/AppsPage.test.tsx](../../app/src/renderer/src/pages/AppsPage.test.tsx) xác nhận: mở chi tiết toàn chiều rộng có nút quay lại và đúng 3 tab ngang, gọi đúng IPC cấu hình, lịch sử deployment, chẩn đoán Doctor và modal rollback an toàn.<br>• Ảnh chụp đã commit: [screenshots/ui-1c/](screenshots/ui-1c/) và [screenshots/ui-1e/](screenshots/ui-1e/). |
| **AC-3.2** | **Chi tiết Máy chủ VPS - Đúng 4 tab**:<br>1. *Tổng quan & Tài nguyên*: CPU/RAM/Disk từ `vps:get-resources`, quét công cụ từ `vps:scan(vpsId)`.<br>2. *Ứng dụng trên máy chủ*: Bảng app từ `app:list(vpsId)` kèm link sang app.<br>3. *Cơ sở dữ liệu*: Danh sách database từ `db:list-databases(vpsId)`.<br>4. *Hoạt động*: Lịch sử deployment từ SQLite. | **GAP**<br>*(Lỗi P2)* | • **Điểm đạt**: [../../app/src/renderer/src/components/VpsDetail.tsx](../../app/src/renderer/src/components/VpsDetail.tsx#L63-L115) định nghĩa đúng 4 tab ngang (`overview`, `apps`, `database`, `activity`). Các tab 1, 2, 4 hoạt động đầy đủ qua các IPC `vps:get-resources`, `vps:scan`, `app:list`, `history:list` (xác nhận qua test [../../app/src/renderer/src/pages/VpsPage.test.tsx](../../app/src/renderer/src/pages/VpsPage.test.tsx)).<br>• **Ghi nhận GAP (GAP-2)**: Đối với Tab 3 (*Cơ sở dữ liệu*), `VpsDetail.tsx` (dòng 103) nhúng component `<VpsDatabaseTab vpsId={vps.id} />` mà không truyền prop `supported`, dẫn đến mặc định `supported = false`. Khi đó, tab chỉ hiển thị màn hình thông báo rỗng: *"Chưa hỗ trợ cơ sở dữ liệu - Tính năng quản lý cơ sở dữ liệu trên máy chủ hiện chưa khả dụng trong OpsPilot"* (được xác nhận qua test đã commit [../../app/src/renderer/src/components/VpsDatabaseTab.test.tsx](../../app/src/renderer/src/components/VpsDatabaseTab.test.tsx#L273-L294)). Đồng thời, kiểm tra [../../app/src/main/ipc.ts](../../app/src/main/ipc.ts) cho thấy tiến trình chính **chưa hề đăng ký các handler IPC tiền tố `db:*`** (`db:list-databases`, `db:list-users`, v.v.). Như vậy, yêu cầu hiển thị "Danh sách database từ `db:list-databases(vpsId)`" chưa được kết nối đầu-cuối trong thực tế. |
| **AC-3.3** | **Loại bỏ triệt để Sub-sidebars**:<br>• Xóa bỏ `apps-sidebar` trong trang Ứng dụng.<br>• Xóa bỏ `VpsNavSidebar` và `VpsInfoSidebar` trong trang Chi tiết VPS. | **PASS** | • Cả 2 trang [../../app/src/renderer/src/pages/AppsPage.tsx](../../app/src/renderer/src/pages/AppsPage.tsx) và [../../app/src/renderer/src/pages/VpsPage.tsx](../../app/src/renderer/src/pages/VpsPage.tsx) hoạt động theo luồng 2 màn hình toàn chiều rộng: Danh sách (List view) → Chi tiết (Detail view) có nút Back, không dùng thanh phụ bên trong.<br>• Test đã commit: [../../app/src/renderer/src/pages/AppsPage.test.tsx](../../app/src/renderer/src/pages/AppsPage.test.tsx) và [../../app/src/renderer/src/pages/VpsPage.test.tsx](../../app/src/renderer/src/pages/VpsPage.test.tsx).<br>• Ảnh chụp đã commit: [screenshots/ui-1c/](screenshots/ui-1c/) và [screenshots/ui-1d/](screenshots/ui-1d/). |
| **AC-3.4** | **Backlog rõ ràng**:<br>• Env editor, Live logs, Docker storage, Host-key verification được giữ ở backlog backend.<br>• Không tạo tab giả hay dữ liệu mẫu trong UI-1. | **PASS** | • Các tính năng như Trình chỉnh sửa biến môi trường Runtime, Stream log container thời gian thực, Lệnh dọn dẹp Docker prune, và Xác minh khóa host bằng fingerprint đều không có tab hoạt động giả hay dữ liệu ảo trong giao diện.<br>• **Đính chính phân định backlog cho Cơ sở dữ liệu**: Dù giao diện có chứa tab "Cơ sở dữ liệu", nhưng hệ thống đã xử lý trung thực bằng cách đặt `supported = false` hiển thị thông báo chưa hỗ trợ thay vì tự tạo dữ liệu mẫu. Phần backend handler `db:*` do đó cũng được xếp vào nhóm tồn đọng kỹ thuật của backend tương tự các tính năng trên.<br>• Đạt yêu cầu không dùng dữ liệu giả mạo trong ứng dụng. |

---

### AC-4: Nhãn trạng thái trung thực (Honest Status Model) (3 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-4.1** | **Minh bạch IPC & Phân biệt vps:scan vs vps:test-connection**:<br>• VPS đã lưu chỉ quét bằng `vps:scan(vpsId)`.<br>• `vps:test-connection` chỉ dùng cho form thêm/sửa VPS có `VpsInput`. | **PASS** | • Trên màn hình chi tiết VPS, thao tác quét kiểm tra gọi kênh `vps:scan(vpsId)` thông qua [../../app/src/renderer/src/components/VpsOverviewTab.tsx](../../app/src/renderer/src/components/VpsOverviewTab.tsx). Kênh `vps:test-connection` chỉ được dùng trong modal nhập thông số [../../app/src/renderer/src/components/VpsFormModal.tsx](../../app/src/renderer/src/components/VpsFormModal.tsx).<br>• Test đã commit: [../../app/src/renderer/src/pages/VpsPage.test.tsx](../../app/src/renderer/src/pages/VpsPage.test.tsx) kiểm chứng: sau `vps:scan` thành công, chỉ làm mới bản ghi VPS đó mà không quét lặp hay gọi nhầm kênh kiểm tra kết nối form. |
| **AC-4.2** | **Nhãn thời gian last_seen_at**:<br>• Máy chủ có `last_seen_at` ≤ 24h hiển thị: "Vừa kiểm tra" / "Đã kiểm tra gần đây".<br>• Máy chủ có `last_seen_at` > 24h hiển thị nhãn màu vàng: "Chưa kiểm tra gần đây".<br>• Mốc 24h chỉ là quy tắc hiển thị độ tươi dữ liệu, không phải chứng nhận an toàn. | **PASS** | • Logic tính toán nhãn trạng thái trung thực được đóng gói trong hàm `evaluateVpsStatus` tại [../../app/src/renderer/src/vpsResources.ts](../../app/src/renderer/src/vpsResources.ts):<br>  - Đọc thành công trong phiên: Tag `success` ("Vừa kiểm tra"), có thời hạn TTL 60s.<br>  - Bản ghi DB ≤ 24h: Tag `default` ("Đã kiểm tra gần đây").<br>  - Bản ghi DB > 24h: Tag `warning` màu vàng ("Chưa kiểm tra gần đây").<br>  - Thất bại hoặc timeout: Tag `error` màu đỏ ("Không thể kiểm tra").<br>• Test đã commit: [../../app/src/renderer/src/components/ServerSelector.test.tsx](../../app/src/renderer/src/components/ServerSelector.test.tsx) và [../../app/src/renderer/src/pages/VpsPage.test.tsx](../../app/src/renderer/src/pages/VpsPage.test.tsx).<br>*(Lưu ý: Lỗi thiếu bản dịch `backToList` trên trang VPS được tách riêng thành lỗi bản địa hóa [P3] bên dưới, không làm ảnh hưởng kết quả PASS của AC-4.2)*. |
| **AC-4.3** | **Không gọi "Đã xác minh" về host key**:<br>• Không dùng từ "Đã xác minh" (Verified) khi chưa có kênh tin cậy đối chiếu fingerprint.<br>• Máy chủ mất kết nối/timeout hiển thị màu đỏ "Không thể kiểm tra" hoặc "Mất kết nối". | **PASS** | • Kiểm tra toàn bộ chuỗi ký tự trong [../../app/src/renderer/src/strings.ts](../../app/src/renderer/src/strings.ts) và các component hiển thị máy chủ: Tuyệt đối không sử dụng các từ "Đã xác minh" hoặc "Verified" cho host key.<br>• Máy chủ không kết nối được hoặc timeout hiển thị chính xác nhãn lỗi màu đỏ "Không thể kiểm tra" / "Mất kết nối". |

---

### AC-5: Tương tác Tìm kiếm & Bộ lọc kết hợp (2 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-5.1** | **Combined Filter (AND logic)**:<br>• Ô tìm kiếm văn bản và dropdown lọc theo VPS hoạt động kết hợp đồng thời.<br>• Cập nhật danh sách và bộ đếm kết quả tức thì. | **PASS** | • Cơ chế lọc kết hợp: [../../app/src/renderer/src/pages/AppsPage.tsx](../../app/src/renderer/src/pages/AppsPage.tsx) áp dụng đồng thời cả điều kiện tìm kiếm chuỗi ký tự và bộ lọc VPS theo logic `AND`. Bộ đếm kết quả cập nhật ngay lập tức dạng "Hiển thị X / Y ứng dụng".<br>• Test đã commit: [../../app/src/renderer/src/pages/AppsPage.test.tsx](../../app/src/renderer/src/pages/AppsPage.test.tsx) kiểm chứng: *"tải danh sách app từ app:list, lọc kết hợp tìm kiếm và chọn VPS đồng thời (AND logic)"*.<br>• Ảnh chụp đã commit: [screenshots/ui-1c/](screenshots/ui-1c/). |
| **AC-5.2** | **Nội dung chi tiết đồng bộ đối tượng**:<br>• Bấm vào bất kỳ ứng dụng hoặc máy chủ nào, trang chi tiết hiển thị đúng toàn bộ thông số, cấu hình cổng và danh sách triển khai của đối tượng đó. | **PASS** | • Đồng bộ đối tượng: Khi người dùng chọn một ứng dụng hoặc máy chủ cụ thể, toàn bộ dữ liệu chi tiết (tên, cổng, VPS liên kết, framework, các bản ghi deployment) đều tải đúng theo định danh đối tượng được chọn.<br>• Test đã commit: [../../app/src/renderer/src/pages/AppsPage.test.tsx](../../app/src/renderer/src/pages/AppsPage.test.tsx) và [../../app/src/renderer/src/pages/VpsPage.test.tsx](../../app/src/renderer/src/pages/VpsPage.test.tsx).<br>• *Lưu ý giới hạn kiểm chứng*: Tương tác đã được thẩm định trực tiếp trong phiên Electron của đợt audit này; do không có môi trường VPS thật, các thông số tài nguyên và danh sách app phụ thuộc vào fixture IPC và database cục bộ SQLite. |

---

## 3. Danh sách Khiếm khuyết Ưu tiên (Prioritized Defect Backlog)

### [P1] GAP-1: Nút Action Deploy trên Sidebar toàn cục không mang ngữ cảnh của trang đang mở (AC-2.2)
- **Vị trí**: [../../app/src/renderer/src/App.tsx](../../app/src/renderer/src/App.tsx#L87-L95)
- **Mô tả hiện tượng**:
  Khi người dùng đang ở ngữ cảnh một ứng dụng cụ thể (đang xem chi tiết một app trên `AppsPage`) hoặc một máy chủ cụ thể (đang xem chi tiết một máy chủ trên `VpsPage`), nếu bấm nút `+ Triển khai` (`.app-sidebar-deploy-btn`) ở sidebar bên trái, mã nguồn hiện tại chỉ thực hiện:
  ```tsx
  onClick={() => setActivePage('deploy')}
  ```
  mà không truyền ngữ cảnh preselect sang `DeployPage`.
- **Hệ quả**:
  Màn `DeployPage` mở ra ở trạng thái mặc định (chế độ tạo ứng dụng mới, dropdown VPS và App đều trống), làm mất ngữ cảnh công việc người dùng đang thao tác.
- **Đề xuất giải pháp (cho checkpoint sửa mã nguồn kế tiếp)**:
  Chỉ sử dụng ngữ cảnh của **trang đang mở hiện tại**, tuyệt đối **không lấy ID cũ còn tồn lưu trong session storage** để tránh sai lệch ngữ cảnh:
  1. Kiểm tra trạng thái trang đang kích hoạt (`page`):
     - Nếu đang ở trang Ứng dụng (`page === 'apps'`) VÀ đang mở chi tiết ứng dụng (`selectedAppId !== null`): lấy `appId = selectedAppId` cùng `vpsId` thuộc app đó, thiết lập `setDeployPreselect({ appId, vpsId })`.
     - Nếu đang ở trang Máy chủ (`page === 'vps'`) VÀ đang mở chi tiết máy chủ (`selectedVpsId !== null`): lấy `vpsId = selectedVpsId`, thiết lập `setDeployPreselect({ vpsId })`.
     - Nếu đang ở các trang khác (`dashboard`, `activity`, `settings`), hoặc đang ở màn hình danh sách ngoài (chưa chọn app/VPS cụ thể): giữ `deployPreselect = null` (mở DeployPage ở trạng thái tạo mới mặc định).
  2. Sau khi thiết lập preselect phù hợp với trang hiện tại, mới gọi `setActivePage('deploy')`.

---

### [P2] GAP-2: Tab Cơ sở dữ liệu trên trang Chi tiết VPS chưa hỗ trợ kết nối IPC backend (AC-3.2)
- **Vị trí**: [../../app/src/renderer/src/components/VpsDetail.tsx](../../app/src/renderer/src/components/VpsDetail.tsx#L103), [../../app/src/renderer/src/components/VpsDatabaseTab.tsx](../../app/src/renderer/src/components/VpsDatabaseTab.tsx), [../../app/src/main/ipc.ts](../../app/src/main/ipc.ts)
- **Mô tả hiện tượng**:
  Tiêu chí AC-3.2 yêu cầu Tab 3 (*Cơ sở dữ liệu*) hiển thị *"Danh sách database từ `db:list-databases(vpsId)`"*. Tuy nhiên, trong thực tế:
  1. `VpsDetail.tsx` gọi `<VpsDatabaseTab vpsId={vps.id} />` không truyền `supported`, khiến `supported` mặc định là `false`.
  2. Tab Database hiển thị giao diện trống (`Empty`) với thông báo: *"Chưa hỗ trợ cơ sở dữ liệu - Tính năng quản lý cơ sở dữ liệu trên máy chủ hiện chưa khả dụng trong OpsPilot"*.
  3. Tiến trình chính `app/src/main/ipc.ts` chưa đăng ký bất kỳ handler nào cho tiền tố `db:*` (`db:list-databases`, `db:list-users`, `db:create-user`, `db:create-database`, `db:save-schema`, `db:list-tables`).
- **Hệ quả**:
  Tính năng quản lý cơ sở dữ liệu chưa thể sử dụng được trong thực tế; tab hiện hữu chỉ đóng vai trò placeholder thông báo chưa hỗ trợ.
- **Đề xuất giải pháp (cho checkpoint kế tiếp)**:
  - Nếu đưa tính năng này vào vận hành: Cần triển khai các handler `db:*` trong `app/src/main/ipc.ts` (kết nối remote database qua adapter SSH/Docker), sau đó truyền `supported={true}` từ `VpsDetail.tsx`.
  - Nếu tính năng này chính thức chuyển sang giai đoạn sau (Backlog backend): Cập nhật lại tài liệu đặc tả AC-3.2 để làm rõ tab Database tạm thời ở trạng thái thông báo chưa hỗ trợ trong phạm vi UI-1.

---

### [P3] Khiếm khuyết Bản địa hóa: Thiếu chuỗi dịch nút quay lại danh sách VPS trên VI / CN / JP (Tách khỏi AC-4.2)
- **Vị trí**: [../../app/src/renderer/src/strings.ts](../../app/src/renderer/src/strings.ts), [../../app/src/renderer/src/pages/VpsPage.tsx](../../app/src/renderer/src/pages/VpsPage.tsx#L267-L274)
- **Mô tả hiện tượng**:
  Nút quay lại danh sách máy chủ trên trang `VpsPage.tsx` sử dụng nhãn:
  ```tsx
  <Tooltip title={strings.vps.backToList}>
    <Button
      type="text"
      icon={<ArrowLeftOutlined />}
      aria-label={strings.vps.backToList}
      onClick={() => setSelectedVpsId(null)}
    />
  </Tooltip>
  ```
  Thuộc tính `backToList` hiện chỉ được định nghĩa trong `BASE_EN_STRINGS.vps.backToList` (`"Back to VPS list"`). Cả 3 file ghi đè ngôn ngữ (`VI_OVERRIDES.vps`, `CN_OVERRIDES.vps`, `JP_OVERRIDES.vps`) đều thiếu trường `backToList` trong nhóm `vps`. Do đó, trên cả 3 ngôn ngữ tiếng Việt, tiếng Trung và tiếng Nhật, tooltip và aria-label của nút này đều bị hiển thị bằng tiếng Anh (trong khi ở `AppsPage`, nhãn này được bản địa hóa đầy đủ).
- **Hệ quả**:
  Trải nghiệm bản địa hóa bị khiếm khuyết chuỗi tiếng Anh cục bộ trên giao diện tiếng Việt, Trung, Nhật.
- **Đề xuất giải pháp**:
  Bổ sung khai báo `backToList` vào các khối dịch tương ứng trong `strings.ts`:
  - `VI_OVERRIDES.vps`: `backToList: 'Quay lại danh sách máy chủ'`
  - `CN_OVERRIDES.vps`: `backToList: '返回服务器列表'`
  - `JP_OVERRIDES.vps`: `backToList: 'サーバー一覧に戻る'`

---

## 4. Kết luận Nghiệm thu & Kiến nghị (Acceptance Sign-off)

1. **Kết quả định lượng**: Đạt **13 / 15** tiêu chí nghiệm thu (tỷ lệ 86.7%). Cả 15 tiêu chí đã được kiểm tra, phân loại rõ ràng và đếm đủ.
2. **Khung vỏ & Bố cục**: Thiết kế shell 230px, Titlebar Overlay native và hệ thống tab ngang không sub-sidebars hoạt động ổn định trên cả 2 độ phân giải 1280×800 và 1366×768.
3. **Tính trung thực dữ liệu**: Mô hình nhãn trạng thái trung thực phân biệt rành mạch giữa dữ liệu kiểm tra tức thời trong phiên và dữ liệu lịch sử quá khứ; không phát sinh tuyên bố sai lệch về an toàn host key.
4. **Kế hoạch khắc phục**:
   - Khắc phục **GAP-1 [P1]** tại `App.tsx` bằng cách chỉ lấy ngữ cảnh của trang đang mở để truyền preselect sang Deploy.
   - Xử lý **GAP-2 [P2]** đối với tab Database (hoàn thiện backend IPC hoặc cập nhật lại đặc tả AC-3.2).
   - Bổ sung chuỗi dịch **[P3]** cho `backToList` trên 3 ngôn ngữ trong `strings.ts`.
