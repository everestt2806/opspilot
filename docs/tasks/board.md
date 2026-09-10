# BẢNG TASK — NGUỒN SỰ THẬT VỀ TRẠNG THÁI

> Quy trình bắt buộc: [`README.md`](README.md). Kế hoạch sau demo và điểm vào cho AI mới:
> [`../24-ke-hoach-demo-3-ngay.md`](../24-ke-hoach-demo-3-ngay.md).
>
> Trạng thái hợp lệ: `BACKLOG · TUẦN NÀY · ĐANG LÀM · CHỜ REVIEW · HOÀN THÀNH · BLOCKED`.
> Mỗi người tối đa **một** task `ĐANG LÀM`; Worker đổi trạng thái khi thật sự bắt đầu, không đổi
> thay người kia. `HOÀN THÀNH` chỉ sau khi PR merge `main` và đủ bằng chứng.

## Điểm vào hiện tại — 10/09/2026

- **A solo:** TK-A17 — [task packet](tk-a17-demo-checkpoint.md),
  [prompt Worker](../prompts/tk-a17-worker.md), [handoff/review](tk-a17-worker-handoff.md).
- **B:** không có task chặn demo; A nhận tích hợp B6/B8 trong A17 từ 10/09 theo yêu cầu solo.
  Code B4/B5/B2 đã merge; báo cáo runtime B6 còn ở nhánh riêng, cần tái xác minh.
- Baseline đã fetch: `origin/main@683bfc6`; PR #25 (A15), #26 (B4/B5), #28 (B2) đã merge.
- Nhánh plan `plan/a17-demo-checkpoint` từ baseline; chưa implementation/test runtime A17.
- P0: collector deploy kèm app → metric thật/ML → Monitor/alert/label → recovery/rollback thủ công.
  M8 theo score là P1 có điều kiện; ngày 12/09 đóng băng, demo dự kiến 13/09.

## Đang ưu tiên — W3/W4

| ID     | Task                                                                 | Chủ                   | Hạn      | Trạng thái | Branch                      | PR/phụ thuộc                | Ghi chú                                                                 |
| ------ | -------------------------------------------------------------------- | --------------------- | -------- | ---------- | --------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| TK-A17 | Demo solo: collector/ML live + Monitor/alert + recovery/versions     | A                     | 12/09    | TUẦN NÀY   | `plan/a17-demo-checkpoint`  | `main@683bfc6`              | Plan sẵn sàng; Worker chưa bắt đầu; G1/G2/G3 + P1 có mốc cắt            |
| TK-A15 | M4 hardening: rollback thật + 3 image + diagnostic/retry + lock port | A                     | 08/09    | HOÀN THÀNH | `feat/m04-deploy-hardening` | #25 merge                   | Evidence VM02 01/09 và full 220/220; A17 chạy gate mới                  |
| TK-B4  | M5: docker stats + HTTP probe local                                  | B                     | 01/09    | HOÀN THÀNH | `feat/m05-collector-probes` | Gộp #26 merge               | `fe1da33`; 21/21 theo task B                                            |
| TK-B5  | M5: metrics.jsonl + latest.json, seq/fsync/rotation                  | B → A nghiệm thu      | 10/09    | CHỜ REVIEW | `feat/m05-collector-output` | #26 merge                   | Code đã merge; 26/26 + smoke local theo B; DoD SSH tail khép tại A17/G1 |
| TK-B6  | M5: collector Docker trên VPS                                        | B → A tích hợp        | 10/09    | CHỜ REVIEW | `feat/m05-collector-docker` | report `dfc0ed7` chưa merge | B báo VM02 68 mẫu/11 phút; A17/G1 tái xác minh, giữ app B               |
| TK-S4  | Gate dữ liệu thật A16 + collector VPS                                | A solo                | 10/09    | TUẦN NÀY   | Qua TK-A17                  | G1/R1                       | Không còn chờ B; chọn VPS sau preflight                                 |
| TK-B8  | Monitor Dashboard: chart + score + alert UI                          | A làm thay B từ 10/09 | 11/09    | TUẦN NÀY   | Qua TK-A17                  | G2/R2                       | Chưa có code Monitor UI trong main; không task song song                |
| TK-A7  | M3: detector 3 Tier 1                                                | A                     | Sau demo | BACKLOG    | `feat/m03-tier1-detectors`  | Sau A17                     | Hoãn để ưu tiên demo dữ liệu thật                                       |
| TK-B2  | M12: next-blog + vite-spa + fault endpoint                           | B                     | 10/09    | HOÀN THÀNH | `feat/m12-demo-apps-rest`   | #28 merge                   | 3 app Docker/fault smoke theo B; detector 3 stack chưa hoàn thành       |
| TK-S5  | Gate MVP 16/24 FR + smoke/rollback/alert                             | A solo                | Sau A17  | BACKLOG    | —                           | A17/R3                      | A17 là checkpoint demo, không tự xác nhận 16/24 FR                      |

## Phụ thuộc được xử lý trong A17 hoặc sau demo

| ID    | Task                                                    | Chủ | Trạng thái | Điều kiện gỡ chặn                                          |
| ----- | ------------------------------------------------------- | --- | ---------- | ---------------------------------------------------------- |
| TK-A5 | M1 readFileTail + resource check — nghiệm thu file thật | A   | TUẦN NÀY   | B5 code đã merge; nghiệm thu A17/G1 cùng TK-S4             |
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
