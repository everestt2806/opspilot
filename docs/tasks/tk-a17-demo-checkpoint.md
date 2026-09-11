# TK-A17 — Điều phối Worker và review từng chặng

| Chủ    | Branch plan                | Baseline code | Trạng thái                  |
| ------ | -------------------------- | ------------- | --------------------------- |
| A solo | `feat/a17-demo-checkpoint` | `683bfc6`     | ĐANG LÀM — C02 CHANGES_REQUESTED |

[Plan tổng](../24-ke-hoach-demo-theo-chang.md) · [Prompt](../prompts/tk-a17-worker.md)
· [Sổ bàn giao](tk-a17-worker-handoff.md).
Hướng dẫn thực thi: [Worker playbook](../prompts/tk-a17-worker-playbook.md).
Yêu cầu đầy đủ: [plan mục 7–10](../24-ke-hoach-demo-theo-chang.md#7-ma-trận-đầy-đủ-yêu-cầu-giao-worker).
Khảo sát: [preflight 11/09](tk-a17/preflight-11-09.md). Trạng thái mới:
[C00 APPROVED](tk-a17/review-c00.md), code `d4ec3be` / docs `23cd248`.
[C01 APPROVED review-03](tk-a17/review-c01.md), code `8e42856` / docs `9689ea4`; mở C02.
[C02 review-03 CHANGES_REQUESTED](tk-a17/review-c02.md), code `ce1a9ff` / submitted `0e7d207`;
C03–C09 tiếp tục đóng.
Mục tiêu: A trình chiếu **tự phát hiện → tự rollback → xác minh phục hồi**. C08 bắt buộc.
Không chia theo ngày/giờ công. Thời lượng 10s/30s/baseline/test vẫn giữ theo yêu cầu kỹ thuật.

## 1. File giao theo thứ tự

| Chặng | Phụ thuộc APPROVED | File                                  | Phạm vi review                                 |
| ----- | ------------------ | ------------------------------------- | ---------------------------------------------- |
| C00   | Không              | [c00](tk-a17/c00-baseline.md)         | Môi trường và target                           |
| C01   | C00                | [c01](tk-a17/c01-collector-deploy.md) | Deploy/collector                               |
| C02   | C01                | [c02](tk-a17/c02-ingestion.md)        | SSH/SQLite, lifecycle deployment               |
| C03   | C02                | [c03](tk-a17/c03-ml-runtime.md)       | ML runtime                                     |
| C04   | C03                | [c04](tk-a17/c04-demo-experience.md)  | Website nghiệp vụ demo                         |
| C05   | C04                | [c05](tk-a17/c05-monitor-ui.md)       | Monitor chỉ đọc                                |
| C06   | C05                | [c06](tk-a17/c06-incident-flow.md)    | Alert/settings/fault/before-after              |
| C07   | C06                | [c07](tk-a17/c07-recovery.md)         | Versions/rollback/history                      |
| C08   | C07                | [c08](tk-a17/c08-auto-rollback.md)    | Bắt buộc: C08A → C08B → C08C, review từng phần |
| C09   | C08C APPROVED      | [c09](tk-a17/c09-demo-acceptance.md)  | Nghiệm thu toàn luồng tự khôi phục             |

Worker chỉ code một chặng mỗi lượt, không tự chạy cả bảng. B6/B8/S4 là scope trong A17,
không mở task ĐANG LÀM song song. Mỗi chặng có file chi tiết gồm đầu vào, việc làm, file được
sửa, test, DoD, evidence, trọng tâm review và điểm dừng. C08A/B/C cũng dừng review riêng.

## 2. Đọc trước và quyền thực hiện

1. Đọc `CLAUDE.md`, `docs/tasks/README.md`, board, plan tổng, file này, sổ bàn giao và
   đúng chặng. Đọc thêm contract/spec mà chặng chỉ ra trước sửa code.
2. Worker tạo `feat/a17-demo-checkpoint` từ HEAD nhánh plan chứa hồ sơ mới nhất. Nhánh đã
   có thì tiếp tục HEAD hiện tại; không tạo từ main cũ bỏ mất tài liệu/rewrite lịch sử.
3. Ghi base SHA trước sửa, chặng trước đã approve và reviewed SHA được kế thừa.
4. Được sửa/test/commit local. Commit/comment kỹ thuật tiếng Anh theo yêu cầu A; UI/docs
   tiếng Việt. Không push/PR/merge/spawn subagent; giữ untracked/stash của A.
5. A nhận scope B6/B8 để làm solo. Không migrate, detector breadth, redesign shell/title bar,
   thí nghiệm chính thức, thêm dependency/LLM API. Tái dùng AntD/Recharts/services/IPC.
6. Contract thắng. Mismatch chặn thật: lập proposal cụ thể/ảnh hưởng cho Leader trước đổi;
   schema cần migration mới. Không thêm `error_rate_source` từ bản RC đề xuất cũ.
7. GitNexus context/impact hỗ trợ core review nếu khả dụng; xác nhận source trực tiếp.
   Công cụ lỗi thì ghi hạn chế, dùng rg và tiếp tục trong scope.

## 3. Quy trình review mỗi chặng

1. Worker START, code/test đúng file chặng. Commit theo thay đổi có nghĩa, tránh một commit
   trộn backend/UI/model. Code sẵn đã đúng thì kiểm chứng, không viết lại cho có diff.
2. Tạo `docs/tasks/tk-a17/handoff-cNN.md`; evidence vào `docs/evidence/tk-a17/cNN/`.
   Ghi base/code HEAD, commands/cwd/runtime/exit/count/raw log, proof UI/VPS và việc chưa xong.
3. Update task log/board/sổ bàn giao. Gửi A kết quả READY_FOR_LOCAL_REVIEW hoặc BLOCKED rồi dừng.
4. Leader tạo `docs/tasks/tk-a17/review-cNN.md`: reviewed SHA, finding ID, severity,
   file/line, trigger, expected/actual, regression yêu cầu, verdict và chặng được mở tiếp.
5. Worker sửa ở HEAD hiện tại, append REVIEW-FIX: finding → commit → regression → evidence.
   Leader đóng finding; Worker không tự approve. Không code chặng sau trong lúc chờ review.
6. Chặng cũ phát sinh regression: mở lại review của chặng gốc, kiểm tra downstream bị ảnh hưởng.
   Không gọi “baseline” để bỏ qua lỗi khi chưa chứng minh trên baseline tương ứng.

Severity findings: BLOCKER/MAJOR/MINOR (khác ưu tiên feature P0/P1). BLOCKER/MAJOR về đúng
đắn, dữ liệu, secret hoặc demo phải đóng trước APPROVED. CHANGES_REQUESTED thì sửa cùng chặng;
BLOCKED cần bằng chứng và điều kiện gỡ. Chỉ C09 có verdict DEMO_READY.

## 4. Gate chung

- C00 ghi Node 22/pnpm/Python venv/native ABI thực tế. C01–C08 chạy test liên quan và scoped
  format/lint/typecheck khi đổi TS; Python đổi chạy suite liên quan. Build/smoke theo file chặng.
- C09 chạy full suite tuần tự Node 22 và build. Không skip test hay tăng timeout hàng loạt.
  Process treo: thu log/chẩn đoán rồi dừng đúng process mình tạo, ghi FAIL, không báo pass
  vì mới “transform complete”. Reviewer và Worker ghi kết quả riêng theo SHA.
- Fixture test được mock để kiểm tra logic; evidence demo/live không được mock. Screenshot
  placeholder không phải bằng chứng PASS. Không hiển thị số giả hoặc spinner có delay giả.
- Mọi trạng thái/summary trước-sau phải có nguồn dữ liệu, đơn vị, time window, null/stale policy.
  Không suy “đã phục hồi” chỉ vì lệnh rollback trả ID hoặc timestamp mới.

## 5. VPS và artifact

C00 read-only. Từ C01 deploy app demo riêng theo manifest đã kiểm tra, tạo record bằng service
thật. Không sửa app B, không reset toàn VPS/SQLite/experiment; không ghi secret vào git/log.
Thiếu credential thì báo blocker cụ thể, không yêu cầu paste secret trong chat. Chuẩn bị docs/
test plan được tiếp tục; không vượt live gate. Reset/xoá cần yêu cầu reset riêng của A theo
manifest; helper phục hồi fault của chính lượt test được thực hiện theo scope chặng.

## 6. Nhật ký

- START 10/09 — Leader lập plan theo `main@683bfc6`, chưa code/test runtime mới.
- UPDATE 10/09 — Source/merge: Monitor UI thiếu, Apps/Versions còn mock, compose thiếu
  collector; B6 report `dfc0ed7` chưa thuộc main. Shell Node `v24.16.0`, C00 cần Node 22.
- UPDATE 10/09 — Theo yêu cầu A, thay lịch ngày/G0–G3 bằng C00–C09 có review độc lập.
  Bổ sung website nghiệp vụ demo, màn tình trạng dễ hiểu, timeline/so sánh trước-sau;
  M8 tùy chọn theo readiness. Chưa có chặng PASS.

- UPDATE 10/09 — A xác nhận tự thao tác/trình chiếu, cần bước tiến chức năng lớn: nâng C08
  thành bắt buộc, tách C08A/B/C và thêm playbook thi công. Ghi chú “tùy chọn” trước đó chỉ
  là lịch sử. Chưa implementation/test runtime mới.

Worker append START/UPDATE/HANDOFF-LOCAL/REVIEW-FIX với ngày thực tế để giữ lịch sử.

- START 11/09 — Worker tiếp tục từ plan HEAD `ac6d8cd74204d66ba9122ca615876480808572e4`,
  tạo `feat/a17-demo-checkpoint`; chỉ C00: runtime/native ABI, focused tests, SSH read-only,
  manifest và boot evidence. Giữ ba mục untracked của A và stash hiện có; không làm C01.
- UPDATE 11/09 — A làm rõ yêu cầu: Leader lên kế hoạch chi tiết để A giao Worker, dừng
  thực thi C00 ở mức khảo sát. Đã ghi preflight: focused 64/64, collector 26/26,
  typecheck/build exit 0, native/boot/SSH VM02 có quan sát; chưa có handoff/review C00.
  Bổ sung ma trận R01–R25, 12 lượt giao, xử lý blocker và prompt khởi động kế thừa HEAD.
  Task về TUẦN NÀY để Worker nhận C00; không mở C01 hoặc tự approve kết quả khảo sát.
- HANDOFF-LOCAL 11/09 — Bản kế hoạch nằm trong commit chứa dòng này; kiểm tra local Markdown
links của 10 file thành công, `git diff --check` sạch. Không chạy thêm runtime/test sản phẩm
sau khi A chuyển yêu cầu sang lập kế hoạch. Raw evidence/helper khảo sát vẫn local chưa commit;
việc tiếp theo: A gửi prompt khởi động cho Worker hoàn thiện C00. Chưa push/PR/merge.

- START 11/09 — Worker tiếp tục tại `bf951f9`; chỉ thực hiện C00: tái kiểm tra runtime/native
ABI, focused tests, SSH read-only, manifest và boot/browser evidence. Không làm C01 hoặc chạm
app B, dữ liệu thật và stash hiện có.
- UPDATE 11/09 — C00-T1/T2/T4 PASS với runtime/lệnh đã chạy lại; VM02 read-only PASS, VM01
 timeout được ghi rõ; public port B timeout và tunnel chỉ xem app B. Đã tạo baseline/manifest/
 evidence và đánh dấu C01–C09 NOT_RUN. C00 chờ commit local và Leader review.
- HANDOFF-LOCAL 11/09 — `handoff-c00.md`, evidence `docs/evidence/tk-a17/c00/`; READY_FOR_LOCAL_REVIEW.
 Chưa push/PR/merge; Leader cần review target/ABI và mở C01 riêng nếu approve.
Chờ review: board CHỜ REVIEW kèm ID chặng. Tiếp tục/sửa: ĐANG LÀM.
HOÀN THÀNH chỉ sau merge và đủ DoD; DEMO_READY không cấp quyền push/merge.

- START 11/09 — Leader review C00: input code `d4ec3be`, docs `23cd248`, kế thừa plan
  `bf951f9`; kiểm tra scope/ancestry, raw evidence, native runtime và target read-only.
  Chạy kiểm chứng độc lập có log reviewer riêng; chưa mở hoặc thực thi C01.
- REVIEW 11/09 — [review-c00](tk-a17/review-c00.md): APPROVED code `d4ec3be` / docs `23cd248`.
  Reviewer tự chạy focused 64/64, collector 26/26, typecheck node/web, native Node/Electron
  và SSH VM02 exit 0; raw JSON tại `docs/evidence/tk-a17/c00/review-01/`. Đã đọc build/boot/
  browser evidence Worker và mở ảnh, không báo các bước đó là reviewer chạy lại.
  Đóng hai MINOR hồ sơ; chấp nhận giới hạn helper C00 theo review. Mở duy nhất C01 để A
  giao Worker, target VM02/a17-notes-0911 phải kiểm tra lại trước deploy. Không thực hiện C01,
  không push/PR/merge; task TUẦN NÀY cho lượt Worker tiếp.

- START 11/09 — Worker tiếp tục HEAD hiện tại `1b447e4` sau C00 APPROVED; chỉ C01: collector
 packaging/compose, deploy v1-v2, marker PostgreSQL, JSONL soak và failure isolation.
- UPDATE 11/09 — C01 initial v1 fail thật vì PostgreSQL readiness; đã sửa healthcheck/
 `depends_on: service_healthy`, test 44/44 và live v6/v7 running. Marker/volume/collector
 soak/failure isolation đã kiểm tra; C02+ NOT_RUN.
- HANDOFF-LOCAL 11/09 — `handoff-c01.md`, evidence `docs/evidence/tk-a17/c01/`;
 READY_FOR_LOCAL_REVIEW. Chưa push/PR/merge.

- START 11/09 — Leader review C01 tại code `66cbdab`, docs `f0b73aa`, kế thừa review C00
  `1b447e4`. Đọc diff/source/evidence, chạy regression và static checks độc lập, kiểm tra
  SQLite local cùng VM02 read-only; không deploy/restart, không sửa app B và không mở C02.
- REVIEW 11/09 — [review-c01](tk-a17/review-c01.md): **CHANGES_REQUESTED** với 2 BLOCKER,
  3 MAJOR, 1 MINOR. Packaged app thiếu collector resource; collector live đã exited; Express
  generic bị ép `/items`; build fail có thể xóa shared collector tag; helper đã ingest 21 metric
  và ghi 105 score rows của chặng C02; provenance docs chưa đúng bản nộp. Reviewer xác nhận
  soak seq 2–91 liên tục 886 giây, focused 64/64, collector 26/26 và static checks đạt.
  Task về ĐANG LÀM để Worker sửa C01 trên HEAD hiện tại; C02–C09 tiếp tục đóng.
- REVIEW-FIX 11/09 — C01 findings `C01-R1-01…06` fixed at code `0d15eb5`; focused,
  collector/static/build and VM02 evidence are in `tk-a17/handoff-c01.md` and
  `docs/evidence/tk-a17/c01/review-fix-01.md`. Collector remained running after helper exit
  and seq increased; C02-C09 remain `NOT_RUN`; outcome `READY_FOR_LOCAL_REVIEW`.
- REVIEW 02 11/09 — Leader review code `0d15eb5`, docs `518644f`: packaged artifact, tag
  cleanup, live collector và helper isolation đạt; independent focused 73/73, collector 26/26,
  typecheck/lint/format/build/unpack PASS. Mở `C01-R2-01` MAJOR vì POST-only `/items` và
  GET `/items/:id` đều bị resolver nhận nhầm là GET `/items` collection; reviewer regression
  2/2 FAIL. C01 tiếp tục ĐANG LÀM, C02–C09 đóng; không push/PR/merge.
- REVIEW-FIX 02 11/09: `C01-R2-01` closed at code `8e42856`; two route regressions and
  focused/static/build checks PASS. Read-only VM02 seq `372→373`; no deploy/marker; C02-C09
  remain `NOT_RUN`.
- REVIEW 03 11/09 — [review-c01](tk-a17/review-c01.md): **APPROVED** code `8e42856`, docs
  `9689ea4`; mọi finding review 01–02 đã đóng. Reviewer focused 75/75, collector 26/26,
  typecheck/lint/format/build PASS; VM02 read-only app v9/DB healthy, collector running,
  restart 0, seq `1791→1792`, app B running. Mở duy nhất C02; C03–C09 đóng; task về
  TUẦN NÀY cho lượt Worker tiếp, chưa push/PR/merge.

  - HANDOFF C02 11/09: live SSH/SQLite ingestion trên VM02 app 1 deployment 9 đã ghi boundary
    trước/sau, thêm 10 metric/50 score, retry `0`, duplicate `0`; focused 71/71 và static/build PASS.
    `handoff-c02.md` là `READY_FOR_LOCAL_REVIEW`; C03-C09 vẫn `NOT_RUN`, chưa push/PR/merge.
- REVIEW C02 01 11/09 — [review-c02](tk-a17/review-c02.md): **CHANGES_REQUESTED** tại code
  `0967fb9`, docs `8e08f76`. Reviewer focused 71/71, collector 26/26 và static/build PASS, nhưng
  regression boundary 1/1 FAIL. SQLite read-only có 80 rows seq `22..101` trước activation v9 bị
  gán vào deployment 9; tổng mutation C02 thực tế là `+2120 metrics/+10600 scores`. C02-T5 chưa
  quan sát scheduler thật. Task về ĐANG LÀM; C03–C09 đóng; không push/PR/merge.

  - REVIEW-FIX C02 01: Worker dừng trước implementation boundary vì cần Leader duyệt proposal contract/schema byte activation. Handoff `BLOCKED`; dữ liệu 80 rows nhiễm được giữ nguyên; C03-C09 vẫn `NOT_RUN`.
- REVIEW C02 02 11/09 — Leader **APPROVED_WITH_AMENDMENTS** proposal tại `87fa868`: dùng lịch sử
  activation theo runtime episode, stream generation và stop/flush collector trước boundary. Gỡ
  blocker để Worker tiếp tục implementation C02; C02 chưa APPROVED, C03–C09 vẫn đóng.

- REVIEW-FIX C02 02 11/09 — Worker triển khai migration `002` và persistent activation boundary,
  đóng C02-R1-01…05 bằng regression, live forward deploy/manual rollback và hai tick
  MonitorScheduler thật trên VM02. Handoff C02 `READY_FOR_LOCAL_REVIEW`; C03-C09 tiếp tục
  đóng/`NOT_RUN`, không train/score ML, UI, fault coordinator hoặc thao tác app B.
- REVIEW C02 03 11/09 — [review-c02](tk-a17/review-c02.md): **CHANGES_REQUESTED** tại code
  `ce1a9ff`, submitted HEAD `0e7d207`. Reviewer regression 1/1 FAIL vì first deploy đọc
  `metrics.jsonl` trước khi collector tạo file. Cutover thiếu stop/flush, rotation không drain `.1`,
  post-runtime failure có thể bỏ candidate episode và regression/migration chưa đủ. Local focused
  81/81 + 106/106, collector 26/26, static/build PASS; không chạy live. C02 về
  `REVIEW_FIX_REQUIRED`; C03-C09 tiếp tục đóng/`NOT_RUN`.
