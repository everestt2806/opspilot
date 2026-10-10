# TK-S7-D11 — kịch bản demo 11:00 ngày 11/10/2026

**Trạng thái:** CHỜ REVIEW. Lịch giảng viên thay đổi từ 14/10 sang 11:00 ngày 11/10. Phạm vi: kịch bản trình bày và phiếu A4 dựa trên bằng chứng hiện có; không thay đổi runtime, contract, DB, VPS hoặc deployment.

## Requirement ledger

| Yêu cầu | Thay đổi / lý do | Kiểm chứng phiên hiện tại | Trạng thái |
|---|---|---|---|
| Có kịch bản đủ 7 phút cho ngày 11/10 | `docs/demo-11-10/kich-ban-11h.md`, thứ tự màn hình và lời dẫn | Đối chiếu hồ sơ G2/G4b và UI Electron profile G2 | PASS |
| Có phiếu in | `docs/demo-11-10/phieu-demo.html` và `.pdf` | `pdfinfo`: A4, 1 trang; render xem đủ chữ | PASS |
| Có phương án khi mạng/precheck lỗi | Video G3 build cũ/v3, nhãn rõ; dừng trước Start khi gate lỗi | File MP4 tồn tại và hồ sơ G3 đã kiểm tra; kịch bản ghi rõ hạn chế | PASS |
| Không tuyên bố quá bằng chứng | Phân biệt Git manual, same SHA redeploy, HTTP với HTTPS, local test với VPS live | Đối chiếu `evidence.md` và PDF render | PASS |
| Kiểm tra live gần demo | Checklist sáng 11/10 yêu cầu refresh 3 URL và profile G2 | 10/10 khoảng 15:09 UTC+07: 3 HTTP 200 sau C3d v5; sáng 11/10 chưa đến | IMPLEMENTED |

## Nhật ký

- START 2026-10-10 UTC+07 — Nhận lịch mới 11:00 ngày 11/10. Ưu tiên hoàn tất kịch bản độc lập với redeploy mới; đọc board, G5-live, evidence G2–G5 và phiếu cũ.
- UPDATE 2026-10-10 UTC+07 — Từ máy điều khiển, `curl.exe` đến Express `:30000/health`, Vite `:30001/`, Next `:30002/` đều HTTP 200. Electron profile G2 thấy app Git Express v4 và ba app trong lịch sử. Wizard Git Prepare chưa được Leader xác nhận hoàn tất; Worker C3b tiếp tục kiểm tra riêng. Không bấm Start.
- UPDATE 2026-10-10 UTC+07 — Tạo kịch bản 7 phút, HTML/PDF A4. `pdfinfo` trả 1 trang A4 (594.96 × 841.92 pt); render PNG đã xem, không cắt chữ. `git diff --check` sạch trước khi thêm file task. Bản ghi dự phòng G3 là build cũ/deployment v3 và không được gọi là live.
- UPDATE 2026-10-10 UTC+07 — Gắn thông báo lịch mới ở đầu `docs/29-ke-hoach-demo-14-10.md` để các mốc 12–14/10 cũ không bị hiểu là lịch hiện hành. Bổ sung câu trả lời về push-to-deploy, firewall, migrate và ML trong kịch bản.
- UPDATE 2026-10-10 UTC+07 — Sau C3d, sửa kịch bản/phiếu A4 theo Git Express v5 đã redeploy thành công trên build hiện tại và ba URL còn HTTP 200. Video C3d bị cắt trước Start, nên không dùng làm bằng chứng liên tục; giữ video G3 build cũ/v3 làm fallback có nhãn.

## Handoff

Kiểm tra lại ba URL và OpsPilot lúc 10:30–10:50 ngày 11/10; nếu nguồn hoặc precheck không đạt, dùng kịch bản chính không deploy mới. Chỉ đổi trạng thái live sau một lượt kiểm chứng riêng với cùng build/profile. Không push/PR/merge.
