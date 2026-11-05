# 27 — Kế hoạch tự động hóa pipeline, domain, Doctor, dữ liệu ML và detector

> Cập nhật: 14/10/2026. Đây là kế hoạch hợp nhất; phân biệt rõ trạng thái đã qua gate với đề xuất còn mở. Contract hiện hành trong `docs/contracts/` vẫn là nguồn sự thật cao hơn file này. Trạng thái checkpoint gần nhất xem `docs/tasks/board.md` và các task note liên kết.

## 0. Kết luận điều hành

Mục tiêu nên được diễn đạt là **“không lặp lại thao tác thủ công sau lần ủy quyền đầu tiên”**, không
phải “không cần user cung cấp bất kỳ quyền nào”. OpsPilot không thể tự thay đổi firewall/DNS thuộc
tài khoản nhà cung cấp nếu không có API và credential/OAuth do chủ tài khoản cấp. Tương tự, tool
không thể tự đoán secret ứng dụng, quyền sở hữu domain hay chấp nhận một thay đổi phá hủy dữ liệu.

Thứ tự nên làm:

1. **P0 — hợp nhất và khóa bộ thí nghiệm ML** đang nằm trên nhánh `feat/experiment-harness`, chạy
   pilot thật, rồi mới chạy dữ liệu chính thức. Đây vẫn là đường găng của đồ án.
2. **P1 — reachability/publish**: pipeline đã có publish phase, UFW reconcile, external probe và exposure evidence. Mở rộng provider/cloud firewall theo adapter được cấp quyền; không nhầm phase này với HTTPS ingress.
3. **P1 — Deploy Doctor**: Evidence → Diagnosis → Safe fix → Verify → Record outcome; rule xác định trước, không “đoán bằng AI”.
4. **P1a — shared ingress/HTTPS**: quyết định thiết kế Caddy theo task note `TK-S7 P1a`; implementation vẫn chưa bắt đầu.
5. **P3 — detector/template và polish**: chỉ mở rộng sau khi pilot/dữ liệu chính thức đã an toàn.

Hai đề xuất ML cần chốt ngay:

- **Không DDoS** ứng dụng. Chỉ load-test có giới hạn trên hạ tầng do nhóm sở hữu, có rate cap,
  kill-switch và thời điểm bắt đầu/kết thúc được ghi nhãn.
- **Không trộn nhiều app cạnh tranh tài nguyên vào tập train chính**. Giữ thí nghiệm gốc cô lập để
  có tính tái lập; biến ý tưởng này thành một scenario “noisy neighbor” riêng, được điều khiển và
  chỉ dùng để đánh giá sau 5 scenario chính.

## 1. Ảnh chụp trạng thái code hiện tại

### 1.1 Deploy/reachability

- Pipeline hiện là `PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → RECORD`.
- `stepHealthcheck()` chỉ gọi `curl http://127.0.0.1:<host_port>` **trên VPS**. Nó chứng minh app
  sống nội bộ, không chứng minh người dùng ngoài Internet truy cập được.
- Nhánh hiện tại đã có `app/src/main/deploy/reachability.ts`:
  - parse trạng thái ufw;
  - quyết định `ufw allow <port>/tcp` có điều kiện;
  - probe URL từ máy chạy Electron;
  - dựng diagnosis `PORT_BLOCKED_EXTERNAL`.
- Test tập trung cũ 15/15 ngày 22/09/2026 chỉ là mốc lịch sử. Trên nhánh hiện tại, `DeployPipeline`
  đã nối publish/external probe và ghi exposure evidence; không suy ra HTTPS từ gate direct-port.
- Sau loopback health, pipeline giữ deployment healthy nếu publish thất bại; `app_url` chỉ được trả theo exposure evidence. HTTPS shared ingress chưa có runtime.

### 1.2 DNS/domain

- URL hiện tại có dạng `http://<vps-host>:<host_port>`, port app nằm trong `30000–30999`.
- DNS A/AAAA/CNAME chỉ ánh xạ hostname, **không ánh xạ cổng HTTP**. Tạo `A app.example.com → VPS_IP`
  không làm `https://app.example.com` tự đi tới port 30000.
- URL direct-port vẫn là đường hiện hành; DNS assistant/shared-ingress plan không tự tạo route. P1a đã chọn Caddy host-native do OpsPilot sở hữu, nhưng route, certificate, 80/443 preflight và HTTPS activation chưa triển khai. Đặc tả và gates nằm ở [TK-S7 P1a](tasks/tk-s7-p1a-shared-ingress-https.md).

### 1.3 Doctor

- Đã có doctor cho kết nối VPS: probe TCP/SSH, `VpsDiagnosis`, `DiagnosisPanel`.
- Deploy pipeline đã giữ `IpcError`, step, `last_log_lines`; healthcheck failure còn lấy
  `docker inspect` và `docker logs --tail 80`.
- Chưa có bộ luật ghép các evidence này thành root cause/fix; lỗi runtime hiện chủ yếu dừng ở raw
  log và thông báo tổng quát.

### 1.4 ML/experiment

- `ml-service` đã có train/ingest/replay và 3 model + ensemble; collector ghi metric JSONL.
- Code load generator, scheduler, protocol, analyze và export đã được triển khai trên nhánh
  `feat/experiment-harness` (commit mốc `abf16ef`), **chưa nằm trên nhánh hiện tại**.
- Nhánh experiment còn chứa phần vá đường dữ liệu `http_error_rate` từ traffic của load generator;
  phải review để chắc collector đo traffic thật, không chỉ suy ra từ một health probe/10 giây.
- Nhánh hiện tại chỉ còn `.gitkeep` và bytecode cache trong `experiments/`; không được nhầm bytecode
  cache với source đã hợp nhất.
- Protocol chính hiện chốt 5 scenario × 10 run, mỗi run có baseline/holdout/fault/recovery.

### 1.5 Detector

- Engine đang đăng ký 3 detector: Next.js, Vite SPA, Express.
- `FrameworkId` và hint có `flask`, nhưng không có `flaskDetector` được đăng ký. Đây là trạng thái
  contract/capability dễ gây hiểu nhầm.
- Detector chỉ nhìn root project, dùng npm command cố định, chưa hỗ trợ monorepo/package manager
  khác và inference port/health path còn hẹp.
- Script `try:detect` vẫn in “M3 chưa được triển khai” dù detector đã tồn tại.

### 1.6 Rủi ro vận hành nhìn thấy ngay

- Runtime dev hiện dùng Node 24 trong khi `package.json` yêu cầu Node 22; test vẫn chạy nhưng đây là
  nguồn “máy tôi chạy được” cần chặn bằng preflight.
- Plan/task và code đang chia ở hai nhánh `feat/deploy-reachability` và
  `feat/experiment-harness`; nguy cơ branch drift cao trước khi mở thêm tính năng.

## 2. Trạng thái đích của pipeline

Không thêm một `DeployStep` mới vào contract hiện tại. `PUBLISH` là sub-phase nội bộ sau loopback
health và trước `RECORD`:

```text
DETECT/PRECHECK
      ↓
UPLOAD → RENDER → BUILD → DEPLOY
      ↓
INTERNAL_HEALTH (loopback)
      ↓ pass
PUBLISH
  ├─ reconcile firewall OS
  ├─ reconcile firewall provider (nếu đã ủy quyền)
  ├─ reconcile ingress/domain/tunnel theo exposure mode
  └─ probe từ ngoài
      ↓
RECORD runtime_status + exposure_status + evidence
```

Đề xuất tách hai trạng thái, tránh “container chạy” bị đồng nghĩa với “người dùng truy cập được”:

| Runtime | Exposure | Ý nghĩa |
|---|---|---|
| `healthy` | `reachable` | Deploy hoàn chỉnh, URL mở được từ ngoài |
| `healthy` | `degraded` | App chạy nhưng publish thất bại; Doctor có diagnosis/fix |
| `healthy` | `tunnel_only` | URL trực tiếp bị chặn, URL tunnel dùng được |
| `unhealthy` | `not_checked` | Xử lý theo nhánh rollback hiện tại |

Việc thêm field/event phải sửa contract + `DECISIONS.md` theo quy trình. Không nhét diagnosis vào
chuỗi log rồi bắt renderer parse text.

## 3. Câu 1 — Deploy xong nhưng port chưa mở

### 3.1 Thiết kế đề xuất

Tạo `ExposureManager` với ba lớp idempotent:

1. **OS firewall adapter**: ufw/firewalld/nftables capability probe; v1 chỉ hỗ trợ ufw. Chỉ mở đúng
   TCP port app, gắn comment/tag nếu công cụ hỗ trợ, chạy lại không tạo rule trùng.
2. **Cloud firewall adapter**: provider nào có API thì reconcile rule qua API từ Electron. Adapter
   tối thiểu:

   ```ts
   interface CloudFirewallProvider {
     detect(vps: VpsProfile): Promise<CapabilityResult>
     ensureIngress(vps: VpsProfile, port: number): Promise<ReconcileResult>
     revokeIngress(vps: VpsProfile, port: number): Promise<ReconcileResult>
   }
   ```

   Làm provider đang dùng thật trước, sau đó mới thêm provider thứ hai. DigitalOcean và AWS đều có
   API quản lý ingress; token phải least-privilege và mã hóa bằng cơ chế credential hiện có.
3. **External verifier**: probe tối đa 3 lần với timeout/backoff. Ghi status code, latency, lỗi socket
   và observer. Probe từ laptop chỉ chứng minh đường đi từ laptop; phase sau có thể bổ sung remote
   probe trung lập để phân biệt firewall provider với VPN/proxy/mạng cục bộ của user.

Thứ tự trong pipeline:

1. loopback health pass;
2. `ufw status` → ensure rule nếu active;
3. nếu VPS profile đã có provider binding + credential → ensure cloud firewall rule;
4. probe direct URL;
5. nếu fail → chạy Doctor, không rollback app healthy;
6. nếu policy cho phép → tự bật quick tunnel làm fallback và verify URL tunnel;
7. record exposure state rồi mới phát `finished`.

### 3.2 Quyền user chỉ cần cấp một lần

- Khi thêm VPS, thêm bước “Khả năng publish”: provider, resource/firewall ID, API token/OAuth.
- Token chỉ có quyền đọc VPS/firewall và sửa ingress; không xin quyền billing/delete VPS.
- Credential được mã hóa, không đi vào log/export/DB plaintext.
- Sau onboarding, mỗi deploy/redeploy/delete/migrate tự reconcile, không hỏi lại.

### 3.3 Trường hợp provider không có API

Không hứa “tự mở dashboard” nếu kỹ thuật không cho phép. Chọn theo policy:

- **Recommended trong scope hiện tại**: tự tạo quick tunnel từ máy Electron qua SSH local-forward;
  không cần inbound rule nhưng URL chỉ sống khi OpsPilot và tunnel đang chạy.
- **Guided fallback**: Doctor chỉ đúng port/rule cần tạo, có copy và nút “Tôi đã mở — kiểm tra lại”.
- **Ngoài scope v1**: connector/tunnel bền vững chạy trên VPS. Cách này xung đột quy tắc “không
  agent trên VPS”, nên chỉ làm sau khi có ADR rõ ràng.

### 3.4 Cleanup bắt buộc

- Delete app: revoke rule do OpsPilot sở hữu, dừng tunnel, không xóa rule user tạo.
- Migrate: ensure ở VPS đích → verify → đổi DNS/route → sau grace period mới revoke ở VPS nguồn.
- Rollback: không đổi exposure nếu app vẫn cùng host port; nếu port đổi phải reconcile transaction.
- Rule phải có ownership metadata/fingerprint để cleanup không đụng tài nguyên ngoài OpsPilot.

### 3.5 Definition of Done

- Có test pure logic + fake provider adapter + pipeline integration test.
- Ufw active/inactive/unknown đều có behavior rõ; lỗi thiếu sudo được Doctor phân loại.
- Trên provider được hỗ trợ, 20 lần deploy/redeploy/delete liên tiếp không tạo rule trùng/rule rác.
- `running/reachable` chỉ được hiển thị khi external probe pass; app healthy nhưng blocked hiển thị
  `running/degraded`, không rollback oan.
- Quick tunnel fallback được đánh dấu “temporary”, tự kill khi Electron thoát.

## 4. Câu 2 — Trỏ DNS/domain nhanh cho nhiều nhà cung cấp

### 4.1 Sự thật cần khóa

Domain đẹp cần đủ ba phần:

```text
DNS hostname → public ingress 80/443 → route theo Host → app:<host_port>
```

Chỉ làm DNS record mà không có ingress sẽ tạo tính năng sai. HTTP-01 của ACME cũng cần port 80;
TLS-ALPN-01 cần 443. DNS-01 không cần mở port nhưng lại cần API DNS/credential.

### 4.2 Ba mode sản phẩm

| Mode | Tự động | URL | Giới hạn |
|---|---|---|---|
| Direct port | Cao nếu có firewall adapter | `http://app.example.com:30000` | Có `:port`, chưa HTTPS |
| Shared ingress (đề xuất production) | Cao sau onboarding | `https://app.example.com` | Cần ADR cho 80/443 + reverse proxy |
| Named tunnel | Cao với Cloudflare | `https://app.example.com` | Domain/zone và token Cloudflare |

**Khuyến nghị kiến trúc production:** một Caddy gateway được OpsPilot quản lý trên mỗi VPS, chỉ mở
80/443; app port 30000–30999 không cần public. Caddy route hostname → app port và tự quản lý HTTPS.
Phương án này tốt hơn mở một public port cho mỗi app, nhưng xung đột ADR v1 “bỏ reverse proxy” và
quy tắc không mở thêm port. Chỉ triển khai sau khi:

1. pilot/dữ liệu ML đã an toàn;
2. sửa ADR/contract theo quy trình;
3. có test migrate/rollback/certificate persistence.

### 4.3 Kiến trúc DNS provider-agnostic

Tạo abstraction:

```ts
interface DnsProvider {
  discover(domain: string): Promise<ProviderCapability>
  upsertRecord(record: DnsRecord): Promise<ChangeResult>
  deleteOwnedRecord(recordId: string): Promise<ChangeResult>
  checkPropagation(record: DnsRecord): Promise<PropagationResult>
}
```

Các đường tích hợp theo thứ tự:

1. **Domain Connect synchronous flow** khi authoritative provider hỗ trợ. Đây là chuẩn mở giúp
   service provider yêu cầu cấu hình record sau khi user đăng nhập/consent; coverage chưa phải mọi
   provider nên luôn cần fallback.
2. **Cloudflare adapter** làm fast path đầu tiên: scoped API token chỉ `DNS Write` trên một zone;
   hỗ trợ upsert A/CNAME và named tunnel.
3. **RFC 2136/dynamic DNS adapter** nếu provider/VPS lab có endpoint chuẩn và TSIG.
4. **Generic assistant** cho mọi provider: sinh record chính xác, copy, mở đúng dashboard URL nếu
   biết, theo dõi propagation và tự tiếp tục pipeline sau khi record đúng.

Không tích hợp registrar API chỉ để sửa DNS nếu authoritative DNS thực tế nằm ở nơi khác. Discovery
phải dựa trên NS/_domainconnect, không dựa vào “nơi mua domain”.

### 4.4 Domain onboarding flow

1. User nhập hostname mong muốn.
2. OpsPilot kiểm tra ownership/conflict, NS và provider capability.
3. User consent một lần bằng OAuth/token hoặc Domain Connect.
4. OpsPilot tạo/patch record, không overwrite record khác nếu chưa xác nhận.
5. Poll authoritative DNS rồi ít nhất một public resolver; phân biệt `pending`, `propagated`,
   `conflict`, `wrong_target`.
6. Provision ingress/tunnel + certificate.
7. HTTP/HTTPS probe hostname; chỉ lúc này domain mới `active`.
8. Lưu provider, zone, record ID, target, desired state và ownership để migrate/delete an toàn.

### 4.5 Migrate/rollback DNS không downtime

- Hạ TTL trước cutover nếu provider cho phép.
- Publish ingress ở đích và healthcheck trước.
- Upsert DNS/route sang đích.
- Verify từ ngoài; giữ nguồn trong grace window.
- Nếu fail, đổi record/route về nguồn; không xóa certificate/rule nguồn quá sớm.

### 4.6 Definition of Done

- UI không bao giờ nói “domain đã xong” chỉ vì API trả 200; phải DNS + HTTPS probe pass.
- Cloudflare adapter có contract test; generic assistant chạy được với provider bất kỳ.
- Token được scope theo zone và mã hóa; log mask token.
- Domain lifecycle hoạt động qua deploy, redeploy, migrate, rollback, delete.
- Nếu không duyệt shared ingress, UI phải hiển thị URL có `:port` trung thực.

## 5. Câu 3 — Use case và thiết kế Deploy Doctor

### 5.1 Use case chính

> Khi deploy thất bại hoặc app healthy nội bộ nhưng không truy cập được, user bấm **Chẩn đoán &
> sửa**. Doctor thu evidence không chứa secret, đưa ra một root cause chính kèm độ tin cậy và bằng
> chứng, chỉ tự chạy fix nằm trong allowlist an toàn, rồi chạy lại đúng probe đã thất bại để xác nhận.

Flow:

```text
Failure event
   ↓
Evidence bundle
   ↓
Deterministic diagnosis rules
   ├─ confidence cao + safe fix → Fix → Verify → Success/Failed
   ├─ confidence cao + unsafe fix → hướng dẫn/điền form → Verify
   └─ chưa đủ evidence → Abstain + export support bundle
```

### 5.2 Evidence bundle

Thu theo failed step, có timeout và mask secret:

- deployment/app/VPS ID, step, error code, 200 dòng log cuối;
- `docker compose ps`, `docker inspect .State`, exit code/OOMKilled/health;
- log container app/DB/collector;
- disk/RAM/inode, Docker daemon, image/container existence;
- port listener và port mapping;
- env **key presence**, không thu env value;
- loopback/external/DNS/TLS probe;
- ufw/provider firewall capability/result;
- detector signals + BuildPlan đã dùng + lockfile/package manager.

Bundle lưu local, có retention và nút export bản redacted. Không gửi ra server bên ngoài mặc định.

### 5.3 Bộ diagnosis v1 ưu tiên

| Signature/evidence | Diagnosis | Safe action |
|---|---|---|
| `no space left on device`, disk/inode thấp | VPS disk full | Chỉ prune image OpsPilot-owned không còn deployment tham chiếu |
| exit 137 hoặc `OOMKilled=true` | Runtime OOM | Đề xuất limit/plan; không tự tăng nếu chưa kiểm tra RAM VPS |
| app listen port khác BuildPlan | Port mismatch | Patch plan tạm + redeploy nếu log/inspect xác nhận chắc chắn |
| container running, `/health` 404 nhưng `/` 2xx | Wrong health path | Cập nhật health path + rerun healthcheck |
| `ECONNREFUSED:5432`, DB unhealthy | DB not ready/down | Wait/restart service DB rồi verify; không reset volume |
| missing env key | Missing required env | Mở form đúng field; không tự bịa secret |
| `npm ci` lock mismatch/ERESOLVE | Dependency/lockfile | Chỉ hướng dẫn sửa source/lock; không tự sửa dependency |
| crash loop + stack trace | Runtime crash | Surface frame đầu thuộc app, không auto-edit code |
| ufw/provider blocks port | External port blocked | Reconcile adapter rồi external probe |
| DNS wrong target/NXDOMAIN/TLS | Domain publish failure | Upsert/await propagation/retry certificate theo capability |
| Docker daemon missing/down | Docker unavailable | Tái dùng installer/start service nếu platform được hỗ trợ |
| SSH transient timeout/reset | Transport transient | Retry có backoff, giới hạn và idempotency key |

### 5.4 Cách tăng tỉ lệ fix thành công

- Rule xác định + evidence bắt buộc; không map chỉ bằng một regex log mơ hồ.
- Mỗi rule có `requiredEvidence`, `exclusions`, `confidence`, `fixId`, `verifyProbe`.
- Chỉ auto-fix thao tác idempotent/reversible và thuộc tài nguyên OpsPilot.
- Nếu nhiều diagnosis ngang nhau, hiển thị top candidates và **abstain**, không sửa thử ngẫu nhiên.
- Mọi fix đều chạy precondition trước, snapshot/desired state, postcondition sau.
- Lưu outcome để đo thật: diagnosis đúng/sai, fix success/fail, số lần user phải can thiệp.
- Dựng fixture lỗi có chủ đích và golden tests; đánh giá top-1 accuracy và fix-success theo loại lỗi.

Không dùng dữ liệu outcome để âm thầm thay rule trong runtime. Mọi thay đổi rule phải qua test/review
để kết quả tái lập được.

### 5.5 Schema/UI đề xuất

- `doctor_run`: trigger, evidence hash/path, diagnosis code, confidence, selected fix, outcome,
  timestamps, deployment ID.
- `doctor_action`: command/action type, precondition, result, verify result, rollback result.
- UI: Nguyên nhân chính → bằng chứng → hành động đề xuất → “Tự sửa”/“Mở cấu hình”/“Kiểm tra lại” →
  lịch sử kết quả. Raw log nằm trong collapse, không bắt user tự đọc trước.

### 5.6 Definition of Done

- Golden fixtures cho tối thiểu 10 diagnosis, có cả negative/ambiguous case.
- Mục tiêu pilot: top-1 diagnosis ≥80%; auto-fix allowlist ≥90% thành công; case không chắc chắn phải
  abstain thay vì tạo fix sai. Đây là target cần đo, không phải cam kết trước dữ liệu.
- Mỗi auto-fix có verify probe và không rò secret trong log/bundle.
- Ít nhất 5 lỗi thật được inject end-to-end trên VPS và ghi evidence/outcome.

## 6. Câu 4 — Cách lấy data ML hiệu quả và có giá trị khoa học

### 6.1 Dataset đúng cho mô hình hiện tại

Ba model hiện tại là one-class/unsupervised và train theo `deployment_id`. Vì vậy:

- Train chỉ bằng **normal baseline sạch của chính deployment/workload đó**.
- Không gộp raw metric nhiều app/VPS thành một model chung: scale, traffic, memory limit và hành vi
  khác nhau làm “normal” trở thành hỗn hợp khó giải thích.
- Fault data và label dùng để **đánh giá/calibrate**, không đưa vào train chính chỉ để model biết
  trước anomaly.
- Synthetic data chỉ dùng cho unit test/smoke, không dùng làm bằng chứng headline.
- Khi vận hành thật, mẫu nghi anomaly phải vào quarantine; không tự rolling-retrain trên mọi mẫu vì
  model sẽ học luôn trạng thái hỏng thành “normal”. Mỗi lần retrain cần model version và rollback.

### 6.2 Thiết kế thu thập khuyến nghị

Giữ protocol chính hiện tại để bảo đảm nội tại:

1. VPS cùng provider/gói/region; không workload ngoài thí nghiệm.
2. Baseline train 30 phút/180 mẫu như contract hiện tại.
3. Normal holdout riêng, tuyệt đối không train trên holdout.
4. Fault có lịch và tham số cố định.
5. Recovery vẫn thu nhưng loại khỏi confusion matrix.
6. 10 run/scenario; threshold/config khóa sau pilot.

Load generator 5 RPS của protocol hiện đặt cùng VPS để giảm jitter Internet. Trước final runs phải
đo overhead của chính load generator và đặt CPU/memory limit cho nó. Với scenario traffic surge,
khuyến nghị generator chạy trên VPS thứ hai cùng region/private network; nếu chạy cùng host thì nó
đồng thời trở thành noisy neighbor và làm sai câu hỏi nghiên cứu. Thay đổi vị trí generator, nếu có,
phải chốt trước pilot và ghi vào protocol version.

Để baseline bền hơn trong sản phẩm sau thí nghiệm, thêm “baseline readiness” thay vì chỉ đếm 150
mẫu: đủ coverage theo khung giờ/load band, missing rate thấp, không rule alert, variance không bằng
0 và không có deploy/restart trong cửa sổ. Không thay protocol chính sau khi đã nhìn kết quả.

### 6.3 Có nên dồn nhiều app vào một VPS?

- **Không trong 5 scenario chính và không trong train baseline.** Nhiễu ngẫu nhiên làm mất khả năng
  biết anomaly đến từ app hay hàng xóm, đồng thời làm các run không so sánh được.
- **Có, dưới dạng experiment phụ “noisy_neighbor”** sau khi dữ liệu chính đã khóa:
  - một stressor container có CPU/memory limit rõ;
  - start/stop đúng timestamp;
  - mức 25/50/75% CPU hoặc memory pressure định trước;
  - cgroup stats của app và host cùng được lưu;
  - 10 run, không chạy chồng experiment khác.

Kịch bản này trả lời câu hỏi mới: detector app-level có phân biệt lỗi nội tại và áp lực hạ tầng
chung hay không. Không dùng nhiều app ngẫu nhiên do người dùng thật tạo tải không kiểm soát.

### 6.4 Có nên DDoS ứng dụng?

**Không.** DDoS lên tài sản ngoài phạm vi có rủi ro pháp lý/ToS và khó tái lập. Thay bằng
`traffic_surge`/bounded load test trên VPS của nhóm:

- ramp 5 → 10 → 25 → 50 RPS theo lịch;
- concurrency/rate cap cố định;
- abort nếu host CPU/memory, error rate hoặc network vượt safety threshold;
- chỉ target IP/app allowlist;
- kill-switch và auto teardown;
- ghi offered load, achieved load, timeout, status distribution và latency p50/p95/p99.

Traffic generator phải chạy trên hạ tầng kiểm soát, không gọi dịch vụ bên thứ ba.

### 6.5 Scenario nên có

| Nhóm | Scenario | Vai trò |
|---|---|---|
| Chính | memory leak, CPU creep, error burst, slow DB, latency creep | Trả lời RQ1–RQ3 hiện tại |
| Phụ | noisy neighbor | Cạnh tranh tài nguyên có kiểm soát |
| Phụ | traffic surge | Load tăng có giới hạn, thay DDoS |
| Robustness | dependency restart/network latency có lịch | Đánh giá transient vs sustained fault |
| Negative control | normal load step nhưng vẫn trong SLO | Đo false alert khi tải hợp lệ thay đổi |

Chỉ thêm scenario phụ sau khi 50 run chính hoàn tất hoặc khi timeline chính thức được re-baseline.

### 6.6 Chất lượng dữ liệu bắt buộc

Mỗi run có manifest bất biến:

- run/scenario/attempt ID, app/deployment/VPS anonymized ID;
- git SHA của app, collector, ml-service và experiment harness;
- feature version, model params, threshold, seed;
- VPS plan/region/kernel/Docker version/resource limits;
- phase timestamps theo đồng hồ VPS, `clock_offset_ms`;
- expected/actual sample count, gap lớn nhất, null rate từng metric;
- fault params, load params, abort reason;
- hash các CSV sau export.

Integrity gate tự abort/retry khi clock skew, sample gap, score thiếu hoặc load không đạt. Không xóa
attempt bị abort; phân tích chính chọn attempt completed theo rule đã chốt.

### 6.7 Chống data leakage và đánh giá đúng

- Split theo **run/time**, không random theo sample vì cửa sổ 20 mẫu chồng lấn làm leakage.
- Pilot dùng để chọn threshold/config; final runs khóa config và không dùng để tune lại.
- Báo cáo Precision, Recall, F1, PR-AUC, false alerts/hour, detection delay và số run censored.
- Confidence interval tính trên đơn vị run, không coi hàng nghìn sample chồng lấn là độc lập.
- So sánh theo scenario và theo VPS; công bố run abort/outlier theo rule có trước.
- Không đặt KPI “ML phải thắng rule”; kết quả rule thắng ở error burst vẫn là kết quả hợp lệ.

### 6.8 Việc phải làm ngay trên nhánh experiment

1. Review/chạy lại toàn bộ test của `feat/experiment-harness` trên source thật.
2. Chốt mâu thuẫn `latency_creep`: `+50 ms/phút × 20 phút` chỉ khoảng 1000 ms, không khớp mô tả
   vượt ngưỡng 2000 ms cuối pha. Quyết định **trước pilot/final runs**, ghi DECISIONS.
3. Chạy một pilot end-to-end ngắn rồi một run đủ phase; kiểm manifest/export/analyze.
4. Khóa protocol/config; tag commit sinh dữ liệu.
5. Chạy 50 run; backup CSV sau từng run; không commit DB chứa credential.

## 7. Câu 5 — Mở rộng detector/template

### 7.1 Sửa nền trước khi thêm framework

1. **Project root discovery**: tìm workspace/package root thay vì mặc định thư mục user chọn là root.
2. **Package manager**: nhận diện `package-lock`, `pnpm-lock`, `yarn.lock`, `bun.lock`; command build
   phải tương ứng, không luôn `npm ci`.
3. **Port/start/health inference** có evidence và confidence; ambiguity phải dừng hỏi, không đoán.
4. **Environment classifier**: build-time public env vs runtime secret; không bake secret vào image.
5. **Existing Dockerfile mode**: validate Dockerfile/compose do user cung cấp như escape hatch có kiểm
   soát, giúp tăng coverage mà không phải viết template cho mọi framework.
6. **Detect-only CLI/UI** thật, thay placeholder `try:detect`; in detector, alternatives, signals,
   BuildPlan và validation errors mà không deploy.
7. **Fixture matrix**: positive, negative, ambiguous, monorepo, missing lockfile, custom port.

### 7.2 Những gap cụ thể cần test

- Vite chỉ được tìm trong `devDependencies`; một số project đặt ở `dependencies`.
- Express chỉ được tìm trong `dependencies`; project/monorepo có thể đặt khác.
- Prisma thường dùng `@prisma/client` runtime và `prisma` devDependency; `needsDb` hiện có thể bỏ sót.
- `.env.example` parser không xử lý `export KEY=`, khoảng trắng và comment inline.
- Express health route chỉ scan entry file; route có thể được mount từ module khác.
- Vite `build.outDir` custom có thể không khớp Dockerfile static hiện tại.
- Next.js monorepo/standalone/custom server chưa được phân loại.
- `flask` có trong union/hint nhưng capability chưa tồn tại.

### 7.3 Thứ tự template đề xuất

Chỉ bắt đầu sau gate ML:

| Ưu tiên | Template | Lý do |
|---|---|---|
| 1 | Flask | Đã có trong contract/Tier 2; khép mismatch hiện tại |
| 2 | FastAPI | Python API phổ biến, template gần Flask nhưng chạy Uvicorn |
| 3 | Generic Dockerfile | Coverage lớn nhất với ít core change; cần security validation |
| 4 | NestJS | Bổ sung Node backend có build step rõ |
| 5 | Go | Binary tĩnh, image nhỏ, demo tính mở rộng tốt |
| 6 | Django/Spring/Laravel | Chỉ khi có use case/fixture thật; DB/migration phức tạp hơn |

Không tạo detector riêng cho React/Vue/Svelte nếu cùng là Vite static và BuildPlan giống nhau; detector
Vite có thể hiển thị subtype. Mục tiêu là khác biệt về build/runtime, không phải tăng số logo.

### 7.4 Contract detector v2 (chỉ khi thật sự cần)

Giữ kiến trúc array object, không runtime plugin. Có thể mở rộng kết quả bằng:

- confidence và evidence có trọng số;
- detected project root;
- package manager;
- inferred port/health/start command kèm source;
- validation warnings/errors;
- build strategy: template hay existing Dockerfile.

Mọi thay đổi union/interface phải sửa `docs/contracts/detector-contract.ts`, mirror shared type và
`DECISIONS.md` trong cùng commit.

### 7.5 Definition of Done cho mỗi template

- Detector positive/negative/ambiguous tests.
- Render Dockerfile/compose snapshot tests.
- Build + deploy thật fixture lên VPS; loopback và external verify pass.
- Required env được phát hiện; secret không xuất hiện trong build log/image history.
- Redeploy, rollback, migrate và collector hoạt động, không chỉ “docker build pass”.
- Đo số dòng core bị sửa và thời gian thêm framework để làm bằng chứng extensibility.

## 8. Câu 6 — Backlog tối ưu, lỗi tồn đọng và tính năng giá trị cao

### 8.1 P0/P1 — lỗi/rủi ro cần xử lý trước

| Vấn đề | Hậu quả | Hành động |
|---|---|---|
| Reachability module chưa nối pipeline/UI | Healthy giả | Hoàn tất integration + contract diagnosis |
| Experiment source ở nhánh riêng | Mất/đúp công, không chạy được từ HEAD hiện tại | Review, merge/rebase có kiểm soát, test lại |
| `latency_creep` params mâu thuẫn mô tả | Ground truth/kỳ vọng sai, nguy cơ p-hacking | Chốt trước pilot |
| DNS proposal chỉ tạo A record | Domain không vào được port cao | Không ship nếu chưa có ingress hoặc URL `:port` |
| Flask nằm trong contract/hint nhưng không có implementation | UI hứa capability giả | Ẩn khỏi hint hoặc hoàn thiện sau gate |
| `try:detect` là placeholder | Không có đường test module độc lập | Viết CLI thật |
| Node runtime lệch engine | Build/test không tái lập | Preflight Node 22, CI matrix đúng version |
| RECORD nuốt lỗi DB nhưng vẫn có thể báo running | Runtime/DB lệch trạng thái | Ghi degraded persistence state + reconciliation |

### 8.2 P2 — cải thiện trải nghiệm và độ tin cậy

- **Capability onboarding** cho VPS: SSH, sudo, Docker, firewall OS/provider, DNS, ingress/tunnel;
  pipeline biết trước cái gì auto được thay vì fail cuối.
- **Desired-state reconciliation**: nút Repair kiểm tra app/container/firewall/DNS/tunnel và sửa drift.
- **Resume/retry có giới hạn** theo step và error class; không retry blind thao tác không idempotent.
- **Preflight source** trước upload: detector/build plan/env/lockfile/Dockerignore/size/security warning.
- **Deployment evidence bundle** một click, redacted, có correlation/deployment ID.
- **Notification + audit**: publish degraded, auto-rollback, doctor fix, DNS cutover.
- **Backups trước migrate/DB change**, hiển thị restore point; không tự chạy destructive migration.
- **Resource quota/capacity planner**: dự báo RAM/disk/port trước khi đặt nhiều app lên VPS.

### 8.3 P2/P3 — tính năng “xịn” nhưng đúng giá trị đồ án

- Live detection-delay readout trong demo.
- Reproducibility manifest viewer + nút verify hash.
- Auto-label alert từ experiment phase, nhưng vẫn giữ provenance “generated ground truth”.
- Compare rule vs 3 model + ensemble trên cùng timeline.
- Explain anomaly bằng top contributing feature/z-score detail hiện có, không thêm deep learning.
- Canary deploy ngắn: candidate chạy port tạm, health/external verify rồi mới cutover ingress.
- Domain cutover preview và rollback một click.
- Doctor success dashboard: lỗi nào hay gặp, diagnosis/fix nào đang thất bại.

## 9. Những hành động không nên hoặc không thể auto hoàn toàn

| Hành động | Vì sao | UX đề xuất |
|---|---|---|
| Cấp quyền firewall/DNS lần đầu | Tài nguyên thuộc tài khoản ngoài OpsPilot | OAuth/scoped token một lần, test quyền ngay |
| Provider không có API/Domain Connect | Không có kênh kỹ thuật để sửa | Guided step + live verify hoặc tunnel fallback |
| Giá trị secret/env nghiệp vụ | Tool không thể đoán và không nên tự sinh | Form đúng field, secret store, validation |
| Xác nhận ownership domain | Yêu cầu bảo mật bắt buộc | Consent/OAuth/TXT/HTTP validation |
| Sửa source/dependency tùy ý | Có thể đổi behavior app | Doctor đưa evidence/patch preview, user chấp nhận |
| DB migration phá hủy dữ liệu | Không dễ rollback | Backup + dry-run + explicit confirmation |
| DDoS hoặc load ngoài allowlist | Rủi ro pháp lý/ToS | Bounded lab load test, safety gate |
| Thay đổi protocol sau khi xem final result | P-hacking | Versioned decision trước pilot/final |

Mục tiêu UX là gom các việc không auto được vào **onboarding một lần** hoặc **một màn hình có live
verification**, không bắt user nhớ runbook sau mỗi deploy.

## 10. Work packages và phụ thuộc

| WP | Nội dung | Phụ thuộc | Ước lượng | Gate ra |
|---|---|---|---:|---|
| WP0 | Đồng bộ hai nhánh, test baseline, khóa scope | — | 0.5–1 ngày | Source/test ở một integration branch |
| WP1 | Review harness, sửa protocol conflict, pilot ML | WP0 | 2–4 ngày + giờ chạy | 1 run đủ phase, manifest/export/analyze hợp lệ |
| WP2 | Nối reachability + exposure state/UI | WP0 | 1–2 ngày | VPS thật direct pass + blocked diagnosis |
| WP3 | Cloud firewall adapter provider đầu tiên | WP2 | 2–3 ngày | Reconcile/delete idempotent |
| WP4 | Doctor v1 10 diagnosis + 5 E2E faults | WP2 | 3–5 ngày | Accuracy/fix-success report |
| WP5 | DNS assistant + propagation state | WP2 | 2–3 ngày | Generic provider flow trung thực |
| WP6 | Cloudflare DNS/Domain Connect fast path | WP5 | 2–4 ngày | One-time consent, auto upsert/verify |
| P1a | Hợp đồng shared ingress Caddy, 80/443/DNS/TLS/rollback | Domain + exposure hiện có | docs checkpoint | ADR/task note được review; chưa ghi VPS |
| P1b–P1f | Contract/state → preflight → DNS/ACME → atomic reconcile → UI/operations | P1a | chia nhỏ theo task note | Unit/fault-injection gates rồi mới VPS lab live gate |
| WP8 | Detector hardening + Flask | WP1 final-data gate | 3–5 ngày | Fixture + VPS E2E |
| WP9 | 50 final runs + analysis | WP1 | 60+ giờ máy | Dataset locked + report tables |
| WP10 | Scenario phụ noisy-neighbor/traffic-surge | WP9 | 20+ giờ/scenario | 10 run/scenario hoặc cắt scope |

WP1 và WP2 có thể triển khai độc lập nhưng không nên chạy experiment thật trong lúc redeploy/can thiệp
VPS. WP7/WP8/WP10 là scope cắt đầu tiên nếu ảnh hưởng WP9.

## 11. KPI nghiệm thu toàn chương trình

| Nhóm | KPI đề xuất |
|---|---|
| Publish | Sau onboarding, không thao tác dashboard mỗi deploy trên provider hỗ trợ |
| Reachability | `reachable` chỉ khi external probe pass; không rollback app chỉ vì cloud firewall |
| Cleanup | Không rule/DNS/tunnel orphan sau 20 vòng deploy/migrate/delete test |
| Doctor | Top-1 ≥80%, safe auto-fix ≥90%, có abstention cho case mơ hồ |
| DNS | Record + ingress + HTTPS probe đều pass trước trạng thái active |
| Detector | 100% fixture matrix cho framework công bố hỗ trợ + E2E VPS |
| ML data | Không leakage, manifest đầy đủ, integrity gate pass, config khóa trước final runs |
| Reproducibility | Một người khác chạy `analyze.py` từ CSV và tái tạo cùng bảng/hash |

KPI Doctor/publish phải đo bằng fault injection và trial log; không tự tuyên bố đạt dựa trên unit test.

## 12. Quyết định kiến trúc cần chốt trước khi code phần tương ứng

Đề xuất mặc định:

1. **Approve** thêm exposure state/diagnosis có cấu trúc vào contract; không parse log text ở UI.
2. **Approve** provider adapter cho đúng nhà cung cấp VPS đang dùng trước, không viết 5 adapter giả.
3. **Cloudflare-first** cho DNS automation; Domain Connect + generic assistant là đường mở rộng.
4. **Chọn Caddy shared ingress** theo P1a; implementation vẫn phải qua contract, conflict, rollback và external-probe gates trước khi công bố HTTPS. Nếu chưa triển khai/đủ điều kiện thì direct URL `:port` tiếp tục phục vụ.
5. **Giữ 5 scenario chính cô lập**; noisy neighbor và traffic surge là secondary dataset.
6. **Cấm DDoS**, chỉ bounded load test trên allowlist.
7. **Chốt `latency_creep` trước pilot**, version protocol và không chỉnh theo final result.

## 13. Tài liệu chính thức tham khảo cho các quyết định mới

- [Cloudflare DNS record API](https://developers.cloudflare.com/api/go/resources/dns/subresources/records/methods/create/): tạo record cần scoped `DNS Write` token.
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/): tunnel là outbound-only; named
  tunnel ánh xạ hostname tới local service mà không cần mở inbound port.
- [Domain Connect](https://www.domainconnect.org/getting-started/): discovery + consent/template flow
  cho nhiều DNS provider; synchronous flow có coverage tốt hơn asynchronous OAuth hiện tại.
- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https): domain public cần DNS đúng,
  ingress 80/443 cho HTTP/TLS challenge hoặc DNS provider credential cho DNS challenge.
- [Let’s Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/): HTTP-01 chỉ dùng
  port 80; DNS-01 cần cập nhật TXT và nên dùng credential scope hẹp.
- [DigitalOcean firewall API](https://docs.digitalocean.com/reference/api/reference/firewalls/): ví dụ
  provider có API/scoped permission để thêm ingress rule.
- [AWS EC2 ingress API](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AuthorizeSecurityGroupIngress.html): ví dụ thứ hai cho cloud firewall adapter.

## 14. Trạng thái triển khai trên nhánh tích hợp — cập nhật 14/10/2026

Các hạng mục sau đã được hiện thực hóa và kiểm thử trong source hiện tại:

- `DeployPipeline` chạy phase publish sau loopback healthcheck, tự reconcile UFW khi đang active,
  probe external, ghi `exposure_status`/evidence redacted và chỉ trả `app_url` khi reachable.
  Cloud firewall adapter DigitalOcean đã có contract/idempotency test; credential provider chưa
  được nhúng vào DB nên cần onboarding một lần trước khi nối vào `SshExposureManager`.
- Doctor rule engine có 12 nhóm nguyên nhân, confidence, abstention khi evidence mơ hồ, safe-fix
  allowlist và verify outcome. Failure ở BUILD/DEPLOY cũng tạo `doctor_run`; fix firewall là nhánh
  tự động đầu tiên, các fix đụng source/DB vẫn trả manual.
- Domain assistant hỗ trợ direct-port/shared-ingress/named-tunnel plan và propagation check; phần shared ingress hiện vẫn là desired-state/hướng dẫn, chưa có Caddy runtime.
  Cloudflare adapter upsert/delete chỉ nhận record có ownership fingerprint; IPC `domain:upsert`
  nhận token scoped theo request, không lưu token, ghi `domain_binding` desired-state. Provider
  khác dùng cùng interface hoặc Domain Connect URL; shared ingress đã được chọn thiết kế ở P1a nhưng chưa có runtime.
- Detector helper xử lý package manager/env/build args ổn định hơn, `try:detect` đã chạy được trên
  fixture. Flask vẫn bị giữ ngoài capability công bố cho đến khi gate dữ liệu ML chính thức đạt.
- `experiments/` có manifest/hash/integrity gate, bounded load generator (private/allowlist, tối đa
  50 RPS/30 phút, kill-switch) và phân tích CSV với grace sensitivity; không có DDoS hoặc fault
  injection phá hoại.

Git manual: live deploy/redeploy đã được xác minh; xem [G2](tasks/tk-s7-g2-live-git-vps-smoke.md), [G2b](tasks/tk-s7-g2b-local-template-vps-smoke.md) và [evidence demo](demo-14-10/evidence.md). Điều này không bao gồm push-to-deploy.

P1a chọn kiến trúc Caddy shared ingress trong tài liệu; chưa sửa runtime, chưa chiếm cổng, cấp certificate hay ghi VPS. Các gate code/live sẽ theo task note P1a trước khi gọi HTTPS là active. Kết quả kiểm thử và cảnh báo ở các task cũ là snapshot theo ngày ghi, không đại diện gate mới nhất.
