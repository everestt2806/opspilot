# Review C01 — CHANGES_REQUESTED

> Verdict mới nhất — review 02, 11/09/2026: code `0d15eb5`, docs `518644f` vẫn
> **CHANGES_REQUESTED** vì `C01-R2-01` MAJOR. Năm finding còn lại của review 01 đã đóng.

- Reviewer: Leader (Codex/root), 11/09/2026, review 01.
- Base/review kế thừa: `1b447e4` chứa C00 APPROVED; Worker code HEAD `66cbdab`.
- Worker docs HEAD được review: `f0b73aa` (sau `c6c8064`, `c10814c`).
- Verdict: **CHANGES_REQUESTED cho C01**. Có 2 BLOCKER, 3 MAJOR và 1 MINOR.
- C02–C09 tiếp tục đóng. Worker chỉ sửa C01 trên HEAD hiện tại, append REVIEW-FIX rồi
  bàn giao lại; chưa push/PR/merge và chưa DEMO_READY.

## 1. Scope và kiểm tra độc lập

`git merge-base --is-ancestor 1b447e4 66cbdab` exit 0. Reviewer đọc diff code
`1b447e4..66cbdab`, ba commit docs tới `f0b73aa`, task C01 và toàn bộ evidence Worker.
Source đổi đúng vùng deploy/template/test/live helper; không có Monitor UI, recovery policy
hoặc migration mới. Ba mục untracked của A vẫn được giữ nguyên.

GitNexus `analyze` cập nhật index tại HEAD. `detect_changes` so với `1b447e4` tìm 15 symbol
đổi và 40 symbol bị ảnh hưởng; risk CRITICAL vì `renderCompose` đi vào deploy, restore và
rollback. `impact` cho `renderCompose` có 7 caller/test trực tiếp, gồm `stepRender`, đường
restore và rollback. Truy vấn context tiếp theo gặp LadybugDB chưa khởi tạo/không resolve
được symbol helper mới; reviewer xác nhận các call site bằng source và test trực tiếp.

Bằng chứng reviewer được lưu riêng tại
[review-01](../../evidence/tk-a17/c01/review-01/), không ghi đè evidence Worker.

| Gate | Reviewer tự chạy/kiểm tra | Kết quả và bằng chứng |
| --- | --- | --- |
| Deploy/monitor regression | Vitest tuần tự `src/main/deploy src/main/monitor` trên Node 22 | 12 files, 64/64 PASS; `focused.json` |
| Collector | Pytest từ `collector` bằng venv dự án | 26/26 PASS; `collector.json` |
| Static checks | Node/web typecheck, ESLint file đổi, Prettier check | Tất cả exit 0; `typecheck-*.json`, `lint.json`, `format.json` |
| Hai repro mới | Fixture Express generic và redeploy có app build fail | 2/2 FAIL trên code được review, đúng hai finding C01-R1-02/03; `regressions.json`, `regression-fixture.ts.txt` |
| Soak Worker | Parse 91 dòng JSONL, kiểm seq/time và chia đoạn theo gap tối đa 12 giây | PASS: seq 2–91 liên tục trong 886 giây; `soak-analysis.json` |
| VPS hiện tại | SSH read-only strict host key; inspect A17 và app B, HTTP/DB marker, file mode, metrics tail | App v7 và DB healthy, marker 1001–1003 còn nguyên, app B vẫn chạy; collector A17 đã exited; `vps-readonly.json`, `vps-collector-state.json` |
| SQLite local | Mở DB `mode=ro`, kiểm app/deployment/metric/score/experiment | Đã có 21 metric rows và 105 score rows từ C01 helper; `local-inventory.json`, `local-score-detail.json` |

Reviewer không chạy deploy/redeploy mới, không restart collector, không sửa app B, không mở
tunnel và không chạy ML train/score. Build Worker đã đọc có 3045 renderer modules, exit 0;
reviewer dùng focused regression + typecheck/lint/format cho vòng này. Full build/suite vẫn ở C09.

## 2. Findings phải sửa

### C01-R1-01 — BLOCKER — collector không có trong packaged desktop

- Vị trí: `app/src/main/deploy/pipeline.ts:38-46`, `app/electron-builder.yml:11-22`.
- Trigger: chạy bản desktop đã đóng gói rồi deploy. `resolveCollectorDir()` chỉ lấy override
  hoặc `process.cwd()/../collector`, trong khi `extraResources` chỉ đóng gói `ml-service` và
  `templates`.
- Expected: C01 bước 2 yêu cầu source collector đi theo luồng dev/build và không phụ thuộc
  source checkout trên máy chạy.
- Actual: bản packaged không có resource collector được khai báo và resolver không có đường
  `process.resourcesPath`; deploy dừng với “Không tìm thấy source collector”.
- Fix/regression bắt buộc: đóng gói collector vào artifact, resolve rõ dev/packaged path giống
  resource hiện có, kiểm tra `collect.py` + `Dockerfile`; thêm test hai mode và proof artifact
  unpack/resource thật chứa đúng file.

### C01-R1-02 — MAJOR — mọi Express app bị ép probe route riêng của demo

- Vị trí: `app/src/main/deploy/pipeline.ts:638-639,842-852`.
- Trigger: deploy hoặc restore một Express app hợp lệ chỉ có health route, không có `/items`.
- Expected: `/items?limit=1` chỉ áp dụng cho Express demo có route nghiệp vụ đó; app khác dùng
  route đã xác minh, tối thiểu là healthcheck hiện có.
- Actual: framework `express` luôn render `/items?limit=1`. Collector coi HTTP 404 dưới 500 là
  response không lỗi, nên có thể ghi latency và `http_error_rate=0` cho probe sai.
- Repro: reviewer fixture Express chỉ có `/health`; assertion compose phải dùng `/health` FAIL
  vì nhận `/items?limit=1`.
- Fix/regression bắt buộc: chọn business path từ capability/source đã xác minh cho demo, có
  fallback healthcheck cho Express generic; test forward và restore cho cả hai trường hợp.

### C01-R1-03 — MAJOR — app build fail xóa collector tag đang dùng

- Vị trí: `app/src/main/deploy/pipeline.ts:716-744`.
- Trigger: đã có deployment chạy với `${app}:collector`, lượt redeploy tiếp theo thất bại ở
  app build trước khi collector build bắt đầu.
- Expected: cleanup chỉ xóa candidate do lượt thất bại tạo; image/tag của deployment đang chạy
  và đường restore phải còn dùng được.
- Actual: catch luôn chạy `docker image rm` cho cả app tag và shared collector tag. Container
  hiện tại còn chạy bằng image ID, nhưng recreate/restore có thể mất tag collector.
- Repro: reviewer mock app build exit khác 0 và bắt lệnh SSH; assertion không được xóa
  `demo-api:collector` FAIL.
- Fix/regression bắt buộc: dùng candidate collector tag hoặc theo dõi chính xác tag được tạo
  trong lượt build; test app-build fail, collector-build fail, build thành công và restore/recreate.

### C01-R1-04 — BLOCKER — trạng thái live cuối không khớp handoff

- Vị trí: `docs/tasks/tk-a17/handoff-c01.md:62`; target
  `a17-notes-0911-collector` trên VM02.
- Trigger: reviewer kiểm tra read-only sau bàn giao.
- Expected: handoff “app/DB/collector running”; collector tiếp tục ghi metric sau proof T6.
- Actual: app v7 và PostgreSQL healthy, nhưng collector `exited`, exit 0 lúc
  `2026-09-10T20:40:14Z`. File dừng ở 101 dòng/seq 101 lúc `20:40:05Z`.
- Fix/regression bắt buộc: sau khi sửa code, Worker dùng đúng scope C01 để đưa collector A17
  về running, chứng minh seq mới tăng trong ít nhất hai interval và kiểm tra lại sau khi helper/
  desktop đã thoát. Không thao tác app B; lưu inspect/compose ps/metrics tail mới.

### C01-R1-05 — MAJOR — live helper đã chạy side effect của C02

- Vị trí: `tools/a17-c01-live.cjs` khi load full `app/out/main/index.js`; local profile A.
- Trigger: helper boot toàn bộ main app trong các lượt deploy dài. Monitor scheduler tự poll
  app mới và ghi SQLite dù handoff nói C02+ NOT_RUN.
- Expected: C01 chỉ nghiệm thu JSONL trên VPS; C02 mới xác lập ingestion/lifecycle vào SQLite.
- Actual: DB read-only cho thấy `metrics_offset=6152`, 21 metric rows ở deployment 2/3/5 và
  105 score rows. Mỗi metric có `rule` score thật cùng bốn ML method null; experiment/alert là 0.
- Fix/regression bắt buộc: cô lập C01 live runner khỏi scheduler/ML side effects bằng entrypoint
  service phù hợp hoặc cơ chế hẹp có test. Ghi rõ dữ liệu đã phát sinh; **không reset DB**.
  C02 phải kế thừa offset/rows này và đặt boundary bằng evidence mới thay vì tuyên bố DB sạch.

### C01-R1-06 — MINOR — provenance docs HEAD chưa đúng bản nộp

- Vị trí: `docs/tasks/tk-a17/handoff-c01.md:7,21-24`.
- Trigger: đối chiếu handoff với `git log` tại thời điểm review.
- Expected: handoff ghi exact docs HEAD được nộp và đủ commit docs.
- Actual: ghi `c10814c`, nhưng bản nộp là `f0b73aa`; commit list thiếu `f0b73aa`.
- Fix: append provenance của vòng REVIEW-FIX và exact code/docs HEAD mới, không sửa lịch sử
  theo cách làm mất dấu bản nộp vòng 01.

## 3. Kết quả được giữ và phạm vi vòng sửa

Các phần sau đã có bằng chứng đạt và không cần làm lại nếu diff sửa không tác động: compose
app/PostgreSQL/collector, PostgreSQL healthcheck + `service_healthy`, secret qua `.env` mode 600,
DB volume/marker qua v6→v7, hai image v6/v7, app B không đổi, collector failure không làm app
chết, focused 64/64, collector 26/26 và static checks. Soak 10 phút đạt bằng đoạn seq 2–91
trong 886 giây; khoảng trống 160 giây trước seq 2 không làm mất đoạn liên tục đạt gate.

Worker cần chạy lại test chịu ảnh hưởng và C01-T7 sau sửa. Live proof mới phải xác nhận collector
còn running sau khi runner thoát. Không fault app, rollback, mở C02, train/score ML, thay schema,
reset SQLite/VPS, push, PR hoặc merge.

## 4. Bàn giao vòng sửa cho Worker

```text
Sửa duy nhất TK-A17/C01 theo docs/tasks/tk-a17/review-c01.md, verdict CHANGES_REQUESTED.
Tiếp tục HEAD hiện tại có commit review; không checkout lùi về 66cbdab/f0b73aa.
Đóng C01-R1-01…06, thêm regression theo từng finding và append REVIEW-FIX vào handoff-c01.md.
Giữ dữ liệu SQLite đã phát sinh, không reset; C02 vẫn NOT_RUN và chưa được mở.
Live verify chỉ target VM02/a17-notes-0911; không thao tác app B. Sau helper exit, chứng minh
collector vẫn running và seq tăng. Chạy focused tests, collector tests, typecheck/lint/format/build
theo file đổi; cập nhật board/task/sổ, evidence và commit local. Không push/PR/merge/subagent.
Bàn giao READY_FOR_LOCAL_REVIEW rồi dừng.
```

## 5. Review 02 — review-fix-01

- Reviewed code `0d15eb5`; reviewed docs HEAD `518644f`; base review `7e34b96` là ancestor.
- Worker giữ đúng scope C01. Diff gồm pipeline/template packaging, startup guard cho helper,
  regression và hồ sơ; không có C02 implementation, schema, Monitor UI hoặc recovery policy.
- Verdict: **CHANGES_REQUESTED**. `C01-R1-01/03/04/05/06` CLOSED. `C01-R1-02` chưa đóng
  hoàn toàn và được tiếp tục bằng `C01-R2-01` bên dưới. C02 tiếp tục đóng.

Reviewer lưu bằng chứng riêng tại
[review-02](../../evidence/tk-a17/c01/review-02/). GitNexus index tại `518644f` nhận 34 symbol
đổi, 30 symbol ảnh hưởng và risk CRITICAL. `stepBuild` có risk HIGH; `restoreComposeTo` có
risk CRITICAL vì đi vào manual/automatic rollback và healthcheck-failure restore. Reviewer
đọc các caller trực tiếp và chạy regression deploy/restore tương ứng.

| Gate | Kết quả reviewer |
| --- | --- |
| Focused deploy + detector + monitor | 13 files, 73/73 PASS trên Node 22.23.2 |
| Collector | 26/26 PASS |
| Typecheck/lint/format | Node/web typecheck exit 0; ESLint TS exit 0; Prettier TS/CJS/YAML exit 0 |
| Build/unpack | electron-vite build exit 0, 3045 renderer modules; electron-builder unpack exit 0; collector artifact khớp SHA-256 source |
| Helper isolation | Node regression exit 0; SQLite read-only giữ đúng 21 metric/105 score rows và offset 6152 sau v8/v9 |
| Live VM02 | App v9 + DB healthy; collector running/restart 0; seq 234→236; marker 1004 và hai image v8/v9 còn nguyên; app B vẫn running |
| Reviewer edge regression | 2/2 FAIL trên code review: POST-only `/items` và GET `/items/:id` đều bị chọn sai thành GET `/items?limit=1` |

### C01-R2-01 — MAJOR — route detector chưa chứng minh GET collection endpoint

- Kế thừa: `C01-R1-02`.
- Vị trí: `app/src/main/deploy/pipeline.ts:55-64`; regression Worker tại
  `app/src/main/deploy/pipeline.test.ts:278-294`.
- Trigger 1: Express app có `POST /items` để ghi dữ liệu và `GET /health`, không có
  `GET /items`. Trigger 2: app chỉ có `GET /items/:id`, không có collection route.
- Expected: collector thực hiện GET nên chỉ chọn `/items?limit=1` khi source chứng minh một
  GET-capable collection route `/items`; hai trường hợp trên phải fallback `/health`.
- Actual: regex chấp nhận `post|put|patch|delete|use` và chấp nhận dấu `/` sau `items`, nên cả
  hai fixture đều trả `/items?limit=1`. HTTP 404 sau đó vẫn có thể bị collector ghi như probe
  không lỗi, đúng rủi ro của finding gốc.
- Repro reviewer: `route-regression.test.ts.txt`; Vitest 2/2 FAIL tại `0d15eb5`.
- Fix/regression bắt buộc: giới hạn detector vào method chấp nhận GET và static collection path
  `/items` (có thể chấp nhận trailing slash nếu có chủ ý). Thêm hai fixture trên vào regression
  sản phẩm, giữ fixture demo GET `/items` → business path và generic → health. Chạy lại focused,
  typecheck/lint/format/build. Không cần deploy/marker mới nếu diff chỉ sửa resolver/test; kiểm
  tra VM02 read-only sau test để bảo đảm collector vẫn running và seq tiếp tục tăng.

Các closure đã xác nhận:

- `C01-R1-01`: `extraResources` + packaged resolver đúng; reviewer tự build unpack và hash
  `collect.py`/`Dockerfile` khớp source.
- `C01-R1-03`: pre-existing collector tag được kiểm trước build và không bị cleanup khi build
  fail; success/restore suite đạt.
- `C01-R1-04`: reviewer kiểm tra sau helper hơn 20 phút, collector vẫn running và seq tăng.
- `C01-R1-05`: scheduler/ML bị guard trong C01 helper; SQLite không phát sinh thêm metric/score.
- `C01-R1-06`: lịch sử submission được giữ, code fix `0d15eb5`, payload docs `dfdc465` và
  provenance commit `518644f` đối chiếu được.

Worker tiếp tục HEAD chứa commit review 02, chỉ đóng `C01-R2-01`, append REVIEW-FIX 02 và
bàn giao lại. Không reset SQLite/VPS, không thao tác app B, không mở C02, push, PR hoặc merge.
