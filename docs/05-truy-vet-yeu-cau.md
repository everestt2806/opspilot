# MA TRẬN TRUY VẾT YÊU CẦU

> **06/11 — service execution:** [R3c-1](tasks/tk-s7-release-r3c1-execution-service.md) explicit `run-product` + startup/admission/SSH runtime và health truth, Linux3process/2deploy/restart-no-duplicate PASS với Git file adapter. Chưa public Git/systemd/API/Desktop authority hoặc FR/UC tổng PASS; không suy thành production acceptance.

> **06/11 — resource/cold recovery:** [R3b-6](tasks/tk-s7-release-r3b6-readiness-recovery.md) thêm admission trước dispatch và bounded cold startup scanner/CLI, historical proof và T1→T2 không replay PASS trong Linux SSH/Docker7/7. Chưa service-driven Git/OS restart hoặc FR/UC/PRODUCT_PASS tổng; default polling-only, live/ML/HTTPS/migrate/installer còn gate riêng.

> **06/11 — target enrollment:** [R3b-5b](tasks/tk-s7-release-r3b5b-target-enrollment.md) có production bootstrap/SQLite021, installed paths chạy2apps/7real cases và controller process-loss/CLI inspect; Linux11/11, full app1519 PASS/2 SKIP, Python365PASS. Chưa service-driven Git/API/UI/admission/startup recovery hoặc FR/UC/PRODUCT_PASS tổng; không dùng fixture initializer làm production proof.

> **06/11 — bundle controller:** [R3b-5a](tasks/tk-s7-release-r3b5a-controller-bundle.md) đóng gói11payload files + pinned manifest verifier, Linux FS14/14/fresh native install/enrollment regression PASS; full app1502 PASS/2 SKIP. Chưa target app enrollment/installed service activation, không tự nâng FR/UC/PRODUCT_PASS từ component gate.

> **06/11 — controller bootstrap:** [R3b-4 key/VPS credential enrollment CLI](tasks/tk-s7-release-r3b4-controller-enrollment.md) có Linux CLI14/14, 29 unit tests/full app1481 PASS/2 SKIP. Đây là local product-mode bootstrap, chưa target app enrollment/service-driven deploy và chưa nâng FR/UC/PRODUCT_PASS. Các gate live/ML/HTTPS/migrate/installer giữ trạng thái riêng.

> **06/11 — hạn kết thúc 04/12:** dùng [ma trận release và task R0–R14](tasks/tk-s7-release-2026-12-04.md) để điều phối. Giữ dấu FR/UC lịch sử tới khi có evidence nghiệm thu hiện hành; không tự nâng trạng thái vì test component pass.

> **Rà soát 05/11/2026:** code nền/L0/H1 và checkpoint H2 đã merge main qua #33/#34; [review/gates](tasks/tk-s7-pr33-pr34-integration-2026-11-05.md), [các checkpoint còn thiếu](tasks/tk-s7-next-checkpoints-2026-11-05.md). H2/full auto-deploy, pilot ML, migrate hai VPS và HTTPS live chưa được nâng PRODUCT_PASS chỉ vì merge hoặc test component xanh. Các dòng FR/NFR lịch sử bên dưới giữ evidence gốc.

Mỗi yêu cầu trong [`00-de-tai-goc.md`](00-de-tai-goc.md) phải có: **module hiện thực · nơi
kiểm chứng · trạng thái**. Bảng này trả lời câu hỏi "còn thiếu gì" trong 30 giây, và là phụ
lục rất được đánh giá cao trong báo cáo.

**Cách dùng:** xong một hạng mục thì đổi ⬜ → ✅ **trong cùng PR** với code. Không có PR nào
được merge mà bảng này vẫn nói "chưa làm".

Trạng thái: ⬜ chưa · 🔨 đang làm · ✅ xong & kiểm chứng được · ⏸ hoãn (ghi lý do)

> Rà soát 08/10/2026: các dấu trạng thái bên dưới là bằng chứng theo checkpoint lịch sử, **chưa phải nghiệm thu toàn sản phẩm trên VPS mới**. Đặc biệt UC-02/FR-B5 chưa bao phủ nguồn Git và bước chạy test của source; UC-05/UC-07 cần live gate riêng. Trước khi chốt trạng thái hiện hành, đối soát theo [chuẩn hoàn thiện sản phẩm](31-lo-trinh-hoan-thien-san-pham.md), không tự đổi dấu ✅ chỉ vì có code hoặc test mock.

> 10/09 — Checkpoint demo solo: [TK-A17](tasks/tk-a17-demo-checkpoint.md).
> A15/B4/B5/B2 đã có code merge (#25/#26/#28); runtime B6 còn báo cáo trên nhánh
> `dfc0ed7`, Monitor UI chưa có trong main. A17 ưu tiên FR-D1…D5, FR-B7/FR-E1
> và luồng UC-06/08/09. Các chặng C00–C09 có review riêng; website nghiệp vụ, Monitor dễ hiểu
> và before/after là cách trình diễn các chức năng thật. FR-E2 functional (M8, C08A/B/C) nay là P0 bắt buộc cho demo tự khôi phục; early-detection research vẫn riêng. Chưa tick thêm yêu cầu
> trong phiên lập plan; Worker cập nhật bằng chứng từng gate, Leader xác nhận.

---

## Yêu cầu chức năng

| ID    | Yêu cầu                                        | Module                            | Kiểm chứng                                                      | Màn hình | Tuần  | TT  |
| ----- | ---------------------------------------------- | --------------------------------- | --------------------------------------------------------------- | -------- | ----- | --- |
| FR-A1 | CRUD VPS, credential mã hoá                    | M2 + `db`                         | unit test crypto + `loadSecret` roundtrip DB + smoke VM01 30/08; R1 migration 008 giữ app/lịch sử khi gỡ và nối lại đúng SSH identity (local gate, live reconnect chưa chạy) | 3.1      | W1    | ✅  |
| FR-A2 | Test SSH, kiểm tra & tự cài Docker             | M1 + `vps:install-docker`         | `try-ssh` 6 bước + connection/scan handler + smoke VM01 30/08   | 3.1      | W1    | ✅  |
| FR-A3 | Danh sách VPS + trạng thái + tài nguyên        | M1 + `vps:get-resources` + `vps:get-operational-diagnostics` | test parser/renderer + VPS Control Panel #21 + smoke VM01 30/08; C2b parser/IPC/fixture tests local (không phải live diagnostics gate) | 3.1      | W1    | ✅  |
| FR-B1 | Detector plugin nhận diện framework            | M3                                | unit test ≥4 case/detector                                      | 3.2 b2   | W2    | ⬜  |
| FR-B2 | Hỗ trợ 3 stack Tier 1 (+Flask Tier 2)          | M3                                | deploy thật cả 3 demo app                                       | 3.2      | W3    | ⬜  |
| FR-B3 | Wizard hỏi env thiếu + cảnh báo thủ công       | M3 `requiredEnv` + UI             | smoke test                                                      | 3.2 b3   | W3    | ⬜  |
| FR-B4 | Precheck RAM/disk/port                         | M4 `PRECHECK`                     | unit test + click-through VM01; case thiếu RAM còn bổ sung W4   | 3.2 b4   | W2    | 🔨  |
| FR-B5 | Build image + deploy qua SSH                   | M4 `BUILD`,`DEPLOY`               | Express/PostgreSQL end-to-end, health ngoài mạng 200, PR #23    | 3.3      | W2–W3 | ✅  |
| FR-B6 | Log build/deploy real-time                     | M4 event + xterm                  | quan sát trực tiếp trong demo 30/08                             | 3.3      | W3    | ✅  |
| FR-B7 | Lịch sử deploy (version, framework, thời gian) | bảng `deployment`                 | màn Phiên bản có ≥3 version                                     | 3.5      | W4    | ⬜  |
| FR-B8 | Thêm framework mới không sửa lõi               | `detector-contract.ts`            | **đo giờ công thêm Flask ở W10**                                | —        | W10   | ⬜  |
| FR-C1 | Chọn VPS nguồn/đích, khởi tạo migrate          | M9 `PREPARE`                      | smoke test                                                      | 3.6      | W6    | ⬜  |
| FR-C2 | Backup app + DB + config + volume              | M9 `BACKUP`                       | file backup tồn tại, kích thước hợp lý                          | 3.6      | W6    | ⬜  |
| FR-C3 | Truyền + restore + khởi động lại               | M9 `TRANSFER`,`RESTORE`           | app chạy trên VPS đích                                          | 3.6      | W6    | ⬜  |
| FR-C4 | Verify checksum + đếm bản ghi                  | M9 `VERIFY`                       | bảng đối chiếu 2 cột (chụp vào báo cáo)                         | 3.6      | W7    | ⬜  |
| FR-C5 | Huỷ/rollback migrate, giữ nguồn                | M9 nhánh lỗi                      | **test chủ động: ngắt SSH giữa TRANSFER**                       | 3.6      | W7    | ⬜  |
| FR-D1 | Container thu metric deploy kèm app            | M5 + compose template             | `metrics.jsonl` có dữ liệu                                      | —        | W2    | ⬜  |
| FR-D2 | Poll metric qua SSH + dashboard real-time      | M6 + UI                           | metric/sample tick qua MonitorPoller + SQLite thật              | 3.4      | W3    | 🔨  |
| FR-D3 | Rule-based, ngưỡng cấu hình được               | M6 `rules.ts` + `monitor_setting` | rule/setting/alert lifecycle có regression SQLite               | 3.4      | W3    | 🔨  |
| FR-D4 | 3 phương pháp ML song song + độ tin cậy        | M7                                | `score_sample` đủ 5 dòng/mẫu, ML NULL khi down                  | 3.4      | W1–W3 | 🔨  |
| FR-D5 | Gắn nhãn đúng/sai từng cảnh báo                | `monitor:label-alert`             | IPC label ghi DB thật và regression                             | 3.4 t3   | W4    | 🔨  |

Ghi chú TK-A16 đã merge PR #24: backend parser/repository/rule/poller/ML/IPC có regression SQLite
thật và CLI fixture; smoke VPS thật và UI nghiệm thu vẫn chờ TK-S4/B8.
| FR-E1 | Rollback thủ công | M4 rollback + runtime image chain | unit + smoke VM02: manual v4 về runtime v1, readiness retry, dữ liệu 1.001 dòng; còn tái xác nhận VM01 | 3.5 | W4 | 🔨 |
| FR-E2 | Tự động rollback theo method tin cậy | M8 | demo memory leak → tự rollback | 3.4 | W5 | ⬜ |
| FR-E3 | Ghi log toàn bộ hành động | `action_log` | màn Lịch sử có đủ loại hành động | 3.7 | W7 | ⬜ |

## Yêu cầu phi chức năng

| ID    | Yêu cầu                                               | Bảo đảm bằng                                        | Kiểm chứng                                           | TT  |
| ----- | ----------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | --- |
| NFR-1 | Không tiến trình thường trực trên VPS ngoài container | Kiến trúc SSH-only (ADR-001)                        | `systemctl list-units \| grep opspilot` → rỗng       | ⬜  |
| NFR-2 | Credential mã hoá, không rời máy                      | M2 `safeStorage` (ADR-002)                          | unit test + **chốt với GVHD tuần 0**                 | ⬜  |
| NFR-3 | Đóng gói electron-builder chạy được                   | `electron-builder.yml`                              | cài trên **máy sạch** (không có Node)                | ⬜  |
| NFR-4 | Deploy Tier 1 < 3 phút                                | M4 tối ưu bước UPLOAD/BUILD                         | `deployment.total_duration_ms`, ≥5 lần mỗi framework | ⬜  |
| NFR-5 | Chu kỳ metric 15–30s, cấu hình được                   | `monitor_setting.poll_interval_s=30`, collector 10s | đổi trong Drawer, quan sát                           | ⬜  |
| NFR-6 | UI tối giản, ưu tiên chức năng                        | AntD mặc định, chỉ đầu tư 2 màn demo                | tự đánh giá theo docs/02 mục 5                       | ⬜  |
| NFR-7 | 3 stack Tier 1 ổn định, Tier 2 là stretch             | Quy tắc cắt của Cổng 3                              | 3 framework deploy được ≥5 lần liên tiếp             | ⬜  |
| NFR-8 | Lặp đủ số lần để tính CI                              | 5 kịch bản × 10 run                                 | `analyze.py` xuất mean ± std + CI 95%                | ⬜  |

## Use case → màn hình

| UC    | Tên                                         | Màn hình   | Smoke test bước                                                                                              | TT  |
| ----- | ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ | --- |
| UC-01 | Kết nối VPS mới                             | 3.1        | 1; R1 giữ hồ sơ khi gỡ/kết nối lại, R2 hiển thị read-only app còn trên VPS nhưng thiếu SQLite (live NOT_RUN) | ✅  |
| UC-02 | Deploy lần đầu                              | 3.2 + 3.3  | 2                                                                                                            | ✅  |
| UC-03 | Redeploy + tự rollback khi healthcheck fail | 3.3 + 3.5  | TK-A15 `6fd3efd`: smoke VM02 v3 health 503 → `rolled_back` về v2, giữ dữ liệu/3 image; còn public smoke VM01 | 🔨  |
| UC-04 | Rollback thủ công                           | 3.5        | 6                                                                                                            | ⬜  |
| UC-05 | Migrate sang VPS khác                       | 3.6        | —                                                                                                            | ⬜  |
| UC-06 | Dashboard vận hành                          | 3.4        | 3                                                                                                            | ⬜  |
| UC-07 | Cảnh báo + tự rollback                      | 3.4        | 4                                                                                                            | ⬜  |
| UC-08 | Gắn nhãn cảnh báo                           | 3.4 tầng 3 | 5                                                                                                            | ⬜  |
| UC-09 | Lịch sử hoạt động                           | 3.7        | —                                                                                                            | ⬜  |

## Tiêu chí đánh giá của đề tài → nơi có số liệu

| Tiêu chí                                                | Số liệu lấy từ                                          | TT  |
| ------------------------------------------------------- | ------------------------------------------------------- | --- |
| Tỷ lệ deploy/migrate/rollback thành công theo framework | `deployment.status`, `migration_job.status`             | ⬜  |
| Downtime khi migrate + toàn vẹn dữ liệu                 | `migration_job.downtime_ms`, `verify_json`              | ⬜  |
| P/R/F1 kèm CI của các phương pháp                       | `analyze.py` bảng chính                                 | ⬜  |
| Thời gian phát hiện sớm hơn rule                        | `analyze.py` cột detection delay                        | ⬜  |
| Tính mở rộng của kiến trúc detector                     | Đo giờ công thêm Flask ở W10 (số file, số dòng, số giờ) | ⬜  |
| Chất lượng "Hạn chế & hướng phát triển"                 | Chương 6                                                | ⬜  |
| Độ hoàn thiện app (đóng gói chạy được)                  | Bản build cài trên máy sạch                             | ⬜  |
