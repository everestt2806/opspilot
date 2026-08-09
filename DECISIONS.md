# DECISIONS.md — Nhật ký quyết định

> Mọi thay đổi so với kế hoạch gốc (`docs/00-de-tai-goc.md`, `docs/01-ke-hoach.md`) ghi
> **1 dòng** ở đây, kèm lý do. Đây chính là tài liệu trả lời hội đồng khi bị hỏi
> *"AI hỗ trợ nhiều thế em có nắm được kiến trúc không?"* — mỗi dòng dưới đây là một
> quyết định do người ra, có lý do kỹ thuật, giải thích được trong 30 giây.
>
> **Format:** `YYYY-MM-DD | [phạm vi] Quyết định — Lý do — Ảnh hưởng — Ai`
> Quyết định lớn có ADR riêng trong `docs/14-quyet-dinh-kien-truc.md`, ghi số ADR vào đây.

---

## 2026-07 — Tuần 0: chốt trước khi code

| Ngày | Phạm vi | Quyết định | Lý do | Ảnh hưởng |
|---|---|---|---|---|
| 2026-07-27 | [ml] | Collector ghi **append vào `metrics.jsonl`** thay vì ghi đè `latest.json`; poller kéo 30s/lần nhưng nạp **mọi dòng mới** (ADR-007) | Bản gốc collector 5s + poll 15s làm mất 2/3 số mẫu — đúng loại dữ liệu đắt nhất (50+ giờ máy). Cách mới còn giảm một nửa số lời gọi SSH | `collector/`, `monitor/poller.ts`, `metric_sample.seq` |
| 2026-07-27 | [ml] | Baseline thu **30 phút = 180 mẫu** trước khi train, tối thiểu chấp nhận 150 | Bản gốc mâu thuẫn: yêu cầu ≥200 mẫu nhưng chỉ thu 60. 40 vector cho không gian 20 chiều là quá mỏng | `docs/07`, `run_experiment.py` |
| 2026-07-27 | [ml] | Feature vector gồm **5 metric × 4 đặc trưng = 20 chiều** (bỏ `mem_pct` trùng `mem_mb`, bỏ `container_up` vì đã có rule) | Giảm chiều → tỷ lệ mẫu/chiều 9:1 thay vì 6:1, mô hình ổn định hơn với cùng lượng dữ liệu | `ml-service/features.py` |
| 2026-07-27 | [db] | Tách **`score_sample`** khỏi **`alert`**: score thô của mọi phương pháp ở mọi mẫu vào `score_sample`, `alert` chỉ chứa sự kiện đã triggered | Bản gốc nhồi cả hai vào `alert` → cột `label` (UC-08) vô nghĩa với 45.000 dòng score, UI gắn nhãn không lọc được. Threshold sweep vẫn chạy offline bình thường trên `score_sample` | `docs/contracts/schema.sql`, UI dashboard, `analyze.py` |
| 2026-07-27 | [db] | Thêm bảng `app`, `monitor_setting`, `migration_job`; thêm index cho mọi truy vấn theo `(deployment_id, ts)` | Bản gốc không có nơi lưu cấu hình auto-rollback (M8) và ngưỡng rule (FR-D3), và không có index nào cho bảng ~45k dòng | `docs/contracts/schema.sql` |
| 2026-07-27 | [db] | Thêm `'ensemble'` vào ràng buộc CHECK của `method` ở mọi bảng | Bản gốc quên, insert sẽ throw ngay tuần 5 | `docs/contracts/schema.sql` |
| 2026-07-27 | [infra] | **Bỏ nginx ở v1.** App expose trực tiếp `http://<vps-ip>:<host_port>`, port cấp tự động trong dải 30000–30999 (ADR-006) | Nginx không phục vụ câu hỏi nghiên cứu; collector probe qua docker network nên không cần access log. Tiết kiệm ~3 ngày. Reverse proxy + HTTPS ghi vào hướng phát triển | `templates/`, `deploy/pipeline.ts`, `app.host_port` |
| 2026-07-27 | [exp] | Thêm **load generator** chạy bằng container trên VPS (`experiments/load_gen/`) | Không có traffic thì `latency_ms` và `http_error_rate` chỉ đo được từ 1 probe/10s → ước lượng error rate quá nhiễu, 3/5 kịch bản fault mất ý nghĩa | `experiments/load_gen/`, `docs/07` |
| 2026-07-27 | [exp] | Đo **lệch đồng hồ VPS ↔ máy user** mỗi run, lưu `experiment_run.clock_offset_ms`; mọi phép tính detection delay quy về đồng hồ VPS; VPS bật `systemd-timesyncd` | `detection delay` là con số headline của đồ án mà bản gốc lại trừ hai đồng hồ khác nhau, lệch 5–10s là bình thường | `run_experiment.py`, `docs/08` |
| 2026-07-27 | [exp] | **2 VPS phải cùng provider, cùng gói, cùng region** (huỷ gợi ý dùng 2 provider khác nhau) | Chạy 50 run song song trên 2 cấu hình khác nhau là confound; `analyze.py` vẫn kiểm tra chênh lệch giữa 2 VPS và báo cáo | `docs/07`, `docs/08` |
| 2026-07-27 | [ops] | Chỉ commit **CSV export** của `metric_sample`/`score_sample`/`alert`/`experiment_run`; **không commit file `.db`** | File `.db` chứa bảng `vps` với credential SSH; repo private vẫn là thói quen xấu | `.gitignore`, `run_experiment.py` |
| 2026-07-27 | [plan] | Lịch giãn từ 12 tuần lên **16 tuần theo ngày thật** (tuần 0 từ 27/07, nộp 20/11): 12 tuần lõi + tuần 13 đệm kỹ thuật + tuần 14–16 báo cáo/tập demo | Có 16 tuần thật, dùng hết thay vì tự ép 12 tuần rồi cháy ở cuối | `docs/04-timeline.md` |
| 2026-07-28 | [plan] | Ngày bắt đầu dự kiến là **08/08/2026**; quyết định này được thay bởi rebaseline ngày 09/08 bên dưới | Tách rõ kế hoạch ban đầu với lịch nhóm thực sự cam kết | `README.md`, `docs/04-timeline.md` |
| 2026-07-28 | [ops] | GVHD là người giám sát mức độ làm việc nghiêm túc, **không là cổng phê duyệt kỹ thuật**; nhóm tự quyết định và ghi lý do để giải trình | Không phụ thuộc vào khả năng GVHD hướng dẫn chi tiết; vẫn giữ trao đổi định kỳ làm bằng chứng tiến độ | `docs/15-checklists.md`, cách ra quyết định kỹ thuật |
| 2026-08-09 | [plan] | **Rebaseline ngày bắt đầu thành 10/08/2026**; W1–W4 ưu tiên 16/24 FR để đạt 66,7% chức năng | Repo mới có tài liệu, chưa có code; cần gom setup vào W1 và đi theo lát cắt dọc Express trước để có hệ thống chạy thật sớm | `README.md`, `docs/04-timeline.md`, các nhãn tuần trong tài liệu |

---

## Mẫu để ghi tiếp

```
| 2026-08-XX | [ssh] | Đổi từ sftp sang tar-over-ssh cho bước UPLOAD | sftp từng file chậm gấp ~6 lần với node_modules | M1, M4 bước UPLOAD |
```

**Phạm vi hợp lệ:** `[ssh] [crypto] [db] [detector] [deploy] [migrate] [monitor] [ml] [ui] [exp] [infra] [ops] [plan] [report]`
