# BẢNG TASK — NGUỒN SỰ THẬT VỀ TRẠNG THÁI

> Luồng trạng thái và quy tắc cập nhật bắt buộc cho AI: [`README.md`](README.md) mục 2–3.
> Hồ sơ chi tiết từng task: `tk-<id>-*.md`. Hệ thống task trong repo chính thức từ 19/08/2026.
>
> Trạng thái hợp lệ: `BACKLOG · TUẦN NÀY · ĐANG LÀM · CHỜ REVIEW · HOÀN THÀNH · BLOCKED`.
> Mỗi người tối đa **một** task `ĐANG LÀM`; phần còn lại đứng `TUẦN NÀY` theo thứ tự kéo.
> Cập nhật dòng task đi **cùng commit/PR của task** — không commit riêng.

## Tuần 1 — đang chạy (10/08–23/08)

> Từ 19/08/2026 B bận → **A nhận toàn bộ task tuần, backend lẫn UI**, dồn lực **demo
> 24/08 với thầy** (chẩn đoán lỗi kết nối VPS → auto-deploy Express thật → ops dashboard).
> Chi tiết ở `docs/20` mục "Cập nhật 19/08". Collector + 2 demo app còn lại + M7 lùi W2.

| ID | Task | Chủ | Hạn | Trạng thái | Branch | PR | Ghi chú |
|---|---|---|---|---|---|---|---|
| TK-S1 | Hồ sơ kiến trúc RC-1 + 7 quyết định đề xuất D1–D7 | Both | 11/08 | HOÀN THÀNH | chore/ho-so-kien-truc | — | `docs/19`; D1–D7 còn chờ khóa contract sau review |
| TK-A1 | DB: schema + CRUD + migration | A | 11/08 | HOÀN THÀNH | feat/db-crud | #4 | |
| TK-A2 | UI khung màn VPS List (state rỗng) | A | 11/08 | HOÀN THÀNH | feat/ui-vps-list-khung | #4 | Nối 4 state đầy đủ + chẩn đoán: TK-B7 (A nhận 19/08) |
| TK-A3 | M2 credential: AES-256-GCM + safeStorage | A | 11/08 | HOÀN THÀNH | feat/m02-credential | #8 | 30/30 test |
| TK-B1 | M5 collector scaffold (script + Dockerfile khung) | B | 15/08 | HOÀN THÀNH | feat/m05-collector-scaffold | #6 | pytest 3/3; probe/output gốc ở TK-B4/B5 (lùi W2) |
| TK-S2 | Dựng + nghiệm thu 2 VPS cùng provider/gói/region | A | 12/08 | BLOCKED | chore/vps-nghiem-thu-19-08 | #12 | Đã dựng + 6/6 nghiệm thu + merge 19/08; **chờ 3 việc tay người dùng**: snapshot `clean-docker-19-08`, nạp pubkey B, chép DC/hạn thanh toán vào `docs/08` mục 0 |
| TK-A4 | M1 SSH: connect/exec + timeout + auth fail + TOFU | A | 17/08 | HOÀN THÀNH | feat/m01-ssh-connect-exec | #9 | `try-ssh` **6/6 trên 2 VPS thật** 19/08 |
| TK-A5 | M1 upload/readFileTail + resource check | A | 19/08 | BLOCKED | feat/m01-ssh-connect-exec | #9 | upload/readFileTail xanh trên VPS thật; còn chờ `metrics.jsonl` của collector (TK-B5 — lùi W2). Hồ sơ: `tk-a5-m1-files.md` |
| TK-A10 | M1 chẩn đoán lỗi kết nối VPS: probe TCP + 5 lớp lỗi + gợi ý sửa tiếng Việt | A | 21/08 | HOÀN THÀNH | feat/m01-connect-diagnostics | #14 | Bài toán mở đầu demo 24/08 (case mẫu: firewall WiService chặn SSH). Đã merge: probe TCP + `VpsDiagnosis` trong contract; case chặn port kết luận nguyên nhân ~8s. Hồ sơ: `tk-a10-m1-diagnostics.md` |
| TK-B2 | M12: lát cắt demo — express-api + fault endpoint + Dockerfile | **A** | 20/08 | TUẦN NÀY | feat/m12-express-demo-app | #15 | Lát cắt `express-api` xong 19/08 (chạy local + Docker, CRUD + seed 1000): merge #15. Phần còn lại (`next-blog`, `vite-spa`, fault endpoint) chuyển W2, không chặn demo. Hồ sơ: `tk-b2-m12-demo.md` |
| TK-B7 | UI VPS connection + resource: 4 state + hiển thị chẩn đoán | **A** | 22/08 | CHỜ REVIEW | feat/ui-connection-states | #16 | B lùi, **A nhận 19/08**; 4 state bảng + tài nguyên + "Kiểm tra kết nối" trong modal + `DiagnosisPanel` (TK-A10) đã merge. Còn 1 DoD: chờ xác nhận bằng mắt với VPS thật khi người dùng thêm VM01 (demo). Hồ sơ: `tk-b7-ui-states.md` |
| TK-A13 | M4 lát cắt demo: deploy Express thật lên VM01 (PRECHECK→RECORD) | A | 23/08 | TUẦN NÀY | feat/m04-deploy-express | — | Kéo TK-A8 (W2) lên sớm cho demo 24/08: 1 app chạy port 30xxx trên VM01, thao tác từ UI, ghi nhận deploy trong DB. |
| TK-A14 | Dashboard v1: tổng quan VPS + lịch sử + log deploy live | A | 23/08 | TUẦN NÀY | feat/ui-dashboard-v1 | — | Ops dashboard cho demo (không chart metric — collector lùi W2). |
| TK-S3 | Gate G0: review chéo + smoke tuần 1 | Both | 22/08 | TUẦN NÀY | — | — | Chạy chiều 22/08. B bận → review chéo: B nếu rảnh, không thì A tự review theo `prompts/99` và ghi rõ trong hồ sơ. Item ML hoãn W2 (A6/B3 lùi); item demo-apps tính theo lát cắt express-api. Hồ sơ: `tk-s3-w1-gate.md` |

## Tuần 2 — plan chốt (22/08–28/08)

Tạo tk-file khi kéo task (mẫu `tk-template.md`). Đầy đủ ở `docs/20` mục 3.

| ID | Task | Chủ | Trạng thái | Ghi chú |
|---|---|---|---|---|
| TK-A6 | M7 ML skeleton: features + 6 endpoint + unit test | A | CHỜ REVIEW | Kéo sớm 20/08 (A14 khép sớm hơn hạn, W2 dày A6→A7→A9, không phụ thuộc B/port). A tự viết `gen_fake_series.py` trong scope (TK-B3 chưa bàn giao). Xong 20/08: features 20 chiều + 3 model + 6 endpoint + 19/19 test + curl đủ 6 endpoint. PR — (đang mở). |
| TK-A7 | M3 Detector engine: rule + 3 detector Tier 1 | A | BACKLOG | Brief `prompts/m03` |
| TK-A9 | M7 train/ingest/replay + 4 method | A | BACKLOG | Sau TK-A6 |
| TK-A15 | M4 hoàn thiện: compose + healthcheck + giữ 3 image + lock port | A | BACKLOG | Phần còn lại sau lát cắt demo TK-A13 |
| TK-B3 | Fixture metric giả đúng contract cho A | B | BACKLOG | Lùi W2 cùng đợt ML (TK-A6); A tự viết `gen_fake_series` nếu cần (phương án dự phòng đã thống nhất) |
| TK-B4 | M5: docker stats + HTTP probe (chạy local) | B | BACKLOG | Lùi W2 (collector ngoài demo 24/08); đích probe = express-api (TK-B2) |
| TK-B5 | M5: ghi metrics.jsonl + latest.json chu kỳ 10s | B | BACKLOG | Lùi W2 cùng chuỗi collector; khép TK-A5 khi có file thật |
| TK-B6 | M5: chạy collector bằng Docker trên VPS | B | BACKLOG | Lùi W2 cùng chuỗi collector |
| TK-B8 | Hoàn tất collector + nối Monitor UI | B | BACKLOG | Phần Deploy Wizard/Log UI đã A làm ở TK-A14 → B8 còn lại = collector + Dashboard chart/score khi quay lại |
| TK-B2 | M12 (phần còn lại): next-blog + vite-spa + fault endpoint | B | BACKLOG | Chuyển từ W1 (lát cắt express-api đã xong #15); giữ tk-file `tk-b2-m12-demo.md` |

## Tuần 3+ 

Lấy từ `docs/20` mục 3 (W3: DEPLOY→RECORD + poller/rule + Dashboard; W4: rollback + smoke 16/24).
Thêm dòng vào bảng trên khi chốt plan đầu tuần.