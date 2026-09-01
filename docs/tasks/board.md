# BẢNG TASK — NGUỒN SỰ THẬT VỀ TRẠNG THÁI

> Quy trình bắt buộc: [`README.md`](README.md). Kế hoạch sau demo và điểm vào cho AI mới:
> [`../23-ke-hoach-sau-demo-30-08.md`](../23-ke-hoach-sau-demo-30-08.md).
>
> Trạng thái hợp lệ: `BACKLOG · TUẦN NÀY · ĐANG LÀM · CHỜ REVIEW · HOÀN THÀNH · BLOCKED`.
> Mỗi người tối đa **một** task `ĐANG LÀM`; Worker đổi trạng thái khi thật sự bắt đầu, không đổi
> thay người kia. `HOÀN THÀNH` chỉ sau khi PR merge `main` và đủ bằng chứng.

## Điểm vào hiện tại — 01/09/2026

- **A:** TK-A15 — M4 Deploy Hardening. Hồ sơ/prompt Worker:
  [`tk-a15-m4-deploy-hardening.md`](tk-a15-m4-deploy-hardening.md).
- **B:** TK-B5 — ghi metrics.jsonl + latest.json, seq/fsync/rotation. Hồ sơ:
  [`tk-b5-m5-jsonl.md`](tk-b5-m5-jsonl.md).
- Baseline chung: `origin/main` commit `d40afc9`; PR #24 (TK-A16 Monitor backend) đã merge.
- Demo VPS Management + Express/PostgreSQL Deploy cơ bản với giảng viên đã hoàn tất. P0 hiện tại
  là `collector → metrics.jsonl → poller → SQLite/ML → Dashboard`, không phải polish thêm demo cũ.

## Đang ưu tiên — W3/W4

| ID     | Task                                                                 | Chủ  | Hạn   | Trạng thái | Branch                      | PR/phụ thuộc             | Ghi chú                                                                       |
| ------ | -------------------------------------------------------------------- | ---- | ----- | ---------- | --------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| TK-A15 | M4 hardening: rollback thật + 3 image + diagnostic/retry + lock port | A    | 08/09 | CHỜ REVIEW | `feat/m04-deploy-hardening` | code `6fd3efd`           | VM02 smoke auto/manual PASS · full 220/220 · VM01 TCP/22 còn chặn · chưa push |
| TK-B4  | M5: docker stats + HTTP probe local                                  | B    | 01/09 | CHỜ REVIEW | `feat/m05-collector-probes` | TK-B2 Express đã có      | code `fe1da33` đã push · 21/21 · mở PR cuối chuỗi B4–B5 (chỉ đạo B)             |
| TK-B5  | M5: metrics.jsonl + latest.json, seq/fsync/rotation                  | B    | 02/09 | ĐANG LÀM   | `feat/m05-collector-output` | Sau TK-B4                | START 01/09 · pytest 26/26 · smoke 10,5 phút 64 dòng PASS · khép blocker TK-A5                               |
| TK-B6  | M5: chạy collector Docker trên VM01                                  | B    | 03/09 | BACKLOG    | `feat/m05-collector-docker` | Sau TK-B5                | Không mở thêm port                                                            |
| TK-S4  | Gate dữ liệu thật: A16 + B6 trên VM01                                | Both | 04/09 | BLOCKED    | —                           | A16 đã merge; còn chờ B6 | Metric thật vào SQLite, 5 score/mẫu, reconnect không trùng                    |
| TK-B8  | Monitor Dashboard: chart + score + alert UI                          | B    | 07/09 | BACKLOG    | `feat/ui-monitor-dashboard` | Sau TK-S4                | Chỉ renderer + typed IPC thật                                                 |
| TK-A7  | M3: detector 3 Tier 1                                                | A    | 10/09 | BACKLOG    | `feat/m03-tier1-detectors`  | Sau A15                  | Breadth; thấp hơn đường dữ liệu                                               |
| TK-B2  | M12 còn lại: next-blog + vite-spa + fault endpoint                   | B    | 10/09 | BACKLOG    | `feat/m12-demo-apps-rest`   | Sau B8                   | Lát cắt Express đã hoàn thành #15                                             |
| TK-S5  | Gate MVP 16/24 FR + smoke/rollback/alert                             | Both | 11/09 | BACKLOG    | —                           | Sau A15/B8               | Bằng chứng vào `docs/smoke-log.md`                                            |

## Đang bị chặn nhưng không chặn A15/B4

| ID    | Task                                                    | Chủ | Trạng thái | Điều kiện gỡ chặn                                          |
| ----- | ------------------------------------------------------- | --- | ---------- | ---------------------------------------------------------- |
| TK-A5 | M1 readFileTail + resource check — nghiệm thu file thật | A   | BLOCKED    | TK-B5 sinh `metrics.jsonl`; đóng tại TK-S4                 |
| TK-S2 | Hoàn tất hồ sơ vận hành 2 VPS                           | A   | BLOCKED    | Snapshot sạch, pubkey B, DC/hạn thanh toán trong `docs/08` |

## Đã hoàn thành/merge

| ID       | Kết quả                                                     | Chủ            | PR/bằng chứng                                          |
| -------- | ----------------------------------------------------------- | -------------- | ------------------------------------------------------ |
| TK-S1    | Hồ sơ kiến trúc RC-1 + D1–D7                                | Both           | `docs/19`                                              |
| TK-A1/A2 | DB CRUD + khung VPS List                                    | A              | #4                                                     |
| TK-A3    | Credential AES-256-GCM + safeStorage                        | A              | #8, 30/30 test                                         |
| TK-A4    | SSH connect/exec/upload/read tail nền                       | A              | #9, try-ssh 6/6 trên hai VPS                           |
| TK-A6    | ML: feature 20D + 3 model + ensemble + 6 endpoint + fixture | A              | #19, 19/19 pytest                                      |
| TK-A9    | Train/ingest/replay + 4 score ML                            | A              | Đã được thực hiện gộp trong TK-A6/#19                  |
| TK-A10   | Chẩn đoán kết nối VPS 5 lớp                                 | A              | #14                                                    |
| TK-A13   | Express deploy/redeploy PRECHECK→RECORD + demo thật         | A              | #17 + #23; health ngoài mạng 200                       |
| TK-A14   | Dashboard tổng quan + History + log deploy                  | A              | #18                                                    |
| TK-A16   | M6 poller/rule/5 score/alert/monitor IPC                    | A              | PR #24 · review-07 APPROVED · focused 25/25            |
| TK-B1    | Collector scaffold                                          | B              | #6, pytest 3/3                                         |
| TK-B3    | Fixture metric cho A                                        | A làm fallback | `gen_fake_series.py` trong #19; B không cần làm lại    |
| TK-B7    | UI kết nối/tài nguyên/diagnosis đủ state                    | A làm thay     | #16 + smoke demo thật 30/08                            |
| TK-B9    | VPS Control Panel v1                                        | B              | #21; 172/172 test tại bàn giao                         |
| TK-S3    | Gate nền điều chỉnh: SSH/VPS/Express/ML skeleton            | Both           | Demo cơ bản hoàn tất; phần collector chuyển sang TK-S4 |

## Quy tắc cập nhật nhanh

1. Bắt đầu: đổi đúng task của mình thành `ĐANG LÀM`, ghi `START dd/mm` trong tk-file.
2. Cuối phiên: ghi `UPDATE` với code/test/việc tiếp theo.
3. Mở PR: chuyển `CHỜ REVIEW`, thêm link PR và kết quả gate.
4. Merge: tick DoD, ghi `DONE`, chuyển `HOÀN THÀNH`.
5. Vướng trên 30 phút: chuyển `BLOCKED`, ghi bằng chứng + điều kiện gỡ.
