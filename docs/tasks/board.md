# BẢNG TASK — NGUỒN SỰ THẬT VỀ TRẠNG THÁI

> Luồng trạng thái và quy tắc cập nhật bắt buộc cho AI: [`README.md`](README.md) mục 2–3.
> Hồ sơ chi tiết từng task: `tk-<id>-*.md`. Hệ thống task trong repo chính thức từ 19/08/2026.
>
> Trạng thái hợp lệ: `BACKLOG · TUẦN NÀY · ĐANG LÀM · CHỜ REVIEW · HOÀN THÀNH · BLOCKED`.
> Mỗi người tối đa **một** task `ĐANG LÀM`; phần còn lại đứng `TUẦN NÀY` theo thứ tự kéo.
> Cập nhật dòng task đi **cùng commit/PR của task** — không commit riêng.

## Tuần 1 — đang chạy (10/08–21/08)

| ID | Task | Chủ | Hạn | Trạng thái | Branch | PR | Ghi chú |
|---|---|---|---|---|---|---|---|
| TK-S1 | Hồ sơ kiến trúc RC-1 + 7 quyết định đề xuất D1–D7 | Both | 11/08 | HOÀN THÀNH | chore/ho-so-kien-truc | — | `docs/19`; D1–D7 còn chờ khóa contract sau review |
| TK-A1 | DB: schema + CRUD + migration | A | 11/08 | HOÀN THÀNH | feat/db-crud | #4 | |
| TK-A2 | UI khung màn VPS List (state rỗng) | A | 11/08 | HOÀN THÀNH | feat/ui-vps-list-khung | #4 | B nối 4 state đầy đủ ở TK-B7 |
| TK-A3 | M2 credential: AES-256-GCM + safeStorage | A | 11/08 | HOÀN THÀNH | feat/m02-credential | #8 | 30/30 test |
| TK-B1 | M5 collector scaffold (script + Dockerfile khung) | B | 15/08 | HOÀN THÀNH | feat/m05-collector-scaffold | #6 | pytest 3/3; probe/output tách TK-B4/B5 |
| TK-S2 | Dựng + nghiệm thu 2 VPS cùng provider/gói/region | A | 12/08 | ĐANG LÀM | chore/vps-nghiem-thu-19-08 | — | Đã dựng + 6/6 nghiệm thu xong 19/08 (Ubuntu 24.04.4 · Docker 29.7.2 · clock <300ms); còn snapshot `clean-docker-19-08` (tay người dùng) + nạp key B + chép DC/hạn thanh toán từ dashboard. Hồ sơ: `tk-s2-vps.md` |
| TK-A4 | M1 SSH: connect/exec + timeout + auth fail + TOFU | A | 17/08 | HOÀN THÀNH | feat/m01-ssh-connect-exec | #9 | `try-ssh` **6/6 trên 2 VPS thật** 19/08; PR #9 đã merge. Hồ sơ: `tk-a4-m1-ssh.md` |
| TK-A5 | M1 upload/readFileTail + resource check | A | 19/08 | BLOCKED | feat/m01-ssh-connect-exec | #9 | upload/readFileTail đã xanh trên VPS thật; còn đọc `metrics.jsonl` của B (TK-B5). Hồ sơ: `tk-a5-m1-files.md` |
| TK-A6 | M7 ML skeleton: features + 6 endpoint + unit test | A | 21/08 | TUẦN NÀY | feat/m07-ml-skeleton-tests | — | Kéo sau TK-S2; B chưa giao fixture → A tự viết `gen_fake_series.py` nếu cần (báo B trước). Hồ sơ: `tk-a6-m7.md` |
| TK-S3 | Gate G0: review chéo + smoke + cập nhật FR tuần | Both | 21/08 | TUẦN NÀY | — | — | Chờ TK-S2, TK-B2, TK-B3; chạy chiều thứ 2 22/08 nếu trượt 21/08. Hồ sơ: `tk-s3-w1-gate.md` |
| TK-B2 | M12: 3 demo app Tier 1 + fault endpoint | B | 11/08 | ĐANG LÀM | feat/m12-demo-apps | — | **TRỄ** — `demo-apps/` còn rỗng; chặn TK-B4 + gate W1. Ưu tiên cao nhất của B. Hồ sơ: `tk-b2-m12-demo.md` |
| TK-B3 | Fixture metric giả đúng contract cho A | B | 17/08 | TUẦN NÀY | feat/m07-fake-metrics | — | TRỄ; đặt ở `experiments/fixtures/`; báo A trước khi làm để khỏi trùng `gen_fake_series`. Hồ sơ: `tk-b3-fixture.md` |
| TK-B4 | M5: docker stats + HTTP probe (chạy local) | B | 18/08 | TUẦN NÀY | feat/m05-collector-probes | — | Chờ demo Express (TK-B2) làm đích probe. Hồ sơ: `tk-b4-m5-probes.md` |
| TK-B5 | M5: ghi metrics.jsonl + latest.json chu kỳ 10s | B | 19/08 | TUẦN NÀY | feat/m05-collector-output | — | A (TK-A5) đọc file này để nghiệm thu resource check. Hồ sơ: `tk-b5-m5-jsonl.md` |
| TK-B6 | M5: chạy collector bằng Docker trên VPS | B | 20/08 | TUẦN NÀY | feat/m05-collector-docker | — | VPS đã mua từ 19/08. Hồ sơ: `tk-b6-m5-docker-vps.md` |
| TK-B7 | UI VPS connection + resource: đủ 4 state | B | 21/08 | TUẦN NÀY | feat/ui-connection-states | — | Nối handler thật `vps:test-connection`, `vps:get-resources` (A đã có). Hồ sơ: `tk-b7-ui-states.md` |

## Tuần 2 — plan chốt (22/08–28/08)

Tạo tk-file khi kéo task (mẫu `tk-template.md`). Đầy đủ ở `docs/20` mục 3.

| ID | Task | Chủ | Trạng thái | Ghi chú |
|---|---|---|---|---|
| TK-A7 | M3 Detector engine: rule + 3 detector Tier 1 | A | BACKLOG | Brief `prompts/m03` |
| TK-A8 | M4 Deploy PRECHECK→UPLOAD→RENDER→BUILD (Express) | A | BACKLOG | Lát cắt Express trên VPS; Brief `prompts/m04` |
| TK-A9 | M7 train/ingest/replay + 4 method | A | BACKLOG | Sau TK-A6 |
| TK-B8 | Hoàn tất collector + Deploy Wizard/Log bằng mock event | B | BACKLOG | Mock theo typed event của A; Brief `prompts/m05`/`m10` |

## Tuần 3+ 

Lấy từ `docs/20` mục 3 (W3: DEPLOY→RECORD + poller/rule + Dashboard; W4: rollback + smoke 16/24).
Thêm dòng vào bảng trên khi chốt plan đầu tuần.