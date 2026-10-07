# Báo cáo Nghiệm thu Giao diện UI-1k-a (Interface Acceptance Audit)

> **Checkpoint**: UI-1k-a  
> **Tài liệu đối chiếu**: [docs/ui-redesign/README.md](file:///D:/Developing/DuAnCNTT/docs/ui-redesign/README.md) (Mục 5: Tiêu chí Nghiệm thu AC-1 đến AC-5)  
> **Môi trường thẩm định**: Electron runtime thực tế (v35 / Chromium / Node 22), Windows  
> **Độ phân giải kiểm thử**: 1280×800 và 1366×768 (cả Dark Theme và Light Theme)  
> **Nguyên tắc checkpoint**: Chỉ kiểm tra & lập biên bản nghiệm thu; **không sửa mã nguồn** trong checkpoint này.

---

## 1. Tổng quan Kết quả Nghiệm thu (Executive Summary)

| Nhóm tiêu chí | Nội dung tiêu chí | Đánh giá tổng hợp | Số lượng PASS | Số lượng GAP | Số lượng NOT_RUN |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **AC-1** | Khung vỏ Desktop Shell & Titlebar | **PASS** | 3 / 3 | 0 | 0 |
| **AC-2** | Hệ thống Điều hướng 5 mục & Nút Action Deploy | **GAP (P1)** | 2 / 3 | 1 | 0 |
| **AC-3** | Bố cục Tab ngang tại các trang chi tiết | **PASS** | 4 / 4 | 0 | 0 |
| **AC-4** | Nhãn trạng thái trung thực (Honest Status Model) | **PASS (với P3 Minor)** | 3 / 3 | 1 (Minor) | 0 |
| **AC-5** | Tương tác Tìm kiếm & Bộ lọc kết hợp | **PASS** | 2 / 2 | 0 | 0 |
| **TỔNG CỘNG** | **14 tiêu chí thành phần** | **12 PASS / 2 GAP** | **12** | **2** | **0** |

---

## 2. Bảng Đánh giá Chi tiết từng Tiêu chí (AC-1 → AC-5)

### AC-1: Khung vỏ Desktop Shell & Titlebar

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận runtime |
| :--- | :--- | :---: | :--- |
| **AC-1.1** | **Sidebar đơn nhất**:<br>• Duy nhất một thanh sidebar bên trái rộng cố định 230px.<br>• Tuyệt đối không có sub-sidebar lồng bên trong trang Apps hoặc VPS. | **PASS** | • Class `.app-sidebar` có chiều rộng cố định `width: 230px` (xác nhận qua computed styles trong DOM Electron).<br>• `subSidebarsCount = 0`: Các component sidebar con cũ (`apps-sidebar`, `VpsNavSidebar`, `VpsInfoSidebar`) đã bị loại bỏ hoàn toàn khỏi cây DOM.<br>• Xác nhận qua `App.test.tsx` và audit DOM tự động. |
| **AC-1.2** | **Native Titlebar Overlay**:<br>• Giữ nguyên cấu hình `titlebarOverlay: true` của Electron BrowserWindow.<br>• Không vẽ nút cửa sổ giả bằng HTML/CSS.<br>• Titlebar là drag-region, hiển thị brand "OpsPilot" và context breadcrumb ngắn gọn. | **PASS** | • BrowserWindow khởi tạo với `titleBarStyle: 'hidden'`, `titleBarOverlay: true`. Kênh `window:set-titlebar-overlay` cập nhật màu sắc động theo Dark/Light theme.<br>• Đếm số nút giả (`fakeControlsCount = 0`): Không render bất kỳ nút min/max/close giả nào trong renderer HTML/CSS.<br>• Phần tử `.app-titlebar` mang CSS `-webkit-app-region: drag`, chứa logo và brand text "OpsPilot" kèm breadcrumb trang. |
| **AC-1.3** | **Độ phân giải & Bố cục**:<br>• Không tràn viền, không xuất hiện thanh cuộn ngang ngoài ý muốn ở 1280×800 và 1366×768 (Dark/Light). | **PASS** | • Đo đạc DOM thực tế trên Electron tại 1280×800:<br>  - `document.documentElement.scrollWidth = 1280`, `clientWidth = 1280` (`hasDocScroll = false`).<br>  - Vùng nội dung `.app-main`: `scrollWidth = 1050`, `clientWidth = 1050` (`hasContentScroll = false`).<br>• Đo đạc DOM thực tế trên Electron tại 1366×768:<br>  - `document.documentElement.scrollWidth = 1366`, `clientWidth = 1366` (`hasDocScroll = false`).<br>  - Vùng nội dung `.app-main`: `scrollWidth = 1136`, `clientWidth = 1136` (`hasContentScroll = false`).<br>• Kiểm tra trên tất cả 6 màn hình chính: `Dashboard`, `Apps`, `VPS`, `Activity`, `Settings`, `Deploy` không có trang nào bị tràn hoặc cuộn ngang. |

---

### AC-2: Hệ thống Điều hướng 5 mục & Nút Action Deploy

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận runtime |
| :--- | :--- | :---: | :--- |
| **AC-2.1** | **5 mục điều hướng**:<br>• Sidebar chứa đúng 5 mục: Tổng quan, Ứng dụng, Máy chủ, Hoạt động, Cài đặt.<br>• Thứ tự hiển thị: Ứng dụng đặt trước Máy chủ. | **PASS** | • Danh sách mục `.app-sidebar-item`: `['Tổng quan', 'Ứng dụng', 'Máy chủ', 'Hoạt động', 'Cài đặt']` (tương ứng keys: `dashboard`, `apps`, `vps`, `activity`, `settings`).<br>• Mục `apps` (Ứng dụng) nằm ngay trước `vps` (Máy chủ).<br>• Kiểm thử đa ngôn ngữ thành công ở cả 4 thứ tiếng (EN, VI, CN, JP) trong `App.test.tsx`. |
| **AC-2.2** | **Nút Action Deploy**:<br>• Nút "Triển khai" có icon `+` (PlusOutlined, không lặp dấu cộng) nổi bật trên sidebar.<br>• Khi bấm, điều hướng sang `DeployPage` hiện có (`setActivePage('deploy')`) và truyền preselect (`appId`, `vpsId`) nếu đang ở ngữ cảnh app/VPS.<br>• Không tạo modal deploy mới.<br>• Lối vào MigratePage nằm tại nút hành động trên trang Máy chủ. | **GAP**<br>*(Lỗi P1)* | • **Điểm đạt**: Nút `.app-sidebar-deploy-btn` hiển thị đúng icon `+`, nhãn "Triển khai", không có dấu cộng lặp. Bấm nút chuyển sang `DeployPage` thật, không mở modal giả. Nút "Di chuyển" (Migrate) nằm đúng vị trí trong header trang Máy chủ (`VpsPage`). Các nút Action nội bộ trang ("Triển khai phiên bản mới" trong `AppsPage`, "Deploy new app" trong `VpsPage`, nút "Deploy" trong `VpsAppsTab`) đều truyền preselect thành công.<br>• **Ghi nhận GAP (GAP-1)**: Nút toàn cục `+ Triển khai` trên sidebar (`App.tsx` dòng 87–95) chỉ gọi `setActivePage('deploy')` mà **không đọc `selectedAppId` hay `selectedVpsId` từ session store để truyền `deployPreselect`**. Khi người dùng đang xem chi tiết app hoặc VPS mà bấm nút này ở sidebar, ngữ cảnh bị mất và `DeployPage` mở ở trạng thái tạo ứng dụng mới chưa chọn máy chủ. |
| **AC-2.3** | **Loại bỏ dead menus**:<br>• Không giữ lại menu nào chỉ hiển thị `alert()` hoặc trang trống. | **PASS** | • Không có route hoặc button nào kích hoạt `alert()`, `confirm()` rỗng hay trang trắng.<br>• Chức năng Doctor được nhúng trực tiếp vào tab `Bác sĩ & Exposure` trong `AppsPage` và màn cứu hộ deploy trong `DeployPage`, không tách thành menu riêng chết. |

---

### AC-3: Bố cục Tab ngang tại các trang chi tiết

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận runtime |
| :--- | :--- | :---: | :--- |
| **AC-3.1** | **Chi tiết Ứng dụng - Đúng 3 tab**:<br>1. *Tổng quan*: Thông tin cấu hình (`app:get`), runtime (`app:runtime-inspect`), metrics, cổng, link VPS.<br>2. *Lịch sử & Rollback*: Bảng deployment (`app:versions`), nút Rollback an toàn (`app:rollback`).<br>3. *Bác sĩ & Exposure*: Chẩn đoán mạng, domain (`doctor:diagnose`, `domain:check`). | **PASS** | • Số lượng tab trong `.apps-tabs`: Đúng 3 tab ngang.<br>  - Tab 1: `overview` ("Tổng quan") hiển thị đầy đủ cấu hình runtime, port mapping, VPS host, metrics.<br>  - Tab 2: `history` ("Lịch sử & Rollback") hiển thị lịch sử phiên bản và modal xác nhận rollback với validation gõ tên app.<br>  - Tab 3: `doctor` ("Bác sĩ & Exposure") hiển thị chẩn đoán, domain check và nút Safe auto-fix.<br>• Kiểm thử suite `AppsPage.test.tsx` đạt 16/16 tests. |
| **AC-3.2** | **Chi tiết Máy chủ VPS - Đúng 4 tab**:<br>1. *Tổng quan & Tài nguyên*: CPU/RAM/Disk từ `vps:get-resources`, quét công cụ từ `vps:scan(vpsId)`.<br>2. *Ứng dụng trên máy chủ*: Bảng app từ `app:list(vpsId)` kèm link sang app.<br>3. *Cơ sở dữ liệu*: Danh sách DB từ `db:list-databases(vpsId)`.<br>4. *Hoạt động*: Lịch sử deployment từ SQLite. | **PASS** | • Số lượng tab trong `VpsDetail`: Đúng 4 tab ngang.<br>  - Tab 1: `overview` ("Tổng quan & Tài nguyên") hiển thị các đồng hồ tài nguyên và nút "Scan again" gọi `vps:scan(vpsId)`.<br>  - Tab 2: `apps` ("Ứng dụng trên máy chủ") kèm badge số lượng app, hiển thị bảng và nút Deploy/Chi tiết.<br>  - Tab 3: `database` ("Cơ sở dữ liệu") hiển thị bảng database và tài khoản người dùng.<br>  - Tab 4: `activity` ("Hoạt động") hiển thị lịch sử deployment lọc theo VPS.<br>• Kiểm thử thực tế trên Electron (`test-vps-click.js`) trả về đúng mảng: `['Tổng quan & Tài nguyên', 'Ứng dụng trên máy chủ (2)', 'Cơ sở dữ liệu', 'Hoạt động']`. |
| **AC-3.3** | **Loại bỏ triệt để Sub-sidebars**:<br>• Xóa bỏ `apps-sidebar` trong trang Ứng dụng.<br>• Xóa bỏ `VpsNavSidebar` và `VpsInfoSidebar` trong trang Chi tiết VPS. | **PASS** | • Đã xóa hoàn toàn các layout lồng thanh bên.<br>• Cả `AppsPage` và `VpsPage` đều chuyển hoàn toàn sang kiến trúc 2 màn: Bảng danh sách toàn chiều rộng (List view) → Bấm vào hàng/nút để chuyển sang trang chi tiết toàn chiều rộng (Detail view) có thanh điều hướng quay lại (`ArrowLeftOutlined`). |
| **AC-3.4** | **Backlog rõ ràng**:<br>• Env editor, Live logs streaming, Docker prune, Host-key verification được giữ ở backlog backend.<br>• Không tạo tab giả hay dữ liệu mẫu trong UI-1. | **PASS** | • Mã nguồn không có tab giả hay mockups cho các tính năng chưa có IPC backend (không có `app:get-env`, `docker logs -f`, `docker system prune`, `trusted_fingerprint`).<br>• Tất cả tab hiện hữu đều gắn kết chặt chẽ với IPC backend đã triển khai. |

---

### AC-4: Nhãn trạng thái trung thực (Honest Status Model)

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận runtime |
| :--- | :--- | :---: | :--- |
| **AC-4.1** | **Minh bạch IPC & Phân biệt vps:scan vs vps:test-connection**:<br>• VPS đã lưu chỉ quét bằng `vps:scan(vpsId)`.<br>• `vps:test-connection` chỉ dùng cho form thêm/sửa VPS có `VpsInput`. | **PASS** | • Log IPC trong runtime Electron: Khi nhấn quét trên trang chi tiết VPS, renderer gọi đúng channel `vps:scan` với tham số `[vpsId]`. Kênh `vps:test-connection` hoàn toàn không bị gọi trên màn hình tổng quan mà chỉ xuất hiện trong `VpsFormModal` khi test thông tin nhập mới.<br>• Xác nhận trong `VpsPage.test.tsx` và `audit-preload-ui1k.js`. |
| **AC-4.2** | **Nhãn thời gian last_seen_at**:<br>• Máy chủ có `last_seen_at` ≤ 24h hiển thị: "Vừa kiểm tra" / "Đã kiểm tra gần đây".<br>• Máy chủ có `last_seen_at` > 24h hiển thị nhãn màu vàng: "Chưa kiểm tra gần đây".<br>• Mốc 24h chỉ là quy tắc hiển thị độ tươi dữ liệu, không phải chứng nhận an toàn. | **PASS**<br>*(Kèm lỗi P3)* | • Đánh giá logic qua hàm `evaluateVpsStatus` và `ServerSelector`:<br>  - Probed thành công trong phiên: Tag `success` ("Vừa kiểm tra"), TTL 60s.<br>  - DB record ≤ 24h: Tag `default` ("Đã kiểm tra gần đây").<br>  - DB record > 24h: Tag `warning` màu vàng ("Chưa kiểm tra gần đây").<br>  - Probed lỗi SSH: Tag `error` màu đỏ ("Không thể kiểm tra").<br>  - Chưa rõ: Tag `default` ("Chưa rõ").<br>• **Ghi nhận lỗi bản địa hóa (GAP-2 / P3)**: Trong tiếng Việt, nút quay lại của trang chi tiết VPS hiển thị tooltip/aria-label `"Back to VPS list"` do thiếu trường `backToList` trong `VI_OVERRIDES.vps` của `strings.ts`. |
| **AC-4.3** | **Không gọi "Đã xác minh" về host key**:<br>• Không dùng từ "Đã xác minh" (Verified) khi chưa có kênh tin cậy đối chiếu fingerprint.<br>• Máy chủ mất kết nối/timeout hiển thị màu đỏ "Không thể kiểm tra" hoặc "Mất kết nối". | **PASS** | • Kiểm tra toàn bộ text render trên trang chi tiết VPS và bảng danh sách: Tuyệt đối không xuất hiện cụm từ "Đã xác minh host key" hay "Verified".<br>• Máy chủ lỗi kết nối hiển thị rõ ràng nhãn lỗi "Không thể kiểm tra" / "Mất kết nối". |

---

### AC-5: Tương tác Tìm kiếm & Bộ lọc kết hợp

| Mã AC | Tiêu chí chi tiết | Kết quả | Bằng chứng kiểm thử & Ghi nhận runtime |
| :--- | :--- | :---: | :--- |
| **AC-5.1** | **Combined Filter (AND logic)**:<br>• Ô tìm kiếm văn bản và dropdown lọc theo VPS hoạt động kết hợp đồng thời.<br>• Cập nhật danh sách và bộ đếm kết quả tức thì. | **PASS** | • Thử nghiệm trực tiếp trên Electron runtime (`test-apps-table.js`):<br>  1. Trạng thái ban đầu: 3/3 apps, bộ đếm: `"Hiển thị 3 / 3 ứng dụng"`.<br>  2. Tìm kiếm `express`: Lọc ra 1 hàng (`express-api`), bộ đếm: `"Hiển thị 1 / 3 ứng dụng"`.<br>  3. Xóa tìm kiếm, chọn VPS `VM02-Staging`: Lọc ra 1 hàng (`next-blog`), bộ đếm: `"Hiển thị 1 / 3 ứng dụng"`.<br>  4. Kết hợp tìm `express` VÀ chọn VPS `VM02-Staging`: Lọc ra 0 hàng, bộ đếm: `"Hiển thị 0 / 3 ứng dụng"`.<br>• Cả bộ đếm và bảng dữ liệu phản hồi tức thì theo logic `AND`. |
| **AC-5.2** | **Nội dung chi tiết đồng bộ đối tượng**:<br>• Bấm vào bất kỳ ứng dụng hoặc máy chủ nào, trang chi tiết hiển thị đúng toàn bộ thông số, cấu hình cổng và danh sách triển khai của đối tượng đó. | **PASS** | • Khi bấm vào app `express-api` (id 1): Trang chi tiết hiển thị chính xác tên `express-api`, cổng `:30001`, VPS kết nối `VM01-Prod (221.121.1.79)`, framework `express`, danh sách deployment #101 và #100.<br>• Khi bấm vào VPS `VM01-Prod` (id 1): Trang chi tiết hiển thị chính xác IP `221.121.1.79:22`, CPU 2 cores, RAM 1.2 GB / 4.0 GB, Disk 15 GB / 40 GB, cùng 2 ứng dụng gắn kèm (`express-api`, `vite-dashboard`). |

---

## 3. Danh sách Khiếm khuyết Ưu tiên (Prioritized Defect Backlog)

Dưới đây là danh sách khiếm khuyết được phát hiện trong quá trình nghiệm thu UI-1k-a, phân loại theo độ ưu tiên:

### [P1] GAP-1: Nút Action Deploy trên Sidebar toàn cục không mang ngữ cảnh preselect (AC-2.2)
- **Vị trí**: [app/src/renderer/src/App.tsx](file:///D:/Developing/DuAnCNTT/app/src/renderer/src/App.tsx#L87-L95)
- **Mô tả hiện tượng**:
  Khi người dùng đang ở ngữ cảnh một ứng dụng cụ thể (ví dụ đang xem chi tiết `express-api` trên `VM01-Prod`) hoặc một máy chủ cụ thể (đang xem chi tiết `VM01-Prod`), nếu người dùng bấm nút `+ Triển khai` (`.app-sidebar-deploy-btn`) ở sidebar bên trái, ứng dụng chỉ thực hiện:
  ```tsx
  onClick={() => setActivePage('deploy')}
  ```
  mà không đọc `selectedAppId` hoặc `selectedVpsId` từ `useAppSessionStore` để thiết lập `setDeployPreselect(...)`.
- **Hệ quả**:
  Màn `DeployPage` mở ra ở trạng thái mặc định (mode "Tạo ứng dụng mới", dropdown VPS và App đều trống), làm mất ngữ cảnh công việc hiện tại của người dùng. Trong khi đó, các nút bấm Deploy nội bộ trong `AppsPage` và `VpsPage` vẫn truyền preselect bình thường.
- **Yêu cầu đối chiếu**:
  AC-2.2 ghi rõ: *"Khi bấm, điều hướng sang màn DeployPage hiện có (gọi setActivePage('deploy')) và truyền preselect (appId, vpsId) nếu đang ở ngữ cảnh ứng dụng hoặc máy chủ"*.
- **Giải pháp đề xuất (cho checkpoint sửa chữa kế tiếp)**:
  Trong `App.tsx`, khi xử lý sự kiện click của `.app-sidebar-deploy-btn`:
  1. Kiểm tra nếu `selectedAppId` đang có giá trị: tìm `app` tương ứng để lấy `appId` và `vpsId`, gọi `setDeployPreselect({ appId, vpsId })`.
  2. Nếu không có `selectedAppId` nhưng có `selectedVpsId`: gọi `setDeployPreselect({ vpsId: selectedVpsId })`.
  3. Sau đó mới gọi `setActivePage('deploy')`.

---

### [P3] GAP-2: Thiếu nhãn tiếng Việt cho nút quay lại danh sách VPS (AC-4.2 / Bản địa hóa)
- **Vị trí**: [app/src/renderer/src/strings.ts](file:///D:/Developing/DuAnCNTT/app/src/renderer/src/strings.ts#L973-L985) và [app/src/renderer/src/pages/VpsPage.tsx](file:///D:/Developing/DuAnCNTT/app/src/renderer/src/pages/VpsPage.tsx#L267-L274)
- **Mô tả hiện tượng**:
  Trong `VpsPage.tsx`, nút quay lại có thuộc tính:
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
  Tuy nhiên, trong `VI_OVERRIDES.vps` của `strings.ts`, thuộc tính `backToList` chưa được khai báo ghi đè, khiến giá trị mặc định bằng tiếng Anh từ `BASE_EN_STRINGS.vps.backToList` (`"Back to VPS list"`) hiển thị trên giao diện tiếng Việt. Trong khi đó ở `AppsPage`, nhãn này được ghi là `"Quay lại danh sách ứng dụng"`.
- **Hệ quả**:
  Trải nghiệm bản địa hóa tiếng Việt bị lẫn chuỗi tiếng Anh ("Back to VPS list") trong tooltip và nhãn hỗ trợ tiếp cận (aria-label).
- **Giải pháp đề xuất (cho checkpoint sửa chữa kế tiếp)**:
  Bổ sung `backToList: 'Quay lại danh sách máy chủ'` vào `VI_OVERRIDES.vps` (và bổ sung tương ứng cho CN, JP nếu thiếu) trong `strings.ts`.

---

## 4. Kết luận Nghiệm thu (Acceptance Sign-off)

1. **Về Khung vỏ & Bố cục (AC-1, AC-3)**: Toàn bộ shell 230px, Titlebar Overlay native, bố cục tab ngang và loại bỏ sub-sidebar đều đạt 100% tiêu chí đề ra. Ứng dụng đáp ứng tốt ở cả hai độ phân giải 1280×800 và 1366×768, không có hiện tượng cuộn ngang ngoài ý muốn.
2. **Về Tính trung thực dữ liệu & Tương tác (AC-4, AC-5)**: Hệ thống nhãn trạng thái trung thực phân biệt rõ giữa kiểm tra tức thời trong phiên và dữ liệu lịch sử quá khứ; không có tuyên bố sai lệch về xác minh host key. Bộ lọc kết hợp AND và tính đồng bộ dữ liệu chi tiết hoạt động chính xác.
3. **Về Khiếm khuyết cần khắc phục**: Cần đưa **GAP-1 (P1)** và **GAP-2 (P3)** vào nhiệm vụ tiếp theo để hoàn thiện triệt để luồng điều hướng deploy và trải nghiệm bản địa hóa.
