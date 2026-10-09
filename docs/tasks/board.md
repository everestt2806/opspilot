# BẢNG TASK — NGUỒN SỰ THẬT VỀ TRẠNG THÁI

> Quy trình bắt buộc: [`README.md`](README.md). Kế hoạch sau demo và điểm vào cho AI mới:
> [`../24-ke-hoach-demo-theo-chang.md`](../24-ke-hoach-demo-theo-chang.md).
>
> Trạng thái hợp lệ: `BACKLOG · TUẦN NÀY · ĐANG LÀM · CHỜ REVIEW · HOÀN THÀNH · BLOCKED`.

## Sprint sản phẩm 08/10 — hai nguồn deploy và nền auto deploy

> Người dùng chốt phát triển theo hướng production, cho phép control plane trên VPS quản lý (ADR-011). Demo 14/10 trình bày phần đã qua live gate, không cắt các chức năng cũ để kịp demo. Chuẩn nghiệm thu: [docs/31](../31-lo-trinh-hoan-thien-san-pham.md). Chỉ một task Worker `ĐANG LÀM` tại một thời điểm.

| ID | Task | Chủ | Hạn mục tiêu | Trạng thái | Branch | Phụ thuộc / ghi chú |
|---|---|---|---|---|---|---|
| TK-S7 G0 | [Hợp đồng local/Git và snapshot Git công khai](tk-s7-g0-two-source-git.md) | Worker | 09/10/2026; không cắt gate | CHỜ REVIEW | `feat/deploy-reachability` | local `ebbfc7e` · chưa push; contract `7e6cf25`; Node 22 gates pass |
| TK-S7 G1a | [Nối snapshot Git vào deploy core](tk-s7-g1a-git-deploy-core.md) | Worker | 10/10/2026; không cắt gate | CHỜ REVIEW | `feat/deploy-reachability` | Local review `234cb57` pass: Node 22 focused 55/55, full Vitest 653/653, typecheck; chưa push/merge, chưa live VPS |
| TK-S7 G1b | [Hai nguồn deploy trong UI, lịch sử Git và migrate](tk-s7-g1b-git-ui-history-migrate.md) | Worker | 10/10/2026; không cắt gate | CHỜ REVIEW | `feat/deploy-reachability` | Leader review manual Git flow đủ cho G2, guard `49300ea` và migrate 19/19 pass; DoD migrate rollback chưa xong |
| TK-S7 G2 | [Live smoke deploy Git trên VPS phát triển](tk-s7-g2-live-git-vps-smoke.md) | Worker | 11/10/2026; không cắt gate | CHỜ REVIEW | `feat/deploy-reachability` | Leader xác minh public HTTP 200, remote SHA và SQLite v1/v2 cùng SHA; local `ffb2278`, chưa push/merge |
| TK-S7 G2b | [Live smoke nguồn thư mục và template trên VPS](tk-s7-g2b-local-template-vps-smoke.md) | Worker | 11/10/2026; không cắt gate | CHỜ REVIEW | `feat/deploy-reachability` | Leader xác minh lại Vite/Next/Git HTTP 200 và SQLite local source/Git fields NULL; local `27a06ac`, chưa push/merge |
| TK-S7 G3 | [Diễn tập demo trên VPS thật](tk-s7-g3-demo-rehearsal.md) | Worker | 12/10/2026; không cắt gate | CHỜ REVIEW | `feat/deploy-reachability` | Leader xác minh remote SHA, SQLite v3, 3 URL HTTP 200 và MP4 457.4s video-only; local `764d2d6`, chưa push/merge |
| TK-S7 G4 | [Sửa copy nguồn và freeze gói demo](tk-s7-g4-final-rehearsal-freeze.md) | Worker | 13/10/2026; không cắt gate | CHỜ REVIEW | `feat/deploy-reachability` | G4a xác nhận MemAvailable 3,061 MiB, sửa kết luận RAM/PDF; live G4a NOT_RUN do chưa xác nhận wizard precheck, verdict recorded chờ Leader review |
| TK-S7 G4a | [Đo đúng RAM khả dụng và chốt live gate](tk-s7-g4a-memory-available-live-gate.md) | Worker | trước freeze 13/10/2026 | CHỜ REVIEW | `feat/deploy-reachability` | Local G4a: MemFree 314 MiB / MemAvailable 3,061 MiB; UI/precheck parity và PDF cập nhật; live NOT_RUN vì Electron wizard precheck chưa xác minh, fallback G3 SHA/deployment giữ nguyên |
| TK-S7 G4b | [Live rehearsal qua nút triển khai phiên bản mới](tk-s7-g4b-live-rehearsal-navigation.md) | Worker | trước freeze 13/10/2026 | CHỜ REVIEW | `feat/deploy-reachability` | Leader chấp nhận `DEMO_READY_RECORDED` fallback G3/build cũ. Ảnh 91% correction là từ Electron cũ, không chứng minh VPS dưới ngưỡng RAM; live không chạy, app v4 có bằng chứng riêng; container ID là giới hạn |
| TK-S7 G5 | [Chẩn đoán RAM và chốt demo](tk-s7-g5-memory-stability-demo-freeze.md) | Worker | trước freeze 13/10/2026 | CHỜ REVIEW | `feat/deploy-reachability` | G5c giải thích sai lệch UI: build hiện tại có 3 refresh ~20–21% khớp collector; `vps:get-resources` hoạt động. G5 RAM discrepancy complete; live NOT_RUN do kiểm tra vận hành chưa xong và chưa có video deploy liên tục trên build mới; theo checkpoint riêng. Giữ recorded |

TK-A18 Titlebar fix 05: `READY_FOR_LOCAL_REVIEW` tại code checkpoint `30747f1`; WCO drag region dùng
đúng rectangle, native controls không còn chồng caption và màu overlay đã liền shell; Snap Layout ghi
manual-only, không push/PR/merge.

> Mỗi người tối đa **một** task `ĐANG LÀM`; Worker đổi trạng thái khi thật sự bắt đầu, không đổi
> thay người kia. `HOÀN THÀNH` chỉ sau khi PR merge `main` và đủ bằng chứng.

## Điểm vào hiện tại — 13/09/2026

- **A/Worker:** TK-A18 — [task UI native dark](tk-a18-native-dark-ui.md),
  [prompt Worker](../prompts/tk-a18-worker.md), [handoff](tk-a18/handoff.md). Tạo branch mới từ HEAD
  chứa task packet; giữ `936e643` làm mốc demo ổn định.
- **A17:** đã `DEMO_READY` cho deploy/migrate; [task packet](tk-a17-demo-checkpoint.md),
  [handoff/review](tk-a17-worker-handoff.md). Không mở lại C06–C09 trong TK-A18.
- **B:** không có task chặn demo; A nhận tích hợp B6/B8 trong A17 từ 10/09 theo yêu cầu solo.
  Code B4/B5/B2 đã merge; báo cáo runtime B6 còn ở nhánh riêng, cần tái xác minh.
- Baseline đã fetch: `origin/main@683bfc6`; PR #25 (A15), #26 (B4/B5), #28 (B2) đã merge.
- Nhánh Worker `feat/a17-demo-checkpoint`; C00–C03 đã APPROVED. Demo 14/09 đổi phạm vi thành
  C03 deploy ba Tier 1 → C04 migrate hai VPS → C05 rehearsal. ML deferred tới ít nhất 28/09.
  [Task hiện hành](tk-a17-demo-checkpoint.md) ·
  [nguyên lý deploy/migrate](../25-nguyen-ly-deploy-migrate-demo-14-09.md).
  C00 [APPROVED](tk-a17/review-c00.md): code `d4ec3be`, docs `23cd248`; có kiểm chứng reviewer riêng.
  C01 [APPROVED review-03](tk-a17/review-c01.md): code `8e42856`, docs `9689ea4`;
  toàn bộ finding đã đóng bằng kiểm chứng reviewer độc lập.
- P0: deploy Express/Next/Vite thành công lên VPS; migrate stateless và PostgreSQL thành công giữa
  hai VPS, có checksum/row/marker/health proof. A trình chiếu, thầy quan sát.
- C03 deploy và C04 migrate đã được duyệt; C05 đạt `DEMO_READY` tại rehearsal SHA `936e643`.
  ML, monitor/fault và auto rollback không thuộc demo 14/09, được giữ lại sau 28/09.

## Đang ưu tiên — W3/W4

### Checkpoint L1a–L8 (Tự động hóa pipeline, domain, Doctor, ML và detector) — feat/deploy-reachability

> Các checkpoint L1a–L8 đã hoàn tất triển khai thành các commit local trên nhánh `feat/deploy-reachability` (L2 `e2959f7`, L1a `d86a319`, fix test `ae029c5`, backend L3+L4+L5 `13591ba`, L6 `ad86736`, L7 `82a5d5d`, L8 `f870b6f`). Riêng typecheck tại commit L1a `d86a319` đã FAILED do lỗi test kế thừa và chỉ PASS sau commit `ae029c5`. Do chưa merge vào `main` (không tự ý push/PR/merge), tất cả đều giữ trạng thái `CHỜ REVIEW`.

| ID | Task | Chủ | Hạn | Trạng thái | Branch | Commit / Phụ thuộc | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L2 | Tích hợp bộ thí nghiệm ML TK-S6 offline | Worker | 30/09 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `e2959f7` | Chưa merge `main`; 25 files; 71 test experiments + 35 test collector PASS (106/106 pytest), Ruff pass; target check, kill-switch |
| L1a | Đồng bộ contract IPC, DeployEvent, Doctor, Domain và DB Schema | Worker | 30/09 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `d86a319` | Chưa merge `main`; 7 files; ipc-contract, deploy-events, schema.sql contract, DECISIONS, app/src/shared/ipc.ts; typecheck tại d86a319 FAILED do lỗi test kế thừa (pass sau ae029c5) |
| Fix | Sửa mock reachability.test.ts (ngoại lệ kế thừa 29ed4d3) | Worker | 30/09 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `ae029c5` | Chưa merge `main`; 1 file; đổi cú pháp vi.fn<(url: string) => Promise<boolean>>(), 15/15 tests pass |
| L3+L4+L5 | Backend Publish, Reachability, Doctor Engine, Safe Fix, Domain & DNS | Worker | 30/09 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `13591ba` | Chưa merge `main`; 25 files; migration 004 thực thi, 4 exposure states, idempotent UFW, external probe, Doctor 12 classes, Safe Fix fail-closed, Cloudflare DNS; 418 Vitest pass, build pass |
| L6 | Detector Tier 1 (Next/Express/Vite) & CLI try-detect | Worker | 30/09 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `ad86736` | Chưa merge `main`; 9 files; detector 65 test tổng pass (57 unit + 8 CLI integration), CLI 3 demo apps pass, build pass |
| L7 | UI Exposure, Doctor, Đa ngôn ngữ (4 locales) & Deploy Guard | Worker | 30/09 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `82a5d5d` | Chưa merge `main`; 20 files; DeployPage, AppsPage, SettingsPage, 4 locales; 479 Vitest pass, build pass; GUI thực `NOT_RUN` (headless) |
| L8 | Cấu hình .gitignore, cập nhật Board & Handoff | Worker | 30/09 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `f870b6f` | Chưa merge `main`; 3 files (.gitignore, board.md, HANDOFF.md); loại trừ công cụ AI cục bộ, hồ sơ bàn giao hoàn chỉnh |
| P2b-1 | Migration 005: attempt_index 1..3 & unique 3 trường cho experiment_run | Worker | 01/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `25a3bac` | Migration runner tắt foreign_keys trước tx, kiểm tra toàn vẹn ID/alert và foreign_key_check trước commit; test rollback và migrate thành công trực tiếp trên kết nối; 9 test DB pass |
| P2b-2 | Attempt lifecycle trong run_store.py (TK-S6) | Worker | 01/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `5547a85` | start_run cấp attempt 1..3 nguyên tử trong BEGIN IMMEDIATE, kiểm soát retry sau abort, từ chối sau completed, bảo toàn tx ownership; 135 pytest pass |
| P2b-3 | Export và analyze theo attempt (TK-S6) | Worker | 01/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `6f5405b`, `50343e5`, `604685a` | export_run độc quyền thư mục, bảo vệ meta_extra không đè DB; main_table yêu cầu đủ dữ liệu với completed và bỏ qua aborted; 145 pytest pass |
| P2c-1 | Gắn alert.experiment_run_id trực tiếp khi tạo alert trong poller | Worker | 02/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `7150601`, `5c40780`, `f9e1f12`, `fe7901b` | Gắn trực tiếp experiment_run_id khi tạo alert trong tx poller theo deployment và first.ts_vps, so sánh timestamp microsecond (BigInt), giữ metric ts giây nguyên theo contract, loại trừ chuỗi bắt đầu trước baseline/ended run, ném lỗi truy vấn DB thay vì nuốt; 69 vitest monitor pass, pilot NOT_RUN |
| P2c-2 | Thiết kế runner run_experiment.py, adapter và kế hoạch phân rã | Worker | 02/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `b029eef` (Docs only) | Tạo experiment_run trước SSH/deploy, gắn deployment_id ngay khi pipeline trả ID và chờ kết quả, deploy lỗi giữ bản ghi failed và abort attempt; fault_end_ts = fault_start_ts + 1200s (chỉ chờ phần thời gian còn lại); poller drain điều khiển tiến trình con Electron (xử lý run-as-node spawnSync); loadgen mặc định 1800s, mở 4500s qua pilot; pha A ≥162/180 mẫu, toàn run 75'/450 mẫu; phân rã P2d thành P2d-1a đến P2d-4; pilot NOT_RUN |
| P2d-1a | Helper attach_deployment_id & ML Client (TK-S6) | Worker | 02/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `17c4589`, `e1a3103` | attach_deployment_id() trong run_store gắn deployment running, kiểm tra khớp VPS, giữ tx caller, chống race condition; MlClient với /health, /reset, /train, /status dùng urllib chuẩn; 180 pytest pass, Ruff clean; pilot NOT_RUN |
| P2d-1b | Deploy Adapter & Test Deploy Failure (TK-S6) | Worker | 02/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `11d6ff4`, sửa `9fa27a2`, `ac41fc4`, `26b8d3e`, `86163f1` | DeployAdapter Python cùng CLI TypeScript deploy-cli.ts dùng DeployPipeline và cùng SQLite DB; truyền env_vars qua env OPSPILOT_APP_ENV_JSON ngoài CLI; xoá biến env kế thừa (OPSPILOT_APP_ENV_JSON, OPSPILOT_SSH_SECRET, OPSPILOT_DEPLOY_SECRET); không đưa stderr thô vào exception hoặc abort_reason để bảo mật credential lấy từ DB; start_new_session=True tạo process group trên POSIX; đường mặc định bắt buộc Electron binary và compiled CLI (không fallback spawnSync/Node); khử secret tại deploy-cli.ts trước mọi event stdout kể cả error message và technical; xác nhận db_path trùng file main của SQLite connection, từ chối RAM DB và abort attempt trước khi spawn; lỗi trước spawn ném ngoại lệ đã khử secret; 25 test mock Python pass (205 pytest tổng), 6 test eventSerializer TS pass (503 vitest tổng), typecheck pass; pilot NOT_RUN |
| P2d-2 | Headless Poller CLI & Python Poller Adapter (TK-S6) | Worker | 02/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `89c15d7`, sửa `950e0c1` | HeadlessPoller tái sử dụng MonitorService.pollAll/MonitorPoller với autoTrain=false, chế độ strict ném lỗi khi đọc metric/DB (không phát ready/drained giả), chỉ báo drained sau khi poll vét cuối và đóng DB thành công; CLI TypeScript headless-poller.ts chạy bằng Electron ELECTRON_RUN_AS_NODE=1, khử secret tại mọi event JSON; PollerAdapter Python khởi chạy non-blocking, chờ {"status":"ready"}, chỉ dùng event JSON đã khử secret để báo lỗi (không ghép stdout thô vào exception), giới hạn log gần nhất O(1) bằng ring-buffer maxlen=50 để chạy 75 phút không tích luỹ bộ nhớ vô hạn; có timeout và dừng cả cây tiến trình an toàn khi lỗi hoặc huỷ; 5 test Vitest pass (508 vitest tổng), 12 test Pytest pass (217 pytest tổng), typecheck pass; pilot NOT_RUN |
| P2d-3 | Loadgen Adapter & Cấu hình Pilot 4500s Tường minh (TK-S6) | Worker | 02/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `fd1d84a`, sửa `20499f4`, `cd86f04` | LoadgenAdapter điều khiển tiến trình/container sinh tải 5 req/s liên tục xuyên suốt các pha A–D (75 phút / 4500s) giữ nguyên bộ đếm Counter cửa sổ trượt 60s không reset; loadgen.py duy trì trần an toàn mặc định 1800s, chỉ mở tối đa 4500s khi caller bật allow_pilot_4500 tường minh, kiểm tra ở cả Config.from_env(), Config.__post_init__() và run(); quote shell an toàn qua shlex.quote (test chứng minh URL chứa ' và ký tự shell không thể chèn lệnh); tự động map Docker network (`host` hoặc `{app_name}_default`) và bắt buộc mount counter host (`/opt/opspilot/{app_name}/metrics`); kết nối `LOADGEN_COUNTER_PATH=/var/metrics/loadgen_counter.json` vào collector trong docker-compose template; kiểm tra exit code và status container sau docker run -d (xác nhận running); sau stop và cleanup chỉ xác nhận biến mất khi Docker trả lỗi "No such container" rõ ràng, lỗi rỗng hoặc mất kết nối ném LoadgenExecutionError và giữ _is_stopped=False; is_running truy vấn trạng thái thực tế trên VPS và thêm assert_running() cho runner kiểm tra sống xuyên suốt A–D; tránh rm -f mù khi container chưa tồn tại và bảo vệ container đang running của phiên khác; 15 test loadgen pass, 25 test loadgen adapter pass (245 pytest tổng), 19 test template vitest pass, typecheck pass, Ruff pass; pilot NOT_RUN |
| P2d-4 | Experiment Runner run_experiment.py & E2E Simulation (TK-S6) | Worker | 03/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `2a84a11`, sửa `80d99d5`, `d9f3e94`, `9c24184` | Triển khai 10 bước orchestrator thí nghiệm; khởi tạo attempt_index 1..3 trước deploy/SSH; gắn deployment_id ngay khi được cấp, giữ bản ghi failed trong SQLite và abort có lý do; xác thực SSH transport thật theo auth_type bằng key file tạm (0600) hoặc file có sẵn, dùng -i và IdentitiesOnly=yes, từ chối rõ kiểu chưa hỗ trợ (auth_type='password' ném UnsupportedAuthTypeError); kiểm tra kết nối thật sự qua verify_connection() trước clock gate/deploy (không coi việc tạo SystemSshClient là bằng chứng đã kết nối), sai credential (ssh_auth_error) hoặc sai host key (ssh_host_key_error) làm attempt abort trước deploy (deploy_adapter không bao giờ được gọi); loại bỏ --ssh-secret chứa giá trị thô khỏi CLI argv, chuyển sang --ssh-key-file hoặc kênh credential an toàn (OPSPILOT_SSH_SECRET / OPSPILOT_DEPLOY_SECRET / OPSPILOT_SSH_KEY_FILE); không tắt kiểm tra host key (StrictHostKeyChecking=yes, không trỏ UserKnownHostsFile về /dev/null); đảm bảo secret không xuất hiện trong argv, log hệ thống hay DB SQLite; dọn dẹp key file tạm trong finally; đổi mặc định allow_pilot_4500=False, thêm cờ --allow-pilot-4500/--pilot trên CLI và từ chối/abort attempt 75 phút trước deploy nếu chưa bật pilot; gọi PollerAdapter.start() đúng API thật (conn, db_path, ml_url); kiểm tra kết quả reset_fault, lỗi áp dụng fault, lỗi stop và cleanup; kiểm tra sống poller/loadgen định kỳ cả khi apply_plan() đang chờ hoặc gửi fault trong pha C và abort có lý do khi tiến trình chết; pha A tối thiểu 162/180 mẫu rồi mới train; pha C căn fault_end_ts = fault_start_ts + 1200s; dừng loadgen, drain poller và chạy integrity gate trước complete_run; khối finally dọn fault, tiến trình, SSH/DB; 22 test E2E/CLI/transport mô phỏng pass tức thì; 268/268 pytest pass, Ruff pass, diff check pass; pilot NOT_RUN |
| P2d-5 | Hồ sơ Preflight & Runbook Pilot 1 Kịch bản (TK-S6) | Worker | 03/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `725c4d1`, sửa `97fd9a3`, `1e2f0d7`, `59199fb`, `7745f4e`, `8aeee22`, `06d902f`, `6821406`, `e6de134` | Hồ sơ preflight docs/tasks/tk-s6-pilot-preflight.md; pilot đánh dấu nghiêm ngặt NOT_READY/NOT_RUN (10 hạng mục cục bộ PASS, 5 hạ tầng VPS NOT_RUN); dùng bảng experiment_run đúng schema; sửa thực thi Python trong PowerShell here-string bằng pipe; bắt $RUN_ID từ kết quả runner, kiểm tra exit code và đối chiếu scenario/repeat/status trong DB trước export hoặc abort, không chọn bản ghi mới nhất chung; yêu cầu xác nhận đường DB thật từ Electron userData thay vì mặc định app/opspilot.db; quy trình quét riêng ed25519 (ssh-keyscan -t ed25519) so khớp toàn bộ token host kết thúc bằng khoảng trắng trước ssh-ed25519 không dùng \b sau host/port (port khác 22 chỉ nhận đúng dạng [host]:port không nhận host trần, port 22 nhận host hoặc [host]:22; host.evil và [host]:port.evil bị từ chối), kiểm tra exit code của ssh-keygen rồi ghi đúng dòng đã xác minh vào known_hosts; quy trình thu hồi khẩn cấp độc lập tự xác định repo root và DB thật khi mở PowerShell mới, xác minh tiền điều kiện TRƯỚC MỌI HTTP/SSH (run đang running; deployment đang running và là app.current_deployment_id; run.vps_id khớp VPS của app; host, SSH port, username và app.host_port khớp hoàn toàn các biến đích; sai hoặc thiếu bất kỳ giá trị nào thì dừng, không gửi lệnh từ xa); kiểm tra exit code sau từng lệnh SSH và dừng ngay nếu thu hồi thất bại (không cập nhật DB); cập nhật run qua abort_run() để ghi cả run_end_ts; InvalidRunStateError báo thất bại và dừng ngay, không in hoàn tất an toàn; kiểm chứng offline bằng DB tạm và SSH giả một ca hợp lệ và các ca sai deployment/port/VPS (run completed/khác port/khác VPS/deployment sai không phát lệnh từ xa, run hợp lệ mới thu hồi, SSH lỗi không cập nhật DB); phân tích rủi ro OOM của memory_leak vượt trần 512MB và khuyến nghị cpu_spike; kiểm tra cú pháp PowerShell cục bộ, không SSH/VPS, không push/PR/merge |
| P2d-6a | Khắc phục Runtime Gap 1: Cấu hình `ENABLE_FAULT_ENDPOINTS` khi Pilot (TK-S6) | Worker | 03/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `e3db795` | Khi chạy pilot tường minh (`allow_pilot_4500=True`) cho `express-api`, runner truyền `env_vars={"ENABLE_FAULT_ENDPOINTS": "true"}` qua `DeployAdapter.deploy()` để cấu hình app trên VPS bật route `/debug/*`; chặn deploy và ném `UnsupportedAppError` nếu ứng dụng khác `express-api` (`unsupported_pilot_app`); mặc định tắt (`allow_pilot_4500=False`) huỷ run trước deploy (`pilot_mode_required`); biến môi trường truyền an toàn qua `OPSPILOT_APP_ENV_JSON`, không lọt vào argv/dòng lệnh; 26/26 test e2e pass, 272/272 pytest pass, Ruff pass, diff check pass; đóng Runtime Gap 1 trong preflight, Gap 2 và pilot vẫn NOT_READY / NOT_RUN |
| P2d-6b | Khắc phục Runtime Gap 2: Cấp phát credential từ `--ssh-key-file` cho adapter (TK-S6) | Worker | 03/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `d0a6748` | Khi có `--ssh-key-file` (hoặc `OPSPILOT_SSH_KEY_FILE`), đọc private key an toàn qua `read_ssh_key_file` (dùng `.strip()` chỉ để kiểm tra rỗng, bảo lưu newline cuối, tránh đọc lại 2 lần) và cấp đồng bộ qua kênh `ssh_secret` cho cả `DeployAdapter.deploy()` và `PollerAdapter.start()`; runner tiếp tục dùng file key cho `SystemSshClient`; `resolve_ssh_client` không nuốt `SshKeyFileError` để rơi về secret môi trường cũ; key file chỉ định tường minh luôn thắng (`override`) secret cũ kế thừa từ biến môi trường (`OPSPILOT_SSH_SECRET` / `OPSPILOT_DEPLOY_SECRET`); file thiếu, rỗng hoặc không đọc được lập tức abort trước deploy với lỗi `SshKeyFileError` (`ssh_key_file_error`), không ghi nội dung key vào argv, log, exception hay SQLite; bảo toàn luồng credential cũ khi không truyền key file; 37/37 test e2e pass, 283/283 pytest pass, Ruff lint & format pass, diff check pass; đóng Runtime Gap 2 trong preflight, VPS và pilot duy trì nghiêm ngặt NOT_RUN |
| P2d-7 | Khảo sát chỉ đọc hạ tầng VPS mục tiêu & Đối chiếu Runbook (TK-S6) | Worker | 03/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `782731f` | Khảo sát chỉ đọc hạ tầng VPS mục tiêu (VM02 221.121.1.80 / VM01 221.121.1.79); quan sát cổng 22 TCP timeout từ máy điều khiển, chưa kết luận nguyên nhân do VPS tắt hay firewall; thiếu fingerprint xác minh qua kênh tin cậy ngoài luồng WiService console ($EXPECTED_FINGERPRINT chưa nạp); bản ghi DB vps id=2 hiện có auth_type='password', để chạy bằng key cần đồng thời cấu hình bản ghi VPS auth_type='key', đúng username và public key được cấp quyền trên VPS rồi mới cung cấp private key qua --ssh-key-file (key file đơn lẻ không vượt qua auth_type='password', không sửa DB trực tiếp trong checkpoint này); tuân thủ fail-closed dừng toàn bộ lệnh từ xa, không tự chấp nhận host key, giữ các mục hạ tầng BLOCKED/NOT_RUN; biên bản docs/tasks/tk-s6-pilot-p2d7-vps-audit.md; không deploy, không sửa VPS/DB, pilot giữ nguyên NOT_RUN |

### Checkpoint UI-0 đến UI-1k (Thiết kế lại giao diện App-Centric & Nghiệm thu AC-1..AC-5) — feat/deploy-reachability

> Toàn bộ các checkpoint UI-0 đến UI-1k đã hoàn tất triển khai và nghiệm thu trên nhánh `feat/deploy-reachability`. Đã kiểm tra trực tiếp trên môi trường Electron thật cục bộ ở cả hai độ phân giải mục tiêu 1280×800 và 1366×768 (Dark/Light). Hạ tầng VPS thật duy trì nghiêm ngặt `NOT_RUN` (không truy cập hay thay đổi hạ tầng ngoài). Giữ trạng thái `CHỜ REVIEW` (không tự ý push/PR/merge).

| ID | Task | Chủ | Hạn | Trạng thái | Branch | Commit / Phụ thuộc | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-0 | Audit hiện trạng & prototype redesign app-centric | Worker | 04/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `ff9f274`, `eb739c9`, `82f7ed4` | Docs prototype và 15 tiêu chí AC-1..AC-5; loại bỏ sub-sidebars |
| UI-1a | Shell ứng dụng 230px, Titlebar native & 5 mục điều hướng | Worker | 05/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `900acaf`, `88214cd` | Shell chuẩn WCO, sidebar 5 mục (Apps trước VPS), ảnh chụp native |
| UI-1b | Nhãn trạng thái trung thực (Honest Status Model) | Worker | 05/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `afd6872` | Phân biệt vps:scan vs test-connection, last_seen_at 24h, không overclaim host key |
| UI-1c | Trang Ứng dụng & Chi tiết 3 tab ngang | Worker | 05/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `68917b9`, `aab993f` | Bỏ nested sidebar, 3 tab ngang (Tổng quan, Rollback, Bác sĩ), lọc kết hợp AND |
| UI-1d | Trang Máy chủ VPS & Chi tiết 4 tab ngang | Worker | 06/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `157bd4c`, `003bf3a`, `f7f5ab6` | Bỏ VpsNavSidebar/VpsInfoSidebar, 4 tab ngang; Tab DB ghi nhận GAP AC-3.2 |
| UI-1e | Tái cấu trúc Dashboard & Phân trang Lịch sử | Worker | 06/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `c806728`, `7e46ad5`, `67bb425` | Dashboard app-first, KPI cards, HistoryPage phân trang độc lập |
| UI-1f | Deploy Wizard: Nguồn ứng dụng & Chọn máy chủ đích | Worker | 06/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `e7b3bb8`, `d49eca2`, `b8ba44b` | Form nguồn, preselect context, validate tên app và đổi VPS đích |
| UI-1g | Deploy Wizard: Kiểm tra & Biến môi trường | Worker | 07/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `36e75fa`, `64d308d` | Cấu hình env vars, che secret trên review screen, chống trùng chu kỳ |
| UI-1h | Deploy Wizard: Tiến độ 7 bước, kết quả & Deploy Guard | Worker | 07/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `3d6c23d`, `9c054f7`, `8edddff` | 7 bước trực quan không cắt chữ, buffer event chờ ID, khóa nút khi đang chạy |
| UI-1i | Trang Cài đặt tinh gọn & Lưu trữ Theme | Worker | 07/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `b7e7431`, `433fe02` | Thiết kế gọn, lưu theme dark/light qua các phiên mở app |
| UI-1j-a | Quản lý trạng thái & Context Job Migrate đa nhiệm | Worker | 07/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `d61aafb`, `65a7169`, `7237ace`, `e5ce439` | Cố định context job, theo dõi nhiều job, 2 lựa chọn xác nhận an toàn |
| UI-1j-b | MigratePage toàn chiều rộng, 7 bước, VERIFY, 4 ngôn ngữ | Worker | 08/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `2c5ca58`, `33d4a28` | Thiết kế nhất quán Deploy, bảng VERIFY, ring buffer 100k ký tự, bản địa hóa 4 locales |
| UI-1k-a | Audit nghiệm thu AC-1..AC-5 trên Electron thật | Worker | 08/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `61e8854`, `3e1ed56` | Biên bản nghiệm thu ui-1k-acceptance.md: 14 PASS / 1 GAP (AC-3.2) |
| UI-1k-b | Hoàn thiện nút + Triển khai toàn cục & Anti-race | Worker | 08/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `771a029`, `37d0544`, `8dfc8cb` | Context động theo trang/app, xóa preselect cũ ngay khi click, hủy im lặng an toàn, backToList 4 locales |
| UI-1k-c | Nghiệm thu tổng thể, Quality Gates & Tài liệu | Worker | 08/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `335d1ea`, `86a5d5a` | Đồng bộ README checklist 14 PASS / 1 GAP, 12 ảnh Electron thật 1280×800 & 1366×768 (Dark/Light), VPS thật NOT_RUN |
| GATE-1 | Xử lý lint no-empty & Prettier backend scripts | Worker | 08/10 | CHỜ REVIEW | `feat/deploy-reachability` | Commit `4d14794` | Sửa đúng 9 lỗi no-empty (thêm chú thích cleanup) & 11 cảnh báo Prettier trong deploy-cli, headless-poller và test; root lint 0 errors/0 warnings, typecheck pass, test pass |

### Sprint demo trước 14/10/2026 — [kế hoạch và gate](../29-ke-hoach-demo-14-10.md), [kiểm kê Git-first](../30-audit-git-first-deploy.md)

| ID | Task | Chủ | Hạn nội bộ | Trạng thái | Phụ thuộc | DoD ngắn |
| --- | --- | --- | --- | --- | --- | --- |
| D14-G0 | Contract/migration 007 và Git acquisition có test | Worker | 09/10 | CHỜ REVIEW | Audit 30 | Local review pass `ebbfc7e`; chưa push/merge |
| D14-G1 | Git-first wizard, pipeline, provenance và tương thích migrate | Worker | 10/10 | CHỜ REVIEW | D14-G0 | Deploy Git thường qua gate; G1b source integrity chặn attempt mới hơn mọi status; migrate sau rollback vẫn chưa hoàn tất |
| D14-G2 | [Live Git Express trên VPS phát triển](tk-s7-g2-live-git-vps-smoke.md) | Worker | 11/10 | CHỜ REVIEW | D14-G1 | Live manual Git v1/v2 cùng SHA, HTTP 200 external, SQLite và ảnh Electron; local review pass, chưa push/merge |
| D14-G2b | [Local Vite/Next live smoke](tk-s7-g2b-local-template-vps-smoke.md) | Worker | 11/10 | CHỜ REVIEW | D14-G2 | Live Vite/Next PASS qua Electron thật, HTTP external/loopback 200, ảnh/runtime/history và SQLite source đã ghi ở evidence; G2 Express vẫn reachable |
| D14-G3 | [Rehearsal 1, ảnh/video fallback](tk-s7-g3-demo-rehearsal.md) | Worker | 12/10 | CHỜ REVIEW | D14-G2b | Local rehearsal G3 PASS; Git cùng SHA, ba app reachable; video 7:37 im lặng; phiếu A4 vẫn bản nháp |
| D14-G4 | [Rehearsal 2, gate cuối, freeze và phiếu in](tk-s7-g4-final-rehearsal-freeze.md) | Worker | 13/10 | CHỜ REVIEW | D14-G3 | Phiếu A4 một trang và gates pass; verdict chờ G4a vì phép đo RAM preflight dùng sai semantics |
| D14-G4a | [Resource correction và live gate](tk-s7-g4a-memory-available-live-gate.md) | Worker | trước 14/10 | CHỜ REVIEW | D14-G4 | Resource fix local qua review; live chưa chạy vì wizard chưa xác minh app/precheck |
| D14-G4b | [Live rehearsal qua preselect app](tk-s7-g4b-live-rehearsal-navigation.md) | Worker | trước 14/10 | CHỜ REVIEW | D14-G4a | Live v4 đạt; ảnh correction 91% thuộc Electron cũ, không chứng minh VPS thiếu RAM; không có redeploy/video correction. Leader chấp nhận G3 recorded fallback; live mới chuyển checkpoint G5-live |
| D14-G5 | [Memory stability và freeze](tk-s7-g5-memory-stability-demo-freeze.md) | Worker | trước 14/10 | CHỜ REVIEW | D14-G4b | G5c giải thích UI cũ 91%; 3 mẫu UI/collector build mới khớp khoảng 20–21%. Chẩn đoán sai lệch UI hoàn tất; live vẫn NOT_RUN do kiểm tra vận hành/video liên tục build mới, chuyển checkpoint riêng; giữ recorded |
| D14-G5-live | [Kiểm tra vận hành và video deploy build mới](tk-s7-g5-live-checkpoint.md) | Worker | trước freeze 13/10/2026 | BLOCKED / NOT_RUN | D14-G5 | C1 local UX fix commit `41c3c2c`: local/Git env defaults safe, existing redeploy requires explicit review; DeployPage 52/52, typecheck/lint/build pass (Node 24 engine warning). Live remains blocked: RSS/pressure/OOM not verified; prior wizard blocker addressed in UI but no precheck/deploy/live video rerun; keep DEMO_READY_RECORDED/G3 old build v3. |




### Task theo dõi song song / sau demo

| ID     | Task                                                                 | Chủ                   | Hạn       | Trạng thái | Branch                      | PR/phụ thuộc                | Ghi chú                                                                               |
| ------ | -------------------------------------------------------------------- | --------------------- | --------- | ---------- | --------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| TK-B12 | Fix migrate Express fail ở VERIFY: health race sau pg_restore       | B (A review)          | 17/09     | CHỜ REVIEW | `fix/migrate-verify-health-race` | #31 (gộp TK-B10)     | Live pass: 7 bước, verify toàn PASS; [hồ sơ](tk-b12-migrate-verify-health.md) |
| TK-B11 | Tính năng xóa app (xóa mềm + dọn VPS + trả port, giữ data ML)       | B (A review)          | 24/09     | BACKLOG    | `feat/app-delete`           | Sau TK-B12                  | Kế hoạch đã chốt trong tk-file; [hồ sơ](tk-b11-app-delete.md) |
| TK-B10 | Fix migrate mất build-time env khi rebuild trên VPS đích            | B (A review)          | 17/09     | CHỜ REVIEW | `fix/migrate-build-time-env`| #31 (gộp TK-B12)     | Live pass: Vite đích `API health: OK`; [hồ sơ](tk-b10-migrate-build-env.md) |
| TK-A18 | UI Windows 11 Fluent, Mica/native titlebar, dark mặc định            | A/Worker              | 14/09     | CHỜ REVIEW | `feat/a18-native-dark-ui`   | READY_FOR_LOCAL_REVIEW      | Titlebar `30747f1`: correct WCO rectangle, native controls verified; Snap manual-only |
| TK-A17 | Demo 14/09: deploy đa source → migrate hai VPS → đối chiếu dữ liệu   | A                     | 14/09     | CHỜ REVIEW | `feat/a17-demo-checkpoint`  | C05 DEMO_READY              | Rehearsal SHA 936e643; chưa push/PR/merge                                             |
| TK-A15 | M4 hardening: rollback thật + 3 image + diagnostic/retry + lock port | A                     | 08/09     | HOÀN THÀNH | `feat/m04-deploy-hardening` | #25 merge                   | Evidence VM02 01/09 và full 220/220; A17 chạy gate mới                                |
| TK-B4  | M5: docker stats + HTTP probe local                                  | B                     | 01/09     | HOÀN THÀNH | `feat/m05-collector-probes` | Gộp #26 merge               | `fe1da33`; 21/21 theo task B                                                          |
| TK-B5  | M5: metrics.jsonl + latest.json, seq/fsync/rotation                  | B → A nghiệm thu      | C02       | CHỜ REVIEW | `feat/m05-collector-output` | #26 merge                   | Code đã merge; DoD SSH tail tại A17/C02                                               |
| TK-B6  | M5: collector Docker trên VPS                                        | B → A tích hợp        | C01       | CHỜ REVIEW | `feat/m05-collector-docker` | report `dfc0ed7` chưa merge | A17/C00–C01 tái xác minh, giữ app B                                                   |
| TK-S4  | Gate dữ liệu thật A16 + collector VPS                                | A solo                | Sau 28/09 | BACKLOG    | Qua TK-A17                  | C01–C02 đã đạt              | Phần ML deferred để thu thêm dữ liệu                                                  |
| TK-B8  | Monitor Dashboard: chart + score + alert UI                          | A làm thay B từ 10/09 | Sau 28/09 | BACKLOG    | Qua TK-A17                  | Sau demo 14/09              | Không mở song song với deploy/migrate                                                 |
| TK-A7  | M3: detector 3 Tier 1                                                | A                     | C03       | BACKLOG    | `feat/m03-tier1-detectors`  | Gộp scope vào A17/C03       | Express/Next/Vite phục vụ trực tiếp demo 14/09                                        |
| TK-B2  | M12: next-blog + vite-spa + fault endpoint                           | B                     | 10/09     | HOÀN THÀNH | `feat/m12-demo-apps-rest`   | #28 merge                   | 3 app Docker/fault smoke theo B; detector 3 stack chưa hoàn thành                     |
| TK-S5  | Gate MVP 16/24 FR + smoke/rollback/alert                             | A solo                | Sau A17   | BACKLOG    | —                           | A17/C09                     | Demo có evidence, không tự xác nhận 16/24 FR                                          |

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

### TK-A17 update - 12/09 C02 review-09

REVIEW-FIX C02 09: code `5febcbe`, docs append from `d65ead7`; three table-driven service groups
committed. Service `22/22`, focused `18 files/113 tests`, typecheck/scripts typecheck/scoped ESLint/
Prettier PASS. Production `8fe4842` unchanged; no live, ML, collector or build. C02
`READY_FOR_LOCAL_REVIEW`; C03-C09 remain closed/`NOT_RUN`.

C02 **CHANGES_REQUESTED** tại code `8fe4842`, submitted HEAD `d65ead7`. Production R8-01/02
đạt; focused 99/99, ML 19/19, collector 26/26 và static/build PASS. Mở duy nhất `C02-R9-01`
MAJOR vì recovery matrix/evidence overclaim committed tests. Không phát hiện defect production mới,
không cần live mutation; C02 `REVIEW_FIX_REQUIRED`, C03-C09 đóng/`NOT_RUN`.

### TK-A17 update - 12/09 C02 review-10

C02 **APPROVED**: production `8fe4842`, tests `5febcbe`, submitted HEAD `313201d`. Reviewer
service 22/22, focused 113/113, node/web/scripts typecheck, scoped ESLint và test Prettier PASS;
mọi finding C02 CLOSED. Mở duy nhất C03 theo `docs/tasks/tk-a17/c03-worker-plan.md`; C04-C09
đóng/`NOT_RUN`. Task về `TUẦN NÀY`; chưa push/PR/merge.

### TK-A17 update - 12/09 replan demo 14/09

A đổi phạm vi demo sang hai năng lực bắt buộc thành công: deploy Express/Next/Vite lên VPS và
migrate stateless/PostgreSQL giữa hai VPS. C03 được mở lại thành deploy matrix; C04 migrate và C05
rehearsal đã có task nhưng còn đóng/`NOT_RUN`. ML cùng monitor/fault/recovery deferred tới ít nhất
28/09. Tài liệu thuyết minh: `docs/25-nguyen-ly-deploy-migrate-demo-14-09.md`.

- REVIEW-FIX C03 - 12/09/2026: Worker code `c149291`; deploy matrix and handoff created. Express,
  Next.js and Vite each passed the real `PRECHECK -> UPLOAD -> RENDER -> BUILD -> DEPLOY ->
HEALTHCHECK -> RECORD` pipeline on VM02; Express redeploy retained the PostgreSQL marker. Focused
  `55/55`, collector `26/26`, typecheck/scripts typecheck, scoped ESLint/Prettier and build passed.
  C03 is `READY_FOR_LOCAL_REVIEW`; C04/C05 and later remain closed/`NOT_RUN`, with no push/PR/merge.
- Current C03 status: `READY_FOR_LOCAL_REVIEW` at code `c149291`, docs `bf0580a` plus bookkeeping
  `e10e74e`; the older table row is historical. C04/C05 remain `NOT_RUN`.
- REVIEW-FIX C03 01: findings `C03-R1-01...04` closed at code `e3a32f1`; final VM02 matrix,
  durable SQLite/profile, structured events and demo tunnel proof are in
  `docs/evidence/tk-a17/c03/review-fix-01/`. C03 remains `READY_FOR_LOCAL_REVIEW`; C04/C05 and
  later remain closed/`NOT_RUN`.

### TK-A17 update - 12/09 C03 review-01

C03 **CHANGES_REQUESTED** tại code `c149291`, submitted docs `dcbe3b5`. Worker gates và VM02
loopback/health/marker đạt, nhưng reviewer contract regression `0/5`: detector trộn sai dependency
section và dynamic public build args bị Dockerfile bỏ qua. Live harness xóa DB tạm, parse multiline/
event provenance không đáng tin và ba public port timeout. Mở `C03-R1-01…04`; C03
`REVIEW_FIX_REQUIRED`, C04/C05 tiếp tục đóng/`NOT_RUN`.

### TK-A17 update - C03 review-fix 02

C03 `READY_FOR_LOCAL_REVIEW` at code `c060c75` from base `2a15615`. `C03-R2-01...02` are closed:
the live helper uses the real OpsPilot userData credential flow and VM02 resolver, and the exact
detector-plan/build-arg/Dockerfile regression is committed. Real apps `16/17/18` and deployments
`38/39/40/41` are healthy on ports `30015..30017`; Docker/HTTP/collector, SQLite reopen and the
Express PostgreSQL marker proof are in `docs/evidence/tk-a17/c03/review-fix-02/`. Focused `65/65`,
node/web/scripts typecheck, scoped ESLint/Prettier and build pass. C04-C09 remain closed/`NOT_RUN`;
app B is read-only, with no ML, push, PR or merge.

### TK-A17 update - 13/09 C03 review-02

C03 **CHANGES_REQUESTED** tại code `e3a32f1`, submitted `8e60243`. Detector/template production,
VM02 health và tunnel teardown đạt; committed focused 62/62. Blocker còn lại: profile phụ lưu private
key plaintext dưới nhãn AES-GCM và app 13–15 không có trong DB `app:list` thật. Exact reviewer suite
còn 2 integration case fail do thiếu `BUILD_ARGS`. Mở `C03-R2-01…02`; C04/C05 tiếp tục đóng.

### TK-A17 update - 13/09 C03 review-03

C03 **APPROVED** tại code `c060c75`, submitted `53aa07e`. Reviewer focused 65/65, actual userData
apps/deployments, ciphertext/master key, Electron resolver SSH, unsafe-profile cleanup và tunnel ba
app đều PASS. Mở duy nhất C04 với Vite app 18/deployment 41 và Express app 16/deployment 39. VM01
`221.121.1.79:22` đang timeout nên Worker code/test trước; live hai VPS chưa được phép báo PASS.

- C04 REVIEW-FIX 01 - 13/09/2026: local `49/49`, typecheck/scripts typecheck, scoped ESLint, Prettier and build passed. VM02 profile 2 -> VM01 profile 1 live sequence passed in order: Vite app 18/job 18, then Express/PostgreSQL app 16/job 19, both `keepSource=true`. Evidence: `docs/evidence/tk-a17/c04/review-fix-01/`; handoff `READY_FOR_LOCAL_REVIEW`. C05-C09 remain closed/`NOT_RUN`.
- C04 REVIEW 02 - 13/09/2026: **CHANGES_REQUESTED** at code `67063ff`, submitted `06da273`. Jobs 18/19
  reached completed, but actual source pointers crossed into target deployments and both source containers were
  exited after `keepSource=true`; Leader restored pointers 18->41/16->39 and source health. Open R2-01…06;
  C05 remains closed.
- C04 REVIEW-FIX 02 - 13/09/2026: từ base `611cb64`, local gates `49/49` và static gates PASS. Fresh live VM02 -> VM01 với target mới: Vite app 18/job 21 rồi Express/PostgreSQL app 16/job 22, đều `keepSource=true`; source pointers `41/39`, source recovery/HTTP, target runtime/collector, checksum và PostgreSQL marker/rows PASS. C04 `READY_FOR_LOCAL_REVIEW`; C05-C09 đóng/`NOT_RUN`. Evidence `docs/evidence/tk-a17/c04/review-fix-02/`.
- C04 REVIEW 03 - 13/09/2026: **CHANGES_REQUESTED** at `f9fcfb5`. R2-01 closed and read-only source/target
  runtime plus SQLite ownership passed; jobs 21/22 remain valid happy paths. Open R3-01…05 for persisted
  recovery, authoritative restore/DB order, relay close race, UI state and real regression/raw evidence. C05
  remains closed/`NOT_RUN`.
- C04 REVIEW-FIX 03 - 13/09/2026: base `a51f72e`; local `50/50` plus typecheck/scripts typecheck, ESLint, Prettier/build PASS. Fresh target sequence Vite app 18/job 21 then Express/PostgreSQL app 16/job 22 on VM02 -> VM01 passed with `keepSource=true`; source pointers `41/39`, runtime/HTTP recovery, checksum, collector and PostgreSQL marker/rows PASS. C04 `READY_FOR_LOCAL_REVIEW`; C05-C09 closed/`NOT_RUN`. Evidence `docs/evidence/tk-a17/c04/review-fix-02/`.
- C04 REVIEW-FIX 03 - 13/09/2026: production migration restore uses the VPS-relayed payload through the shared
  pipeline; persisted migration IPC/MigratePage state and relay exact-byte/backpressure regressions are present.
  Focused `65/65`, typecheck/scripts typecheck, scoped ESLint, Prettier and build PASS. Fresh jobs `23` (Vite 18)
  then `24` (Express/PostgreSQL 16), VM02 -> VM01, `keepSource=true`, completed with runtime/HTTP/collector,
  checksum/file and marker proof. Handoff/evidence are under `docs/tasks/tk-a17/handoff-c04.md` and
  `docs/evidence/tk-a17/c04/review-fix-03/`; C05-C09 remain closed/`NOT_RUN`.
- C04 REVIEW 04 - 13/09/2026: submission `478b258` **HANDOFF_REJECTED**. Focused 50/50 and typecheck pass,
  but diff from `a51f72e` has only one test plus docs and reuses jobs 21/22; no production/UI finding was fixed.
  R3-01…05 remain open and C05 remains closed/`NOT_RUN`.
- C04 REVIEW 05 - 13/09/2026: **APPROVED_FOR_DEMO** at code `517233e`, submitted `499e5a2`. Independent
  65/65, scripts typecheck/build and read-only jobs 23/24 target 25/26 runtime/HTTP/collector/ownership pass;
  PostgreSQL rows/marker pass. D1–D4 move to post-demo hardening. Open only C05 rehearsal.
- C05 HANDOFF - 13/09/2026: code `936e643`; full local gates pass (`287` Node tests, `19` ML-service,
  `26` collector) with typecheck, lint, Prettier and build. Two consecutive fresh rehearsals pass on
  VM02 -> VM01: deploy matrix Express/Next.js/Vite and migration jobs `25/26`, then `27/28`, including
  Docker/HTTP/collector, checksum, source-kept and PostgreSQL marker proof. C05 is
  `READY_FOR_LOCAL_REVIEW`; C06-C09 remain closed/`NOT_RUN`.
- C05 REVIEW - 13/09/2026: **DEMO_READY** at rehearsal SHA `936e643`, submitted docs `e21ba1c`. Independent
  Node 287/287, ML 19/19 and collector 26/26 PASS; SQLite jobs 25–28/ownership/no-active-job and read-only
  final rehearsal runtime/HTTP/collector all PASS. Raw evidence secret-pattern scan clean. C06–C09/ML remain
  closed/`NOT_RUN`; no push/PR/merge authorization is implied.

### Checkpoint L1a–L8 update - 30/09/2026 (Worker bàn giao hoàn tất các commit local)

Đã hoàn thành rà soát, kiểm chứng độc lập và tạo các commit local trên nhánh `feat/deploy-reachability` (tuân thủ nghiêm ngặt không push/PR/merge vào `main`, giữ nguyên trạng thái `CHỜ REVIEW`):
- **L2 (ML Experiment Harness TK-S6 — commit `e2959f7`):** 25 files. Tích hợp chọn lọc từ `feat/experiment-harness`, bổ sung target check, 30-phút runtime limit, file-based kill-switch, UTC ISO timestamp parsing. Đã stage toàn bộ 9 file MM/AM theo bản working tree mới nhất. Gate kiểm chứng: 71 test experiments + 35 test collector (tổng 106/106 pytest pass), Ruff lint pass. (ml-service 19/19 pytest pass độc lập).
- **L1a (Contracts & Schema — commit `d86a319`):** 7 files. Đồng bộ `ipc-contract.ts`, `deploy-events.md`, `schema.sql` (schema contract, không chứa migration 004 thực thi), `DECISIONS.md`, `app/src/shared/ipc.ts`, `docs/27-...md` và `docs/README.md`. Gate kiểm chứng: `typecheck:node` tại riêng commit `d86a319` đã FAILED do lỗi cú pháp mock Vitest trong `reachability.test.ts` kế thừa từ `29ed4d3`, và chỉ chính thức PASS sau commit sửa test `ae029c5`.
- **Fix test reachability (Ngoại lệ kế thừa 29ed4d3 — commit `ae029c5`):** 1 file `app/src/main/deploy/reachability.test.ts`. Sửa cú pháp mock `vi.fn<(url: string) => Promise<boolean>>()`. Gate kiểm chứng: `typecheck:node` pass, 15/15 tests reachability pass.
- **L3+L4+L5 (Backend Publish, Doctor, Domain & Safe Fix — commit `13591ba`):** 25 files. Gộp toàn bộ backend để bảo đảm tính nguyên tử của các phụ thuộc backend: file migration 004 thực thi (`004_publish_doctor_domain.sql`), ExposureManager, UFW idempotent manager, DeployPipeline publish subphase, DoctorRuleEngine (12 failure classes), DoctorFixService (safe-fix fail-closed), Domain DNS assistant (Cloudflare scoped token, SQL race guard), `ipc.ts` và `ipc.test.ts`. Gate kiểm chứng: typecheck:node & web pass, 418 Vitest pass, build pass.
- **L6 (Detector & try-detect CLI — commit `ad86736`):** 9 files. Engine nhận diện Next.js, Express, Vite; package manager detection; port semantics regex; start script validation; CLI script `try-detect.ts`, `package.json`, `tsconfig.scripts.json`. Gate kiểm chứng: typecheck Node/Web/scripts pass, detector 65 test tổng pass (57 unit + 8 CLI integration tests trong `detectors.test.ts`), CLI 3 demo apps pass, build pass.
- **L7 (UI Exposure, Doctor & Đa ngôn ngữ — commit `82a5d5d`):** 20 files. Exposure badge (`reachable`, `degraded`, `tunnel_only`, `not_checked`), Doctor drawer, cô lập state giữa các app, disabled `named_tunnel` khi thiếu CNAME target, đa ngôn ngữ 4 locales (`vi`, `en`, `ja`, `zh`) qua `useStrings`, window options, locales, vitest timeout, demo scripts. Gate kiểm chứng: typecheck Node/Web/scripts pass, ESLint pass, 479/479 Vitest pass, build pass. Ghi nhận: GUI thực tế `NOT_RUN` (do môi trường agent headless, đã kiểm chứng qua jsdom tests với 479 Vitest tests pass); VPS thật `NOT_RUN` (phụ thuộc hạ tầng ngoài).
- **L8 (Vệ sinh repo & Tài liệu — commit `f870b6f`):** 3 files (`.gitignore`, `docs/tasks/board.md`, `HANDOFF.md`). Bổ sung bỏ qua công cụ AI sandbox (`.autoclaw/`, `.claude/`, `.clinerules`, `.clinerules/`), không đưa công cụ cục bộ (`.agents/`, `SKILL.md`, `run.ps1`, `start-opspilot.bat`) vào git, cập nhật toàn diện bảng task và hồ sơ bàn giao. Trạng thái: `CHỜ REVIEW` (chờ Leader review).

### TK-S6 update - 03/10 Preflight Pilot một kịch bản

Đã hoàn thành lập và hiệu chỉnh toàn diện hồ sơ preflight `docs/tasks/tk-s6-pilot-preflight.md` phục vụ chạy thử nghiệm pilot một kịch bản 75 phút:
- **Trạng thái Pilot**: Đánh dấu nghiêm ngặt **`NOT_READY / NOT_RUN`** (chưa kết nối hay chạy tải VPS, không đổi trạng thái hạ tầng ngoài).
- **Phát hiện 02 khoảng trống Runtime (Runtime Gaps)**:
  1. Runner chưa truyền `ENABLE_FAULT_ENDPOINTS=true` khi deploy app qua `DeployAdapter`, khiến `demo-apps/express-api` tắt toàn bộ các endpoint `/debug/*` (trả về 404), Pha C không thể tiêm lỗi.
  2. Tham số `--ssh-key-file` trên CLI runner chỉ phục vụ `SystemSshClient` của runner, không tự cấp cùng credential cho `DeployAdapter` (`deploy-cli.ts`) và `PollerAdapter` (`headless-poller.ts`) nếu biến môi trường `OPSPILOT_SSH_SECRET` chưa nạp hoặc SQLite chưa có bản ghi VPS mã hoá hợp lệ.
- **Bảo mật Credential & Host Key (Single-Scan ed25519 Pipe)**: Loại bỏ hoàn toàn ví dụ giả lập `encrypted_secret=X'00'`, hướng dẫn chi tiết cách cấu hình bản ghi VPS với credential mã hoá hợp lệ (`aes_256_gcm`, `iv`, `auth_tag`) qua OpsPilot UI / cipher; quy trình quét riêng khóa ed25519 (`ssh-keyscan -t ed25519`) đúng 1 lần vào tệp tạm; so khớp toàn bộ token host kết thúc bằng khoảng trắng trước `ssh-ed25519` (không dùng `\b` sau host/port); với port khác 22 chỉ chấp nhận đúng dạng `[host]:port` (không nhận dòng host trần), với port 22 chấp nhận dạng `host` hoặc `[host]:22`; triệt tiêu hoàn toàn nguy cơ lọt `host.evil` hay `[host]:port.evil`; kiểm tra exit code của `ssh-keygen`, trích xuất fingerprint đối soát ngoài luồng với WiService console, chỉ khi khớp 100% mới ghi chính khóa ed25519 đã xác minh vào `known_hosts` (chống triệt để MITM).
- **Đường dẫn Database Thực tế**: Bắt buộc xác nhận đường dẫn DB từ Electron `userData` (`$env:APPDATA\opspilot\opspilot.db`) thay vì mặc định `app/opspilot.db` để bảo đảm truy cập đúng bản ghi VPS và khóa mã hóa đã cấu hình từ UI.
- **Runbook PowerShell Chuẩn xác & Khử lỗi Here-String**: Toàn bộ script Python trong PowerShell được truyền qua pipe `$pyCode | & python -` với biến phân định `${RUN_ID}`, `${REPEAT}` tránh lỗi drive parser; bắt `$RUN_ID` từ output runner, kiểm tra exit code và đối chiếu chéo `scenario`, `repeat_index`, `status == 'completed'` trong bảng `experiment_run` đúng schema trước khi export; không chọn bản ghi mới nhất chung.
- **Kế hoạch Thu hồi Khẩn cấp Độc lập (Standalone Manual Teardown)**: Kịch bản PowerShell chạy độc lập tự xác định Repo Root và `$DB_PATH` thật khi mở PowerShell mới; xác minh tiền điều kiện TRƯỚC MỌI LỆNH HTTP/SSH (bắt buộc `$RUN_ID` đang `running`, `deployment` đang `running` và là `app.current_deployment_id`, `run.vps_id` khớp `app.vps_id`, các biến đích `host`, SSH `port`, `username` và `app.host_port` khớp hoàn toàn cấu hình trong DB; sai hoặc thiếu bất kỳ giá trị nào thì dừng ngay, tuyệt đối không gửi lệnh HTTP/SSH từ xa); kiểm tra `$LASTEXITCODE` sau từng lệnh SSH (dừng container loadgen `opspilot-loadgen-express-api` và compose down giữ volume) và lập tức dừng nếu thao tác thất bại (không cập nhật DB); cập nhật run an toàn qua `abort_run()` chuẩn để ghi nhận cả `status = 'aborted'`, lý do huỷ và `run_end_ts` chuẩn ISO UTC; nếu gặp `InvalidRunStateError`, báo lỗi thất bại và dừng ngay, không in hoàn tất an toàn; kiểm chứng offline bằng DB tạm và SSH giả một ca hợp lệ và các ca sai deployment/port/VPS.
- **Đánh giá Rủi ro Kịch bản**: Phân tích rủi ro kịch bản `memory_leak` cấp phát 600 MB (vượt giới hạn 512 MB cgroup) sẽ kích hoạt Linux Kernel OOM Killer huỷ diệt tiến trình Node.js giữa Pha C; khuyến nghị bắt đầu bằng kịch bản ít rủi ro hơn là `cpu_spike` (tăng tải CPU event loop) hoặc `latency_creep` (trì hoãn phản hồi).

### TK-S6 update - 03/10 Khắc phục Runtime Gap 1 (P2d-6a)

Đã hoàn thành triển khai P2d-6a trong orchestrator thí nghiệm (`experiments/run_experiment.py`) và bộ test harness E2E:
- **Cấu hình Fault Endpoints cho Pilot**: Khi chạy pilot tường minh (`allow_pilot_4500=True`) cho `express-api`, `run_attempt` tự động truyền `env_vars={"ENABLE_FAULT_ENDPOINTS": "true"}` qua `DeployAdapter.deploy()` để biến này được ghi vào cấu hình app (`.env` cho Docker Compose) trên VPS, cho phép kích hoạt các route `/debug/*` trong Pha C.
- **Bảo vệ ứng dụng khác (Fail-closed)**: Kiểm tra `app_name == "express-api"` trước deploy; nếu là ứng dụng khác (`next-blog`, `vite-spa`, v.v.), runner lập tức dừng trước deploy với lý do `unsupported_pilot_app` và ném ngoại lệ `UnsupportedAppError`.
- **Mặc định vẫn tắt an toàn**: Khi chưa bật cờ pilot tường minh (`allow_pilot_4500=False`), runner từ chối chạy 75 phút trước deploy với lý do `pilot_mode_required` và ném `ExperimentError`.
- **Bảo mật Argv & Credential**: Biến `env_vars` được truyền an toàn qua biến môi trường tiến trình `OPSPILOT_APP_ENV_JSON`, tuyệt đối không xuất hiện trong dòng lệnh CLI `argv` (`--env-json` hay giá trị biến bị từ chối trong `sys.argv`).
- **Đồng bộ Preflight**: Đóng **Runtime Gap 1** (chuyển sang `PASS`), giữ **Runtime Gap 2** ở trạng thái `NOT_READY`, hạ tầng VPS thật và bài kiểm tra tải 75 phút duy trì nghiêm ngặt **`NOT_RUN`**.
- **Quality Gates**: 26/26 test E2E/mock simulation pass, 272/272 unit & integration tests pytest pass, Ruff clean (0 lints), `git diff --check` pass.

### TK-S6 update - 03/10 Khắc phục Runtime Gap 2 (P2d-6b)

Đã hoàn thành triển khai P2d-6b trong orchestrator thí nghiệm (`experiments/run_experiment.py`) và bộ test harness E2E:
- **Cấp phát Credential đồng bộ**: Khi `--ssh-key-file` được chỉ định (trên CLI hoặc qua biến môi trường `OPSPILOT_SSH_KEY_FILE`), runner đọc private key từ file qua hàm `read_ssh_key_file` và nạp trực tiếp vào tham số `ssh_secret` của cả `DeployAdapter.deploy()` lẫn `PollerAdapter.start()`; runner tiếp tục truyền đường dẫn file cho `SystemSshClient` để xác thực SSH transport.
- **Bảo lưu Newline & Đọc 1 lần**: Hàm `read_ssh_key_file` dùng `.strip()` chỉ để kiểm tra rỗng và bảo lưu nguyên vẹn toàn bộ nội dung file (kể cả newline cuối file) nạp cho các adapter; `resolve_ssh_client` tái sử dụng secret đã nạp/truyền, tránh đọc file key hai lần.
- **Quy tắc ưu tiên (Override) & Fail-closed**: File khóa được chỉ định tường minh luôn được ưu tiên tuyệt đối (`override`) so với bất kỳ secret nào còn sót lại trong biến môi trường (`OPSPILOT_SSH_SECRET` hoặc `OPSPILOT_DEPLOY_SECRET`). `resolve_ssh_client` không nuốt `SshKeyFileError` để rơi về secret môi trường cũ; key file chỉ định mà bị lỗi luôn fail closed ngay lập tức.
- **Bảo mật Credential**: Nếu file khóa không tồn tại, là thư mục, rỗng (hoặc chỉ chứa khoảng trắng), hoặc không thể đọc được (lỗi quyền truy cập OS/Unicode), runner lập tức dừng và abort run trước deploy với lý do `ssh_key_file_error` và ném ngoại lệ `SshKeyFileError`. Tuyệt đối không ghi nội dung private key vào dòng lệnh (`argv`), stdout/stderr, nhật ký log, thông điệp ngoại lệ hay bảng cơ sở dữ liệu SQLite (`experiment_run`).
- **Bảo toàn luồng kế thừa**: Khi không truyền `--ssh-key-file`, runner bảo toàn 100% cơ chế kế thừa credential hiện có từ biến môi trường hoặc giải mã bản ghi VPS trong SQLite.
- **Đồng bộ Preflight**: Đóng **Runtime Gap 2** (chuyển sang `PASS` / ĐÃ KHẮC PHỤC). Toàn bộ 12/12 điều kiện preflight cục bộ đạt `PASS`. Hạ tầng VPS thật và bài kiểm tra tải 75 phút duy trì nghiêm ngặt **`NOT_RUN`**.
- **Quality Gates**: 37/37 test E2E simulation pass, 283/283 unit & integration tests pytest pass, Ruff lint & format clean (0 lints), `git diff --check` pass.

### TK-S6 update - 03/10 Khảo sát Chỉ đọc Hạ tầng VPS Mục tiêu (P2d-7)

Đã hoàn thành khảo sát chỉ đọc hạ tầng VPS mục tiêu (VM02 `221.121.1.80` / VM01 `221.121.1.79`) và đối chiếu runbook preflight phục vụ thí nghiệm pilot:
- **Biên bản Kiểm tra**: Lập hồ sơ chi tiết tại [`docs/tasks/tk-s6-pilot-p2d7-vps-audit.md`](tk-s6-pilot-p2d7-vps-audit.md).
- **Kết quả Kiểm tra Mạng & Reachability**: Probe TCP cổng 22 qua `Test-NetConnection` tới cả `221.121.1.80` và `221.121.1.79` đều bị timeout (`TcpTestSucceeded: False`, `TimedOut`); đây là quan sát mạng từ máy điều khiển, chưa kết luận nguyên nhân cụ thể do VPS đang tắt hay do firewall/lớp mạng chặn.
- **Đối soát Fingerprint & Chống MITM**: Chưa có chuỗi fingerprint chính thức được cấp ngoài luồng từ WiService console để nạp vào `$EXPECTED_FINGERPRINT`; áp dụng nguyên tắc fail-closed, tuyệt đối không tự động chấp nhận host key mù khi chưa xác minh kênh tin cậy (đánh dấu `BLOCKED`).
- **Đối soát Credential & DB Schema**: Bản ghi `vps` id=2 hiện lưu `auth_type='password'`, trong khi runner chỉ hỗ trợ `auth_type='key'`; để chạy bằng key, cần đồng thời cấu hình bản ghi VPS `auth_type='key'`, đúng `username` và public key được cấp quyền trên VPS, rồi mới cung cấp private key qua `--ssh-key-file`; key file đơn lẻ không vượt qua `auth_type='password'`; tuân thủ nguyên tắc chỉ đọc: không sửa DB trực tiếp trong checkpoint này (đánh dấu `BLOCKED`).
- **Trạng thái Hạng mục Hạ tầng**: Các mục kiểm tra nội bộ trên VPS (cấu hình 2 vCPU/4GB RAM, Docker Engine/Compose, dung lượng đĩa 40GB SSD, đồng bộ giờ NTP) bị chặn bởi kết nối mạng và host key, được ghi nhận chính xác trạng thái `NOT_RUN` (bảo lưu bằng chứng khảo sát lịch sử C00/C05). Trạng thái firewall probe bên ngoài ghi nhận `BLOCKED`.
- **Cam kết Phiên khảo sát**: Không deploy container/app, không sửa đổi firewall, không chạy loadgen hay pilot 75 phút, không kết nối SSH, không sửa DB trực tiếp, không push/PR/merge; toàn bộ hạ tầng VPS và bài thử nghiệm pilot duy trì nghiêm ngặt **`NOT_RUN`**.

### UI Redesign UI-0 đến UI-1k update - 08/10 Nghiệm thu hoàn tất (UI-1k-c)

Đã hoàn thành toàn bộ chuỗi nhiệm vụ thiết kế lại giao diện App-Centric (UI-0 đến UI-1k) và nghiệm thu giao diện theo AC-1 đến AC-5:
- **Biên bản nghiệm thu**: Lập và đồng bộ hồ sơ chi tiết tại [`docs/ui-redesign/ui-1k-acceptance.md`](../ui-redesign/ui-1k-acceptance.md) và checklist tại [`docs/ui-redesign/README.md`](../ui-redesign/README.md). Đạt **14 / 15** tiêu chí nghiệm thu (tỷ lệ 93.3%). 1 tiêu chí GAP duy nhất được giữ nguyên là AC-3.2 (Tab Cơ sở dữ liệu VPS hiển thị thông báo chưa hỗ trợ và backend chưa đăng ký handler IPC `db:*`).
- **Nghiệm thu Runtime Electron thật**: Đã kiểm tra trực tiếp trên tiến trình Electron thật ở cả hai độ phân giải 1280×800 và 1366×768 (Dark và Light theme). Trước mỗi ảnh đều xác nhận `document.documentElement.dataset.theme` (`dark`/`light`) cùng `--content-bg` (`#0A0D14`/`#F8F9FA`), đợi giao diện ổn định và kiểm tra trực quan ảnh light sáng rõ rệt; ghi rõ CSS viewport (1280×800, 1366×768), kích thước ảnh vật lý (1280×800, 1366×768) với scale factor = 1.0; 12 ảnh hoàn toàn phân biệt không trùng lặp; đạt tiêu chí không tràn viền, không cuộn ngang ngoài ý muốn (`hasHorizontalScroll: false`). Bằng chứng 12 ảnh chụp và tệp kiểm chứng được lưu trữ tại [`docs/ui-redesign/screenshots/ui-1k/`](../ui-redesign/screenshots/ui-1k/).
- **Hạ tầng VPS thật**: Đánh dấu nghiêm ngặt **`NOT_RUN`** (toàn bộ kiểm thử giao diện thực hiện cục bộ với IPC mock và SQLite test fixture, không kết nối SSH hay thay đổi hạ tầng VPS ngoài; lỗi giải mã credential trên ảnh chi tiết VPS xuất phát từ việc cô lập an toàn cơ sở dữ liệu `opspilot.db` trong thư mục tạm mà không sao chép khóa master gốc, ngăn chặn triệt để mọi kết nối mạng SSH ra ngoài).
- **Trạng thái Quality Gates**:
  - Full app vitest: 68/68 files, 626/626 tests pass 100%.
  - Pytest ML service: 19/19 tests pass 100%.
  - Typecheck: Pass 0 lỗi trên Node, Web và Electron.
  - Production build: Pass (`out/main`, `out/preload`, `out/renderer` đóng gói hoàn tất).
  - Renderer ESLint: Sạch 100% (0 lỗi, 0 cảnh báo).
  - Root ESLint: **GATE FAIL / GAP-3** (Đúng 9 errors `no-empty` và 11 warnings prettier tại các file backend CLI kế thừa `deploy-cli.ts` và `headless-poller.ts`; giữ nguyên gate FAIL, ghi nhận trung thực, không tự ý sửa backend trong scope UI).
- **Cam kết Phiên làm việc**: Không sửa backend/schema, không push/PR/merge; duy trì trạng thái `CHỜ REVIEW` cho toàn bộ nhánh `feat/deploy-reachability`.

### Checkpoint GATE-1 update - 08/10 Xử lý dứt điểm Root Lint (GAP-3)

Đã hoàn thành checkpoint GATE-1 riêng biệt, xử lý dứt điểm các lỗi lint tồn đọng kế thừa từ backend scripts đã ghi nhận tại UI-1k-c:
- **Xử lý 9 lỗi `no-empty`**:
  - `app/scripts/deploy-cli.ts` (7 vị trí): Thêm chú thích giải thích rõ lý do bỏ qua lỗi khi dọn dẹp đóng kết nối SQLite hoặc hủy pipeline (`database.close()`, `pipeline.cancel()`) trước khi ném ngoại lệ hoặc thoát tiến trình qua SIGINT/lỗi.
  - `app/scripts/headless-poller.ts` (2 vị trí): Thêm chú thích giải thích rõ lý do bỏ qua lỗi trong `metricSnapshot` và `fileIdentity` khi stat file metric chưa tồn tại hoặc không thể đọc.
  - Bảo tồn nguyên vẹn 100% logic nghiệp vụ, luồng deploy và poller; không nuốt thêm bất kỳ loại lỗi mới nào.
- **Xử lý 11 cảnh báo Prettier**: Chuẩn hóa format import và ngắt dòng trong `deploy-cli.ts` (1), `eventSerializer.test.ts` (2) và `headlessPoller.test.ts` (8).
- **Trạng thái Quality Gates sau GATE-1**:
  - Root ESLint (`npm run lint`): **0 errors, 0 warnings** (PASS 100%).
  - Typecheck (`typecheck:node`, `typecheck:web`, `tsconfig.scripts.json`): **PASS 100%** (0 lỗi).
  - Tests (`eventSerializer.test.ts`, `headlessPoller.test.ts`): **11/11 tests PASS 100%**.
  - `git diff --check`: Sạch 100% (không có lỗi khoảng trắng thừa hay kết thúc dòng).
- **Cam kết Phiên làm việc**: Không sửa đổi schema hay logic nghiệp vụ, không push/PR/merge, không cần VPS thật.
