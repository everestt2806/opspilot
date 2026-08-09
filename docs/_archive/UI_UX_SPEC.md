# SPEC UI/UX — DESKTOP APP DEPLOY & MONITOR
> File đi kèm KE_HOACH_DO_AN.md. Paste file này + spec module liên quan khi cho AI code phần renderer.
> Nguyên tắc gốc (NFR-6): tối giản, đúng chức năng — NHƯNG dashboard và deploy log là 2 màn hình
> xuất hiện trong demo bảo vệ, nên được đầu tư "trông chuyên nghiệp" có chủ đích. Wow đến từ
> cảm giác "tool thật", không phải từ trang trí.

---

## 1. ĐỊNH HƯỚNG THIẾT KẾ

**Cảm giác cần đạt:** một công cụ vận hành (ops tool) nghiêm túc kiểu Vercel/Railway/Portainer — tối, gọn, số liệu là nhân vật chính. Không phải trang landing, không gradient, không minh hoạ.

**Chốt công nghệ UI (không bàn lại):**
- **Ant Design v5** — lý do: có sẵn Steps (wizard), Table, Form validation, Modal confirm, Notification, Drawer, Tag, Statistic. Với team 2 người + AI, AntD tiết kiệm ~1 tuần so với shadcn/Tailwind tự ráp. Dùng ConfigProvider dark algorithm.
- **Recharts** cho toàn bộ chart. **@xterm/xterm** cho log viewer (render ANSI color từ docker build — log đẹp tự nhiên, không tốn công).
- Layout cố định min 1280×800. Không responsive mobile (app desktop), chỉ cần co giãn hợp lý khi phóng to.

**Design tokens (khai báo 1 lần trong ConfigProvider + CSS variables):**
```
Nền:        bg-base #0F1115   bg-panel #171A21   bg-elevated #1E2230   border #2A2F3A
Chữ:        text-primary #E6E8EE   text-secondary #9AA3B2   text-muted #5C6470
Trạng thái: success #34D399   warning #FBBF24   danger #F87171   info #60A5FA
4 phương pháp phát hiện (dùng NHẤT QUÁN ở mọi chart/tag/bảng trong toàn app):
  rule #9AA3B2 (xám — baseline)   zscore_ewma #60A5FA (xanh dương)
  iforest #A78BFA (tím)           ocsvm #F472B6 (hồng)   ensemble #34D399 (xanh lá)
Font:  UI = Inter;  số liệu/log/code/host = JetBrains Mono (tabular numbers)
Radius 8px; spacing bội số 8; KHÔNG shadow màu, KHÔNG gradient, KHÔNG animation trang trí
(chỉ giữ transition mặc định của AntD + pulse nhẹ ở dot "live").
```
Quy tắc màu quan trọng nhất: **mỗi phương pháp phát hiện có 1 màu cố định toàn app.** Giảng viên nhìn chart, bảng so sánh trong báo cáo, và slide đều thấy cùng bộ màu → cảm giác nhất quán rất "wow ngầm". Dùng chính bộ màu này cho biểu đồ matplotlib trong báo cáo (analyze.py).

---

## 2. KHUNG ỨNG DỤNG (App Shell)

```
┌──────┬──────────────────────────────────────────────────────────┐
│ LOGO │  [Tên VPS/App đang chọn ▾]                    ● ML svc OK │ ← topbar 48px
├──────┼──────────────────────────────────────────────────────────┤
│ ☁ VPS │                                                          │
│ ▲ Apps│                                                          │
│ 📈 Dash│                 NỘI DUNG MÀN HÌNH                        │
│ ⇄ Migr│                                                          │
│ 🕘 Hist│                                                          │
│ ⚙ Sett│                                                          │
└──────┴──────────────────────────────────────────────────────────┘
  sidebar 220px, thu gọn được còn 56px
```
- Topbar phải có: dot trạng thái ML service (xanh=chạy, đỏ=chết, click → xem log service) và dot kết nối SSH của VPS đang chọn. Lý do UX: 2 tiến trình nền này chết âm thầm là nguồn bug khó hiểu nhất — phải nhìn thấy được ngay.
- Điều hướng: sidebar là cấp 1; trong Apps → click app → tab cấp 2 (Overview / Logs / Versions / Settings). Không breadcrumb sâu hơn 2 cấp.

---

## 3. SPEC TỪNG MÀN HÌNH

### 3.1 VPS List (UC-01)
- Bảng AntD: Tên | Host (mono) | Trạng thái (Tag: ● Online xanh / ● Offline đỏ / ⟳ Đang kiểm tra) | CPU/RAM/Disk khả dụng (3 progress bar mini) | Số app | Hành động (Kiểm tra lại, Sửa, Xoá).
- Nút "Thêm VPS" → Modal form: Tên, Host, Port (mặc định 22), Username, chọn tab [SSH key | Password], textarea dán private key. Nút "Kiểm tra kết nối" ngay trong modal, kết quả hiện từng bước: `✓ SSH OK → ✓ Docker 26.1 → ✓ Ghi được /opt/deploytool`. Nếu thiếu Docker → hiện cảnh báo vàng + nút "Cài Docker ngay" (xác nhận lại, FR-A2).
- Empty state: icon server + "Chưa có VPS nào. Thêm VPS đầu tiên để bắt đầu deploy." + nút chính.

### 3.2 Deploy Wizard (UC-02) — AntD Steps 4 bước, mỗi bước 1 việc
1. **Nguồn:** ô kéo-thả thư mục (hoặc nút chọn) | input Git URL. Chọn xong hiện luôn cây file rút gọn (2 cấp) để người dùng biết app đã đọc đúng thư mục.
2. **Nhận diện:** kết quả detector dạng card: logo framework + tên (vd "Next.js 14") + build command + port mặc định + Dockerfile template sẽ dùng (link "Xem" mở Drawer readonly). Nếu không detector nào khớp → card đỏ giải thích các dấu hiệu đã kiểm tra và vì sao trượt (minh bạch = điểm cộng khi demo).
3. **Cấu hình:** form các biến env `requiredEnv` còn thiếu (đánh dấu đỏ), env tuỳ chọn thêm bằng nút "+". Trường secret có toggle ẩn/hiện. Khối cảnh báo vàng cho thao tác thủ công (FR-B3: "Nhớ cập nhật OAuth callback URL sau khi deploy").
4. **Kiểm tra & Deploy:** bảng precheck 3 dòng RAM/Disk/Port, mỗi dòng ✓ xanh hoặc ✗ đỏ kèm con số thực tế vs yêu cầu. Tất cả xanh mới enable nút "Deploy". Bấm → chuyển thẳng sang màn Log.

### 3.3 Màn Deploy Log (FR-B6) — màn hình demo, đầu tư nhất cùng với Dashboard
```
┌ Stepper ngang: PRECHECK ✓ → UPLOAD ✓ → RENDER ✓ → BUILD ⟳ → DEPLOY → HEALTHCHECK ┐
│  (bước xong: ✓ xanh + thời gian "12s"; đang chạy: spinner; lỗi: ✗ đỏ)             │
├───────────────────────────────────────────────────────────────────────────────────┤
│  xterm.js log stream, ANSI color giữ nguyên, auto-scroll (tắt khi user cuộn lên,  │
│  hiện nút "↓ Xuống cuối");  toolbar: [Copy] [Wrap] [Tìm]                          │
├───────────────────────────────────────────────────────────────────────────────────┤
│  Footer: ⏱ tổng thời gian đang chạy   |   [Huỷ deploy]                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```
- Thành công: banner xanh "Deploy thành công sau 2m41s" + nút "Mở app ↗" (URL thật) + "Xem dashboard". Con số 2m41s chính là bằng chứng sống cho NFR-4 lúc demo.
- Thất bại: banner đỏ ghi rõ **bước nào** fail + 30 dòng log cuối của bước đó được trích sẵn + nút "Rollback về v(N-1)" nếu áp dụng được.

### 3.4 Dashboard (UC-06/07/08) — màn hình "đinh" của demo. Bố cục 3 tầng:
```
┌ Tầng 1 — Hàng Statistic: CPU % | RAM MB | Latency ms | Error rate | DB ms | Container ●
│   (số to JetBrains Mono; nhấp nháy nhẹ khi có mẫu mới; mũi tên ↑↓ so mẫu trước)
├ Tầng 2 — TRÁI (70%): 2 chart Recharts xếp dọc, chọn metric hiển thị bằng Segmented
│   control; trục thời gian đồng bộ 2 chart; cửa sổ 15ph/1h/6h.
│   ★ SIGNATURE: vạch dọc đánh dấu sự kiện ngay trên chart — alert của method nào thì
│   vạch màu method đó, rollback = vạch đỏ đậm có nhãn. Đây chính là "biểu đồ timeline"
│   trong báo cáo, hiện live trong app → lúc demo memory leak, giảng viên NHÌN THẤY
│   đường mem đi lên chạm lần lượt vạch tím/hồng/xanh dương trước khi chạm ngưỡng rule.
│ ── PHẢI (30%): "Bảng điều khiển phát hiện" — 5 hàng (rule, zscore, iforest, ocsvm,
│   ensemble), mỗi hàng: chấm màu + tên + thanh score 0..1 realtime + trạng thái
│   (Yên tĩnh / ⚠ CẢNH BÁO). Method được chọn làm trusted có tag "tự rollback".
├ Tầng 3 — Bảng cảnh báo gần đây: Thời gian | Method (tag màu) | Score | Metric bất
│   thường | Nhãn: 2 nút [✓ Đúng] [✗ Sai] (UC-08) — bấm 1 phát, đổi màu ngay,
│   sửa được. Không modal, không form. Gắn nhãn phải "rẻ" thì mới có đủ nhãn.
└───────
```
- Cấu hình ngưỡng rule + chọn trusted method + bật/tắt auto-rollback: Drawer "Cài đặt giám sát" mở từ góc phải, không chiếm đất dashboard.

### 3.5 App Detail — Versions (UC-03/04)
- Timeline dọc các version: v5 (đang chạy, Tag xanh) → v4 → v3..., mỗi mục: thời gian, framework, thời lượng build, trạng thái. Nút "Rollback về đây" ở mọi version cũ.
- Rollback là hành động phá huỷ → Modal confirm bắt gõ đúng tên app (kiểu GitHub) khi app đang Running bình thường; nếu app đang Failed thì chỉ cần confirm thường (đang cháy nhà thì không bắt gõ chữ).

### 3.6 Migrate Wizard (UC-05) — Steps 5 bước
Chọn nguồn/đích (2 card VPS cạnh nhau, mũi tên →) → Precheck đích → Tiến hành (mỗi giai đoạn backup/transfer/restore 1 progress bar + log thu gọn) → **Verify: bảng đối chiếu 2 cột Nguồn|Đích** (checksum từng file ✓, count từng bảng DB ✓ — bảng này chụp vào báo cáo làm bằng chứng FR-C4) → Xác nhận: 2 nút "Hoàn tất, giữ nguồn" / "Hoàn tất, dọn nguồn" + nút "Huỷ & rollback" luôn hiện đến trước khi xác nhận.

### 3.7 History (UC-09)
- Bảng + filter thanh trên: loại hành động (multi-select tag), VPS, khoảng thời gian. Click hàng → Drawer chi tiết (detail_json hiển thị dạng key-value, không dump JSON thô).

---

## 4. QUY TẮC UX CHUNG (AI code phải tuân thủ)

1. **Không bao giờ để người dùng đoán hệ thống đang làm gì:** mọi thao tác >300ms có spinner/progress; mọi thao tác nền (poll metric, train model) có indicator ở topbar.
2. **Hành động phá huỷ** (xoá VPS, rollback khi đang chạy tốt, dọn VPS nguồn) → confirm 2 lớp. Hành động thường → không confirm, có Undo qua notification khi khả thi.
3. **Lỗi phải nói 3 điều:** chuyện gì xảy ra, ở bước nào, làm gì tiếp. "SSH timeout khi UPLOAD — kiểm tra VPS còn online rồi bấm Thử lại" chứ không "Error: connect ETIMEDOUT". Message lỗi thô cho vào mục "Chi tiết kỹ thuật" thu gọn được.
4. **Empty state 3 màn chính** (VPS, Apps, Dashboard) đều có hướng dẫn hành động kế tiếp — giảng viên mở app lần đầu là thấy ngay phải làm gì.
5. Mọi timestamp hiển thị giờ địa phương dạng tương đối ("2 phút trước") + tooltip giờ tuyệt đối. Mọi giá trị host/port/command/path dùng font mono.
6. Ngôn ngữ UI: tiếng Việt, sentence case, động từ rõ ("Deploy", "Rollback về v4", "Kiểm tra kết nối") — nút nói đúng việc nó làm, cùng 1 hành động dùng cùng 1 từ ở mọi nơi.
7. Toàn bộ text UI để trong 1 file `strings.ts` — sửa lời không phải mò trong component (và nếu cần đổi sang tiếng Anh cho báo cáo/demo thì đổi 1 chỗ).

---

## 5. THỨ TỰ LÀM & MỨC ĐẦU TƯ (chống overengineering phần UI)

| Ưu tiên | Màn hình | Mức đầu tư | Ghi chú |
|---|---|---|---|
| 1 | Dashboard + Deploy Log | 90% công sức UI | 2 màn demo — làm kỹ signature (vạch sự kiện trên chart, stepper+xterm) |
| 2 | Deploy Wizard | Chuẩn AntD | Form + Steps mặc định, không custom |
| 3 | VPS List, Versions, Migrate | Chuẩn AntD | Table/Timeline/Steps mặc định |
| 4 | History, Settings | Tối thiểu | Bảng thô có filter là đủ |

**Không làm:** theme sáng/tối chuyển đổi (chỉ dark), i18n runtime, kéo-thả sắp xếp dashboard, tuỳ biến chart của người dùng, animation chuyển trang, onboarding tour. Tất cả ghi vào "hướng phát triển" nếu cần.

**Định nghĩa "xong" cho UI:** cả 9 use case đi hết luồng không cần đọc tài liệu; không màn nào có JSON thô/lỗi thô lộ ra; demo 3 màn chạy mượt trên máy chiếu (test độ tương phản màu trên máy chiếu ở tuần 12 — màn hình chiếu rửa màu rất mạnh, dot xanh/đỏ phải to ≥10px và kèm chữ, không dựa vào màu đơn thuần).
