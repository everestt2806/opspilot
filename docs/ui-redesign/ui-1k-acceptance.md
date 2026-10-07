# Báo cáo Nghiệm thu Giao diện UI-1k-a (Interface Acceptance Audit)

> **Checkpoint**: UI-1k-a (Đã cập nhật nghiệm thu sửa chữa UI-1k-b)<br>
> **Tài liệu đối chiếu**: [README.md](./README.md) (Mục 5: Tiêu chí Nghiệm thu AC-1 đến AC-5)<br>
> **Môi trường thẩm định**: Electron runtime thực tế (v35 / Chromium / Node 22), Windows<br>
> **Độ phân giải kiểm thử**: 1280×800 và 1366×768 (cả Dark Theme và Light Theme)<br>
> **Nguyên tắc checkpoint**: Cập nhật biên bản sau khi hoàn thiện khắc phục UI-1k-b.<br>
> **Giới hạn môi trường**: Toàn bộ kiểm thử và kiểm tra giao diện chạy trong môi trường cục bộ sử dụng dữ liệu giả lập (fixtures/mocks theo hợp đồng IPC) hoặc SQLite cục bộ; **không sử dụng VPS thật** để kết nối SSH đường dài trong checkpoint này.

---

## 1. Tổng quan Kết quả Nghiệm thu (Executive Summary)

Đếm chi tiết đầy đủ **15 tiêu chí nghiệm thu (AC)** theo đúng Mục 5 của [README.md](./README.md):

| Nhóm tiêu chí | Nội dung tiêu chí | Đánh giá tổng hợp | Số lượng PASS | Số lượng GAP | Số lượng NOT_RUN |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **AC-1** | Khung vỏ Desktop Shell & Titlebar (AC-1.1 → AC-1.3) | **PASS** | 3 / 3 | 0 | 0 |
| **AC-2** | Hệ thống Điều hướng 5 mục & Nút Action Deploy (AC-2.1 → AC-2.3) | **PASS** | 3 / 3 | 0 | 0 |
| **AC-3** | Bố cục Tab ngang tại các trang chi tiết (AC-3.1 → AC-3.4) | **GAP (P2)** | 3 / 4 | 1 | 0 |
| **AC-4** | Nhãn trạng thái trung thực (Honest Status Model) (AC-4.1 → AC-4.3) | **PASS** | 3 / 3 | 0 | 0 |
| **AC-5** | Tương tác Tìm kiếm & Bộ lọc kết hợp (AC-5.1 → AC-5.2) | **PASS** | 2 / 2 | 0 | 0 |
| **TỔNG CỘNG** | **15 tiêu chí thành phần độc lập** | **14 PASS / 1 GAP** | **14** | **1** | **0** |

*Ghi chú cập nhật UI-1k-b*:
- Tiêu chí **AC-2.2** được chuyển từ GAP sang **PASS** sau khi hoàn thành sửa đổi nút `+ Triển khai` trong [../../app/src/renderer/src/App.tsx](../../app/src/renderer/src/App.tsx) để truyền đúng ngữ cảnh trang đang mở ({appId, vpsId} hoặc {vpsId}), xóa preselect cũ khi ở màn danh sách, chặn kết quả `app:get` đến muộn và có đầy đủ bằng chứng test tự động đạt 100% trong [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx).
- Khiếm khuyết bản địa hóa [P3] (`backToList` trên 3 ngôn ngữ VI/CN/JP) đã được bổ sung đầy đủ trong [../../app/src/renderer/src/strings.ts](../../app/src/renderer/src/strings.ts) và xác nhận qua test suite.
- Tiêu chí **AC-3.2** tiếp tục được giữ nguyên trạng thái **GAP** do tab Cơ sở dữ liệu trong thực tế hiển thị thông báo "Chưa hỗ trợ cơ sở dữ liệu" và tiến trình chính backend chưa triển khai các kênh IPC `db:*`.

---

## 2. Bảng Đánh giá Chi tiết 15 Tiêu chí Nghiệm thu (AC-1 → AC-5)

### AC-1: Khung vỏ Desktop Shell & Titlebar (3 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-1.1** | **Sidebar đơn nhất**:<br>• Duy nhất một thanh sidebar bên trái rộng cố định 230px.<br>• Tuyệt đối không có sub-sidebar lồng bên trong trang Apps hoặc VPS. | **PASS** | • Chiều rộng cố định: Class `.app-sidebar` trong [../../app/src/renderer/src/assets/main.css](../../app/src/renderer/src/assets/main.css) được định nghĩa `width: 230px`.<br>• Loại bỏ sub-sidebar: Mã nguồn của [../../app/src/renderer/src/pages/AppsPage.tsx](../../app/src/renderer/src/pages/AppsPage.tsx) và [../../app/src/renderer/src/pages/VpsPage.tsx](../../app/src/renderer/src/pages/VpsPage.tsx) đã xóa hoàn toàn các component sidebar lồng (`apps-sidebar`, `VpsNavSidebar`, `VpsInfoSidebar`).<br>• Ảnh chụp đã commit: [screenshots/ui-1a/](screenshots/ui-1a/) ghi nhận cấu trúc sidebar đơn nhất.<br>• Test đã commit: [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx) xác nhận hiển thị đúng 5 mục điều hướng chính trên thanh sidebar đơn. |
| **AC-1.2** | **Native Titlebar Overlay**:<br>• Giữ nguyên cấu hình `titlebarOverlay: true` của Electron BrowserWindow.<br>• Không vẽ nút cửa sổ giả bằng HTML/CSS.<br>• Titlebar là drag-region, hiển thị brand "OpsPilot" và context breadcrumb ngắn gọn. | **PASS** | • Cấu hình BrowserWindow: [../../app/src/main/index.ts](../../app/src/main/index.ts) khởi tạo với `titleBarStyle: 'hidden'`, `titleBarOverlay: true`. Kênh IPC `window:set-titlebar-overlay` đồng bộ màu động theo Dark/Light theme.<br>• Không vẽ nút giả: Không có nút min/max/close giả nào được render trong DOM renderer.<br>• Drag region: Phần tử `.app-titlebar` có CSS `-webkit-app-region: drag`, chứa brand "OpsPilot" và breadcrumb theo trang.<br>• Ảnh chụp đã commit: Xem bộ ảnh titlebar trong [screenshots/ui-1a/](screenshots/ui-1a/). |
| **AC-1.3** | **Độ phân giải & Bố cục**:<br>• Không tràn viền, không xuất hiện thanh cuộn ngang ngoài ý muốn ở 1280×800 và 1366×768 (Dark/Light). | **PASS** | • Xác nhận qua bộ ảnh chụp Electron thực tế đã commit ở cả 2 độ phân giải (1280×800 và 1366×768) trên Dark/Light theme:<br>  - Shell & Trang chủ: [screenshots/ui-1a/](screenshots/ui-1a/)<br>  - Danh sách máy chủ: [screenshots/ui-1b/](screenshots/ui-1b/)<br>  - Danh sách & Chi tiết ứng dụng: [screenshots/ui-1c/](screenshots/ui-1c/)<br>  - Chi tiết máy chủ: [screenshots/ui-1d/](screenshots/ui-1d/)<br>  - Lịch sử triển khai & Rollback: [screenshots/ui-1e/](screenshots/ui-1e/)<br>  - Deploy wizard & Terminal: [screenshots/ui-1f/](screenshots/ui-1f/), [screenshots/ui-1g/](screenshots/ui-1g/), [screenshots/ui-1h/](screenshots/ui-1h/)<br>  - Cài đặt: [screenshots/ui-1i/](screenshots/ui-1i/)<br>  - Di chuyển (Migrate): [screenshots/ui-1j-b/](screenshots/ui-1j-b/)<br>• Không có trang nào phát sinh thanh cuộn ngang ngoài ý muốn. |

---

### AC-2: Hệ thống Điều hướng 5 mục & Nút Action Deploy (3 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-2.1** | **5 mục điều hướng**:<br>• Sidebar chứa đúng 5 mục: Tổng quan, Ứng dụng, Máy chủ, Hoạt động, Cài đặt.<br>• Thứ tự hiển thị: Ứng dụng đặt trước Máy chủ. | **PASS** | • Danh sách mục `.app-sidebar-item` được cấu hình theo thứ tự: `dashboard` (Tổng quan) → `apps` (Ứng dụng) → `vps` (Máy chủ) → `activity` (Hoạt động) → `settings` (Cài đặt).<br>• Mục `apps` đặt trước `vps`.<br>• Test đã commit: [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx) kiểm tra nhãn hiển thị và thứ tự đạt 100% trên cả 4 ngôn ngữ (EN, VI, CN, JP). |
| **AC-2.2** | **Nút Action Deploy**:<br>• Nút "Triển khai" có icon `+` (PlusOutlined, không lặp dấu cộng) nổi bật trên sidebar.<br>• Khi bấm, điều hướng sang `DeployPage` hiện có (`setActivePage('deploy')`) và truyền preselect (`appId`, `vpsId`) nếu đang ở ngữ cảnh app/VPS.<br>• Không tạo modal deploy mới.<br>• Lối vào MigratePage nằm tại nút hành động trên trang Máy chủ. | **PASS** | • Nút `.app-sidebar-deploy-btn` hiển thị icon `+`, nhãn "Triển khai", không trùng dấu cộng. Bấm nút chuyển sang `DeployPage` thật, không sinh modal mới.<br>• Lối vào Migrate nằm ở nút "Di chuyển" trên trang Máy chủ ([../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx)).<br>• **Đã hoàn thiện trong UI-1k-b**: Nút `+ Triển khai` trên sidebar ([../../app/src/renderer/src/App.tsx](../../app/src/renderer/src/App.tsx)) đã được nâng cấp logic ngữ cảnh chặt chẽ:<br>  - Xem chi tiết app: gọi `app:get` xác thực `vps_id` hợp lệ và truyền `{ appId, vpsId }`.<br>  - Xem chi tiết VPS: truyền `{ vpsId }`.<br>  - Trang khác hoặc màn danh sách: xóa preselect cũ (`null`) và mở Deploy mặc định.<br>  - Cơ chế hủy yêu cầu đang chờ: Vô hiệu hóa ngay lập tức yêu cầu `app:get` khi trang hoặc app được chọn thay đổi (kể cả khi đổi đi rồi quay lại cùng giá trị), đồng thời mỗi lần bấm Deploy mới đều hủy ý định cũ.<br>  - Xử lý lỗi an toàn: Nếu `app:get` gặp lỗi IPC, trả về sai ID, hoặc không có `vps_id` hợp lệ, hệ thống giữ người dùng ở trang hiện tại và hiển thị thông báo lỗi rõ ràng; tuyệt đối không âm thầm mở form tạo app mới.<br>• **Bằng chứng test đã pass**: Suite [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx) với app fixture thực sự hiển thị chi tiết (rời trang rồi quay lại cùng app, đổi app rồi quay lại, bấm Deploy lần hai, phản hồi sai ID, lỗi IPC, thiếu `vps_id`) đạt 100% PASS (17/17 tests). |
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
| **AC-4.2** | **Nhãn thời gian last_seen_at**:<br>• Máy chủ có `last_seen_at` ≤ 24h hiển thị: "Vừa kiểm tra" / "Đã kiểm tra gần đây".<br>• Máy chủ có `last_seen_at` > 24h hiển thị nhãn màu vàng: "Chưa kiểm tra gần đây".<br>• Mốc 24h chỉ là quy tắc hiển thị độ tươi dữ liệu, không phải chứng nhận an toàn. | **PASS** | • Logic tính toán nhãn trạng thái trung thực được đóng gói trong hàm `evaluateVpsStatus` tại [../../app/src/renderer/src/vpsResources.ts](../../app/src/renderer/src/vpsResources.ts):<br>  - Đọc thành công trong phiên: Tag `success` ("Vừa kiểm tra"), có thời hạn TTL 60s.<br>  - Bản ghi DB ≤ 24h: Tag `default` ("Đã kiểm tra gần đây").<br>  - Bản ghi DB > 24h: Tag `warning` màu vàng ("Chưa kiểm tra gần đây").<br>  - Thất bại hoặc timeout: Tag `error` màu đỏ ("Không thể kiểm tra").<br>• Test đã commit: [../../app/src/renderer/src/components/ServerSelector.test.tsx](../../app/src/renderer/src/components/ServerSelector.test.tsx) và [../../app/src/renderer/src/pages/VpsPage.test.tsx](../../app/src/renderer/src/pages/VpsPage.test.tsx).<br>*(Lưu ý: Lỗi thiếu bản dịch `backToList` trên trang VPS đã được khắc phục hoàn toàn trong UI-1k-b)*. |
| **AC-4.3** | **Không gọi "Đã xác minh" về host key**:<br>• Không dùng từ "Đã xác minh" (Verified) khi chưa có kênh tin cậy đối chiếu fingerprint.<br>• Máy chủ mất kết nối/timeout hiển thị màu đỏ "Không thể kiểm tra" hoặc "Mất kết nối". | **PASS** | • Kiểm tra toàn bộ chuỗi ký tự trong [../../app/src/renderer/src/strings.ts](../../app/src/renderer/src/strings.ts) và các component hiển thị máy chủ: Tuyệt đối không sử dụng các từ "Đã xác minh" hoặc "Verified" cho host key.<br>• Máy chủ không kết nối được hoặc timeout hiển thị chính xác nhãn lỗi màu đỏ "Không thể kiểm tra" / "Mất kết nối". |

---

### AC-5: Tương tác Tìm kiếm & Bộ lọc kết hợp (2 tiêu chí)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận thực tế |
| :--- | :--- | :---: | :--- |
| **AC-5.1** | **Combined Filter (AND logic)**:<br>• Ô tìm kiếm văn bản và dropdown lọc theo VPS hoạt động kết hợp đồng thời.<br>• Cập nhật danh sách và bộ đếm kết quả tức thì. | **PASS** | • Cơ chế lọc kết hợp: [../../app/src/renderer/src/pages/AppsPage.tsx](../../app/src/renderer/src/pages/AppsPage.tsx) áp dụng đồng thời cả điều kiện tìm kiếm chuỗi ký tự và bộ lọc VPS theo logic `AND`. Bộ đếm kết quả cập nhật ngay lập tức dạng "Hiển thị X / Y ứng dụng".<br>• Test đã commit: [../../app/src/renderer/src/pages/AppsPage.test.tsx](../../app/src/renderer/src/pages/AppsPage.test.tsx) kiểm chứng: *"tải danh sách app từ app:list, lọc kết hợp tìm kiếm và chọn VPS đồng thời (AND logic)"*.<br>• Ảnh chụp đã commit: [screenshots/ui-1c/](screenshots/ui-1c/). |
| **AC-5.2** | **Nội dung chi tiết đồng bộ đối tượng**:<br>• Bấm vào bất kỳ ứng dụng hoặc máy chủ nào, trang chi tiết hiển thị đúng toàn bộ thông số, cấu hình cổng và danh sách triển khai của đối tượng đó. | **PASS** | • Đồng bộ đối tượng: Khi người dùng chọn một ứng dụng hoặc máy chủ cụ thể, toàn bộ dữ liệu chi tiết (tên, cổng, VPS liên kết, framework, các bản ghi deployment) đều tải đúng theo định danh đối tượng được chọn.<br>• Test đã commit: [../../app/src/renderer/src/pages/AppsPage.test.tsx](../../app/src/renderer/src/pages/AppsPage.test.tsx) và [../../app/src/renderer/src/pages/VpsPage.test.tsx](../../app/src/renderer/src/pages/VpsPage.test.tsx).<br>• *Lưu ý giới hạn kiểm chứng*: Tương tác đã được thẩm định trực tiếp trong phiên Electron của đợt audit này; do không có môi trường VPS thật, các thông số tài nguyên và danh sách app phụ thuộc vào fixture IPC và database cục bộ SQLite. |

---

## 3. Danh sách Khiếm khuyết & Tiến độ Khắc phục (Defect Backlog)

### [P1] GAP-1: Nút Action Deploy trên Sidebar toàn cục không mang ngữ cảnh trang đang mở (AC-2.2) — [ĐÃ KHẮC PHỤC TRONG UI-1k-b]
- **Vị trí**: [../../app/src/renderer/src/App.tsx](../../app/src/renderer/src/App.tsx#L87-L185)
- **Tình trạng**: **ĐÃ GIẢI QUYẾT TRIỆT ĐỂ** trong checkpoint UI-1k-b.
- **Giải pháp đã thực hiện**:
  1. Khi người dùng đang ở trang Ứng dụng (`page === 'apps'`) và đang xem chi tiết app (`selectedAppId !== null`): Lấy thông tin app qua `app:get(selectedAppId)`, xác thực `vps_id` hợp lệ và thiết lập `deployPreselect({ appId, vpsId: app.vps_id })` rồi điều hướng sang `deploy`.
  2. Khi người dùng đang ở trang Máy chủ (`page === 'vps'`) và đang xem chi tiết máy chủ (`selectedVpsId !== null`): Thiết lập `deployPreselect({ vpsId: selectedVpsId })` rồi điều hướng sang `deploy`.
  3. Khi ở các trang khác (`dashboard`, `activity`, `settings`) hoặc màn hình danh sách: Xóa preselect cũ (`deployPreselect = null`) rồi mở DeployPage ở trạng thái tạo mới mặc định.
  4. Cơ chế vô hiệu hóa yêu cầu đang chờ (Anti-race condition): Đăng ký lắng nghe trực tiếp thay đổi trang hoặc app qua Zustand store subscription và effect dependencies, hủy ngay lập tức request token nếu người dùng đổi trang hoặc app (kể cả khi đổi đi rồi quay lại cùng giá trị). Mỗi lần bấm Deploy mới đều hủy ý định cũ.
  5. Xử lý an toàn khi tải app thất bại hoặc dữ liệu không hợp lệ: Nếu `app:get` lỗi, trả về app khác ID, hoặc không có `vps_id` hợp lệ, giữ người dùng ở trang hiện tại và hiển thị thông báo lỗi rõ ràng qua `message.error`; tuyệt đối không âm thầm mở form tạo app mới.
- **Bằng chứng kiểm chứng**: Toàn bộ 10 ca test liên quan đến điều hướng và ngữ cảnh deploy trong [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx) đã chạy PASS 100%.

---

### [P2] GAP-2: Tab Cơ sở dữ liệu trên trang Chi tiết VPS chưa hỗ trợ kết nối IPC backend (AC-3.2) — [GIỮ NGUYÊN GAP]
- **Vị trí**: [../../app/src/renderer/src/components/VpsDetail.tsx](../../app/src/renderer/src/components/VpsDetail.tsx#L103), [../../app/src/renderer/src/components/VpsDatabaseTab.tsx](../../app/src/renderer/src/components/VpsDatabaseTab.tsx), [../../app/src/main/ipc.ts](../../app/src/main/ipc.ts)
- **Tình trạng**: **GIỮ NGUYÊN GAP (Tồn đọng Backend)**.
- **Mô tả hiện tượng**:
  Tiêu chí AC-3.2 yêu cầu Tab 3 (*Cơ sở dữ liệu*) hiển thị *"Danh sách database từ `db:list-databases(vpsId)`"*. Tuy nhiên, trong thực tế:
  1. `VpsDetail.tsx` gọi `<VpsDatabaseTab vpsId={vps.id} />` không truyền `supported`, khiến `supported` mặc định là `false`.
  2. Tab Database hiển thị giao diện trống (`Empty`) với thông báo: *"Chưa hỗ trợ cơ sở dữ liệu - Tính năng quản lý cơ sở dữ liệu trên máy chủ hiện chưa khả dụng trong OpsPilot"*.
  3. Tiến trình chính `app/src/main/ipc.ts` chưa đăng ký bất kỳ handler nào cho tiền tố `db:*` (`db:list-databases`, `db:list-users`, `db:create-user`, `db:create-database`, `db:save-schema`, `db:list-tables`).
- **Hướng xử lý tiếp theo**:
  - Chuyển phần việc này sang backlog backend (khi nào có runner SSH thao tác PostgreSQL trên VPS sẽ đăng ký handler `db:*` tương ứng và bật `supported={true}`).

---

### [P3] Khiếm khuyết Bản địa hóa: Thiếu chuỗi dịch nút quay lại danh sách VPS trên VI / CN / JP — [ĐÃ KHẮC PHỤC TRONG UI-1k-b]
- **Vị trí**: [../../app/src/renderer/src/strings.ts](../../app/src/renderer/src/strings.ts), [../../app/src/renderer/src/pages/VpsPage.tsx](../../app/src/renderer/src/pages/VpsPage.tsx#L267-L274)
- **Tình trạng**: **ĐÃ GIẢI QUYẾT TRIỆT ĐỂ** trong checkpoint UI-1k-b.
- **Giải pháp đã thực hiện**:
  Bổ sung khai báo `backToList` vào các khối ngôn ngữ tương ứng trong [../../app/src/renderer/src/strings.ts](../../app/src/renderer/src/strings.ts):
  - `VI_OVERRIDES.vps`: `backToList: 'Quay lại danh sách máy chủ'`
  - `CN_OVERRIDES.vps`: `backToList: '返回服务器列表'`
  - `JP_OVERRIDES.vps`: `backToList: 'サーバー一覧に戻る'`
- **Bằng chứng kiểm chứng**: Test suite trong [../../app/src/renderer/src/App.test.tsx](../../app/src/renderer/src/App.test.tsx) xác nhận chuỗi dịch hiển thị đúng trên cả 4 ngôn ngữ.

---

## 4. Kết luận Nghiệm thu & Kiến nghị (Acceptance Sign-off)

1. **Kết quả định lượng**: Đạt **14 / 15** tiêu chí nghiệm thu (tỷ lệ 93.3%). 1 tiêu chí GAP còn lại duy nhất là AC-3.2 (Cơ sở dữ liệu - do chờ handler IPC backend).
2. **Khung vỏ & Bố cục**: Thiết kế shell 230px, Titlebar Overlay native và hệ thống tab ngang không sub-sidebars hoạt động ổn định trên cả 2 độ phân giải 1280×800 và 1366×768.
3. **Điều hướng Deploy**: Nút `+ Triển khai` toàn cục đã được hoàn thiện logic ngữ cảnh động theo trang đang mở, có cơ chế bảo vệ race condition và xử lý lỗi an toàn.
4. **Bản địa hóa**: Toàn bộ nhãn hệ thống và nút quay lại đã được bản địa hóa chuẩn xác trên cả 4 ngôn ngữ (VI, EN, CN, JP).
