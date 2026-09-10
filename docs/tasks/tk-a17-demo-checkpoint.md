# TK-A17 — Demo tích hợp dữ liệu thật, giám sát và phục hồi

| Chủ    | Hạn thực hiện | Branch tài liệu            | Baseline code                        | Trạng thái           |
| ------ | ------------- | -------------------------- | ------------------------------------ | -------------------- |
| A solo | 12/09/2026    | `plan/a17-demo-checkpoint` | `683bfc6` (`origin/main` ngày 10/09) | TUẦN NÀY — chưa code |

Đọc [plan 3 ngày](../24-ke-hoach-demo-3-ngay.md), [prompt](../prompts/tk-a17-worker.md),
[handoff](tk-a17-worker-handoff.md). Worker tạo `feat/a17-demo-checkpoint` từ HEAD nhánh plan
đã chứa các file này; không tạo từ main cũ làm mất hồ sơ. Lưu baseline và SHA gốc vào handoff.

## 1. Hồ sơ phải đọc

1. `CLAUDE.md`, `docs/tasks/README.md`, `board.md`, plan/prompt/handoff A17.
2. `docs/contracts/metric-format.md`, `schema.sql`, `ipc-contract.ts`,
   `ml-api.openapi.yaml`, `deploy-events.md`; detector contract nếu sửa BuildPlan.
3. `docs/02-ui-ux-spec.md` mục 3.4/3.5, `docs/10-quy-uoc-code.md`.
4. Prompt module đúng chặng: G1 `m04-deploy-pipeline.md`, `m05-collector.md`,
   `m06-poller-rule.md`, `m07-ml-service.md`; G2 `m10-ui.md`; P1 `m08-auto-rollback.md`.
5. A15/A16 handoff; B4/B5/B2 task; đọc báo cáo B6 bằng
   `git show origin/feat/m05-collector-docker:docs/tasks/tk-b6-m5-docker-vps.md` nếu ref còn tồn tại.

Scope ngày 10/09: A làm thay phần tích hợp của B6/B8, theo yêu cầu solo của A. Các tk-file cũ
giữ lịch sử, không đóng chúng chỉ vì đã nhập scope vào A17.

## 2. File được sửa và ranh giới

- Collector, templates, `app/src/main/deploy/{templates,pipeline,service}.ts` và test liên quan:
  chỉ nối collector, sửa lỗi chặn deploy/redeploy/rollback trong demo.
- `app/src/main/monitor/**`, `mlClient.ts`, `index.ts`, `ipc.ts`, preload: lỗi tích hợp,
  lifecycle/settings và wiring cần thiết; tái sử dụng service/repository đã có.
- Renderer: Monitor mới, Apps/Versions, entry từ VPS/Deploy, history, strings/store,
  test; AntD/Recharts/dependency hiện có, không redesign app shell.
- `app/scripts/`, `tools/`, docs/evidence A17: smoke CLI, fault/reset có giới hạn,
  kịch bản, log và bảng trạng thái. Demo source chỉ sửa lỗi chặn đã tái hiện.
- Không làm migration VPS, detector breadth, thí nghiệm chính thức hoặc thêm dependency.
- Contract giữ nguyên mặc định. Nếu phát hiện mismatch thật: ghi bằng chứng contract/code,
  phương án tối thiểu và ảnh hưởng để Leader review trước đổi; schema cần migration mới.
  Không tự thêm `error_rate_source` chỉ dựa trên hồ sơ đề xuất RC cũ.

## 3. G0 — baseline và manifest (tối đa khoảng 1 giờ)

- Ghi branch/HEAD/status, Node 22 thực tế, pnpm, Python venv, native SQLite/Electron ABI.
  Không hardcode đường dẫn Node từ máy khác; tái dùng môi trường hiện có.
- Kiểm tra SSH, Docker/Compose, RAM/disk, port bận, container/app B đang chạy, experiment
  đang running. Kiểm tra read-only trước mọi thao tác tạo app demo riêng.
- Chọn app slug `a17-demo` hoặc tên riêng chưa bị chiếm, ghi manifest host/path/port/IDs;
  thao tác thật chỉ trên đúng app demo được A giao. Không nhận quyền reset app B hoặc cả VPS.
- Đọc/check git B6, báo rõ phần report chưa merge; không merge/cherry-pick cả nhánh để lập bằng chứng.
- Tái lập focused test monitor/deploy, collector pytest và typecheck. Ghi mọi lỗi với exit code;
  không dùng chữ “baseline” để bỏ qua lỗi khi chưa tái hiện ở baseline tương ứng.

## 4. G1 — Deploy kèm collector → SQLite → ML thật (R1)

### Triển khai

1. Dùng deploy service tạo app + deployment thật, Express container port 3000; PostgreSQL
   nội bộ 5432. Không mở port DB. Có marker bản ghi để kiểm chứng giữ dữ liệu.
2. Upload/build collector từ source repo, gắn vào compose cùng network app. Bind metrics
   đúng `/opt/opspilot/<app>/metrics`; docker.sock read-only, mem_limit 128m, restart policy,
   không port collector. Có DB thì DB_DSN nối đúng DB và không lộ secret trong log.
3. Compose dùng lại được lúc redeploy/restore rollback. Regression bắt buộc cho
   `stepRender` và `restoreComposeTo`: không mất collector/metrics/DB credentials sau rollback.
4. HTTP probe cho app demo trỏ endpoint nghiệp vụ `/items?limit=1`; healthcheck deployment
   vẫn `/health`. APP_URL là cấu hình collector hiện hữu, không đổi tên contract.
   Test latency và 5xx của endpoint này thực sự đi vào metric. Error-rate ở baseline là
   tỷ lệ probe trong cửa sổ, không tuyên bố tỷ lệ tất cả request của app.
5. Scheduler thật đọc file qua SSH. Deployment phải là current/running của SQLite trên máy A.
   Kiểm tra seq, byte offset, retry/reconnect, restart collector, rotation bằng fixture.
   Không gán metric backlog của phiên bản trước sang deployment mới rồi train như dữ liệu mới;
   xác định ranh giới offset/version bằng regression và bằng chứng redeploy/rollback.
6. Chạy baseline bình thường ≥180 mẫu, chu kỳ 10s; ML process/API thật và model status/train
   thật. `pnpm try:monitor` hiện dùng fixture + poller không có scorer, chỉ là regression SQLite.
   Nó cho 750 score rows không chứng minh 750 score số hay model đã sẵn sàng.
7. Kiểm tra sau train mẫu mới có score của 3 model + ensemble; ML down vẫn ghi metric/rule,
   ML score là null. Kết nối lại không nhân đôi metric/alert. Không sửa threshold cho đẹp kết quả.

### PASS G1

- CLI smoke mới chạy qua SSH source + MonitorService/ML client thật + SQLite migrations
  thật, lưu summary không secret: host/app/deployment, seq range, count, offset, duplicate
  count, model ready, số score null/non-null, version/hash collector.
- Ít nhất 10 phút metric VPS thật và ≥180 baseline sạch để train; sau train có batch score
  số thật. Mỗi sample đúng 5 score rows; retry cùng file inserted=0.
- Lưu lệnh tái hiện + SQL count/invariant + test log. Reviewer R1 kiểm tra; nếu SSH bị chặn,
  tiếp tục UI bằng test mock nhưng giữ G1 NOT_RUN/BLOCKED, không gọi đó là live.

## 5. G2 — Monitor UI, cảnh báo và version thật (R2)

### Triển khai

1. Có đường vào Monitor từ app/VPS/Deploy. Chọn đúng app/deployment; initial load từ
   `monitor:samples/scores/alerts/get-setting`, subscribe `monitor:tick` và unsubscribe.
   Chống response cũ đè state khi đổi app, duplicate samples và leak listener khi remount.
2. Statistic CPU/RAM/latency/error-rate/DB/container, đồ thị metric + score theo thời gian,
   marker alert, 5 method theo màu spec. Cửa sổ thời gian giới hạn data hiển thị.
   Null hiển thị thiếu dữ liệu, không vẽ thành 0; stale/offline giữ timestamp và thông báo.
3. Bảng alert lấy đúng bảng alert; tick chỉ có `new_alerts`, nên phải re-fetch có giới hạn
   để thấy peak/resolved/label mới. Gắn nhãn đúng/sai qua IPC, lỗi lưu phải báo/khôi phục UI.
4. Drawer rule threshold/consecutive + nút train-now; show lỗi <150 mẫu. Nếu cho đổi
   poll_interval_s, scheduler phải thực sự áp dụng và có test; nếu chưa triển khai thì
   field read-only. collector_interval không được làm như đã đổi VPS chỉ vì SQLite đổi.
   Chưa có M8 thì auto-rollback disabled kèm giải thích, không có toggle giả hoạt động.
5. Apps/Versions trên luồng demo bỏ mock, gọi `app:list/get/versions`, `app:rollback`.
   Confirm đúng app/target; disable khi pending/không hợp lệ; nhận deployment_id chỉ là
   đã bắt đầu, phải theo `deploy:event finished` mới báo thành công và refresh current.
   Không suy runtime image chỉ từ version attempt; rollback tạo attempt mới có thể trỏ image cũ.
6. Tạo helper fault/demo bằng CLI hoặc tools dùng SSH; enable/reset/status chỉ trên manifest
   app demo. Dùng latency 2400ms (<timeout 5s), giới hạn thời gian, có finally reset.
   Không thêm fault control vào sản phẩm chính nếu cần sửa IPC rộng chỉ để biểu diễn.
7. Gây lỗi sau baseline/train, ghi fault_start/reset UTC; `/health=200`, business latency tăng,
   alert mở sau đủ mẫu; reset → resolved. Gắn nhãn và reload kiểm tra DB lưu.
8. Rollback thủ công thật, kiểm tra container health, image/current pointer, marker PostgreSQL,
   collector tiếp tục chạy và poller bám đúng deployment. History đủ hành động demo.

### PASS G2

- Click-through thật không console error; viewport 1366×768 và thu nhỏ 1024×768 không tràn
  ngang toàn app, bảng được cuộn trong vùng của nó. Loading/empty/error/offline/ML-down có test.
- Screenshot normal, degraded, labeled, recovered, rollback, history (không placeholder).
- Test meaningful: stale response khi đổi app, cleanup listener, null, label failure,
  resolved refresh, rollback async failure/success và data preservation.
- R2 kiểm tra cả IPC/source và ảnh/video, không approve chỉ vì ảnh trông đẹp.

## 6. P1 — M8 chỉ sau R1/R2 và còn thời gian

Đọc đủ `m08-auto-rollback.md`; đây là tính năng mới, không phải bật một setting.
Tái dùng pipeline và khóa app. Tách quyết định thuần khỏi coordinator thực thi.

- Đếm mẫu mới liên tiếp của trusted method theo thứ tự, không đếm số poll hoặc alert rows;
  không kích hoạt lại từ batch replay. Cấu hình mặc định OFF, bật có confirm rõ hậu quả.
- Chọn target thành công trước đó còn image thật; không lấy version−1 máy móc khi có failed
  attempt/rollback chain. Không có target/đang deploy/ML null: skip đúng lý do.
- `rollback()` trả ID ngay: theo dõi kết thúc thật. Chỉ ghi acted thành công, cooldown timestamp
  và emit `system:auto-rollback` sau runtime healthy. Phân loại log automatic đúng nguồn,
  không đồng thời ghi manual thành công gây hiểu nhầm.
- Cooldown sống qua restart. Failure không auto retry ở poll sau. Có guard single-flight,
  bảo vệ race deploy/rollback và shutdown; crash/restart không phát lệnh lặp vô hạn.
- Test disabled/thiếu mẫu/null/v1/cooldown/replay/concurrent/failure/restart/target image chain;
  tích hợp thật 1 rollback + 1 lần bị cooldown chặn. Event/marker/notification lấy dữ liệu thật.
- Chưa đạt toàn bộ gate trước hết 11/09: không đưa vào demo, giữ OFF, ghi phần dở và defer.
  Nếu không thể tách code dở an toàn thì không bắt đầu P1 trên nhánh demo.

## 7. G3 — regression, diễn tập, bàn giao (R3)

Chạy dưới `app/`, xác nhận Node 22 trước; các dòng là lệnh riêng:

```powershell
node --version
pnpm typecheck
pnpm lint
pnpm test -- --maxWorkers=1
pnpm try:monitor
pnpm build
```

Chạy scoped Prettier với danh sách file đổi cụ thể (không reformat toàn repo). Dùng Python
venv thực tế chạy `python -m pytest tests -q` lần lượt trong collector và ml-service, ghi
interpreter/cwd/exit code. Test SSH+ML thật G1 bằng CLI mới; test UI thật G2 bằng Electron.
Chạy gate tuần tự để tránh lặp timeout renderer từng gặp; không tắt test, tăng timeout hàng
loạt hoặc nhận count test cũ làm bằng chứng mới. Process treo phải thu log/chẩn đoán handle,
kill đúng process mình chạy, ghi FAIL/NOT_RUN, không báo pass từ đoạn “transform complete”.

Đầu ra Worker phải tạo:

- `docs/evidence/tk-a17/` chứa test-summary, live-smoke, ảnh thật và manifest đã bỏ secret.
- `docs/25-kich-ban-demo-monitor-recovery.md`: thao tác click/command đúng bản đã chạy,
  source path, start app, chuẩn bị baseline, fault/reset, version IDs, câu thuyết trình,
  thời gian chờ, fallback, dọn app riêng (dry-run mặc định), trạng thái máy sau diễn tập.
- Hai lần rehearsal liên tiếp theo kịch bản, không sửa trực tiếp DB để làm đẹp demo.
- Update board, task nhật ký, handoff, docs/05 (chỉ tick yêu cầu có bằng chứng); không tự
  tuyên bố 16/24 hay % hoàn thành từ số commit/file/ảnh.
- Không reset/delete dữ liệu người dùng hoặc experiment. Chỉ dọn app demo theo manifest
  sau yêu cầu reset cụ thể của A; trước demo thường chỉ reset fault, giữ baseline/DB/images.

## 8. Nhật ký và điều kiện bàn giao

- START 10/09 — Leader lập kế hoạch theo `main@683bfc6`, user yêu cầu solo 3 ngày;
  đã kiểm tra source/merge và báo cáo B6, chưa chạy runtime/test mới, chưa Worker implementation.
- UPDATE 10/09 — Phát hiện B8 chưa có, Apps/Versions còn mock, compose chưa có collector;
  giao G1/G2/G3 và P1 có mốc cắt. B6 evidence `dfc0ed7` chưa thuộc main.
- UPDATE 10/09 — Shell lập plan đang dùng Node `v24.16.0`; đã format tài liệu nhưng chưa
  chạy gate code. Worker phải chọn Node 22 trước test/build, ghi đường dẫn thực tế tại G0.

Worker append `START/UPDATE/HANDOFF-LOCAL/REVIEW-FIX` theo ngày thật và gate. Mỗi entry ghi
file/code SHA, việc làm, command+cwd+exit+count+log, lỗi còn lại, hành động tiếp theo.
Outcome: `READY_FOR_LOCAL_REVIEW`, `CHANGES_REQUESTED`, `BLOCKED`; chỉ Leader xác nhận
`DEMO_READY` sau R3. Board CHỜ REVIEW ở handoff cuối; HOÀN THÀNH chỉ sau merge và đủ DoD.
