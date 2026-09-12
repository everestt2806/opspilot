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
