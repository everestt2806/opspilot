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
- Nhánh Worker `feat/a17-demo-checkpoint` từ plan `ac6d8cd`; C01 đã APPROVED, C02 sửa review-04.
  [Ma trận yêu cầu và quy trình giao việc](../24-ke-hoach-demo-theo-chang.md#7-ma-trận-đầy-đủ-yêu-cầu-giao-worker).
  C00 [APPROVED](tk-a17/review-c00.md): code `d4ec3be`, docs `23cd248`; có kiểm chứng reviewer riêng.
  C01 [APPROVED review-03](tk-a17/review-c01.md): code `8e42856`, docs `9689ea4`;
  toàn bộ finding đã đóng bằng kiểm chứng reviewer độc lập.
- P0: website ghi chú thật → người dùng thấy chậm → Monitor giải thích/cảnh báo → khôi phục →
  website tốt lại, giữ dữ liệu; có timeline và so sánh trước/sau. A trình chiếu, thầy quan sát.
- Tiến độ theo C00–C09; C08 bắt buộc, chia C08A policy/C08B coordinator/C08C live, mỗi phần
  review riêng. Điểm nhấn tự khôi phục không manual/reset can thiệp. C02 `CHANGES_REQUESTED`.
  [Playbook Worker](../prompts/tk-a17-worker-playbook.md); không chia ngày/giờ công.

## Đang ưu tiên — W3/W4

| ID     | Task                                                                 | Chủ                   | Hạn      | Trạng thái | Branch                      | PR/phụ thuộc                | Ghi chú                                                                            |
| ------ | -------------------------------------------------------------------- | --------------------- | -------- | ---------- | --------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| TK-A17 | Demo trực quan: website → sự cố → khôi phục → đối chiếu dữ liệu      | A                     | C09      | ĐANG LÀM | `feat/a17-demo-checkpoint`  | `main@683bfc6`              | C02 REVIEW_FIX_REQUIRED theo review-07; C03-C09 NOT_RUN; chưa push/PR |
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

### TK-A17 update - 11/09 C02 handoff

C02 đã chạy live ingestion đúng VM02/app 1/deployment 9, giữ nguyên dữ liệu SQLite kế thừa và ghi boundary trước/sau.
Retry cùng snapshot không thêm rows, duplicate `(deployment_id, seq)=0`; focused 71/71 và static/build đều PASS.
Handoff `docs/tasks/tk-a17/handoff-c02.md` là `READY_FOR_LOCAL_REVIEW`; C03-C09 vẫn đóng/`NOT_RUN`.

### TK-A17 update - 11/09 C02 review-01

C02 **CHANGES_REQUESTED** tại code `0967fb9`, docs `8e08f76`: poller gán 80 rows trước thời điểm
deployment 9 bắt đầu vào deployment 9; regression reviewer 1/1 FAIL. C02-T5 cũng chưa quan sát
scheduler thật, và hồ sơ phải đối soát tổng mutation `+2120 metrics/+10600 scores`. Task về
`ĐANG LÀM`; C03-C09 tiếp tục đóng/`NOT_RUN`.

### TK-A17 update - C02 review-fix 01

C02 `BLOCKED`: boundary backlog requires Leader approval of the byte-boundary contract/schema proposal before implementation or live mutation. C02-R1-03/04/05 are documented; C02-R1-02 remains `NOT_RUN`. C03-C09 remain closed.

### TK-A17 update - 11/09 C02 proposal decision

Leader **APPROVED_WITH_AMENDMENTS** chiến lược byte boundary tại `87fa868`: bắt buộc dùng lịch sử
`deployment_activation`, file generation và cutover sau stop/flush collector trước healthcheck.
C02 được gỡ blocker để tiếp tục implementation, trạng thái `ĐANG LÀM`; C02 chưa APPROVED và
C03-C09 vẫn đóng/`NOT_RUN`.

### TK-A17 update - 11/09 C02 review-fix 02

C02 đã đóng R1-01…05 theo contract byte-boundary đã được duyệt bổ sung: migration `002`,
activation history, cutover/rollback, rotation và shared lock. Live VM02 forward deploy,
manual rollback và hai tick scheduler thật đạt; C02 `READY_FOR_LOCAL_REVIEW`. C03-C09 vẫn
đóng/`NOT_RUN`; code/docs SHA được ghi trong handoff sau commit.

### TK-A17 update - 11/09 C02 review-fix 03

C02 đã đóng R3-01…05 và phần còn lại R1-01: first deploy không có metrics file, stop/flush và
atomic snapshot, drain `.1`/gap policy, candidate runtime failure và v1→v2 partial migration.
Local `88/88`, collector `19/19`, static/build PASS; live forward 15/16, rollback retry 18 và
hai scheduler tick thật PASS. Handoff `READY_FOR_LOCAL_REVIEW`; C03-C09 đóng/`NOT_RUN`.

### TK-A17 update - 11/09 C02 review-03

C02 **CHANGES_REQUESTED** tại code `ce1a9ff`, submitted HEAD `0e7d207`. Reviewer regression xác
nhận first deploy fail khi `metrics.jsonl` chưa tồn tại; source review xác nhận cutover chưa
stop/flush collector, rotation không drain matching `.1`, failure sau runtime start có thể bỏ
candidate episode và migration/regression chưa đủ contract. Local focused 81/81 và 106/106,
collector 26/26, static/build PASS; không chạy live. C02 về `REVIEW_FIX_REQUIRED`; C03-C09 đóng.

### TK-A17 update - 11/09 C02 review-04

C02 **CHANGES_REQUESTED** tại code `fa72a6e`, submitted `85f4810`. Bốn regression reviewer đều
FAIL: snapshot fail để collector bị dừng; restore nonzero vẫn mở activation previous; first
generation ghi data-gap giả; matching `.1` partial bị bỏ mất không gap. Retry live 18 chọn chính
current deployment 16 nên chưa chứng minh rollback. Local 88/88, ML service 19/19, collector 26/26,
static/build PASS. C02 về `REVIEW_FIX_REQUIRED`; C03-C09 đóng/`NOT_RUN`.

### TK-A17 update - 11/09 C02 review-fix 04

C02 đã đóng `C02-R4-01...06` trên code `c6c728c`: collector resume/fail-closed recovery,
runtime image/state verification, exact current-deployment rollback target, first-generation
adoption và committed-byte rotation gap đã có production regressions. Local gates PASS: focused
18 files/90 tests, ML 19, collector 26, typecheck/lint/Prettier/build. VM02 live rollback
current `18/v18` -> target `16/v16` -> deployment `19`, scheduler hai tick với max concurrency 1
và exit 0; C02 `READY_FOR_LOCAL_REVIEW`. C03-C09 vẫn đóng/`NOT_RUN`, chưa push/PR/merge.

### TK-A17 update - 11/09 C02 review-fix 05

### TK-A17 update - 11/09 C02 review-fix 06

### TK-A17 update - 12/09 C02 review-fix 07

### TK-A17 update - 12/09 C02 review-fix 08

C02 đóng `C02-R8-01...03` và phần còn mở R7-03/R6-02 tại code `8fe4842`: reconcile reload prepared
episode dưới shared lock, kiểm boundary `size+1`, và activation/pointer cùng SQLite transaction.
Production regressions cover short/missing/mismatch snapshot, lineage cycle/missing, stale row,
close/reopen, injected pointer failure, retry và second tick. Local `18/99`, ML `19`, collector
`26`, typecheck/lint/Prettier/build PASS. Không live mutation; evidence deployment 20/21 và
`416+5=421`, `2080+25=2105` giữ nguyên. C02 `READY_FOR_LOCAL_REVIEW`; C03-C09 đóng/`NOT_RUN`.

C02 đóng `C02-R7-01...04` và phần còn mở R6-02...05 tại code `65d85ac`: reconciliation dùng
resolved rollback lineage, cycle/missing fail-closed; mixed-invalid rotation giữ valid rows trong
episode cũ và ghi từng byte range. Local `18/98`, ML `19`, collector `26`, typecheck/lint/Prettier/
build PASS. Read-only VM02 evidence: deployment 20 `424/2120`, deployment 21 `5/25`, activation
boundary `[1417093,1541655)` -> `[1541655,EOF)`, giải thích `416+5=421` và `2080+25=2105`.
C02 `READY_FOR_LOCAL_REVIEW`; C03-C09 đóng/`NOT_RUN`.

C02 đóng `C02-R6-01...05` và phần còn mở R5-02/04/05/06 tại code `61f43df`: owner unknown được
giữ qua stop/compose/inspect failure, prepared activation có reconciliation thật sau restart, và
rotated invalid line ghi đúng byte range. Local `18 files/96 tests`, ML `19`, collector `26`,
typecheck/lint/Prettier/build PASS. Controlled VM02 tạo deployment `21` với runtime v16/running sau
current runtime v15; scheduler hai tick, max concurrency 1, clean exit; live SQLite `+421/+2105`,
deployment 21 `5 rows`, retry/reconnect/duplicates `0`. C02 `READY_FOR_LOCAL_REVIEW`; C03-C09
đóng/`NOT_RUN`.

C02 đã đóng `C02-R5-01...06` tại code `37d9e19`: cleanup signal độc lập, runtime-owner state,
durable reconciliation barrier, committed-byte rotation retry và rollback lineage/runtime inspect.
Local focused `95/95`, ML `19/19`, collector `26/26`, typecheck/lint/Prettier/build PASS. Live
VM02 current runtime v16 chọn target runtime v15, rollback deployment `20` healthy; scheduler hai
tick, max concurrency 1, exit 0. C02 `READY_FOR_LOCAL_REVIEW`; C03-C09 vẫn đóng/`NOT_RUN`.

### TK-A17 update - 12/09 C02 review-08

C02 **CHANGES_REQUESTED** tại code `65d85ac`, submitted HEAD `2503c12`. Lineage resolver,
mixed-invalid EOF và read-only split 416/5 đạt; focused 98/98, ML 19/19, collector 26/26 và
static/build PASS. Hai reviewer recovery regression 0/2 PASS: snapshot ngắn hơn durable boundary
vẫn activate và activation/current pointer không cùng transaction. Mở `C02-R8-01…03`; C02 về
`REVIEW_FIX_REQUIRED`, C03-C09 tiếp tục đóng/`NOT_RUN`; không chạy live mutation.
