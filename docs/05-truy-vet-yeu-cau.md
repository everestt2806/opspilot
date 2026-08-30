# MA TRẬN TRUY VẾT YÊU CẦU

Mỗi yêu cầu trong [`00-de-tai-goc.md`](00-de-tai-goc.md) phải có: **module hiện thực · nơi
kiểm chứng · trạng thái**. Bảng này trả lời câu hỏi "còn thiếu gì" trong 30 giây, và là phụ
lục rất được đánh giá cao trong báo cáo.

**Cách dùng:** xong một hạng mục thì đổi ⬜ → ✅ **trong cùng PR** với code. Không có PR nào
được merge mà bảng này vẫn nói "chưa làm".

Trạng thái: ⬜ chưa · 🔨 đang làm · ✅ xong & kiểm chứng được · ⏸ hoãn (ghi lý do)

---

## Yêu cầu chức năng

| ID | Yêu cầu | Module | Kiểm chứng | Màn hình | Tuần | TT |
|---|---|---|---|---|---|---|
| FR-A1 | CRUD VPS, credential mã hoá | M2 + `db` | unit test crypto + `loadSecret` roundtrip DB + smoke VM01 30/08 | 3.1 | W1 | ✅ |
| FR-A2 | Test SSH, kiểm tra & tự cài Docker | M1 + `vps:install-docker` | `try-ssh` 6 bước + connection/scan handler + smoke VM01 30/08 | 3.1 | W1 | ✅ |
| FR-A3 | Danh sách VPS + trạng thái + tài nguyên | M1 + `vps:get-resources` | test parser/renderer + VPS Control Panel #21 + smoke VM01 30/08 | 3.1 | W1 | ✅ |
| FR-B1 | Detector plugin nhận diện framework | M3 | unit test ≥4 case/detector | 3.2 b2 | W2 | ⬜ |
| FR-B2 | Hỗ trợ 3 stack Tier 1 (+Flask Tier 2) | M3 | deploy thật cả 3 demo app | 3.2 | W3 | ⬜ |
| FR-B3 | Wizard hỏi env thiếu + cảnh báo thủ công | M3 `requiredEnv` + UI | smoke test | 3.2 b3 | W3 | ⬜ |
| FR-B4 | Precheck RAM/disk/port | M4 `PRECHECK` | unit test + click-through VM01; case thiếu RAM còn bổ sung W4 | 3.2 b4 | W2 | 🔨 |
| FR-B5 | Build image + deploy qua SSH | M4 `BUILD`,`DEPLOY` | Express/PostgreSQL end-to-end, health ngoài mạng 200, PR #23 | 3.3 | W2–W3 | ✅ |
| FR-B6 | Log build/deploy real-time | M4 event + xterm | quan sát trực tiếp trong demo 30/08 | 3.3 | W3 | ✅ |
| FR-B7 | Lịch sử deploy (version, framework, thời gian) | bảng `deployment` | màn Phiên bản có ≥3 version | 3.5 | W4 | ⬜ |
| FR-B8 | Thêm framework mới không sửa lõi | `detector-contract.ts` | **đo giờ công thêm Flask ở W10** | — | W10 | ⬜ |
| FR-C1 | Chọn VPS nguồn/đích, khởi tạo migrate | M9 `PREPARE` | smoke test | 3.6 | W6 | ⬜ |
| FR-C2 | Backup app + DB + config + volume | M9 `BACKUP` | file backup tồn tại, kích thước hợp lý | 3.6 | W6 | ⬜ |
| FR-C3 | Truyền + restore + khởi động lại | M9 `TRANSFER`,`RESTORE` | app chạy trên VPS đích | 3.6 | W6 | ⬜ |
| FR-C4 | Verify checksum + đếm bản ghi | M9 `VERIFY` | bảng đối chiếu 2 cột (chụp vào báo cáo) | 3.6 | W7 | ⬜ |
| FR-C5 | Huỷ/rollback migrate, giữ nguồn | M9 nhánh lỗi | **test chủ động: ngắt SSH giữa TRANSFER** | 3.6 | W7 | ⬜ |
| FR-D1 | Container thu metric deploy kèm app | M5 + compose template | `metrics.jsonl` có dữ liệu | — | W2 | ⬜ |
| FR-D2 | Poll metric qua SSH + dashboard real-time | M6 + UI | metric thật hiện trên chart | 3.4 | W3 | ⬜ |
| FR-D3 | Rule-based, ngưỡng cấu hình được | M6 `rules.ts` + `monitor_setting` | đổi ngưỡng qua Drawer → alert đổi theo | 3.4 | W3 | ⬜ |
| FR-D4 | 3 phương pháp ML song song + độ tin cậy | M7 | `score_sample` có đủ 5 dòng/mẫu | 3.4 | W1–W3 | ⬜ |
| FR-D5 | Gắn nhãn đúng/sai từng cảnh báo | `monitor:label-alert` | bấm 1 phát, DB đổi | 3.4 t3 | W4 | ⬜ |

Ghi chú TK-A16 local: đã có nền parser/repository/rule/scheduler và các query monitor; FR-D2/FR-D3/FR-D4 vẫn chưa đạt nghiệm thu vì chưa nối poll thật, ML scores động và toàn bộ IPC lifecycle.
| FR-E1 | Rollback thủ công | M4 rollback | về đúng version cũ, app chạy | 3.5 | W4 | ⬜ |
| FR-E2 | Tự động rollback theo method tin cậy | M8 | demo memory leak → tự rollback | 3.4 | W5 | ⬜ |
| FR-E3 | Ghi log toàn bộ hành động | `action_log` | màn Lịch sử có đủ loại hành động | 3.7 | W7 | ⬜ |

## Yêu cầu phi chức năng

| ID | Yêu cầu | Bảo đảm bằng | Kiểm chứng | TT |
|---|---|---|---|---|
| NFR-1 | Không tiến trình thường trực trên VPS ngoài container | Kiến trúc SSH-only (ADR-001) | `systemctl list-units \| grep opspilot` → rỗng | ⬜ |
| NFR-2 | Credential mã hoá, không rời máy | M2 `safeStorage` (ADR-002) | unit test + **chốt với GVHD tuần 0** | ⬜ |
| NFR-3 | Đóng gói electron-builder chạy được | `electron-builder.yml` | cài trên **máy sạch** (không có Node) | ⬜ |
| NFR-4 | Deploy Tier 1 < 3 phút | M4 tối ưu bước UPLOAD/BUILD | `deployment.total_duration_ms`, ≥5 lần mỗi framework | ⬜ |
| NFR-5 | Chu kỳ metric 15–30s, cấu hình được | `monitor_setting.poll_interval_s=30`, collector 10s | đổi trong Drawer, quan sát | ⬜ |
| NFR-6 | UI tối giản, ưu tiên chức năng | AntD mặc định, chỉ đầu tư 2 màn demo | tự đánh giá theo docs/02 mục 5 | ⬜ |
| NFR-7 | 3 stack Tier 1 ổn định, Tier 2 là stretch | Quy tắc cắt của Cổng 3 | 3 framework deploy được ≥5 lần liên tiếp | ⬜ |
| NFR-8 | Lặp đủ số lần để tính CI | 5 kịch bản × 10 run | `analyze.py` xuất mean ± std + CI 95% | ⬜ |

## Use case → màn hình

| UC | Tên | Màn hình | Smoke test bước | TT |
|---|---|---|---|---|
| UC-01 | Kết nối VPS mới | 3.1 | 1 | ✅ |
| UC-02 | Deploy lần đầu | 3.2 + 3.3 | 2 | ✅ |
| UC-03 | Redeploy + tự rollback khi healthcheck fail | 3.3 + 3.5 | — | ⬜ |
| UC-04 | Rollback thủ công | 3.5 | 6 | ⬜ |
| UC-05 | Migrate sang VPS khác | 3.6 | — | ⬜ |
| UC-06 | Dashboard vận hành | 3.4 | 3 | ⬜ |
| UC-07 | Cảnh báo + tự rollback | 3.4 | 4 | ⬜ |
| UC-08 | Gắn nhãn cảnh báo | 3.4 tầng 3 | 5 | ⬜ |
| UC-09 | Lịch sử hoạt động | 3.7 | — | ⬜ |

## Tiêu chí đánh giá của đề tài → nơi có số liệu

| Tiêu chí | Số liệu lấy từ | TT |
|---|---|---|
| Tỷ lệ deploy/migrate/rollback thành công theo framework | `deployment.status`, `migration_job.status` | ⬜ |
| Downtime khi migrate + toàn vẹn dữ liệu | `migration_job.downtime_ms`, `verify_json` | ⬜ |
| P/R/F1 kèm CI của các phương pháp | `analyze.py` bảng chính | ⬜ |
| Thời gian phát hiện sớm hơn rule | `analyze.py` cột detection delay | ⬜ |
| Tính mở rộng của kiến trúc detector | Đo giờ công thêm Flask ở W10 (số file, số dòng, số giờ) | ⬜ |
| Chất lượng "Hạn chế & hướng phát triển" | Chương 6 | ⬜ |
| Độ hoàn thiện app (đóng gói chạy được) | Bản build cài trên máy sạch | ⬜ |
