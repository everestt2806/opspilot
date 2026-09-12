# TK-A17/C03 — Worker execution plan

## Quyền thực thi và phạm vi

- C02 được Leader approve tại review 10: production `8fe4842`, test `5febcbe`, submitted HEAD
  `313201d`. Worker bắt đầu từ HEAD chứa commit review 10 của Leader và ghi exact base SHA.
- Chỉ thực hiện C03. C04–C09 tiếp tục đóng/`NOT_RUN`.
- Mục tiêu là ML process thật do Electron/CLI quản lý, train từ baseline VM02 sạch và ghi score thật
  vào SQLite qua `MonitorService`/`MlApiClient`; fixture hoặc mock không được dùng làm live proof.
- Không đổi model, feature, threshold, window, ML OpenAPI, schema hoặc dependency để làm đẹp kết quả.
  Chỉ sửa integration bug tái hiện được và phải có regression.
- Giữ nguyên activation history, cursor và dữ liệu C02. Không reset/xóa/reassign SQLite/PostgreSQL,
  không gọi `/reset` cho current live deployment, không deploy/rollback/fault, không thao tác app B,
  không push/PR/merge. Giữ `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png`.

## Đường chạy nhanh

Collector VM02 vẫn ghi mỗi 10 giây. Trước khi chờ baseline mới, đo backlog từ activation hiện tại tới
EOF. Nếu current deployment đã có hoặc có thể ingest ngay ít nhất 180 mẫu sạch sau boundary, dùng chính
backlog đó và không chờ thêm 30 phút. Không gộp sample của deployment 20 vào model deployment 21.

Giữ `autoTrain:false` trong runner cho tới khi SQLite của current deployment có ít nhất 180 mẫu đã kiểm
tra sạch. Sau đó gọi `MonitorService.trainNow()` bằng `MlApiClient` thật. Cách này tránh model tự train ở
150 trước khi baseline đạt yêu cầu C03.

## Bước 1 — preflight không mutation

1. Xác nhận branch/HEAD/status và ba untracked được bảo toàn.
2. Mở đúng Electron profile A; đọc `app.id=1`, tên `a17-notes-0911`, current deployment và VPS ID.
3. Assert không có prepared activation; current deployment `running`; active episode khớp deployment,
   generation và cursor C02.
4. SSH read-only VM02: Docker image/state/restart của app A, collector và PostgreSQL; HTTP health;
   `metrics.jsonl` identity, size, dòng cuối, seq/time hiện tại. App B chỉ inspect read-only.
5. Xác nhận fault đang tắt và baseline candidate không có `container_up=0` hoặc lỗi probe. Ghi tiêu chí
   clean cùng SQL/range dùng để kiểm tra, không chỉ ghi “normal”.
6. Kiểm tra cổng 8765–8767 và process ML hiện có. Không kill process không thuộc run. Đọc trạng thái model
   current deployment trước run; nếu đã trained từ một run khác, dừng và bàn giao BLOCKED/provenance thay
   vì reset âm thầm.

## Bước 2 — runner C03 dùng runtime thật

Tạo `app/scripts/a17-c03-live.ts` và thêm đúng file vào `app/tsconfig.scripts.json`. Runner phải:

1. Khởi tạo Electron `app`, profile A, SQLite, credential cipher, `SshManager` giống runner C02.
2. Khởi động `MlServiceManager`, thu status callback, PID/port được cấp và `/health`; tạo
   `MlApiClient(http://127.0.0.1:<port>)` từ `getPort()`. Không spawn uvicorn phụ bên ngoài manager.
3. Khóa target bằng app ID/name/current deployment đã preflight. Recheck trước mỗi mutation; nếu pointer,
   activation hoặc generation đổi thì fail closed.
4. Dùng `MonitorService(database, { autoTrain: false })` với real client để ingest backlog/new rows. Poll
   theo cursor C02, không đọc lại/reassign lịch sử và không tự chế sample.
5. Có bounded wait theo collector interval 10 giây khi cần dòng mới; log từng deadline và fail rõ thay vì
   sleep vô hạn. Mọi `finally` phải disconnect SSH, stop đúng ML child và đóng SQLite/Electron sạch.
6. Xuất một JSON summary đã scrub secret; exit khác 0 nếu bất kỳ invariant nào sai.

## Bước 3 — baseline và train thật

1. Chụp before: deployment, activation, source generation/size, SQLite offset, metric/score counts,
   min/max seq và time.
2. Ingest tới khi current deployment có `>=180` mẫu sạch. Xác nhận mỗi row thuộc episode hiện tại,
   timestamp tăng, seq không duplicate và các metric dùng train không chứa trạng thái fault.
3. Gọi `trainNow(currentDeploymentId, realClient)` đúng một lần. Ghi thời điểm bắt đầu/kết thúc, raw status
   trước/sau, `train_sample_count`, `feature_vector_count`, `trained_at`, feature version và warnings.
4. Assert status trả đúng deployment ID, `trained=true`, train count bằng dataset gửi và feature vectors
   bằng `train_sample_count - 20 + 1`. Không suy model đã tồn tại chỉ từ số row SQLite.

## Bước 4 — score sau train

1. Chờ ít nhất một metric mới sau thời điểm train, rồi poll bằng cùng real client.
2. Với từng sample dùng làm proof, query đúng năm method: `rule`, `zscore_ewma`, `iforest`, `ocsvm`,
   `ensemble`; không thiếu/trùng method.
3. Assert bốn ML score là số hữu hạn trong `[0,1]`; `above_threshold` là boolean đúng payload; rule vẫn là
   hàng thứ năm. Ghi range/min/max theo method và sample IDs, không chỉ tổng count.
4. Assert timestamps/deployment ID/seq của metric và score khớp; retry cùng cursor không thêm metric/score.

## Bước 5 — ML down và phục hồi

1. Dùng chính `MlServiceManager.stopSync()` để dừng child của run; xác nhận callback/status down và port
   được giải phóng. Không kill theo tên process.
2. Chờ metric mới rồi chạy poll không có scorer, đúng như wiring Electron khi manager không có port.
   Assert metric vẫn insert, rule score vẫn số, bốn ML method đều `NULL`, offset vẫn tiến và không có row giả.
3. Gọi `MlServiceManager.start()` lại, tạo client từ port mới, kiểm `/health` và `/status` current deployment.
   Model phải còn `trained=true`, train metadata và sample history được nạp từ state trên đĩa.
4. Chờ metric mới, poll bằng client mới và assert bốn ML score hữu hạn trở lại. Tick lặp không duplicate;
   seq tiếp tục tăng. Cuối run stop manager sạch nhưng giữ model state để phục vụ demo sau.

## Bước 6 — regression local

- `MonitorService`: 149/150, manual train, auto-train disabled/enabled, cooldown trong cùng process,
  ready false, ingest exception, ML down fallback, recovery và deployment isolation.
- `MlApiClient`: health/status/train/ingest parsing, timeout/non-2xx, null trước train, finite score sau train.
- `MlServiceManager`: start-idempotent, port selection, health timeout, stop/restart đúng child và status.
- ML pytest: under-150 reject, train/status, persisted restart, four scores/range, null/window behavior và
  deployment isolation. Dùng temp state directory; không chạm live state.
- T6: ghi và kiểm chứng runbook khi current deployment đổi: model key theo deployment ID mới, baseline
  mới `>=180`, không copy model/state deployment cũ và không train backlog ngoài activation mới.

## Gate bắt buộc

```text
app> pnpm exec vitest run --maxWorkers=1 <focused ML/monitor/manager files>
app> pnpm typecheck
app> pnpm exec tsc -p tsconfig.scripts.json --noEmit
app> pnpm exec eslint <changed production/test/script files>
app> pnpm exec prettier --check <changed production/test/script/docs files>
app> pnpm build
ml-service> .venv\Scripts\python.exe -m pytest -q
```

Chạy collector 26 tests chỉ khi collector hoặc metric contract bị sửa. Nếu chỉ thêm runner/integration ML,
không rerun deploy/rotation live C02.

## Evidence và bàn giao

Tạo `docs/evidence/tk-a17/c03/ml-live.md` và `docs/tasks/tk-a17/handoff-c03.md`:

- exact base/code/docs SHA, command/cwd/runtime/exit;
- target IDs, image/state, activation/generation/source/cursor và clean-baseline rule;
- baseline count, seq/time range, train/status response đã scrub;
- before/after per-method null/non-null counts và score ranges;
- ML stop/down/restart timeline, PID/port ownership, state persistence và recovery sample IDs;
- SQLite mutation ledger, retry/duplicate counts, final app/collector/DB/ML state;
- mapping riêng C03-T1…T6, phần `NOT_RUN`, giới hạn và mọi failure attempt;
- `READY_FOR_LOCAL_REVIEW`; C04–C09 vẫn đóng. Không tự mở C04.

## Điều kiện PASS

- C03-T1: current deployment có baseline live sạch `>=180`, provenance đầy đủ, train thật thành công.
- C03-T2: batch sau train có đúng năm rows/sample; bốn ML score hữu hạn và trong `[0,1]`.
- C03-T3: insufficient/not-ready/down là trạng thái thật; ML null không bị đổi thành zero.
- C03-T4: đúng ML child được stop/restart; metric/rule tiếp tục và score ML phục hồi.
- C03-T5: regression và gates trên PASS, không open handle/process treo.
- C03-T6: runbook deployment mới được kiểm chứng bằng test/provenance, không tái dùng model cũ.

Nếu không đủ baseline sạch, model state đã tồn tại không rõ nguồn, runtime target drift hoặc real ML client
không phục hồi, bàn giao `BLOCKED` với evidence. Không đổi mục tiêu sang mock/rule-only và không reset để
tạo PASS giả.
