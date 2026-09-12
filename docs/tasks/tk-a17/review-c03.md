# TK-A17/C03 — Leader review

## Review 01 — submitted `dcbe3b5`

### Phạm vi và verdict

- Reviewed base `c2d55ad`, code `c149291`, submitted docs HEAD `dcbe3b5`; ancestry hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C03 về `REVIEW_FIX_REQUIRED`; C04/C05 tiếp tục đóng/`NOT_RUN`.
- Production trên VM02 không bị thay đổi trong review. Reviewer chỉ chạy test local và SSH/HTTP
  read-only; app B vẫn chạy.
- Evidence reviewer: [`review-01`](../../evidence/tk-a17/c03/review-01/).

### Kết quả độc lập

| Gate                                             | Kết quả reviewer                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Focused Worker suite                             | 4 file, 55/55 PASS                                                              |
| Collector                                        | 26/26 PASS                                                                      |
| Node/web/scripts typecheck, scoped ESLint, build | PASS; renderer 3045 modules                                                     |
| Contract regression mới                          | **0/5 PASS**: ba lỗi dependency section, hai lỗi build arg                      |
| VM02 read-only                                   | Ba app health `healthy`; ba collector `running`; PostgreSQL healthy; marker còn |
| Nội dung loopback VM02                           | Express `/health`, Next title, Vite title đều PASS                              |
| Đường public `221.121.1.80:30006..30008`         | **FAIL**: cả ba TCP timeout, HTTP `000`                                         |

GitNexus đánh dấu thay đổi ở `DeployPipeline.stepBuild` có ảnh hưởng rộng tới deploy/IPC và các flow
live. Index không nhận diện đầy đủ symbol detector mới nên review dùng source/contract trực tiếp làm
nguồn quyết định.

### Finding mở

#### C03-R1-01 — MAJOR — detector đọc sai dependency section đã chốt

- Vị trí: `app/src/main/detectors/nextjs.ts:14-16,46`; `static-spa.ts:12-14,44`;
  `express.ts:14-17,63`.
- Trigger: `next` chỉ nằm trong `devDependencies`, `vite` chỉ nằm trong `dependencies`, hoặc
  `express` chỉ nằm trong `devDependencies`.
- Expected: contract chỉ nhận Next/Express từ `dependencies`; Vite từ `devDependencies.vite` và
  không có `next`.
- Actual: cả ba detector trộn `dependencies` và `devDependencies`, nên ba fixture sai vẫn matched.
- Regression bắt buộc: commit ba case reviewer cùng matrix priority `next+vite`,
  `express+vite`, malformed/rác và signals đúng section. Sửa `detect`, `explain`, version và
  `needsDb` đọc đúng section theo contract; không sửa contract để hợp thức hóa code.

#### C03-R1-02 — MAJOR — BuildPlan công bố build arg mà Dockerfile bỏ qua

- Vị trí: `nextjs.ts:26-33,67`; `static-spa.ts:30-37,64`;
  `templates/nextjs.Dockerfile:3-4`; `templates/static-spa.Dockerfile:3-4`;
  `pipeline.ts:967-971`.
- Trigger: `.env.example` có `NEXT_PUBLIC_API_URL` hoặc `VITE_SITE_NAME` thay vì đúng một tên được
  hard-code trong template.
- Expected: mọi public build arg trong `BuildPlan.buildArgs` được khai báo/truyền vào build và có
  hiệu lực trong bundle; giá trị override được quote an toàn và không lộ secret.
- Actual: pipeline truyền mọi key nhưng Dockerfile chỉ khai báo `NEXT_PUBLIC_SITE_NAME` hoặc
  `VITE_API_URL`; Docker bỏ qua các key còn lại. Hai regression reviewer cùng thất bại.
- Regression bắt buộc: ít nhất hai public vars mỗi framework, default và override, giá trị có khoảng
  trắng/ký tự shell, nhánh không có build arg; assert Dockerfile/build command thật sử dụng đủ key.
  Không hard-code thêm một danh sách demo. Đồng thời bỏ lần `npm ci` trùng trong mỗi template nhưng
  vẫn giữ build command theo contract, và kiểm tra Next runtime phục vụ được fixture có `public/`.

#### C03-R1-03 — MAJOR — live harness không tạo provenance dùng được cho C04

- Vị trí: `app/scripts/c03-live.ts:91-105,111,201,216,231,238-241`.
- Trigger: HTTP body Next/Vite có nhiều dòng hoặc đọc app bằng `app:list` sau khi C03 kết thúc.
- Expected: mỗi lệnh inspect có field riêng; event được lọc đúng deployment và assert chính xác
  sequence; app/deployment/current pointer còn trong SQLite/profile mà C04 sẽ dùng; raw log scrubbed
  nằm trong evidence.
- Actual: `split('\n')` gán dòng HTML thành collector; mỗi result chứa toàn bộ `events.slice()` tích
  lũy; không assert sequence; DB tạm bị xóa. Handoff nêu deployment ID 1–4 nhưng các record đó không
  còn để UI/C04 chọn. Evidence chỉ có báo cáo tổng hợp, không có raw log đã scrub.
- Fix: tách lệnh/parse có cấu trúc, đánh dấu index event trước từng deployment, assert đủ và đúng thứ
  tự đến terminal event, ghi raw JSON/log scrubbed. Chạy proof bằng SQLite/profile bền mà C04 có thể
  dùng qua `app:list`; không seed/import record giả. Ghi exact DB/profile/app/deployment/current IDs
  và chứng minh close/reopen vẫn đọc được. Có thể thay các target `a17-c03-final-*` bằng target C03
  mới; chỉ dọn target C03 cũ sau khi target bền healthy, không chạm A17/app B.

#### C03-R1-04 — MAJOR — chưa có đường trình chiếu từ máy demo

- Vị trí: `deploy-matrix.md` phần Final state; yêu cầu C03-5 bước 5.
- Expected: với cả ba source, đường trình chiếu thực tế từ máy demo trả HTTP 200 và nội dung nhận diện
  đúng app; lưu lệnh/ảnh hoặc artifact tương đương.
- Actual: loopback trên VPS PASS nhưng cả `30006`, `30007`, `30008` timeout từ máy reviewer. Không có
  tunnel/browser artifact trong evidence.
- Fix: dùng đường truy cập an toàn có thể lặp lại trong buổi demo, ưu tiên SSH local-forward hoặc
  reverse proxy đã được phép; chứng minh ba trang qua chính đường đó, ghi setup/teardown và đảm bảo
  không để tunnel/process mồ côi. Không mở firewall tùy tiện và không dùng app B làm proof.

### Gate đóng review-fix 01

1. Commit regression cho R1-01/R1-02 trước hoặc cùng production fix; bốn reviewer case phải PASS.
2. Chạy lại focused detector/template/pipeline/service, node/web/scripts typecheck, scoped ESLint,
   Prettier file C03, build và collector. Không chạy ML.
3. Vì detector/template/harness thay đổi, chạy lại ba source tuần tự qua pipeline thật. Express vẫn
   phải giữ marker qua redeploy; Next/Vite phải chứng minh public build vars tùy ý có hiệu lực.
4. Lưu raw scrubbed detector/plan/events/SQLite/Docker/HTTP/collector logs, durable close/reopen proof
   và đường trình chiếu ba app. Đối chiếu app B read-only trước/sau.
5. Append REVIEW-FIX 01 vào handoff/evidence/board/task/sổ với exact base/code/docs SHA và mọi failure
   attempt. Chỉ bàn giao `READY_FOR_LOCAL_REVIEW` khi R1-01…04 đều đóng; Worker không tự approve hay mở
   C04.

### Khối giao Worker

```text
Tiếp tục duy nhất TK-A17/C03 từ HEAD chứa Leader review 01; không checkout/reset về c149291 hoặc
dcbe3b5. Đọc docs/tasks/tk-a17/review-c03.md và đóng C03-R1-01…04. C04/C05 vẫn đóng/NOT_RUN.

Sửa detector đúng contract dependency section. Làm cho mọi NEXT_PUBLIC_*/VITE_* do BuildPlan sinh ra
thực sự có hiệu lực trong Docker build, có regression nhiều key/default/override/quoting/no-arg; bỏ npm
ci trùng và kiểm tra Next public asset. Sửa live harness thành structured output, per-deployment exact
event assertion và raw scrubbed log. Proof phải dùng SQLite/profile bền để app:list/C04 đọc lại được,
không seed/import record giả; close/reopen đối chiếu app/deployment/current pointer.

Chạy lại tuần tự Express/Next/Vite qua pipeline thật, giữ PostgreSQL marker qua Express redeploy, chứng
minh build vars của Next/Vite và ba collector. Chứng minh cả ba trang từ máy demo qua đường trình chiếu
có thể lặp lại; đóng tunnel/process sau proof. Chỉ được thay/dọn target C03 của lượt này sau khi target
bền healthy; không chạm A17/app B ngoài read-only. Không migrate, ML, monitor/fault/recovery, Flask,
schema/contract/dependency mới, push/PR/merge/subagent. Giữ .devflow/, docs/ban-giao-20-08.md, logo.png.

Chạy đủ gate trong review, append REVIEW-FIX 01 với exact SHA/log/evidence và bàn giao
READY_FOR_LOCAL_REVIEW rồi dừng. Nếu VPS/path trình chiếu không đạt, bàn giao BLOCKED; không tự mở C04.
```

## Review 02 — submitted `8e60243`

### Phạm vi và verdict

- Reviewed Leader base `43d41b4`, production/test HEAD `e3a32f1`, submitted HEAD `8e60243`; ancestry
  hợp lệ, các commit sau `e3a32f1` chỉ là docs/provenance.
- Verdict: **CHANGES_REQUESTED**. C03 vẫn `REVIEW_FIX_REQUIRED`; C04/C05 đóng/`NOT_RUN`.
- `C03-R1-01`, production của `R1-02` và `R1-04` đạt. `R1-03` chưa đóng vì profile không dùng được
  bởi ứng dụng thật và lưu private key dạng rõ. Mở `C03-R2-01…02`.
- Evidence: [`review-02`](../../evidence/tk-a17/c03/review-02/). Không có live mutation trong review.

### Kết quả độc lập

| Gate                         | Kết quả reviewer                                                 |
| ---------------------------- | ---------------------------------------------------------------- |
| Worker focused suite         | 4 file, 62/62 PASS                                               |
| Exact reviewer + focused     | **3/5 reviewer PASS**, tổng 65 PASS/2 FAIL                       |
| Detector dependency sections | PASS cho Next, Vite và Express                                   |
| Dynamic template production  | PASS khi pipeline cấp `BUILD_ARGS`; không còn tên demo hard-code |
| VM02 read-only               | Final2 apps/DB healthy; collectors và app B running              |
| Tunnel teardown              | PASS; PID đã dừng, local ports 33012–33014 không listen          |
| Durable profile credential   | **FAIL**: `encrypted_secret` chứa nguyên private key plaintext   |
| OpsPilot `app:list` source   | **FAIL**: DB thật chỉ có app A17 ID 1, không có C03 app 13–15    |

### Finding mở

#### C03-R2-01 — BLOCKER — profile bền không tương thích ứng dụng và lưu private key plaintext

- Vị trí: `app/scripts/c03-live.ts:13-25,176-193`; profile
  `docs/evidence/tk-a17/c03/review-fix-01/profile-final2/opspilot.db`.
- Trigger: mở profile bằng luồng thật `createCredentialCipher`/`loadSecret`, hoặc chọn app C03 từ UI
  dùng `%APPDATA%/OpsPilot/opspilot.db`.
- Expected: credential được mã hóa qua AES-256-GCM thật và giải mã được bằng master key được
  `safeStorage` bảo vệ; C03 apps nằm trong DB/profile mà main process/UI/C04 thực sự dùng.
- Actual: script ghi `Buffer.from(keySecret)` vào `encrypted_secret`, dùng IV toàn `1`, tag toàn `2`
  và kết nối qua closure chứa key rõ. Audit xác nhận ciphertext bắt đầu/kết thúc bằng OpenSSH key
  marker và profile không có `credential-master-key.protected`. DB thật có VM01/VM02 nhưng chỉ có app
  A17 ID 1; các ID 13–15 chỉ thuộc DB phụ nên C04 UI không thể chọn hay SSH bằng main resolver.
- Fix bắt buộc: chạy helper trong Electron như `a17-c02-live.ts`, dùng đúng OpsPilot userData,
  `createCredentialCipher` + `loadSecret`, và reuse VM02 profile ID 2. Không đọc/ghi raw key vào DB hay
  tạo crypto metadata giả. Deploy ba target C03 qua chính DB thật, close/reopen rồi dùng resolver thật
  thực hiện ít nhất một SSH/inspect và `DeployService.listApps` proof. Giữ app A17/app B read-only.
- Sau khi target mới healthy và scrubbed reports đã giữ, xóa các DB phụ không an toàn do C03 tạo
  (`profile-final`, `profile-final2`, `profile-retry2`, `profile-retry3`); chứng minh không còn file
  chứa plaintext key. Không commit DB/master key/private key vào evidence.

#### C03-R2-02 — MINOR — exact reviewer regression chưa tương thích renderer mới

- Vị trí: reviewer fixture `review-01/contract-regression.test.ts.txt`, `templates.ts:85` và test C03.
- Expected: năm reviewer cases được commit ở dạng chạy được và cùng focused suite PASS.
- Actual: ba dependency cases PASS; hai dynamic build-arg cases báo thiếu biến `BUILD_ARGS` vì
  fixture chưa truyền output của `renderBuildArgs`. Các test Worker riêng PASS nhưng
  chưa đóng đúng regression tích hợp đã giao.
- Fix: commit integration regression tạo plan, gọi `renderBuildArgs(plan.buildArgs)`, render đúng
  Dockerfile và assert mọi key tùy ý xuất hiện. Giữ case no-args và pipeline override/quote hiện có.
  Đây là test closure; không cần sửa contract hay detector đã đúng.

### Fast-track review-fix 02

1. Ưu tiên R2-01. Dùng actual OpsPilot userData/credential resolver và ba app name mới; không import/
   seed giả app/deployment từ DB phụ. Có thể giữ final2 chạy tới khi target mới healthy rồi chỉ dọn
   target C03 cũ nếu cần tài nguyên.
2. Chạy exact reviewer + focused; scripts/node typecheck, scoped ESLint/Prettier. Nếu không đổi
   production detector/template/pipeline thì không cần lặp collector pytest và full build. Nếu có đổi
   production, chạy lại gate liên quan đầy đủ.
3. Live proof lại ba source tuần tự qua pipeline thật trong default userData, Express redeploy giữ
   marker, close/reopen + resolver SSH PASS, tunnel ba app PASS rồi teardown. Audit ciphertext chỉ ghi
   boolean/length, tuyệt đối không in secret.
4. Append REVIEW-FIX 02 với exact code/docs SHA, actual app/deployment/profile IDs, raw scrubbed logs,
   cleanup ledger và app A17/app B before/after. Bàn giao `READY_FOR_LOCAL_REVIEW` rồi dừng; không mở C04.

### Khối giao Worker review-fix 02

```text
Tiếp tục duy nhất TK-A17/C03 từ HEAD chứa Leader review 02; không checkout/reset về e3a32f1 hoặc
8e60243. Đọc mục Review 02 trong docs/tasks/tk-a17/review-c03.md và đóng C03-R2-01…02. C04/C05 vẫn
đóng/NOT_RUN.

BLOCKER: c03-live đang ghi nguyên private key vào encrypted_secret với IV/tag giả, còn app 13–15 nằm
trong DB phụ nên UI/app:list thật không thấy và loadSecret không dùng được. Chuyển helper sang Electron,
dùng đúng %APPDATA%/OpsPilot userData, createCredentialCipher + loadSecret và reuse VM02 ID 2 như
a17-c02-live.ts. Deploy ba app C03 mới qua chính DB thật; close/reopen rồi chứng minh listApps và một
SSH/inspect qua resolver thật. Không seed/import record giả, không in/commit secret hoặc DB/master key.

Commit regression tích hợp 5 reviewer cases: plan.buildArgs -> renderBuildArgs -> renderDockerfile;
mọi dynamic key và no-args đều PASS. Chạy fast-track gates trong review. Live lại Express/Next/Vite,
marker qua redeploy, collectors, tunnel ba app và teardown. Khi target mới healthy, xóa bốn profile DB
C03 phụ chứa plaintext key và audit boolean chứng minh sạch; giữ scrubbed logs. Không chạm app A17/app B
ngoài read-only; không migrate, ML, Flask, schema/contract/dependency, push/PR/merge/subagent. Giữ
.devflow/, docs/ban-giao-20-08.md, logo.png. Append REVIEW-FIX 02, bàn giao READY_FOR_LOCAL_REVIEW rồi
dừng; không tự mở C04.
```
