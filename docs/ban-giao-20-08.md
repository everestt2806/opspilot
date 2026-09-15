# BÀN GIAO 20/08/2026 — A nhận hết tuần demo (19/08–23/08)

> Viết cho người dùng (A) và B khi quay lại. Nguồn sự thật trạng thái: `docs/tasks/board.md`
> + `tk-*.md`. File này là bản tổng hợp nhanh, không thay thế board.

## 1. Việc đã làm (đến hết 20/08)

| Việc | Trạng thái | PR |
|---|---|---|
| Chẩn đoán lỗi kết nối VPS: probe TCP + 5 lớp lỗi + gợi ý sửa tiếng Việt (TK-A10) | HOÀN THÀNH | #14 |
| Lát cắt demo `express-api`: CRUD + seed 1000, chạy local + Docker (TK-B2 phần A) | HOÀN THÀNH | #15 |
| UI VPS: 4 state + tài nguyên + DiagnosisPanel trong modal (TK-B7, A nhận từ 19/08) | CHỜ REVIEW | #16 |
| Deploy Express thật lên VM01: pipeline PRECHECK→RECORD + try-deploy + DeployPage (TK-A13) | CHỜ REVIEW | #17 |
| **Dashboard v1 (TK-A14)**: `history:list` IPC đúng contract + DashboardPage (4 thẻ tổng quan + bảng hoạt động gần đây) + Deploy Log xterm giữ ANSI (Sao chép/Tìm, auto-scroll, "↓ Xuống cuối") + HistoryPage (bảng + filter hành động/VPS/thời gian + drawer key–value) | CHỜ REVIEW | #18 |

Điểm cần biết:

- Test toàn repo `app`: **124/124**, lint/typecheck/prettier sạch ở mỗi PR.
- PR #18 chênh spec 1 điểm đã ghi rõ trong tk-a14: nút "Xuống dòng" của spec 3.3 bị bỏ vì
  xterm v6 (đã chốt trong docs/09) xoá hẳn option `lineWrapping` từ v4, không có API thay thế.
- Trạng thái xanh trên VPS thật: SSH connect/exec 6/6 trên VM01+VM02 (19/08), deploy pipeline
  tới RECORD đã chạy thật trên VM01 qua `try-deploy` (chờ port để curl từ ngoài).

## 2. Việc sắp tới — theo thứ tự ưu tiên

### Demo 24/08 (ưu tiên số 1, chi phối hết)

Việc tay của người dùng (không AI nào thay được):

1. **Mở port 30000–30999 phía WiService** trên VM01 — khép 2 DoD còn lại của TK-A13
   (curl từ ngoài + click-through UI thật). Firewall máy chặn inbound là đúng case mẫu của
   demo chẩn đoán, nên port phải mở trước giờ demo.
2. **Thêm VM02 bằng tay qua UI** (chỉ VM01 đã nạp; đã thoả thuận để 1 VPS người dùng tự thao tác).
3. TK-S2 còn 3 việc tay: snapshot `clean-docker-19-08`, nạp pubkey của B, chép DC/hạn thanh
   toán vào `docs/08` mục 0.

Kịch bản click-through (thứ tự demo): chẩn đoán lỗi kết nối (case firewall) → deploy
`express-api` v2 thật qua UI → xem log xterm có màu → "Xem dashboard" → thẻ tổng quan +
lịch sử. Trước giờ demo: chạy 1 lần `pnpm dev` duyệt lại cả ba màn, để sẵn source
`express-api` trên máy demo.

### Gate G0 — chiều 22/08 (TK-S3)

B bận tới ~23/08 → nếu B chưa rảnh thì **A tự review chéo theo `docs/prompts/99`** và ghi
rõ "A self-review vì B bận" vào hồ sơ `tk-s3-w1-gate.md`. Item ML + demo-apps tính theo
lát cắt (đã lui W2 trong `docs/20`). Cần review + merge PR #18 (và #16, #17 nếu chưa kịp).

### Tuần 2 (22/08–28/08) — quay lại phân công A core / B UI

- **A**: TK-A6 (M7 ML skeleton: 5 feature → vector 20 chiều, 6 endpoint, unit test) →
  TK-A7 (3 detector Tier 1: rule, Isolation Forest, One-Class SVM) → TK-A9 (train/ingest/
  replay + 4 method). Nếu TK-B3 (fixture metric giả) chưa có thì A tự viết `gen_fake_series.py`
  trong scope A6 (phương án dự phòng đã thống nhất).
- **B khi quay lại**: nhận **TK-B9 — VPS Control Panel v1** trước (A giao 20/08; đọc
  `docs/tasks/tk-b9-vps-control-panel.md`). Sau đó hoàn tất collector
  (TK-B4/B5/B6 — khép luôn TK-A5 vốn chờ `metrics.jsonl`), 2 demo app còn lại
  (`next-blog`, `vite-spa`) + fault endpoint (TK-B2 phần còn lại), rồi TK-B8 nối chart/score
  vào Dashboard.

### Tồn đọng cần nhớ

- TK-A5 BLOCKED: upload/readFileTail đã xanh trên VPS thật, chờ `metrics.jsonl` của TK-B5 (W2).
- TK-A13 CHỜ REVIEW: 2 DoD chờ port (mục demo ở trên); sau khi curl xanh → tick DoD + HOÀN THÀNH.
- Không tự chạy lại thí nghiệm, không đụng `experiments/results/`, không lệnh phá huỷ trên VPS.
- File rác không commit: `.devflow/`, `logo.png`, "ChatGPT Image…png" — đã có trong `.gitignore`
  hoặc đang untracked, cứ để nguyên.

## 3. Nếu mất mạch — đọc gì

`docs/20-phan-cong-a-core-b-ui.md` (phân công + cập nhật 19/08) → `docs/tasks/board.md` →
tk-file của task đang kéo. Deadline nộp đồ án: **20/11/2026** (`docs/04-timeline.md`).
