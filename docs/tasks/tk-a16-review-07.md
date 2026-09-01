# REVIEW 07 — TK-A16 M6 Poller + Rule Engine

> Reviewer: Codex/root
> Code được review: `92bb19f..d332931`
> Kết luận: **APPROVED LOCAL — không còn finding BLOCKING/MAJOR**
> Quyền Git: chưa push, chưa mở PR và chưa merge khi A chưa yêu cầu.

## 1. Tóm tắt

Ba commit vòng 6 đã xử lý đủ R6-01 đến R6-04 về code và regression:

- `5adaccb` — ML phát `down → up` khi `autoTrain:false` mà không gọi train.
- `734fccc` — `trainNow(<150)` trả `VALIDATION`; bổ sung exact batch, two-app và SQLite IPC tests.
- `d332931` — handoff/gate/traceability vòng 6.

Reviewer không tìm thấy regression chức năng mới. Phần log vòng 5 bị lặp và các placeholder SHA còn
sót được reviewer chuẩn hóa trong commit approval; đây là chỉnh sửa tài liệu, không yêu cầu thêm một
vòng Worker.

## 2. Phân tích ảnh hưởng

- GitNexus đã re-analyze đến `d332931`: 2.996 nodes, 6.307 edges, 248 flows.
- Compare `92bb19f..d332931` nhận diện 24 symbol đổi trong 8 file. Risk tổng hợp bị đẩy lên
  `critical` do method tên chung `poll` nối với nhiều flow SSH.
- Truy vấn riêng `MonitorService.pollAll` cho kết quả blast radius **LOW**: hai caller trực tiếp là
  `app/src/main/index.ts` và `service.test.ts`; cả hai tương thích và caller test có coverage.
- `trainNow` có hai caller: IPC registration và service test; error `AppError('VALIDATION')` được
  map đúng qua IPC wrapper.

Đánh giá thực tế của reviewer: **MEDIUM** vì thay đổi chạm poller/SQLite/ML lifecycle, nhưng phạm vi
caller nhỏ và đã có integration regression trực tiếp.

## 3. Đối chiếu finding R6

| Finding | Kết quả                   | Bằng chứng                                                                                  |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| R6-01   | PASS                      | `autoTrain:false`, ingest fail → success phát `[down, up]`, một failure log, `trainCalls=0` |
| R6-02   | PASS                      | 149 mẫu reject `VALIDATION`; 150 mẫu gọi train đúng deployment/count                        |
| R6-03   | PASS                      | focused 25/25; exact batch, empty tick, two app tuần tự và monitor IPC dùng SQLite thật     |
| R6-04   | PASS sau cleanup reviewer | handoff nhất quán; task log bỏ hai bộ vòng 5 bị lặp; SHA được khóa cụ thể                   |

Không còn finding mức BLOCKING hoặc MAJOR. Không sửa renderer, contract, migration, collector,
deploy hoặc dependency.

## 4. Gate reviewer độc lập — Node 22.23.2

| Gate                                | Kết quả                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| Focused monitor + shutdown + IPC    | `25/25 PASS`                                                   |
| CLI SQLite/MonitorPoller thật       | `150 metrics / 750 scores / 0 alerts / offset 43008 / retry 0` |
| Lint                                | exit 0, 16 warning renderer baseline                           |
| Typecheck                           | PASS                                                           |
| Scoped Prettier                     | PASS                                                           |
| Build                               | PASS, 3045 modules transformed                                 |
| Full suite verbose                  | `180/200`; 20 failures đều là renderer timeout dưới tải        |
| `VpsOverviewTab.test.tsx` isolated  | `3/3 PASS`                                                     |
| `git diff --check 92bb19f..d332931` | PASS                                                           |

Full-suite có mức dao động Worker `189/200` và reviewer `180/200`, nhưng không có failure main/
monitor; branch vòng 6 không đổi renderer và isolated renderer liên quan xanh. Baseline này được ghi
nhận thành test-infrastructure debt riêng, không chặn approval M6.

## 5. Kết luận và bước tiếp theo

TK-A16 đạt **APPROVED LOCAL**. Board tiếp tục ở `CHỜ REVIEW` vì quy trình chỉ cho `HOÀN THÀNH` sau
khi được A cho phép push, mở PR, merge vào `main` và chạy lại gate sau merge.

Khi A quyết định đưa code lên remote:

1. Push branch `feat/m06-monitor-poller-rule`.
2. Mở PR vào `main`, đính kèm file review này và nêu renderer baseline exception.
3. Chạy CI/review diff remote; chỉ merge khi A ra lệnh.
4. Sau merge, đồng bộ `main`, chạy focused gate rồi mới chuyển TK-A16 sang `HOÀN THÀNH`.

## 6. Xác nhận an toàn

- `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và `stash@{0}` giữ nguyên.
- Không có secret, DB hoặc runtime state trong diff.
- **CHƯA PUSH — CHƯA MỞ PR — CHƯA MERGE.**
