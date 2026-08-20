# SPEC UI/UX

> Đi kèm [`01-ke-hoach.md`](01-ke-hoach.md). Khi code renderer: dán file này +
> [`prompts/m10-ui.md`](prompts/m10-ui.md) + [`contracts/ipc-contract.ts`](contracts/ipc-contract.ts).
>
> Nguyên tắc gốc (NFR-6): tối giản, đúng chức năng — **nhưng** Dashboard và Deploy Log là 2
> màn hình xuất hiện trong demo bảo vệ nên được đầu tư "trông chuyên nghiệp" có chủ đích.
> Wow đến từ cảm giác "tool thật", không phải từ trang trí.

---

## 1. ĐỊNH HƯỚNG THIẾT KẾ

**Cảm giác cần đạt:** một công cụ vận hành nghiêm túc kiểu Vercel / Railway / Portainer —
tối, gọn, số liệu là nhân vật chính. Không landing page, không gradient, không minh hoạ.

**Chốt công nghệ UI (không bàn lại):**
- **Ant Design v5**, `ConfigProvider` với `theme.darkAlgorithm`. Lý do: có sẵn Steps, Table,
  Form validation, Modal confirm, Notification, Drawer, Tag, Statistic — tiết kiệm ~1 tuần
  so với tự ráp shadcn/Tailwind.
- **Recharts** cho toàn bộ chart. **@xterm/xterm** cho log viewer (render ANSI color của
  `docker build` — log đẹp tự nhiên, không tốn công).
- **Zustand** cho state toàn cục (nhẹ, không boilerplate). Không Redux.
- Layout cố định tối thiểu 1280×800. Không responsive mobile.

**Design token** (khai báo một lần trong `ConfigProvider` + CSS variables trong `tokens.css`):

```
Nền:        bg-base #0F1115   bg-panel #171A21   bg-elevated #1E2230   border #2A2F3A
Chữ:        text-primary #E6E8EE   text-secondary #9AA3B2   text-muted #5C6470
Trạng thái: success #34D399   warning #FBBF24   danger #F87171   info #60A5FA

5 phương pháp phát hiện — MÀU CỐ ĐỊNH TOÀN APP + TOÀN BÁO CÁO:
  rule        #9AA3B2  (xám  — baseline)
  zscore_ewma #60A5FA  (xanh dương)
  iforest     #A78BFA  (tím)
  ocsvm       #F472B6  (hồng)
  ensemble    #34D399  (xanh lá)

Font:   UI = Inter;  số liệu/log/host/path/command = JetBrains Mono (tabular-nums)
Radius 8px · spacing bội số 8 · KHÔNG shadow màu, KHÔNG gradient, KHÔNG animation trang trí
(chỉ transition mặc định của AntD + pulse nhẹ ở dot "live")
```

**Quy tắc màu quan trọng nhất:** mỗi phương pháp có **một màu cố định ở mọi nơi** — chart
trong app, bảng so sánh trong báo cáo, hình matplotlib do `analyze.py` sinh, slide bảo vệ.
Bộ màu này được export thành `experiments/palette.py` để matplotlib dùng đúng mã hex.
Hội đồng nhìn đâu cũng thấy cùng một hệ màu → cảm giác nhất quán rất "wow ngầm".

---

## 2. KHUNG ỨNG DỤNG

```
┌──────┬──────────────────────────────────────────────────────────┐
│ LOGO │  [Tên VPS/App đang chọn ▾]              ● SSH   ● ML svc │ ← topbar 48px
├──────┼──────────────────────────────────────────────────────────┤
│ VPS  │                                                          │
│ Apps │                                                          │
│ Dash │                 NỘI DUNG MÀN HÌNH                        │
│ Migr │                                                          │
│ Hist │                                                          │
│ Sett │                                                          │
└──────┴──────────────────────────────────────────────────────────┘
  sidebar 220px, thu gọn được còn 56px
```

- Topbar **bắt buộc** có 2 chỉ báo: trạng thái **ML service** (xanh=chạy / đỏ=chết, click →
  xem log service) và **kết nối SSH** của VPS đang chọn. Lý do: 2 tiến trình nền này chết âm
  thầm là nguồn bug khó hiểu nhất, phải nhìn thấy ngay.
- Điều hướng: sidebar là cấp 1; trong Apps → click app → tab cấp 2
  (Tổng quan / Log / Phiên bản / Cài đặt). Không breadcrumb sâu quá 2 cấp.

---

## 3. SPEC TỪNG MÀN HÌNH

### 3.1 VPS Control Panel (UC-01, điểm vào UC-02/03/09)

Màn VPS là **panel vận hành trong phạm vi OpsPilot**, không còn chỉ là một bảng CRUD. Bố cục
master–detail: phía trên là tổng quan đội VPS; vùng chính giữ danh sách/chọn máy ở một phía và
chi tiết máy đang chọn ở phía còn lại. Chi tiết có ba tab:

1. **Tổng quan** — thông tin host/user/provider/region/Docker/last seen; CPU core + load 1 phút,
   RAM và disk khả dụng; hành động kiểm tra lại, chẩn đoán kết nối, sửa, cài Docker, xoá.
2. **Ứng dụng & deploy** — app trên đúng VPS, URL/cổng/framework/version hiện tại; mở app;
   deploy app mới hoặc redeploy với VPS/app được điền sẵn trong Deploy Wizard.
3. **Hoạt động** — 20 action log mới nhất lọc theo VPS; click hàng mở chi tiết key–value.

Hàng tổng quan đội VPS phải có tổng số máy, online, offline và tổng số app. Danh sách cho phép
tìm theo tên/host và lọc trạng thái; mỗi máy hiện tên, host (mono), trạng thái (Online / Offline /
Đang kiểm tra / Chưa rõ), Docker, RAM/disk khả dụng và số app. Đổi máy phải xoá dữ liệu chi tiết
cũ trong lúc tải để không hiển thị nhầm dữ liệu của VPS trước.

- "Thêm VPS" → Modal: Tên, Host, Port (mặc định 22), Username, tab [SSH key | Password],
  textarea dán private key. Nút "Kiểm tra kết nối" **ngay trong modal**, kết quả hiện từng
  bước: `✓ SSH OK → ✓ Docker 27.1 → ✓ Ghi được /opt/opspilot`.
  Thiếu Docker → cảnh báo vàng + nút "Cài Docker ngay" (confirm lại, FR-A2).
- Xoá VPS → confirm 2 lớp, cảnh báo rõ "app đang chạy trên VPS **không** bị xoá".
- Empty state cấp đội máy: "Chưa có VPS nào. Thêm VPS đầu tiên để bắt đầu deploy." + nút chính.
  Empty state trong tab ứng dụng/hoạt động phải hướng dẫn đúng hành động kế tiếp.
- Task triển khai hiện hành: `docs/tasks/tk-b9-vps-control-panel.md`. Chỉ dùng typed IPC đã có;
  tính năng cần backend mới phải tách task cho A, không dựng nút giả.
- Không mở rộng thành cPanel/Plesk: không terminal/file manager/firewall/DNS/SSL/package manager,
  không shell tuỳ ý và không thêm start/stop/reboot khi chưa có handler thật.

### 3.2 Deploy Wizard (UC-02) — AntD Steps 4 bước

1. **Nguồn** — ô kéo-thả thư mục (hoặc nút chọn) | input Git URL. Chọn xong hiện cây file
   rút gọn 2 cấp để người dùng biết app đã đọc đúng thư mục.
2. **Nhận diện** — card kết quả detector: tên framework + phiên bản + build command + port
   mặc định + tên Dockerfile template (link "Xem" mở Drawer readonly).
   Không khớp detector nào → **card đỏ liệt kê từng dấu hiệu đã kiểm tra và vì sao trượt**
   (minh bạch = điểm cộng khi demo).
3. **Cấu hình** — form các biến `requiredEnv` còn thiếu (đánh dấu đỏ), thêm env tuỳ chọn bằng
   nút "+". Trường secret có toggle ẩn/hiện. Khối cảnh báo vàng cho thao tác thủ công
   (FR-B3: "Nhớ cập nhật OAuth callback URL sau khi deploy").
4. **Kiểm tra & Deploy** — bảng precheck 3 dòng RAM/Disk/Port, mỗi dòng ✓/✗ kèm **con số
   thực tế vs yêu cầu**; thêm dòng "URL sẽ dùng: `http://<ip>:<port>`". Tất cả xanh mới
   enable nút "Deploy" → chuyển thẳng sang màn Log.

### 3.3 Deploy Log (FR-B6) — màn demo, đầu tư cao

```
┌ Stepper ngang: PRECHECK ✓ → UPLOAD ✓ → RENDER ✓ → BUILD ⟳ → DEPLOY → HEALTHCHECK → RECORD ┐
│  (xong: ✓ xanh + thời gian "12s" · đang chạy: spinner · lỗi: ✗ đỏ)                        │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│  xterm.js log stream, giữ nguyên ANSI color, auto-scroll (tắt khi user cuộn lên, hiện     │
│  nút "↓ Xuống cuối");  toolbar: [Sao chép] [Xuống dòng] [Tìm]                              │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│  Footer: ⏱ tổng thời gian đang chạy    |    [Huỷ deploy]                                   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- Thành công: banner xanh **"Deploy thành công sau 2m41s"** + nút "Mở app ↗" (URL thật) +
  "Xem dashboard". Con số 2m41s chính là bằng chứng sống cho NFR-4 lúc demo.
- Thất bại: banner đỏ ghi rõ **bước nào** fail + trích sẵn 30 dòng log cuối của bước đó +
  nút "Rollback về v(N-1)" nếu áp dụng được.

### 3.4 Dashboard (UC-06/07/08) — màn "đinh" của demo

```
┌ Tầng 1 — Statistic: CPU % | RAM MB | Latency ms | Error rate | DB ms | Container ●
│   số to JetBrains Mono; nhấp nháy nhẹ khi có mẫu mới; mũi tên ↑↓ so với mẫu trước
├ Tầng 2 ─ TRÁI (70%): 2 chart Recharts xếp dọc, chọn metric bằng Segmented control;
│   trục thời gian đồng bộ 2 chart; cửa sổ 15ph / 1h / 6h.
│   ★ SIGNATURE: vạch dọc đánh dấu sự kiện ngay trên chart — alert của method nào thì
│     vạch đúng màu method đó, rollback = vạch đỏ đậm có nhãn. Đây chính là "timeline
│     chart" của báo cáo, hiện live trong app → lúc demo memory leak, hội đồng NHÌN THẤY
│     đường mem đi lên chạm lần lượt vạch tím/hồng/xanh dương TRƯỚC khi chạm ngưỡng rule.
│ ─ PHẢI (30%): "Bảng điều khiển phát hiện" — 5 hàng (rule, zscore_ewma, iforest, ocsvm,
│   ensemble): chấm màu + tên + thanh score 0..1 realtime + trạng thái (Yên tĩnh /
│   ⚠ CẢNH BÁO). Method đang là trusted có tag "tự rollback".
│   Model chưa train đủ mẫu → hiện "Đang thu thập 132/150 mẫu" thay vì score 0.
├ Tầng 3 — Bảng cảnh báo gần đây: Thời gian | Method (tag màu) | Score | Metric bất thường |
│   Nhãn: 2 nút [✓ Đúng] [✗ Sai] (UC-08) — bấm 1 phát, đổi màu ngay, sửa lại được.
│   Không modal, không form. Gắn nhãn phải "rẻ" thì mới đủ nhãn để đánh giá.
│   CHỈ hiện bản ghi trong bảng `alert` (đã triggered) — KHÔNG hiện `score_sample`.
└
```

- Cấu hình ngưỡng rule + chọn trusted method + bật/tắt auto-rollback: Drawer "Cài đặt giám
  sát" mở từ góc phải, không chiếm đất dashboard.
- Bật `auto_rollback` là hành động rủi ro → confirm 1 lớp có giải thích hậu quả.

### 3.5 App Detail — Phiên bản (UC-03/04)

- Timeline dọc: v5 (đang chạy, Tag xanh) → v4 → v3…, mỗi mục: thời gian, framework, thời
  lượng build, trạng thái. Nút "Rollback về đây" ở mọi version cũ.
- Rollback là hành động phá huỷ → Modal confirm **bắt gõ đúng tên app** (kiểu GitHub) khi app
  đang chạy bình thường; nếu app đang `failed` thì chỉ confirm thường (đang cháy nhà thì
  không bắt gõ chữ).

### 3.6 Migrate Wizard (UC-05) — Steps 5 bước

Chọn nguồn/đích (2 card VPS cạnh nhau, mũi tên →) → Precheck đích → Tiến hành (mỗi giai đoạn
BACKUP/TRANSFER/RESTORE một progress bar + log thu gọn) → **Verify: bảng đối chiếu 2 cột
Nguồn | Đích** (checksum từng file ✓, count từng bảng DB ✓ — chụp bảng này vào báo cáo làm
bằng chứng FR-C4) → Xác nhận: 2 nút "Hoàn tất, giữ nguồn" / "Hoàn tất, dọn nguồn"; nút
"Huỷ & rollback" luôn hiện cho tới trước khi xác nhận. Hiện **downtime đang đếm** ở góc.

### 3.7 Lịch sử (UC-09)

Bảng + thanh filter: loại hành động (multi-select tag), VPS, khoảng thời gian.
Click hàng → Drawer chi tiết, hiển thị `detail_json` dạng **key–value**, không dump JSON thô.

---

## 4. QUY TẮC UX CHUNG (bắt buộc)

1. **Không bao giờ để người dùng đoán hệ thống đang làm gì:** thao tác >300ms có
   spinner/progress; thao tác nền (poll metric, train model) có indicator ở topbar.
2. **Hành động phá huỷ** (xoá VPS, rollback khi đang chạy tốt, dọn VPS nguồn, bật
   auto-rollback) → confirm 2 lớp. Hành động thường → không confirm, có Undo qua
   notification nếu khả thi.
3. **Lỗi phải nói đủ 3 điều:** chuyện gì · ở bước nào · làm gì tiếp.
   → *"SSH timeout khi UPLOAD — kiểm tra VPS còn online rồi bấm Thử lại"*
   ✗ *"Error: connect ETIMEDOUT"*. Message thô cho vào mục "Chi tiết kỹ thuật" thu gọn được.
4. **Empty state 3 màn chính** (VPS, Apps, Dashboard) đều hướng dẫn hành động kế tiếp —
   giảng viên mở app lần đầu là biết ngay phải làm gì.
5. Timestamp hiển thị giờ địa phương dạng tương đối ("2 phút trước") + tooltip giờ tuyệt đối.
   Host/port/command/path luôn dùng font mono.
6. Ngôn ngữ UI: **tiếng Việt**, sentence case, động từ rõ ("Deploy", "Rollback về v4",
   "Kiểm tra kết nối"). Cùng một hành động dùng **cùng một từ** ở mọi nơi.
7. Toàn bộ text UI để trong **một file `strings.ts`** — sửa lời không phải mò trong
   component, và đổi sang tiếng Anh cho báo cáo/demo chỉ sửa một chỗ.
8. Số đo luôn kèm đơn vị và làm tròn cố định: CPU 1 chữ số thập phân, RAM số nguyên MB,
   latency số nguyên ms, error rate phần trăm 1 chữ số thập phân, score 2 chữ số.

---

## 5. THỨ TỰ LÀM & MỨC ĐẦU TƯ

| Ưu tiên | Màn hình | Mức đầu tư | Ghi chú |
|---|---|---|---|
| 1 | Dashboard + Deploy Log | **90% công sức UI** | 2 màn demo — làm kỹ signature (vạch sự kiện trên chart, stepper + xterm) |
| 2 | Deploy Wizard | Chuẩn AntD | Form + Steps mặc định, không custom |
| 3 | VPS Control Panel, Phiên bản, Migrate | Chuẩn AntD | Master–detail/Tabs/Timeline/Steps mặc định |
| 4 | Lịch sử, Cài đặt | Tối thiểu | Bảng thô có filter là đủ |

**Không làm:** chuyển theme sáng/tối (chỉ dark), i18n runtime, kéo-thả sắp xếp dashboard,
tuỳ biến chart, animation chuyển trang, onboarding tour.

**Định nghĩa "xong" cho UI:**
- Cả 9 use case đi hết luồng mà không cần đọc tài liệu.
- Không màn nào để lộ JSON thô hoặc message lỗi thô.
- 3 màn demo chạy mượt **trên máy chiếu** — test độ tương phản ở tuần 14: máy chiếu rửa màu
  rất mạnh, dot xanh/đỏ phải ≥10px **và kèm chữ**, không được dựa vào màu đơn thuần.
