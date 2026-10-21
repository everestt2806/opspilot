# TK-S7 P3a — thiết kế auto deploy Git cho Product mode

| Owner | Deadline | Branch | Brief | Priority |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | Chốt kiến trúc và chia checkpoint controller Git luôn chạy | P1 |

## Requirement ledger

| Requirement | Thiết kế / đối chiếu | State |
|---|---|---|
| Kiểm kê phần tái sử dụng và gap theo source thực tế | Mục “Inventory code” bên dưới, đối chiếu Git snapshot, DeployService/Pipeline, repositories, exposure và lock | PASS |
| Chọn pha đầu outbound production branch polling trên một controller Linux; giữ Desktop/manual Git; defer webhook/private/preview | Mục “MVP” | PASS |
| Chốt Product source of truth, SQLite/history/queue/credential/client và mode transition/rollback | Mục “Nguồn sự thật và chuyển mode” | PASS |
| State machine/idempotency/lease/crash recovery/concurrency và deploy thủ công | Mục “State machine và transaction” | PASS |
| Lỗi build/health, push burst/force-push/branch delete/mất Git/SSH/restart/disconnect | Mục “Failure policy” | PASS |
| Pin SSH, Linux credentials, no secret logs/public admin/Docker socket, enrollment/permissions/lifecycle | Mục “Security và enrollment” | PASS |
| Checkpoint code phân nhỏ theo phụ thuộc, files/contracts/gates, Linux lab/crash/live desktop-off gate | Mục “Kế hoạch checkpoint” | PASS |
| Chỉ tài liệu; đối chiếu source và diff check; commit local, không push/PR/merge, giữ untracked | `git diff --check` PASS; commit nội dung `15fae0457e91b757257d78e4c3c4ec4cab946fbf` chỉ gồm task note và board. Untracked ngoài scope được giữ nguyên. | PASS |

## Mục tiêu và trạng thái hiện tại

ADR-011 cho phép một control plane luôn chạy trên VPS quản lý cho Product mode, còn desktop là client. Pha đầu chỉ theo dõi **một repository GitHub public và production branch đã cấu hình** bằng outbound polling. Polling không cần inbound webhook port, chữ ký webhook hay endpoint công khai. Desktop mode hiện tại vẫn triển khai trực tiếp; Git manual/redeploy vẫn giữ nguyên. Pha này không gồm webhook, private repository, preview/PR environment, migrate, auto-rollback theo ML hay cài đặt lên VPS người dùng.

## Inventory code — tái sử dụng và còn thiếu

| Năng lực | Đã có trong source | Gap Product mode |
|---|---|---|
| Nhận source bất biến | `app/src/main/git/snapshot.ts`: canonical GitHub HTTPS public URL; lọc `GIT_*`/global config/credential helper; fetch ref, lấy `rev-parse FETCH_HEAD^{commit}` full 40-hex SHA; detached checkout; root traversal/symlink, timeout, dung lượng, cancel và cleanup được kiểm tra. `PreparedGitSources` cấp handle opaque, precheck token gắn source/target/env/port. | Poller bền cần phát hiện tip branch rồi lưu full SHA trước khi enqueue. Controller phải tái sử dụng semantics snapshot nhưng không phụ thuộc handle tạm từ renderer, working tree hay safeStorage Windows. Lưu SHA quan sát và SHA snapshot thực tế; mismatch thì fail.
| Build/deploy | `DeployService` và `DeployPipeline` nhận Git prepared source rồi cùng pipeline với local: PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → PUBLISH → RECORD. Build dùng Docker trên VPS đích; Git repo/SHA được lưu trong `deployment`. Pipeline có cancellation, event step và thời gian. | Controller Linux cần runtime composition không khởi chạy Electron UI/scheduler; tách dependency composition khỏi Electron-only bootstrap nếu import hiện tại kéo Electron. Job phải tái tạo payload từ cấu hình DB, không dùng prepared renderer handle. Chuyển đổi kết quả/events thành row và log bền trước khi xác nhận queue.
| Logs | Pipeline lưu `~/.opspilot/logs/deploy-<id>.log`, giữ event stdout/stderr theo step và giới hạn một số dòng gần nhất trong memory/event. | Log directory/quyền/rotation trên Linux controller, liên kết job/deployment, redaction secret trước persist/API, quota/retention và đọc lại sau desktop reconnect.
| Health | Pipeline gọi healthcheck loopback theo app `healthcheck_path`/policy và chỉ promote current deployment khi đạt. Failure đi qua rollback handler. | Chạy cùng Linux executor và cấu hình persisted; recovery khi mất lease giữa deploy/health cần xác minh runtime thực tế trước khi quyết định tiếp tục/rollback.
| Exposure | `SshExposureManager` kiểm tra UFW, mở port khi UFW active, tùy chọn provider adapter, rồi probe HTTP từ process gọi. Domain/P1 ingress có coordinator riêng; `DeployEvents` phân biệt exposure degraded với app unhealthy. | Provider firewall hiện chưa adapter production cho VPS đang dùng; UFW không chứng minh cloud reachability. Controller outbound probe phải xác định route/hostname cần kiểm tra. Không để exposure fail rollback app healthy. Pha auto deploy chỉ duy trì hành vi hiện có; HTTPS/shared ingress là checkpoint riêng và không đồng nghĩa auto-active.
| Rollback | Pipeline health failure giữ image trước đó, có automatic restore path và `DeploymentRepository.runtimeImageTag` lineage; manual rollback dùng cùng app pipeline. Compose/data volume cần được bảo toàn. | Recovery/rollback phải được điều khiển dưới lease/fence bền trên controller. Chặn deploy/redeploy/rollback Desktop bypass khi app đang ở Product mode. Ghi đúng attempt gốc, không tạo lịch sử thứ hai.
| Khóa đồng thời | `activeByApp` và `withAppLock(appId, ...)` tuần tự hóa trong một process Electron, dùng chung với MonitorPoller; app row/version và deployment insert có transaction SQLite. | Không bảo vệ qua restart hoặc hai process/desktop-vs-controller. Cần DB lease/queue claim bền và fence token; deploy thủ công phải đi qua cùng quyền sở hữu app. Cần remote lock trong toàn vùng lệnh ghi để process cũ không tiếp tục mutate sau khi mất lease.

## MVP: một controller, outbound polling

- Một controller Product mode chạy trên VPS quản lý, theo dõi repository public qua HTTPS outbound và branch production được chọn rõ. Chu kỳ polling mặc định đề xuất 30 giây, có jitter; cấu hình tối đa 1 lần poll/repository mỗi chu kỳ, timeout ngắn và backoff có trần khi lỗi. Không có webhook listener trong pha đầu.
- Mỗi poll chỉ giải branch tip thành full commit SHA. Cùng `app_id + SHA` đã thành công thì không tạo lần deploy khác; SHA được chốt trước enqueue và snapshot detached phải checkout đúng SHA ấy.
- Poller enqueue bền; một worker toàn controller trong giai đoạn đầu. DB lease theo app vẫn là ranh giới loại trừ và cho phép mở rộng worker sau này, nhưng VPS 2 vCPU/4 GB chỉ cho phép **một build nặng toàn controller tại một thời điểm**. Không chạy song song hai `docker build`; giới hạn snapshot/build/log/disk, theo dõi MemAvailable/disk và trì hoãn job nếu dưới ngưỡng. Không chiếm thêm nguồn ngoài workload nếu memory headroom không được chứng minh.
- Giữ nguyên Desktop mode và đường Git manual. Khi app chọn Product mode, mọi deploy/redeploy/rollback thao tác người dùng cũng gửi job tới controller; không cho desktop chạy pipeline trực tiếp cho app ấy. Nếu controller không liên lạc được, hiển thị queued/unknown và giữ URL/app cũ; không fallback sang ghi trực tiếp bằng SQLite desktop.

## Nguồn sự thật và chuyển mode

**Đề xuất:** với app đã chuyển Product mode, SQLite của VPS controller là nguồn sự thật duy nhất cho cấu hình Git production, queue/lease, `deployment`/job history và trạng thái hiện hành. Controller ghi queue, attempt, Git SHA, log metadata và kết quả deployment trong cùng DB/transaction theo hợp đồng. Desktop giữ SQLite hiện tại cho Desktop mode và các app chưa chuyển; ở Product mode desktop chỉ cache/read replica cho UI, các thao tác ghi đi qua authenticated API qua SSH tunnel và không tạo deployment row cục bộ. Không đồng bộ hai writer hoặc hai lịch sử “gần giống nhau”. Bản cache có `controller_id` và `updated_at`; mất kết nối chỉ đánh dấu stale, không tự nhận là trạng thái mới.

- Chuyển Desktop → Product là explicit maintenance action: dừng nhận deploy ở desktop; drain hoặc xác định mọi pipeline đang chạy; khóa app; export snapshot nhất quán SQLite (bao gồm WAL checkpoint), cấu hình và deployment provenance; nhập một lần vào controller với ID/source SHA lineage giữ nguyên; so row count, full SHA, current deployment/runtime image và log references; controller kiểm tra SSH identity/host-key pin; chỉ sau đối chiếu mới bật Product mode và ghi mode owner. Không bật hai writer trong cutover. Idempotent import theo source database ID + app identity; conflict thì dừng, không merge phỏng đoán.
- Desktop → Product chưa có migration data thì app tiếp tục Desktop mode. Không tự chuyển mode ở background theo việc thêm VPS/control plane.
- Quay lại an toàn: explicit maintenance, ngừng polling/enqueue; drain worker; nếu job/deploy state uncertain thì BLOCKED tới khi remote runtime và DB được đối chiếu. Export DB/history mới nhất từ controller, import/verify về desktop trong khi cả hai chế độ ghi đang khóa; xác nhận current SHA/image/health rồi đổi owner sang Desktop; tắt controller writes cho app. Chỉ sau đó desktop được phép deploy trực tiếp. Nếu có divergence hoặc remote state không rõ, không cho fail-open sang desktop. Giữ bản DB controller read-only backup theo retention.
- SQLite controller chạy WAL, foreign keys, backup snapshot/checkpoint có kiểm thử restore; đặt data dir riêng, owner controller, mode directory `0700`, DB/backup `0600`, disk quota/monitoring. Không dùng DB trong container ephemeral layer.

## State machine và transaction

```text
observed(ref, sha) → queued → claimed(lease, fence) → snapshot_verified(sha)
  → deploying(deployment_id) → succeeded
                              ↘ failed_kept_live | rolled_back | uncertain
```

1. **Discover:** đọc branch tip qua Git HTTPS outbound, xác minh 40-hex SHA và ghi `observed_sha` có timestamp. Không tin webhook (chưa dùng) hay ref name như identity.
2. **Enqueue:** transaction tạo job idempotent theo `(app_id, full_sha)`. Unique constraint ngăn duplicate. Job lưu repository URL/ref/root/config generation, không chứa credential. Nếu SHA đã `succeeded`, chỉ cập nhật observation; redeploy cùng SHA cần action thủ công có provenance riêng theo policy, không giả là push mới.
3. **Claim:** worker transaction chọn job queued/retryable theo thứ tự, cấp lease UUID, monotonically increasing fencing token và lease expiry/heartbeat. Chỉ một active claim/app. Một semaphore global giới hạn build đồng thời là 1 trên host 2 vCPU/4 GB.
4. **Snapshot/start:** fetch snapshot detached và yêu cầu SHA khớp queued SHA; lock app bền phải còn lease. Trong một transaction tạo deployment attempt với repo/full SHA và link job trước khi bắt đầu lệnh ghi. Idempotency bảo đảm retry dùng lại cùng job nhưng mỗi lần thử có attempt rõ; không tạo deployment trùng khi worker chết.
5. **Deploy/finalize:** triển khai qua pipeline; mọi DB write cuối có `WHERE app_id=?, lease_id=?, fencing_token=?, state=expected` (hoặc transaction kiểm tra tương đương). Worker mất lease không thể ghi `succeeded`, current deployment hay exposure. Giữ lock/remote fence xuyên hết các lệnh mutate; lock timeout/ownership không rõ ⇒ `uncertain`, không tự chạy lại.
6. **Lease expiry/crash recovery:** restart scan các claimed/deploying hết lease; trước retry chỉ đọc current deployment, container/image, prepared activation và job attempt trên DB/VPS. Nếu chắc chắn chưa có remote mutation, requeue attempt trong retry budget; nếu đã promote, reconcile history bằng SHA/runtime; nếu runtime/DB không kết luận được thì `uncertain` và yêu cầu operator. Worker cũ bị fence khi heartbeat/DB CAS fail và không được gửi lệnh ghi tiếp; lệnh remote có fencing token được kiểm tra khi giữ remote app lock.
7. **Completion:** job terminal state, deployment status, current deployment pointer, duration/error code và sanitized log metadata commit cùng transaction; event/API history phát sau commit. Không phát “finished/succeeded” nếu DB commit fail.

`withAppLock` hiện tại chỉ là queue in-memory trong một process; không thay được lease trên SQLite controller. Không lồng cùng mutex: executor claim lease một lần ngoài pipeline; pipeline reuse phải nhận lock context/được gọi ở chế độ không acquire lock thứ hai. Remote lock và DB lease có thứ tự acquisition cố định (global build slot → app DB lease → remote app lock), timeout rõ và nhả trong `finally`.

## Failure policy

- Build/precheck/loopback health failure: ghi failed step/log, không đổi `app.current_deployment_id`; live app/container/image và URL HTTP giữ nguyên. Nếu runtime candidate đã được promote trước khi health fail, chỉ rollback dưới cùng lease/fence, kiểm tra runtime image cũ và health cũ; nếu rollback cũng thất bại thì ghi `uncertain/degraded`, không xóa data/volume.
- Push liên tiếp khi job còn queued: gộp về tip mới nhất; SHA chưa claim trước được terminal `superseded` với lý do. Job đang claimed không bị kill giữa lệnh mutate; nó hoàn tất transaction an toàn rồi worker enqueue/giữ đúng tip mới nhất. Không deploy mọi SHA trung gian theo mặc định.
- Force-push: polling so full SHA, không giả định fast-forward. Tip SHA mới được enqueue; SHA lineage lịch sử vẫn bất biến. Không xóa image/history và không tự rollback chỉ vì ancestry đổi. Nếu source SHA không fetch được thì giữ live, mark source error và backoff.
- Branch bị xóa/không resolve được: `source_unavailable`, dừng enqueue, giữ live. Không tự xóa app, deployment, DNS hay rollback.
- Git outage: giữ job hiện tại và live; exponential backoff có jitter/trần, không tạo job cho cùng SHA lặp lại. Không log URL chứa credential (MVP URL public, canonical).
- SSH/host identity mismatch: dừng trước ghi, giữ job blocked; không tự học/đổi host key. Timeout sau khi lệnh ghi có thể đã tới VPS ⇒ `uncertain`, đối chiếu read-only trước khi tiếp tục.
- Controller restart: SQLite queue/lease khôi phục; đợi lease hết hạn hoặc xác minh owner process đã chết trước reclaim; recover theo quy tắc remote-state bên trên. Không replay lệnh deploy một cách mù quáng.
- Desktop disconnect: không ảnh hưởng worker, queue hoặc deploy; desktop hiển thị last-known state kèm stale timestamp. Product-mode actions không chuyển sang local pipeline. Khi reconnect, lấy history theo cursor/generation từ controller.
- Deploy thủ công đồng thời: trong Product mode mọi manual redeploy/rollback đều vào cùng queue/app lease. Nếu desktop mode đang có pipeline khi cutover, chờ drain. Direct deploy từ legacy client bị controller-mode app chặn bằng mode/config generation và shared remote lock; conflict không được giải quyết bằng last-write-wins.

## Security, enrollment và credential lifecycle

- Controller Linux giữ SSH host-key pin cho VPS đích; enrollment pin phải được xác minh out-of-band hoặc qua desktop đã pin, không dùng `ssh-keyscan` để tự tin key. Mỗi remote command strict host-key checking. Rotation cần operator confirm fingerprint cũ/mới; mismatch là hard block.
- Git MVP chỉ public HTTPS repo, credential-free URL. Không token/private key Git, không credential helper kế thừa, không prompt tương tác. Private repo credential-scoped là giai đoạn sau.
- SSH deploy private key cấp riêng cho controller, không dùng/di chuyển Windows `safeStorage` ciphertext. Enrollment qua desktop tunnel: controller tạo CSR/public key (hoặc key pair trên VPS); operator cài public key scoped cho user deploy trên VPS đích qua pinned SSH; desktop xác nhận fingerprint/key identity; private key không rời controller. MVP có thể tái sử dụng key do OpsPilot tạo nếu được kiểm soát, không cho caller upload file arbitrary.
- User remote riêng không phải root, chỉ có sudo không tương tác cho danh sách lệnh đã chốt và quyền Docker tối thiểu. Lưu ý thành viên group `docker` gần tương đương root; do đó coi VPS quản lý là trusted boundary và không expose API/docker socket. Không bind Docker API TCP.
- Private key/controller DB/manifest ở data directory riêng: controller user owner; private key `0600`, parent `0700`, không backup key vào history/portable export, SQLite DB/backup `0600`; systemd service không in environment. Secrets không nằm trong argv, URL, event, exception, stdout/stderr hoặc deployment log. Error mapping allowlist; redact trước persistence. Rotation/revoke có UI/operator operation, fingerprint, thời hạn và audit; xóa key cũ chỉ sau xác minh key mới.
- Admin API chỉ bind loopback/Unix socket; desktop dùng SSH tunnel tới pinned controller. Không mở public admin API. Tunnel auth bằng enrolled desktop client key/token có scope read/action, revoke và rotation; request có CSRF/replay protection nếu transport HTTP; controller authorize app/VPS scope và audit actor. Contract/auth scheme phải được review trước khi mở endpoint.

## Giới hạn host và phụ thuộc hạ tầng

VPS tham chiếu hiện 2 vCPU/4 GB RAM; deploy build cạnh app đang phục vụ có thể cạnh tranh CPU/RAM/disk. Controller phải nhẹ (một poller/worker process theo ADR-011), build nối tiếp, bounded Git snapshot/cache/log, log rotation, disk reserve, memory/disk preflight và retention. Không chạy preview/build song song; không hứa không gián đoạn nếu Docker host thiếu tài nguyên. Nếu app workload cùng VPS controller làm memory headroom không đạt, postpone build và báo blocked, không restart/kill app để nhường tài nguyên. Cần HTTPS/shared ingress và external exposure evidence riêng; MVP không mở port admin mới. Outbound HTTPS tới GitHub, SSH tới target, giờ/NTP, disk backup và một VPS Linux ổn định là dependency. Provider cloud firewall API chưa có cho provider VPS hiện tại; exposure có thể degraded dù loopback health đạt.

## Kế hoạch checkpoint code

Các checkpoint sau bắt đầu sau review P3a. Mỗi thay đổi IPC/schema theo contract-first và migration mới; không sửa migration đã chạy. Pha đầu chỉ public GitHub/production branch.

| Checkpoint | Phạm vi/files dự kiến | Contract cần duyệt trước runtime | Gate / DoD |
|---|---|---|---|
| P3b — Product persistence & API contract | `docs/contracts/schema.sql`, `ipc-contract.ts`, `deploy-events.md`, `DECISIONS.md`, migrations `app/src/main/db/`, repository tests; define mode owner, job/attempt/lease/fence, observed branch state, history cursor and client identity. | Queue/job state machine, unique `(app_id, sha)`, terminal/uncertain semantics, lease fencing/CAS, Product mode ownership, client read/action API and auth/tunnel. | Migration 1..N against fresh/populated DB, upgrade/idempotency/rollback tests, stale fencing CAS, duplicate enqueue, foreign-key check; contract parity/strict typecheck. No controller runtime yet.
| P3c — Linux controller bootstrap/read-only poll | New controller composition/CLI/service modules under `app/src/main/controlPlane/` or approved boundary, systemd unit template/docs, Docker-independent poll tests. Reuse Git snapshot source after checking Electron import graph. | Config/health/status read API, poll schedule/state and safe shutdown. | Debian/Ubuntu isolated Linux container/VM; no Electron window/scheduler/deploy at bootstrap; poll public fixture repository, full SHA persisted once, deleted branch/outage tests; service restart does not lose observed state; no VPS install.
| P3d — queue/lease and durable scheduler | Controller queue worker/repositories/migration code, main-process client action DTO only if needed; use one global worker plus per-app DB lease. | Claim/heartbeat/lease expiry/retry budget/uncertain recovery and manual action enqueue. | SQLite concurrency tests with two worker instances, app lock, expired lease, fencing stale writer, push burst coalescing; crash between each claim/DB write; bounded resource and log output.
| P3e — deploy executor and rollback integration | Reusable `DeployService`/`DeployPipeline` composition adapter, controller SSH transport, Git snapshot acquisition; minimize pipeline edits and share renderer/manual behavior. | Controller job → deploy events/log/history mapping, repository generation and rollback terminal contract. | Linux isolated Docker lab with fixture app/repo: exact SHA through snapshot/build/deploy, wrong SHA blocked, logs sanitized, health/build failure retains live version, rollback target/runtime verification; process crash/restart injection; no auto replay on uncertain.
| P3f — credential enrollment, tunnel client and Desktop/Product switch | Linux credential manager/enrollment CLI, IPC/main/preload/renderer for mode, SSH tunnel client and history cursor cache, import/export tooling. | Enrollment, authorization scope, Product-mode ownership and cutover/rollback protocol; client read freshness and action outcome uncertainty. | Key permission/rotation/revoke tests; strict host pin; no secret in argv/log; offline DB import/export equality and conflict; disconnected desktop read-only stale state; no dual writer; UI tests/localization.
| P3g — operational live gate | Service packaging/upgrade/backup/monitoring and runbook; docs + release gate. | Deployment history/retry/manual override and live evidence fields; no further contract change unless separately reviewed. | First run isolated Linux VPS pair; then approved development target. Close desktop, push one chosen SHA, observe exactly one queued job and one deployment row with same full SHA, build/health pass, public health/exposure evidence, desktop reconnect history matches controller. Repeat same poll no duplicate. Force-push/outage/crash and failed-health keep-live drills. Backup/restore and systemd restart. This gate is required before claiming Product auto deploy; no inference from local tests.

## Definition of done for this design checkpoint

- [x] Design is source-checked, names reuse/gaps and strict Product/desktop authority boundary.
- [x] State machine includes idempotency, finite retry, leases/fences, restart recovery, uncertain state and manual deploy collision.
- [x] Security/enrollment, host limits, staged Linux lab/crash/live gate are actionable.
- [x] This task note and board updated; only docs changed; `git diff --check` pass; local commit, no push/PR/merge.

## Nhật ký

- START 22/10 — Đọc task-discipline, ADR-011, docs/31, board, G0/G1a Git task records, Git snapshot, DeployService/Pipeline, DeploymentRepository, app lock, exposure và deploy event/IPC/schema contracts. Chỉ viết tài liệu; kiểm tra inventory từ source hiện tại, không đề xuất framework mới.
- UPDATE 22/10 — Chốt một SQLite controller là authority duy nhất cho Product-mode app; desktop cache/client; mode cutover có barrier/export/import/verify và rollback không fail-open. Poll public production branch mỗi 30s outbound; durable unique app/SHA job, app lease/fence, single build slot trên host 2 vCPU/4 GB; lỗi/uncertain giữ live và cấm replay mù. Chia P3b–P3g theo contract, queue, Linux poller, executor, enrollment/client, live gate.
- GATES 22/10 — Đối chiếu nguồn: `snapshot.ts`, `DeployService`, `DeployPipeline`, `DeploymentRepository`, `monitor/appLock.ts`, `exposure.ts`, `deploy-events.md`, IPC/schema và ADR/roadmap. `git diff --check` PASS. Không chạy code/test vì checkpoint docs-only.

## Bàn giao local

Nội dung thiết kế và board: `15fae0457e91b757257d78e4c3c4ec4cab946fbf`. Bản cập nhật SHA/checklist được commit tiếp theo. Branch `feat/deploy-reachability`; không push/PR/merge. Không cài hoặc kết nối VPS.
