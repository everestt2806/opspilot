# ⚠ THƯ MỤC LƯU TRỮ — ĐÃ BỊ THAY THẾ, KHÔNG DÙNG

Bốn file trong thư mục này là **bản gốc ngày 26/07/2026**, giữ lại chỉ để đối chiếu lịch sử.
Chúng **chứa các mâu thuẫn đã được sửa** và **không còn là nguồn sự thật**.

**AI và người đọc: bỏ qua thư mục này.** Dùng bản đã cập nhật:

| File cũ ở đây | Thay bằng |
|---|---|
| `De tai du an (goc).txt` | [`../00-de-tai-goc.md`](../00-de-tai-goc.md) *(nội dung giữ nguyên, chỉ đổi định dạng)* |
| `KE_HOACH_DO_AN.md` | [`../01-ke-hoach.md`](../01-ke-hoach.md) + [`../contracts/`](../contracts/) + [`../04-timeline.md`](../04-timeline.md) + [`../07-giao-thuc-thi-nghiem.md`](../07-giao-thuc-thi-nghiem.md) |
| `UI_UX_SPEC.md` | [`../02-ui-ux-spec.md`](../02-ui-ux-spec.md) |
| `PLAN_VAN_HANH_BAO_VE.md` | [`../03-quy-trinh-team.md`](../03-quy-trinh-team.md) + [`../12-outline-bao-cao.md`](../12-outline-bao-cao.md) + [`../13-so-rui-ro.md`](../13-so-rui-ro.md) + [`../16-bao-ve-va-qa.md`](../16-bao-ve-va-qa.md) |

## Những gì đã được sửa (chi tiết: [`../../DECISIONS.md`](../../DECISIONS.md))

1. Collector ghi đè `latest.json` 5s + poll 15s → **mất 2/3 số mẫu**. Đã đổi sang
   `metrics.jsonl` append + đọc theo offset.
2. Yêu cầu ≥200 mẫu để train nhưng chỉ thu 60 mẫu → **mâu thuẫn**. Đã chốt 180 mẫu.
3. Schema thiếu `'ensemble'` trong CHECK, thiếu bảng lưu cấu hình auto-rollback và ngưỡng
   rule, không có index nào.
4. `alert` bị dùng cho cả score thô lẫn sự kiện → đã tách `score_sample`.
5. Không có nguồn traffic → `latency` và `error_rate` vô nghĩa. Đã thêm load generator.
6. Không xử lý lệch đồng hồ VPS ↔ máy user → hỏng `detection delay`. Đã thêm đo offset mỗi run.
7. Gợi ý dùng 2 provider khác nhau ↔ chạy thí nghiệm song song trên 2 VPS (confound).
   Đã chốt cùng provider.
8. Yêu cầu push file `.db` (chứa credential SSH) lên GitHub. Đã đổi thành chỉ push CSV.
9. Không có pha holdout → không đo được False Positive một cách trung thực. Đã thêm pha B.
10. Nginx có trong kiến trúc nhưng không có spec, và không có quy tắc cấp port. Đã bỏ nginx
    ở v1, cấp port 30000–30999.
