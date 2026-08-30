# REVIEW 01 — TK-A16 M6 Poller + Rule Engine

| Trường | Giá trị |
|---|---|
| Reviewer | Codex/root |
| Thời điểm | 30/08/2026 18:35 ICT |
| Baseline | `affc6d8` |
| Worker HEAD | `bfba6c4` |
| Kết luận | `REQUEST_CHANGES` |
| Trạng thái task | `BLOCKED` — chưa đạt local review |
| Remote | Chưa push, chưa mở PR, chưa merge |

## 1. Tóm tắt review

GitNexus `detect_changes(compare affc6d8)` ghi nhận 99 symbol thay đổi trong 20 file, ảnh hưởng 16
execution flow và xếp risk tổng thể `CRITICAL` vì chạm đường dữ liệu SSH/SQLite và hàm đăng ký IPC.
Graph cũng xác nhận `MonitorPoller` hiện chỉ có caller từ test; runtime chưa gọi poller.

Reviewer chạy lại độc lập bằng Node `v22.23.2`:

- `pnpm test`: PASS, 41 file/186 test.
- `pnpm lint`: 0 error, 16 warning Prettier ở renderer baseline không thuộc diff TK-A16.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.
- Prettier scoped `src/main/index.ts src/main/ipc.ts src/main/monitor`: PASS.

186 test xanh chỉ chứng minh phần scaffold hiện có; chưa chứng minh DoD vì runtime poll, ML động,
mutation IPC, event tick và CLI chưa tồn tại. Không format/sửa 16 warning renderer ngoài scope. Trong
vòng sửa, Prettier scoped của toàn bộ file TK-A16 phải xanh; full check được phép ghi lại baseline
failure nếu danh sách ngoài scope không tăng.

## 2. Finding bắt buộc sửa

### R01 — BLOCKING — Runtime scheduler không poll dữ liệu

- Bằng chứng: `app/src/main/index.ts` tạo `new MonitorScheduler(async () => undefined)`; GitNexus chỉ
  thấy `MonitorPoller` được gọi từ `poller.test.ts`.
- Hậu quả: app chạy thật không mở SSH, không đọc JSONL và không ghi metric nào.
- Yêu cầu: repository liệt kê tuần tự mọi app có `current_deployment_id` trỏ tới deployment
  `running`; tạo `SshMetricSource` với đường dẫn POSIX
  `/opt/opspilot/<app_name>/metrics/metrics.jsonl`; poll tuần tự, không overlap và cô lập lỗi từng app.
- Regression: integration test chứng minh hai target được poll đúng thứ tự, một target lỗi không làm
  target sau bị bỏ, và runtime callback không còn no-op.

### R02 — BLOCKING — ML client chưa nối vào poller và không dùng dynamic port

- Bằng chứng: `monitor/mlApi.ts` chỉ có `/ingest`, không có caller; `MlServiceManager` chọn động
  8765–8767 nhưng client mới không lấy port đang chạy.
- Hậu quả: 4 ML score luôn `NULL`, không status/train/auto-train; fallback port sẽ hỏng.
- Yêu cầu: mở rộng `MlServiceManager` hoặc một typed client do manager sở hữu để gọi `/status`,
  `/ingest`, `/train` trên đúng port đã chọn, có timeout và zod response. Poller gọi ingest tuần tự
  theo `seq`; ready/down/invalid response vẫn ghi 4 score `NULL`; response hợp lệ ghi score/detail và
  cập nhật alert đủ bốn method. Không hard-code 8765 và không gọi `Promise.all`.
- Regression: ready false, ready true, service down/timeout, invalid JSON/shape, thứ tự seq và đúng
  năm score trên mỗi metric.

### R03 — BLOCKING — Transaction/async flow chưa đáp ứng tính nguyên tử

- Bằng chứng: `onSample?.(id)` được gọi trong transaction đồng bộ nhưng Promise không được await.
- Hậu quả: callback async có thể fail sau khi offset đã commit; nếu dùng callback này cho ML sẽ tạo
  trạng thái nửa vời.
- Yêu cầu: bỏ async callback khỏi transaction. Với mẫu chưa tồn tại, lấy kết quả ML tuần tự trước;
  sau đó transaction đồng bộ ghi metric + đúng 5 score + alert changes + offset của cả batch. Nếu
  transaction fail, không tiến offset/không còn row nửa vời. Ghi rõ crash-window HTTP thành công
  nhưng SQLite fail theo task packet; không dựng distributed transaction.
- Regression: injected DB failure giữ offset và rollback metric/score/alert; duplicate seq không gọi
  ML lần nữa trong đường retry DB bình thường.

### R04 — BLOCKING — IPC contract và `monitor:tick` chưa đủ

- Bằng chứng: mới đăng ký samples/scores/alerts/get-setting; thiếu `monitor:label-alert`,
  `monitor:set-setting`, `monitor:train-now`; chưa phát `monitor:tick`.
- Yêu cầu: hiện thực đủ bảy `monitor:*` invoke đang có trong `app/src/shared/ipc.ts`. Setting patch
  phải whitelist, validate miền giá trị, không cho đổi `app_id`, ghi `config_change`. Label cập nhật
  `label/labeled_at` và ghi `alert_labeled`. Train-now yêu cầu >=150 mẫu đúng deployment, gọi
  `/train`, trả count. Mỗi batch có dữ liệu mới phát đúng một tick gồm sample/score/new alert của batch.
- Regression: test handler đủ bảy channel, invalid patch, label null/non-null, train thiếu/đủ mẫu và
  payload tick không chứa dữ liệu cũ.

### R05 — BLOCKING — Byte offset local và phát hiện rotation sai

- Bằng chứng:
  - `LocalMetricSource.tail()` dùng byte count làm chỉ số `String.slice`, làm mất dữ liệu khi phần
    trước offset có ký tự UTF-8 nhiều byte.
  - `poller.ts` dùng `size < offset`; ở EOF bình thường luôn có `size === offset - 1`, nên mỗi tick
    rảnh bị nhận nhầm là rotation và đọc lại từ byte 1.
- Yêu cầu: cắt trên `Buffer`/đọc file theo byte; chỉ reset khi `size < offset - 1`. Khi
  `size === offset - 1`, trả no-op và giữ offset. Rotation thật phải ghi action log theo mapping enum
  hiện có, không spam ở EOF bình thường.
- Regression: fixture có Unicode trước offset; EOF lặp hai poll không reset/tail lại; shrink thật reset
  đúng một lần; partial UTF-8/partial line không tiến offset.

### R06 — MAJOR — Alert NULL có thể đóng alert và peak ban đầu bị sai

- Bằng chứng: `AlertTracker.low` coi mọi `above_threshold=0` là low, kể cả row `score=NULL`; khi mở
  alert, `peak_score` dùng score của mẫu trigger cuối thay vì max của cả chuỗi đầu.
- Hậu quả: ML down ba mẫu có thể đóng alert giả; chuỗi `.95,.85,.75` ghi peak `.75`.
- Yêu cầu: score NULL không tăng high/low counter và không resolve. Peak lúc mở là max score non-null
  của chuỗi triggering, sau đó chỉ tăng. Giữ độc lập theo `(deployment_id, method)` và khôi phục hoàn
  toàn từ DB sau restart.
- Regression: NULL giữa chuỗi, ba NULL khi alert mở, peak đầu chuỗi, restart giữa high/low sequence,
  năm method độc lập.

### R07 — MAJOR — Metric validation chưa đúng miền contract

- Bằng chứng: hầu hết field dùng `z.number().finite().nullable()`, nên nhận số âm, percentage ngoài
  miền; timestamp không khóa UTC `Z`; collector version không kiểm tra semver.
- Yêu cầu: validate miền đã ghi trong `metric-format.md` mà không sửa contract: nonnegative cho MB/ms,
  percentage 0–100 nơi contract giới hạn, error rate 0–1, timestamp UTC kết thúc `Z`, seq positive int,
  container 0/1 và collector version semver. CPU container được phép >100 nhưng không âm.
- Regression: mỗi nhóm invalid bị consume như corrupt line, có warning và không tạo DB row; dòng sau
  hợp lệ vẫn được xử lý.

### R08 — MAJOR — Target/query score có thể chọn hoặc gộp sai dữ liệu

- Bằng chứng: `getTarget(deploymentId)` chỉ kiểm tra deployment status, không kiểm tra
  `app.current_deployment_id=d.id`; `listScores` group bằng `ts_vps`, nên hai seq cùng timestamp bị
  gộp thành một điểm.
- Yêu cầu: target runtime xuất phát từ app current deployment đang running. Aggregate score theo
  `metric_sample_id` (vẫn trả shape contract có `ts_vps`) để mỗi metric tạo một ScoreSet, kể cả trùng
  timestamp.
- Regression: deployment running cũ không được poll; hai metric trùng `ts_vps` trả hai ScoreSet đủ 5.

### R09 — MAJOR — Error handling/action log chưa tồn tại

- Bằng chứng: shrink/corrupt chỉ ghi logger; scheduler interval `void this.tick()` không catch rejected
  Promise; SSH/ML failure chưa ghi action log.
- Yêu cầu: bắt lỗi ở biên scheduler/service để không có unhandled rejection; không tạo mẫu giả và
  retry offset cũ. Dùng enum action hiện có: `ssh_error` cho SSH/read/rotation, `ml_service_restart`
  status failed cho ML unavailable (rate-limit, không spam mỗi mẫu), `alert_raised`, `config_change`,
  `alert_labeled`. Không sửa schema/enum.
- Regression: rejected poll không thành unhandled rejection, offset giữ nguyên, action log đúng và
  ML down nhiều mẫu chỉ log có giới hạn.

### R10 — MAJOR — Scheduler stop chưa bảo đảm lifecycle sạch

- Bằng chứng: `stop()` chỉ clear timer; tick đang chạy vẫn có thể dùng DB sau `will-quit` đóng DB.
- Yêu cầu: stop ngăn tick mới và cho lifecycle biết/đợi tick hiện tại hoàn tất hoặc chặn mọi thao tác DB
  sau stop. Giữ API đơn giản, không tạo process/queue mới.
- Regression: stop trong khi poll đang chờ không khởi chạy poll mới, không chạm DB sau close và không
  còn timer giữ process.

### R11 — MAJOR — CLI và coverage bàn giao chưa đủ

- Bằng chứng: không có `app/scripts/try-monitor.ts` hoặc script package; không có test cho mlApi,
  service, IPC mutation/tick, runtime target list và error paths ở trên.
- Yêu cầu: thêm CLI local chạy fixture từ `ml-service/scripts/gen_fake_series.py` hoặc fixture tương
  đương được script sinh, in count metric/5 score/alert/offset; bổ sung test cho R01–R10. CLI không
  cần VPS và phải trả exit code khác 0 nếu invariant sai.

### R12 — MINOR — Handoff chưa phản ánh HEAD cuối

- Bằng chứng: handoff ghi HEAD/range `8139978` nhưng HEAD thực tế là `bfba6c4`; ba checkbox an toàn
  còn bỏ trống dù Worker đã tuyên bố trong tin nhắn.
- Yêu cầu: sau vòng sửa, cập nhật baseline/head/range, toàn bộ commit mới, command + exit code thật,
  DoD và checklist Git. Không sửa/xóa lịch sử review của reviewer.

## 3. Thứ tự sửa bắt buộc

Không rewrite/rebase năm commit cũ. Tạo commit mới trên cùng branch theo thứ tự:

1. `fix(monitor): correct byte offsets targets and alert state` — R05–R08.
2. `feat(monitor): integrate dynamic ml scoring transactionally` — R02–R03, phần ML của R06/R09.
3. `feat(monitor): wire runtime polling ipc and lifecycle` — R01, R04, R09–R10.
4. `test(monitor): complete cli regression coverage and handoff` — R11–R12, docs/gate.

Mỗi commit phải có `REVIEW-FIX 30/08 — finding Rxx...` trong nhật ký task và test hồi quy tương ứng.
Worker đổi board `BLOCKED → ĐANG LÀM` khi bắt đầu sửa. Chỉ đổi sang `CHỜ REVIEW` khi mọi R01–R11 đã
đạt, handoff ghi `READY_FOR_LOCAL_REVIEW`, gate code xanh và scoped Prettier xanh.

## 4. Prompt giao Worker vòng sửa 01

```text
Tiếp tục TK-A16 trên branch feat/m06-monitor-poller-rule từ HEAD hiện tại. Trước khi sửa, xác nhận
lịch sử có code head đã review bfba6c4 và reviewer commit baae52f; không checkout lùi về bfba6c4.

Đọc đầy đủ CLAUDE.md, docs/tasks/tk-a16-m6-poller-rule.md,
docs/tasks/tk-a16-review-01.md và docs/tasks/tk-a16-worker-handoff.md. Kết luận review là
REQUEST_CHANGES; phải sửa toàn bộ R01–R11, rồi cập nhật R12. Không tự thu hẹp scope.

Đổi TK-A16 từ BLOCKED sang ĐANG LÀM và thêm UPDATE/REVIEW-FIX vào nhật ký. Không rewrite/rebase các
commit cũ. Làm bốn commit fix theo đúng thứ tự mục 3 của review; mỗi finding phải có regression test.
Được dùng GitNexus read-only. Không sửa contract/migration/renderer/collector/deploy, không thêm
dependency và không chạm file untracked của user.

Chỉ được commit cục bộ. TUYỆT ĐỐI KHÔNG git push, mở PR, merge, force-push, reset --hard, clean,
rebase hoặc pop/drop stash nếu A chưa ra lệnh riêng.

Chạy lại bằng Node 22: test, lint, typecheck, build và Prettier scoped toàn bộ file TK-A16. Full
Prettier được phép ghi baseline failure ngoài scope nhưng không được tạo warning mới. Điền lại toàn bộ
handoff với baseline affc6d8, HEAD/commits/test/DoD/risks chính xác; thêm HANDOFF-LOCAL mới và đổi board
sang CHỜ REVIEW chỉ khi outcome là READY_FOR_LOCAL_REVIEW. Sau commit handoff, dừng để Codex/root
review vòng 2 và xác nhận rõ CHƯA PUSH/CHƯA PR/CHƯA MERGE.
```
