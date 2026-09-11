# BẢNG TASK — NGUỒN SỰ THẬT VỀ TRẠNG THÁI

> Quy trình bắt buộc: [`README.md`](README.md). Kế hoạch sau demo và điểm vào cho AI mới:
> [`../24-ke-hoach-demo-theo-chang.md`](../24-ke-hoach-demo-theo-chang.md).
>
> Trạng thái hợp lệ: `BACKLOG · TUẦN NÀY · ĐANG LÀM · CHỜ REVIEW · HOÀN THÀNH · BLOCKED`.
> Mỗi người tối đa **một** task `ĐANG LÀM`; Worker đổi trạng thái khi thật sự bắt đầu, không đổi
> thay người kia. `HOÀN THÀNH` chỉ sau khi PR merge `main` và đủ bằng chứng.

## Điểm vào hiện tại — 11/09/2026

- **A solo:** TK-A17 — [task packet](tk-a17-demo-checkpoint.md),
  [prompt Worker](../prompts/tk-a17-worker.md), [handoff/review](tk-a17-worker-handoff.md).
- **B:** không có task chặn demo; A nhận tích hợp B6/B8 trong A17 từ 10/09 theo yêu cầu solo.
  Code B4/B5/B2 đã merge; báo cáo runtime B6 còn ở nhánh riêng, cần tái xác minh.
- Baseline đã fetch: `origin/main@683bfc6`; PR #25 (A15), #26 (B4/B5), #28 (B2) đã merge.
- Nhánh Worker `feat/a17-demo-checkpoint` từ plan `ac6d8cd`; C01 đã APPROVED, C02 sẵn giao Worker.
  [Ma trận yêu cầu và quy trình giao việc](../24-ke-hoach-demo-theo-chang.md#7-ma-trận-đầy-đủ-yêu-cầu-giao-worker).
  C00 [APPROVED](tk-a17/review-c00.md): code `d4ec3be`, docs `23cd248`; có kiểm chứng reviewer riêng.
  C01 [APPROVED review-03](tk-a17/review-c01.md): code `8e42856`, docs `9689ea4`;
  toàn bộ finding đã đóng bằng kiểm chứng reviewer độc lập.
- P0: website ghi chú thật → người dùng thấy chậm → Monitor giải thích/cảnh báo → khôi phục →
  website tốt lại, giữ dữ liệu; có timeline và so sánh trước/sau. A trình chiếu, thầy quan sát.
- Tiến độ theo C00–C09; C08 bắt buộc, chia C08A policy/C08B coordinator/C08C live, mỗi phần
  review riêng. Điểm nhấn tự khôi phục không manual/reset can thiệp. C02 đã mở, chưa thực hiện.
  [Playbook Worker](../prompts/tk-a17-worker-playbook.md); không chia ngày/giờ công.

## Đang ưu tiên — W3/W4

| ID     | Task                                                                 | Chủ                   | Hạn      | Trạng thái | Branch                      | PR/phụ thuộc                | Ghi chú                                                                            |
| ------ | -------------------------------------------------------------------- | --------------------- | -------- | ---------- | --------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| TK-A17 | Demo trực quan: website → sự cố → khôi phục → đối chiếu dữ liệu      | A                     | C09      | TUẦN NÀY | `feat/a17-demo-checkpoint`  | `main@683bfc6`              | C01 APPROVED; mở C02 cho lượt Worker tiếp; chưa push/PR |
| TK-A15 | M4 hardening: rollback thật + 3 image + diagnostic/retry + lock port | A                     | 08/09    | HOÀN THÀNH | `feat/m04-deploy-hardening` | #25 merge                   | Evidence VM02 01/09 và full 220/220; A17 chạy gate mới                             |
| TK-B4  | M5: docker stats + HTTP probe local                                  | B                     | 01/09    | HOÀN THÀNH | `feat/m05-collector-probes` | Gộp #26 merge               | `fe1da33`; 21/21 theo task B                                                       |
| TK-B5  | M5: metrics.jsonl + latest.json, seq/fsync/rotation                  | B → A nghiệm thu      | C02      | CHỜ REVIEW | `feat/m05-collector-output` | #26 merge                   | Code đã merge; DoD SSH tail tại A17/C02                                            |
| TK-B6  | M5: collector Docker trên VPS                                        | B → A tích hợp        | C01      | CHỜ REVIEW | `feat/m05-collector-docker` | report `dfc0ed7` chưa merge | A17/C00–C01 tái xác minh, giữ app B                                                |
| TK-S4  | Gate dữ liệu thật A16 + collector VPS                                | A solo                | C03      | TUẦN NÀY   | Qua TK-A17                  | C01–C03                     | Collector, ingestion và ML có review riêng                                         |
| TK-B8  | Monitor Dashboard: chart + score + alert UI                          | A làm thay B từ 10/09 | C06      | TUẦN NÀY   | Qua TK-A17                  | C05–C06                     | Monitor dễ hiểu, alert/label/settings/summary; không task song song                |
| TK-A7  | M3: detector 3 Tier 1                                                | A                     | Sau demo | BACKLOG    | `feat/m03-tier1-detectors`  | Sau A17                     | Hoãn để ưu tiên demo dữ liệu thật                                                  |
| TK-B2  | M12: next-blog + vite-spa + fault endpoint                           | B                     | 10/09    | HOÀN THÀNH | `feat/m12-demo-apps-rest`   | #28 merge                   | 3 app Docker/fault smoke theo B; detector 3 stack chưa hoàn thành                  |
| TK-S5  | Gate MVP 16/24 FR + smoke/rollback/alert                             | A solo                | Sau A17  | BACKLOG    | —                           | A17/C09                     | Demo có evidence, không tự xác nhận 16/24 FR                                       |

## Phụ thuộc được xử lý trong A17 hoặc sau demo

| ID    | Task                                                    | Chủ | Trạng thái | Điều kiện gỡ chặn                                          |
| ----- | ------------------------------------------------------- | --- | ---------- | ---------------------------------------------------------- |
| TK-A5 | M1 readFileTail + resource check — nghiệm thu file thật | A   | TUẦN NÀY   | B5 code đã merge; nghiệm thu A17/C02 cùng TK-S4            |
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
### TK-A17 update - 11/09 review-fix

TK-A17 remains `ĐANG LÀM`; C01 findings `C01-R1-01…06` are fixed in code `0d15eb5` and
handed back as `READY_FOR_LOCAL_REVIEW`. C02-C09 remain closed/`NOT_RUN`; no push/PR/merge.

### TK-A17 update - 11/09 review-02

C01 review-fix được kiểm tại code `0d15eb5`, docs `518644f`. Năm finding review-01 đã đóng;
`C01-R2-01` MAJOR còn mở vì detector nhận nhầm POST/detail-only `/items` là GET collection
route. Task tiếp tục `ĐANG LÀM`; C02-C09 đóng; chưa push/PR/merge.
- C01 REVIEW-FIX 02: `C01-R2-01` closed at code `8e42856`; focused/static/build checks pass,
  read-only VM02 seq `372→373`, no deploy/marker. Handoff is `READY_FOR_LOCAL_REVIEW`.

### TK-A17 update - 11/09 review-03

C01 APPROVED tại code `8e42856`, docs `9689ea4`; reviewer chạy focused 75/75, collector
26/26, typecheck/lint/format/build và VM02 read-only seq `1791→1792` đều đạt. Task về
`TUẦN NÀY`; mở duy nhất C02, C03-C09 đóng; chưa push/PR/merge.
