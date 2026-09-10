# Worker playbook — xây demo tự phát hiện và tự khôi phục

> Đây là chỉ dẫn thực thi, không phải lời đề xuất. A thao tác/trình chiếu, thầy quan sát.
> Đọc cùng [task](../tasks/tk-a17-demo-checkpoint.md) và file chặng được giao.
> Chỉ thực hiện một chặng mỗi lượt. Chặng C08 bắt buộc, tách A/B/C để review.
> Các script/flag được đề xuất dưới đây là đầu ra Worker phải xây; hiện chưa có các lệnh đó.

## 1. Đích cuối cần chứng minh

A triển khai website ghi chú và bật tự khôi phục. Sau khi A bật fault, OpsPilot tự đọc
metric → phát hiện suy giảm → chọn image tốt trước đó → rollback → quan sát website phục hồi.
A không bấm rollback/reset trong cửa sổ tự khôi phục. Trên máy chiếu nhìn thấy version đổi,
latency giảm và ghi chú trước sự cố vẫn tồn tại.

Demo chính dùng `trusted_method=rule` và nhãn “Tự khôi phục theo ngưỡng”; đây là kiểm chứng
automation thật. ML thật vẫn train/score song song. Sau khi có evidence một method ML trigger,
thêm lượt trusted ML và gọi đúng “Tự khôi phục theo mô hình …”. Không bịa ML trigger/accuracy,
không hứa phát hiện sớm hơn rule. Các gate nghiên cứu ML trong M08/docs/07 vẫn riêng.

## 2. Thao tác đầu phiên

Tại repo root chạy từng lệnh, đọc output trước bước tiếp:

```powershell
git status --short --branch
git log -5 --oneline
git branch --list feat/a17-demo-checkpoint
git rev-parse HEAD
```

Nếu chưa có branch Worker, tạo từ HEAD plan mới nhất đang chứa playbook:

```powershell
git switch -c feat/a17-demo-checkpoint
```

Nếu branch đã có, kiểm tra head/dirty và tiếp tục lịch sử hiện có; không ghi đè nhánh để
quay về plan. Ghi base SHA, interpreter paths và phạm vi chặng vào handoff ngay khi START.
Đừng hardcode path Node/Python từ ví dụ của máy khác. Node trong shell Leader là 24 khi lập
plan; chặng C00 phải tìm/chọn Node 22. Không commit lockfile do vô tình đổi package manager.

## 3. Bản đồ sửa code theo đúng thứ tự

| Chặng | Mở file trước                                                 | Sửa gì cụ thể                                                               | Lệnh/đầu ra trước khi dừng                               |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| C00   | docs/09, package.json, native CLI helpers, A15/A16 handoff    | Thiết lập runtime, read-only VPS manifest, baseline                         | Node/Python path, test baseline, SSH/container inventory |
| C01   | deploy/templates.ts, pipeline.ts, collector/Dockerfile        | Thêm collector vào compose; upload/build source; giữ trong restoreComposeTo | Deploy thật, JSONL 10+ phút, template/pipeline tests     |
| C02   | monitor/metricSource.ts, poller.ts, service.ts, repository.ts | Live CLI + scheduler; byte offset/reconnect/version boundaries              | SQL invariant + live reconnect/redeploy + focused tests  |
| C03   | monitor/mlApi.ts, service.ts, mlClient.ts, ml-service         | Live train/score/lifecycle, ≥180 baseline sạch                              | API status/train, scores số/null, down/recover test      |
| C04   | express-api/server.js, public/, package.json                  | Trang ghi chú rõ, latency request thật, release identity thấy được          | Browser + DB marker, v1/v2 image/release proof           |
| C05   | renderer navigation/store/pages, shared IPC                   | Monitor projection mode và read-only data/state                             | Snapshot state mapping + responsive/live tick tests      |
| C06   | alertTracker.ts, monitor UI, settings API                     | Incident/label/summary, helper fault/status/reset                           | Fault thật → alert → reset, UI/SQL đối chiếu             |
| C07   | AppsPage.tsx, deployRun.ts, deploy pipeline events            | Versions thật, confirm/manual rollback, theo finished                       | Race/error tests + live rollback/data proof              |
| C08A  | poller.ts, service.ts, M08 spec                               | Policy thuần + batch candidate + freshness                                  | Decision tests, chưa gọi VPS rollback                    |
| C08B  | index.ts, pipeline.ts, actionLogRepository.ts                 | Coordinator, completion, durable attempt/failure/restart                    | SQLite+pipeline integration, không cần UI mới            |
| C08C  | Monitor settings, deploy events, history                      | Opt-in và timeline tự khôi phục, live không manual                          | Auto rollback/suppression và business recovery thật      |
| C09   | toàn bộ handoff + evidence                                    | Regression, 2 rehearsal, runbook/screenshot/video                           | Leader DEMO_READY đúng SHA                               |

Không viết lại phần đã đúng chỉ để có diff. Test chặng nào đặt ở module đó. Source map là
điểm vào đã kiểm tra ở baseline, Worker phải dùng rg/context để xác nhận đúng HEAD đang sửa.

## 4. Bộ helper tái hiện — triển khai nhỏ, không thành module sản phẩm mới

Tạo script `app/scripts/demo-scenario.ts` và script npm `demo:scenario` theo cơ chế compiler/
native runtime đã dùng trong try-deploy. Không hardcode credential hoặc app ID. Commands dự kiến:

```powershell
pnpm demo:scenario -- status --manifest <absolute-path>
pnpm demo:scenario -- prepare --manifest <absolute-path> --dry-run
pnpm demo:scenario -- prepare --manifest <absolute-path> --apply
pnpm demo:scenario -- fault --manifest <absolute-path> --latency-ms 2400 --timeout-s 180
pnpm demo:scenario -- verify --manifest <absolute-path>
pnpm demo:scenario -- reset-fault --manifest <absolute-path>
```

- C02 thêm status/verify ingestion; C04 prepare release variants; C06 fault/reset; C08C thêm
  verify automatic result. Chỉ tạo subcommand khi đến đúng chặng, không thực thi toàn bộ sớm.
- `status/verify` read-only. `prepare` dry-run mặc định; apply tạo riêng workspace/source/app
  demo sau manifest/preflight, gọi service thật. Không thay app B, không sửa main user DB trực tiếp.
- Manifest local gồm vps/app IDs, slug/path/port, expected current deployment, image tags,
  release identity và marker ID; không secret. Bản public evidence đã redacted.
- Credential lấy qua secret store của A. CLI cần Electron-safeStorage thì tái dùng launcher
  đúng ABI; không tải `.env` VPS về để tiện debug và không nhét private key vào manifest.
- Hai release v1/v2 có marker version đóng trong image. `/meta.version` hiện lấy package.json:
  có thể chuẩn bị source copy với package/package-lock version nhất quán, không thay env
  version dùng chung giữa hai image. Display package version và deployment attempt tách rõ.
- Mọi release được tạo bằng source+deploy thật. Không chèn deployment/score/alert mẫu vào DB live.
- Fault chỉ gọi endpoint opt-in, không được gọi rollback, tắt container hoặc reset ngay để tạo
  kết quả giả. Theo dõi trong timeout hữu hạn; log exact UTC cho fault/reset/timeout.
- Nếu timeout/finally reset chạy trước automatic finish + business verification thì lượt tự
  khôi phục FAIL/INCONCLUSIVE, không tính PASS vì website nhanh lại. Cleanup vẫn phải ghi log.
- `verify` báo image/current/marker/latency windows/alert/action IDs. Không tự sửa trạng thái
  cho xanh, không retry rollback bị fail. Mỗi subcommand có test argument/target/timeout.

## 5. Release và dữ liệu trước cảnh tự khôi phục

1. Deploy release tốt R1, tạo marker “Buổi review …”, xác nhận PostgreSQL + image digest.
2. Deploy R2 với nhãn release khác, chức năng bình thường và fault opt-in; healthcheck PASS.
   R2 phải là deployment current thực, R1 vẫn còn image và là target hợp lệ.
3. Thu baseline/train trên chính R2; không lấy baseline R1 gán sang R2. ≥180 mẫu sạch theo C03.
4. Mở setting, chọn method rồi bật auto có confirm. Không thay mặc định auto OFF của sản phẩm.
5. Ghi `fault_start`, bật latency. Mọi tác động là fault injection runtime có công bố;
   không gọi đây là bằng chứng đã tìm root cause của bug trong source R2.
6. Không thao tác manual trong cửa sổ đó. Hệ thống phải tự tạo attempt khôi phục về image R1.
7. Chứng minh release R1 qua `/meta.version`, image digest/runtime và current pointer.
   Restart đơn thuần cũng làm mất fault runtime, nên chỉ thấy latency giảm là chưa đủ proof.
8. Kiểm tra ghi chú còn nguyên và collector vẫn chạy. Model của deployment rollback mới có
   thể chưa train; hiển thị đúng, không giữ score R2 làm score hiện tại.

## 6. Màn hình trình chiếu — thiết kế và nguồn dữ liệu

Trong Monitor thêm chế độ trình chiếu (renderer state, không IPC/schema mới): chữ lớn, ẩn
chi tiết kỹ thuật mặc định, tên app/release, timestamp mới nhất, một đồ thị latency và tiến
trình sự cố. Website demo mở browser ngoài, A Alt-Tab khi cần; không nhúng trang HTTP vào
Electron webview hoặc thêm iframe đặc quyền chỉ để có màn hình ghép.

| Trạng thái trên màn hình           | Nguồn bắt buộc                                                                                                               | Không được suy từ                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Đang theo dõi                      | Mẫu current deployment còn mới, rule/alert tương ứng                                                                         | Timer UI hoặc request đã được gửi  |
| Website đang chậm                  | Metric business + threshold/consecutive hoặc alert detail                                                                    | `/health=200` hay status container |
| Đã phát hiện sự cố                 | Alert ID/method/time thật                                                                                                    | Bấm nút fault                      |
| Đang tự khôi phục                  | Durable automatic attempt + pipeline events                                                                                  | Score đơn lẻ hoặc helper gọi reset |
| Đã chuyển phiên bản, đang xác minh | Pipeline finished thành công + runtime image                                                                                 | app:rollback vừa trả ID            |
| Website đã phục hồi                | Mẫu mới của deployment sau rollback: ≥3 mẫu liên tiếp latency hợp lệ dưới ngưỡng, container_up=1, error-rate không vượt rule | Healthcheck thành công đơn độc     |
| Chưa xác minh được                 | Không có mẫu mới/null/stale                                                                                                  | Ép thành thành công cho đẹp demo   |

“Dữ liệu được giữ nguyên” có proof marker từ website/verify riêng; nếu chưa đọc DB thì không
hiện badge xanh. “3 mẫu” là tiêu chí xác minh demo/UI, không đổi contract rule/ML.
Không gọi “Đã chữa tận gốc”; hiển thị “Đã khôi phục về phiên bản …”.

Banner automatic thành công theo system:auto-rollback được diễn giải là thao tác rollback
hoàn tất; timeline còn bước business verification trước hero xanh. Failure dùng deploy:event/
history hiện có, không tự thêm payload vào success-only event. Không dùng alert cũ để báo
ML đã ổn trên deployment mới. Khối before/after ghi rõ deployment và cửa sổ mẫu.

## 7. Chạy test và đóng chặng

Từ `app/`, chọn đúng runtime đã ghi tại C00. Chạy case của file chặng, rồi typecheck/lint/
scoped format nếu đổi TS. Ví dụ focused core hiện có (xác nhận args theo package thực tế):

```powershell
pnpm test -- --maxWorkers=1 src/main/deploy src/main/monitor
pnpm typecheck
pnpm lint
```

File test mới C08 đặt gần implementation và thêm vào command focused. Python venv pytest
khi đổi collector/ML; build khi wiring/resources/UI đổi và tại C09. Không chạy native rebuild
lẫn test đồng thời. Output có exit/count/log; CLI fixture là fixture, không live ML.

Trước bàn giao:

```powershell
git diff --check
git status --short
git diff --stat
```

Stage file cụ thể của chặng rồi commit tiếng Anh; không `git add .`. Ghi base/code SHA, test
commands+cwd+runtime, evidence paths, trạng thái fault/target sau test. Tạo handoff/review riêng
cho C08A/B/C như mọi chặng. C00–C07 và C08A/B/C đều APPROVED mới C09.

## 8. Leader sẽ reject khi

- Demo còn cần A bấm rollback sau fault nhưng handoff ghi tự khôi phục.
- Helper tự reset/restart khiến website khỏe, coordinator thực tế chưa thành công.
- Success ghi trước finished/health, hoặc UI xanh trước business samples mới.
- 5 score rows được gọi là 5 score ML thật; dùng score/null của deployment khác.
- Retry sau crash/failure tự tạo nhiều attempt hoặc cooldown chỉ nằm trong RAM.
- Không chứng minh image và marker DB, fake latency/release/alert hoặc bỏ trạng thái stale.
- Thiếu raw log/exit code, link evidence không tồn tại, scope chặng sau bị gộp vào diff.

Cuối lượt Worker trả: chặng/outcome, base/code/docs SHA, commits, case PASS/FAIL/NOT_RUN,
handoff link, finding còn mở, chặng đề nghị review; CHƯA PUSH — CHƯA PR — CHƯA MERGE.
