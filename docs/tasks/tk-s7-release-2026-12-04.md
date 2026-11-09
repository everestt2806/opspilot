# Hoàn thiện OpsPilot tới 04/12/2026

> **08/11 — R3c-6h2b2:** [Main installation journal/discovery](tk-s7-release-r3c6h2b2-install-journal.md) nối local SQLite029 với existing remote UUID, protected catalog/current ciphertext/security fences, cold unknown/explicit inspect/recovery/rebind. Tiếp6h2b3 root-admin UID bridge và vault installation authority, rồi Settings consent wizard; chưa Desktop one-click install hoặc đóng R3/PRODUCT_PASS. Không productionwrite/PR/merge.

> **08/11 — R3c-6h2b1:** [SSH transfer/bootstrap](tk-s7-release-r3c6h2b1-ssh-bootstrap.md) nối verified local release/tool → pinned SSH → bounded root staging → Python verify → packaged Node/trusted installer; native25 có real systemd và lost reply→coldinspect không replay. Còn code6h2b2 durable Main install journal/root-admin UID bridge/binding rồi wizard; chưa Desktop one-click, live/reboot/soak/distribution và R3 tổng chưa đóng. Không productionwrite/PR/merge.

> **08/11 — R3c-6h2a:** [System service installation](tk-s7-release-r3c6h2a-controller-service.md) nối verified release → private durable installer state → fresh service account → DB/key → enabled non-root systemd/owned loopback health. Native22 có4SIGKILL boundaries và cold same-key recovery; full/types/lint/build trong hồ sơ. Chưa Desktop install: cần6h2b transfer/Python bootstrap/explicit root-admin UID bridge, rồi consent wizard. Không productionwrite/PR/merge; reboot/live/soak và R3 tổng chưa đóng.

> **08/11 — R3c-6h1:** [Linux release/host preflight](tk-s7-release-r3c6h1-controller-release.md) xử lý nền installer: runtime độc lập với Node22/native dependencies theo lock, verified payload/independent pin, passive hash/ELF/ownership checks; fixed readonly SSH probe. Native17/focused52/type/lint/build/Ruff đạt, full cuối trong hồ sơ; không sửa UI/IPC hoặc cài production service. Còn code6h2 transport/install transaction/admin-runtime UID/systemd/wizard; không gọi checkpoint này là đã có one-click installer hoặc PRODUCT_PASS.

> **08/11 — R3c-6g4:** [Target credential onboarding](tk-s7-release-r3c6g4-target-credentials.md) đã nối GUI/main/verifiedSSH/atomic encrypted registration, bỏ bước CLI enroll-vps cho target trên controller đã cấu hình. Explicit consent, local/cipher/binding fences, unknown cùngUUID và wrongpin trướcauth; native34/Electron80/probe18/fresh028 đạt, full cuối tại hồsơ. Code tiếp: installer/setup controller và rotation/rebinding; gates non-root/live/soak vẫn riêng. R3 tổng/PRODUCT_PASS chưa đóng.

> **08/11 — R3c-6g3d:** [Readiness/first deploy Desktop](tk-s7-release-r3c6g3d-first-deploy.md) đã nối source fullSHA/shared preflight, HMAC target inspect, controller/target RAM/disk/Docker/port và explicit prepare→review→send. API có atomic first-deployment precondition, main receipt60s, mất phản hồi chỉ lookup oldkey. Native SSH/Docker đã chạy app thật/HTTP200/1job và cleanup, không production VPS. R3 còn target credential onboarding, installer/rotation/live/soak; checkpoint không đóng R3 tổng hoặc PRODUCT_PASS.

> **07/11 — R3c-6g3c:** [Target preparation GUI](tk-s7-release-r3c6g3c-target-ui.md) readstate/explicitreview/enroll qua existinginstaller/proof, atomic sourcefences +pinnedidentity; native25giữ unknown→coldinspect khôngreinstall. Per-app readiness/resources/Docker vàfirstdeploy GUI là6g3d, R3 tổng chưađóng. Khôngproductionwrite/PR/merge; checkpointpushđượcphép.

> **07/11 — R3c-6g3b:** [Desktop source verification](tk-s7-release-r3c6g3b-source-ui.md) nối fixed verifiedSSH operation và UI4locale/fullSHA; native21/Electron44/99focused/type/lint/build đạt. R3 còn targetenrollment/readiness/firstdeploy GUI (6g3c), credential onboarding/installer/rotation/live/soak. Source verified chỉsnapshot, không đãdeploy; gate sản phẩm/ML/HTTPS/migrate vẫn nghiệmthu riêng.

> **07/11 — R3c-6g3a:** [Source verification backend](tk-s7-release-r3c6g3a-source-verification.md) fixed Linux adminCLI/current SQLite/verified bundle/shared preflight/atomic paused observation, public GitHub + cold process đã chứng minh. R3 còn IPC/UI source verification, enroll-target/readiness/firstdeploy wizard, credential onboarding/installer/rotation/live/soak; không yêu cầu user test để thay code chưa viết. Local checkpoint không đóng R3 tổng hoặc PRODUCT_PASS.

START 05/11/2026 — User chốt hạn kết thúc mới **04/12/2026**, yêu cầu rà soát toàn bộ và triển khai gấp theo hướng sản phẩm chỉn chu. Base `main b2cd50a`, branch `feat/release-audit-20261204`. Hạn 20/11 trong tài liệu trước đây là lịch sử; các yêu cầu tính năng và protocol ML không tự bị cắt vì đổi lịch.

## Requirement ledger của phiên

| Yêu cầu | Hành động / evidence | State |
|---|---|---|
| Đồng bộ hạn kết thúc 04/12 và tiêu chí sản phẩm | CLAUDE/timeline/roadmap/board/handoff/FR matrix có notice hiện hành; giữ lịch sử và DoD cũ | PASS |
| Rà source và evidence toàn luồng, chỉ rõ code vs lab vs live | Ma trận mục 1 và mapping FR/UC/NFR mục 5; code/lab/live tách rõ, không dùng test count làm % sản phẩm | PASS |
| Chia task đủ scope, dependency, owner, checkpoint và lịch | R0–R14 (R8 tách a/b), core/ML/delivery, lịch mục 4 và phạm vi owner mục 3 | PASS |
| Bắt đầu sửa blocker cụ thể thay vì chỉ lập tài liệu | R0: chặn Product C0, recheck sau await và kiểm ownership + mutation trong SQLite write transaction; regression tái hiện trước/sau sửa | PASS |
| Kiểm chứng và bàn giao task hiện hành | 135 focused tests PASS; typecheck/build/scripts/scoped lint; diff/staged check sạch, link nội bộ hợp lệ; hồ sơ và local commit cùng branch, không deploy/đổi DB thật | PASS |

## Điều phối

- Sơn/Worker core: Product runtime, recovery, ownership, queue/executor, DB/contract dùng chung.
- Kim/Worker ML: hạ tầng pilot, run/evidence/dataset/analysis, cập nhật tiến độ hằng ngày.
- Delivery/QA: ma trận desktop/template/migrate/HTTPS/installer và demo; task/file tách với core, phối hợp điểm nối IPC/schema trước sửa.
- Chưa phát Worker mới trên máy này; cần tránh trùng task Kim đang làm. Hiện đang hỏi lại khả năng dành VPS ML riêng, VPS thứ hai và domain; tiếp tục việc local độc lập trong lúc chờ.

## Khởi động ngay

1. Chốt audit và lịch mới theo source vừa merge; các gate tổng 05/11 là baseline lịch sử, không coi là proof của code thay đổi sau đó.
2. Rà và chặn Desktop `MonitorService.reconcilePrepared` khi app thuộc Product hoặc activation do Product giữ; không cho đường Desktop promote/abort thay T1/T2.
3. Sau ownership gate: nối CLI integration lab pinned SSH/SQLite/Docker/collector thật; vẫn giữ executor production tắt tới khi success/failure/recovery matrix qua gate.

## 1. Kết luận audit — cập nhật 06/11

OpsPilot có nền desktop và các thành phần backend đáng kể, nhưng **chưa đủ bằng chứng để gọi là sản phẩm production hoàn chỉnh**. Merge PR #33/#34 hoàn tất L0/H1 và đưa H2 vào main; H2 vẫn PARTIAL. Không lấy số test hoặc số dòng code làm tỷ lệ hoàn thành sản phẩm.

Mục tiêu release: người dùng cài được app trên máy khác, thêm VPS an toàn, deploy từ **thư mục hoặc Git**, cập nhật/rollback có bảo toàn dữ liệu; Product mode tự deploy khi desktop tắt; quản lý URL/HTTPS, xem vận hành, migrate và chứng minh ML bằng dữ liệu thật. Chức năng được giới thiệu phải chạy trọn vòng, có trạng thái lỗi và cách phục hồi. Không đổi protocol ML để chạy nhanh hơn, không thay gate live bằng mock.

Nguồn kiểm tra: source trên `main b2cd50a`, contract, roadmap 31, ma trận FR/UC, hồ sơ PR #33/#34 và các checkpoint được dẫn dưới đây. Chưa truy cập VPS trong đợt audit này; tình trạng hạ tầng tháng 10 không đại diện tình trạng tháng 11.

### Ma trận chức năng và khoảng trống

| Nhóm | Bằng chứng hiện có / nơi đối chiếu | Còn phải làm để nghiệm thu |
|---|---|---|
| VPS / SSH / tự chuẩn bị môi trường | `ssh/manager.ts`, VPS IPC, host-key pin, scan/install, archive/reconnect/discovery | VPS mới và reconnect sau xóa profile; sai pin/quyền/mất mạng được giải thích; phát hiện lại app đúng ownership, không nhận app lạ thành app do tool quản lý |
| Deploy trực tiếp | Desktop `deploy/pipeline.ts`, detector/template và UI có code/test | Local × Express/Next.js/Vite trên bản tích hợp; build/health fail giữ bản cũ; tên/port/env lỗi rõ; local không bị mất khi bổ sung Product |
| Deploy Git thủ công | Source URL/ref/root/SHA, snapshot/guard và history đã có | Public repo/nhánh/thư mục con; SHA thực khớp build/history; repo sai/quyền thiếu được báo; task private Git riêng nếu đưa vào release |
| Product build | L0/H1 đã merge; Linux helper/build tests và Docker lab có evidence | Chưa đồng nghĩa có pipeline deploy hoàn chỉnh; tiếp tục H2 với SSH/SQLite/Docker/collector thật |
| Activate / health / rollback Product | `productRuntimePipeline.ts`, `db/productRuntimeRepository.ts`, target Python; C0/T1/ACK/T2 có code | Một integration CLI thật: deploy đầu, cập nhật, build fail, health fail rollback, collector fail, disconnect và recovery; pointer/image/SHA/metric boundary phải khớp |
| Phân quyền Desktop / Product | `product_app_control`, lease/fence và runtime execution | Monitor Desktop chưa kiểm ownership khi reconcile prepared; sửa R0 trước khi bật executor. Mode transfer không được khiến hai phía cùng điều khiển |
| Git auto deploy khi desktop tắt | `gitPoller.ts`, queue/repository/worker, `controllerService.ts`; worker mặc định thiếu executor | Nối executor sau H2, bootstrap/credentials/service restart, quản trị có xác thực hoặc SSH tunnel; push tạo đúng job/SHA, history đồng bộ, retry không deploy trùng |
| Template / build configuration | Registry có Next.js, Express, static SPA; H2 hiện Express không DB | Product đạt parity ba Tier 1; test/build command, root/port/health path; thêm custom Dockerfile theo cam kết. Compose/prebuilt image cần task và gate riêng, không ghi là đã hỗ trợ |
| PostgreSQL / volume / cấu hình | Desktop template/backup/migrate có code | DB credentials, persistent volume, update/recreate không mất dữ liệu; backup/restore drill. Product DB support trước khi nhận parity Express+DB |
| App lifecycle / logs / env | IPC `app:list/get/versions/runtime-inspect/rollback`; chưa có start/stop/restart handler | Contract-first cho runtime log đọc giới hạn, start/stop/restart, env update + redeploy; ownership/confirm/redaction; không lộ secret qua IPC/log/export |
| Public access / firewall / Doctor | Reachability/exposure, OS firewall, Doctor/DNS có code | Không hứa mở được firewall mọi provider. Tự làm khi có quyền, chỉ rõ thao tác panel khi không có API; probe ngoài quyết định reachable. Product publish hiện chưa reconcile toàn bộ |
| Domain / HTTPS | Caddy ingress installer/reconcile/CAS, domain IPC/UI có code/lab | Domain thật: DNS → ACME staging → cert production → probe HTTPS xác thực; sai DNS/cert/route có retry/rollback, renewal được kiểm thử |
| Migrate | `migrate/` backup/transfer/restore/verify/cancel và UI có code | Hai VPS: PostgreSQL + volume/env + Git provenance; checksum/row count/URL; ngắt giữa transfer/restore, cancel, target fail; giữ nguồn đến xác nhận |
| Monitor / ML train / inference | Collector, byte offsets/activation, poller, FastAPI/sklearn, HTTP smoke và SQLite có evidence | Metric/score/alert thật sau deploy/redeploy/rollback; restart không mất attribution; ML down vẫn rule monitor; model/status dễ hiểu trên UI |
| ML auto rollback | Setting/trusted method/consecutive/cooldown có sẵn | Chưa thấy MonitorService gọi runtime rollback tự động. Nối policy → ownership/lock → rollback → health verify → audit; chặn lặp, alert cũ và stale deployment |
| Thí nghiệm và đánh giá ML | Harness, attempts, fault scheduler, export/analyze và tests | Pilot 75 phút rồi 5 kịch bản × 10 run theo protocol; raw data/labels/model/export/checksum; precision/recall/F1/delay và thống kê hợp lệ. 150 normal train + 30 inference không thay pilot |
| UI và trạng thái chức năng | Redesign accepted; native window và component/layout evidence lịch sử | Kiểm lại bản tích hợp: loading/error/empty/stale/cancel; trạng thái deployment ≠ runtime ≠ public URL; DB tab hiện chưa có backend thì phải ghi chưa hỗ trợ |
| Bản cài và ML runtime | `electron-builder.yml`, `mlClient.ts` tìm `.venv/Scripts/python.exe` | Chưa có bằng chứng máy sạch: venv copy không mặc nhiên portable; đóng gói Python/ML runtime thực, native SQLite đúng ABI, đường dẫn có dấu/khoảng trắng, uninstall và child-process cleanup |
| Release / CI / dữ liệu | Typecheck/build/test local có evidence; chưa có CI workflow kiểm bản cài | Pipeline Windows/Linux, dependency lock, migration từ DB cũ, backup trước upgrade, log rotation/dung lượng, secret/package scan, restore quản trị và soak |
| Báo cáo / demo / tài liệu | FR/UC và task board còn các dấu trạng thái lịch sử | Mapping yêu cầu → phiên bản → evidence; hướng dẫn cài/vận hành/sự cố; slide/results thật, demo ngắn lặp lại được |

### Baseline kiểm chứng — không phải gate của release 04/12

Hồ sơ [tích hợp PR #33/#34](tk-s7-pr33-pr34-integration-2026-11-05.md) ghi: Vitest **1397 pass, 2 skipped**, Python **365 pass**, typecheck/build pass; ESLint **0 errors, 5999 warnings**. Docker L0 **10/10**, H2 controlled target **23/23** (Docker operations mô phỏng), exact-container Docker health **5/5**. Chưa có full H2 SSH+Docker+collector E2E. Code mới phải chạy lại gate bị ảnh hưởng; không ghi lại các số này như kết quả hiện tại.

## 2. Task triển khai và dependency

P0 = chặn luồng sản phẩm hoặc nghiệm thu đồ án; P1 = bắt buộc để đạt phạm vi release đã nêu; P2 = mở rộng sau release nếu chưa được cam kết. Trạng thái trong bảng là trạng thái **release acceptance**, không phủ nhận code đã có.

| ID | Ưu tiên / trạng thái đầu | Owner đề xuất | Deliverable / gate nhận xong | Phụ thuộc |
|---|---|---|---|---|
| R0 | P0 / CHỜ REVIEW | Sơn core | Local gate PASS: Desktop không promote/abort Product prepared; regression ownership ban đầu, chuyển chủ trong await, đổi mode rồi đổi lại, legacy Desktop vẫn hoạt động. Chưa merge main | Không |
| R1 | P0 / CHỜ REVIEW | Sơn core | [Local integration gate PASS](tk-s7-release-r1-runtime-lab.md): 7 real cases + 4 restore-failure profile; SHA/SQLite/SSH/Docker/collector/B0/R0 và cleanup. Chưa thay R2/VPS/installer gate | R0 |
| R2 | P0 / CHỜ REVIEW | Sơn core | [Local crash gate PASS](tk-s7-release-r2-recovery-lab.md): 9/9 before/after seal/T1/ACK/idle/T2/expiry/pin/fence, cold SQLite, không restart/recreate app hoặc collector; installed service restart/soak tiếp ở R3 | R1 |
| R3 | P0 / ĐANG LÀM, còn installer/rotation/live | Sơn core | Bootstrap/recovery/publicGit/systemd/auth/read-write API/Desktop vault/actions và6g1–6g3d project/source/target/readiness/firstdeployGUI đã nối. [6g4](tk-s7-release-r3c6g4-target-credentials.md) thêm selectlocalVPS/review/consent/main-only decrypt/atomic controller receipt; native34/Electron80/probe18/fresh028 đạt, fullgate theohồsơ. Code tiếp: installer/setup controller và rotation/rebinding; gates tiếp: non-root install/live rollout/soak. Chưa cần user test thay code còn thiếu | R1, R2 |
| R4 | P0 / OPEN | Kim ML | Hạ tầng độc lập đúng protocol, preflight clock/disk/SSH/endpoint; counter loadgen thật đi vào collector (nguồn `loadgen`, không lẫn fallback probe); pilot đủ 75 phút, raw/labels/export; review chất lượng trước batch | VPS phù hợp; độc lập R1 |
| R5 | P0 / OPEN | Kim ML | 50 run hợp lệ, completed/aborted tách rõ, model metadata, reproducible analysis/CI/thống kê theo protocol; công bố cả kết quả không thuận lợi | R4 |
| R6 | P0 / OPEN | Sơn core + Kim xác minh | Nối ML rollback với policy/cooldown/ownership/audit; live fault rồi phục hồi, restart/alert cũ/no-loop/missing-score cases | R1, R2; R4 dữ liệu/policy |
| R7 | P1 / OPEN | Sơn template | Local/Git × 3 Tier 1; Product parity, PostgreSQL/volume/env và source checks; custom Dockerfile qua detector/plan/health chuẩn, không lệnh tùy ý từ renderer | R1, R2; R3 cho auto paths |
| R8a | P1 / OPEN | Worker operations, Sơn review | Đối chiếu contract hiện có rồi triển khai runtime logs/start/stop/restart/env lifecycle; không lộ secret, current-version/ownership checks, UI/error/retry trọn vòng | R2; khóa contract trước code |
| R8b | P1 / OPEN | Worker DB, Sơn review | Backend các `db:*` đã khai báo: databases/users/tables/schema/import/export/query, phạm vi PostgreSQL do tool quản lý; quyền/confirm/parameterization/bounded query, không coi `hasHandler=false` là tính năng hoàn tất. Schema mutation/restore cần backup và drill bảo toàn dữ liệu | R7 DB, R10 backup/restore; tách file R8a |
| R9 | P1 / OPEN | Kim ingress sau pilot setup | HTTPS live và renewal/route failure/rollback; public probe/firewall evidence, Product publish dùng đúng kết quả | Domain/VPS; R1 cho Product |
| R10 | P1 / OPEN | Sơn migrate | Migrate + backup/restore hai VPS, DB/volume/config/Git provenance; source bảo toàn, cancel/failure drill, UI verification | Hai VPS; R7 DB parity |
| R11 | P0 / OPEN | Kim delivery, lịch xen R5 | Installer máy sạch + portable ML runtime + SQLite ABI; first launch/upgrade/restart/uninstall, không cần Node/dev venv | Bắt đầu ngay; chốt lại sau runtime |
| R12 | P1 / OPEN | Worker QA, Kim điều phối | CI Windows/Linux, migration fixtures, package/secret checks, resource limits và disk/log retention, soak 24–48h không leak/duplicate jobs | Bắt đầu config ngay; R3 cho soak |
| R13 | P1 / OPEN | Kim UI/delivery | Màn hình gắn đủ luồng mới, trạng thái trung thực, native interaction/accessibility/keyboard; không action chết, overflow hoặc secret trong screenshot | Contract của R3/R8/R9/R10 |
| R14 | P0 / OPEN | Cả hai | Release candidate, đối soát FR/UC/NFR, báo cáo/thống kê, slide/runbook và 3 lần demo có đo giờ | R1–R13 và các ngoại lệ được công bố |

Không đánh dấu R1–R14 DONE bằng unit test đơn thuần. Một lỗi thực tế phát hiện khi chạy gate phải có reproduction, scope fix và regression; không sinh checkpoint tinh chỉnh vô hạn chỉ để thay câu chữ.

## 3. Chia việc để làm song song

**Sơn / core:** R0 → R1 → R2 → R3; sau đó R6/R7/R10 theo điểm nối đã khóa. Giữ quyền sửa chung `controlPlane/**`, `db/product*`, ownership, queue và runtime. Không giao hai Worker cùng sửa pipeline/IPC/schema.

**Kim / ML và delivery:** R4 trước; sau khi pilot được duyệt thì chạy R5 trên VPS riêng. Trong lúc run ổn định, làm R11, chuẩn bị test cases R9/R13 và báo cáo. Không đồng thời thử deploy/migrate trên VPS đang thu dữ liệu, không đổi model/protocol giữa batch. Phân công này là đề xuất release, chưa có bằng chứng Kim đã nhận task trong phiên này.

**Worker bổ sung nếu có:** nhận R8 hoặc R12 trên branch/worktree riêng, phạm vi file rõ. Sơn khóa contract IPC/schema trước; Worker không tự đổi queue/runtime. Có thể viết harness/fixtures và kiểm bản cài song song ngay; chưa giả định đang có Worker chạy. Nếu chỉ hai người thì R8/R12 do Sơn/Kim làm xen kẽ, không coi là nhân lực thứ ba miễn phí.

Mỗi task: branch riêng từ main đã tích hợp, hồ sơ START + requirement ledger, local commit và evidence commands/artifacts. Owner review SHA rồi mới tích hợp; giữ các run đã bắt đầu tách khỏi source đang sửa. Co-author theo người đóng góp; khi có Kim: `Co-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>`.

### Gói giao việc đầu tiên

1. **Core R1:** gọi pipeline thật bằng CLI trên scratch SQLite, pinned SSH tới Docker lab và collector thật; không dùng production DB/VPS. Dùng Express không DB trước để chứng minh H2; đây không phải nghiệm thu R7. Lưu nonce, image/CID/SHA, DB state, B0/R0, exit/result và cleanup ownership. Test fail chỉ ra phase; không bật executor mặc định. Sau happy path phải hoàn tất failure matrix rồi R2, không viết UI để che runtime thiếu.
2. **Kim R4:** đọc protocol và preflight hiện hành, đo hạ tầng thực; thiếu đầu vào thì ghi blocker cụ thể. Chỉ chạy fault trên tài nguyên dành riêng. Giữ raw, DB snapshot, meta/config/version/seed và checksum; review một pilot trước 50 run. Không sửa threshold để làm đẹp số liệu.
3. **Delivery R11:** thử installer trên máy không có repo/Node/Python dev; chứng minh Python thực chạy độc lập, train/inference/persist/restart, native SQLite đúng Electron ABI; ghi thiếu dependency/path/crash. Không gửi bản installer chứa `.venv`/credential của máy dev như bản production đã kiểm chứng.

## 4. Lịch tới 04/12/2026

| Khoảng thời gian | Core | ML / delivery | Cổng cuối kỳ |
|---|---|---|---|
| 06–11/11 | R0–R2 runtime + recovery lab; mở R3 khi gate đạt | Preflight/pilot R4, khảo sát máy sạch R11, chuẩn bị domain/VPS migrate | Một pipeline thật có success/failure/recovery; pilot hợp lệ hoặc blocker có phương án xử lý |
| 12–18/11 | R3 always-on; R6 policy; bắt đầu R7 | R5 batch đầu/soát dữ liệu, HTTPS R9, đóng gói ML runtime | Push khi tắt desktop; HTTPS thật; dữ liệu thật đang tích lũy và backup |
| 19–25/11 | R7 parity/DB/custom Dockerfile, R8 lifecycle, R10 migrate drill | Hoàn tất batch/analysis R5, kiểm UI R13, máy partner/installer R11 | Ma trận chức năng có evidence; migrate/ML rollback live; không còn chức năng trình diễn dang dở |
| 26–29/11 | Sửa lỗi từ integration, R12 soak, chốt RC | Re-test máy sạch, kết quả ML, hướng dẫn/slide/dataset mẫu | RC có backup/restore/upgrade evidence; rà security/secret, lỗi nghiêm trọng = chưa đạt |
| 30/11 | **Feature freeze**; chỉ sửa lỗi có regression | Chốt báo cáo/slide/kịch bản | Không thêm tính năng mới làm mất ổn định release |
| 01–03/12 | Sửa blocker release, giữ bản RC đã kiểm | R14: 3 lần diễn tập, 7–10 phút/lần; dự phòng video/log/URL | Cùng build/version dùng khi nộp; backup cấu hình/data và nguồn demo |
| 04/12 | Bàn giao source + installer + runbook | Báo cáo/demo/evidence | Nêu đúng tính năng đạt, giới hạn và phần cần phát triển |

Lịch là mục tiêu điều phối, **không phải cam kết mọi gate tự động pass đúng ngày**. Sau mỗi cổng cập nhật task còn lại và thời gian thực. Nếu R1/R2 hoặc pilot chậm hơn 11/11, phải điều chỉnh nhân lực/thứ tự ngay; không để tới 03/12 mới phát hiện thiếu luồng chính. Preview deployments, multi-user/team billing, Kubernetes/multi-region và auto-update không chặn release này; Compose/image/private Git chỉ giới thiệu khi có task/gate thật. Điều kiện Tier 2 Flask trong CLAUDE vẫn còn hiệu lực.

## 5. Hạ tầng và chi phí thời gian cần khóa sớm

- Một môi trường Product/deploy phát triển; **hai VPS thí nghiệm cùng provider/gói/region theo mục 2 protocol**, đủ disk (preflight mục tiêu ≥40 GB), clock/endpoint và không chạy workload khác gây nhiễu. Không tự hạ protocol thành một VPS; nếu nguồn lực thiếu, cần chốt sửa thiết kế thí nghiệm trước batch và ghi lý do. Hai VPS có thể dành cho migrate sau khi batch kết thúc, không cùng lúc.
- Một hostname có quyền DNS cho ACME/HTTPS; quyền provider/firewall nếu muốn tự reconcile cloud firewall. Không dùng host key lấy qua kết nối chưa xác minh để tự tin cậy.
- Máy Windows partner để cài sạch và thử Electron/ML; Docker Linux cho lab, không dùng mock thay Docker gate.
- **50 × 75 phút = 62,5 giờ chạy thuần**; cần thêm thời gian preflight, pilot, retries và phân tích. Chạy dữ liệu sớm song song code, không đợi tuần cuối. ML hiện dùng CPU/scikit-learn, không bắt buộc Colab hay GPU.
- Trong phiên này đang chờ user xác nhận VPS riêng, VPS migrate và domain; chưa có câu trả lời thì live gates OPEN/BLOCKED theo task, vẫn làm local/lab/installer độc lập.

### Mapping phạm vi gốc để không bỏ sót

| Yêu cầu gốc | Task nghiệm thu release |
|---|---|
| FR-A1…A3 / UC-01 | R7 preflight/onboarding và R13 reconnect/discovery; đưa vào R14 live matrix |
| FR-B1…B8 / UC-02…04 | R1–R3, R7 template/source/build/precheck/env/log/history; R8a runtime operations |
| FR-C1…C5 / UC-05 | R10 prepare/backup/transfer/restore/verify/cancel + rollback |
| FR-D1…D5 / UC-06/08 | R4/R5/R6 collector→sample→5 scores→alert/label, cấu hình và UI R13 |
| FR-E1…E3 / UC-07/09 | R1/R2 manual/health rollback, R6 ML rollback và action log, R13 lịch sử |
| NFR-1/NFR-2 | R2/R3 authority/security: Desktop giữ quy tắc cũ; Product dùng ngoại lệ ADR-011, credential bảo vệ tại controller, không giả nhận credential chỉ ở laptop |
| NFR-3…NFR-8 / tiêu chí đồ án | R11 installer, R12 resource/interval/CI/soak, R14 đo thời gian/tỷ lệ thành công/downtime/khả năng thêm detector; R5 đủ số lần lặp và CI thống kê; Tier 2 vẫn theo điều kiện đã chốt |
| Cam kết sản phẩm bổ sung | R3 auto Git, R7 Dockerfile, R8a/b app/DB operations, R9 HTTPS, R10 backup/restore, R14 runbook/release |

Những mục lịch sử mô tả chưa mount counter hoặc chưa có nguồn Git cần đối soát source trước khi sửa: template hiện có `LOADGEN_COUNTER_PATH`; điều còn phải chứng minh là counter được ghi/đọc đúng khi chạy thật. Không sửa lại phần đã hoạt động chỉ vì câu chữ cũ chưa cập nhật.

## 6. Release acceptance và demo

Release chỉ gọi PRODUCT_PASS khi có **code + test phù hợp + integration + live + native/installer evidence** cho các luồng được cam kết. Mỗi evidence chứa version/SHA, môi trường, thời gian, bước tái hiện, kết quả và giới hạn; secret không nằm trong artifact. Không mở chức năng chưa backend rồi để người demo bấm vào trạng thái giả.

- Kiểm đầy đủ local/Git × ba template; tối thiểu số lần chạy theo NFR gốc (ba stack ≥5 lần/stack), đo thời gian deploy bằng cấu hình/nguồn cố định. Báo cả cache/no-cache, cấu hình VPS, số app đang chạy; không lấy build cached đại diện mọi repo.
- Update lỗi giữ hoặc phục hồi đúng phiên bản trước; runtime/collector/DB/metric ownership khớp; mất kết nối không báo thành công giả. Auto deploy chạy khi desktop đóng, reconnect/restart không tạo job hoặc side effect trùng.
- Onboarding, discovery/reconnect, public probe/HTTPS, app lifecycle/env/logs, migrate/backup/restore, monitor/Doctor/ML/rollback đều có success và failure case. Model chưa train hoặc ML down phải hiển thị trung thực.
- Upgrade migration trên DB fixture cũ, sao lưu/restore, SQLite integrity; không dùng DB sản xuất để thử migration. Soak quan sát CPU/RAM/disk/process/SSH/queue và log rotation; pin/secret/redaction tests trước release.
- Demo chính **7–10 phút**: (1) tổng quan kiến trúc/trạng thái; (2) deploy nhỏ từ local, mở URL; (3) Git push và phiên bản/SHA mới (controller tự chạy); (4) log/monitor + rollback; (5) HTTPS/migrate và ML bằng môi trường đã chuẩn bị, raw data và kết quả đã chạy. Không train 30 phút hay chạy 75 phút thí nghiệm trên sân khấu.
- Chuẩn bị sẵn VPS, dependencies/base images, repo nhỏ, domain và dữ liệu; trình bày rõ phần chuẩn bị. Video/run logs làm dự phòng mất mạng, không trình bày video như thao tác live. Ba lần diễn tập đo thời gian trên chính bản RC; chức năng phụ chuyển phần hỏi đáp.

## 7. Nhật ký triển khai

- 05/11 START: tạo branch audit từ `b2cd50a`; đồng bộ hạn mới trong CLAUDE/timeline/roadmap/board. Đọc lại source/evidence, không truy cập VPS.
- 06/11 UPDATE: lập ma trận release, dependency R0–R14, ba luồng và lịch freeze; triển khai regression R0 trước khi sửa runtime. Kết quả kiểm chứng sẽ ghi dưới đây sau khi chạy.

### R0 — implementation và gate

- `MonitorService.reconcilePrepared` bỏ qua app Product hoặc activation/deployment đã gắn `product_runtime_execution`, kể cả mode hiện về Desktop. Kiểm lại sau mỗi SSH await; so sánh ownership generation để chặn đổi sang Product rồi quay lại Desktop trong lúc đọc.
- Sau metric snapshot, dùng SQLite transaction `IMMEDIATE` cho kiểm ownership cuối cùng và activate/abort/audit. Không có khoảng chờ async giữa kiểm chủ và mutation; `withAppLock` vẫn giữ. Không thay IPC/schema/contract hay bật executor.
- Trước fix, sau khi sửa fixture cho đúng schema hiện hành: **5 case đều FAIL** do prepared bị chuyển thành active. Sau fix mở rộng thành **7 regression**: Product ngay từ đầu, claim theo activation, claim theo deployment chưa bind activation, đổi chủ sau runtime inspect, đổi chủ sau snapshot, chặn abort về previous runtime, mode round-trip. Thêm một case Desktop schema không có bảng Product; giữ các test Desktop/atomic pointer/lineage cũ.
- Một lỗi fixture ban đầu (INSERT thiếu danh sách cột và thiếu FK leases) đã sửa trước khi xác nhận reproduction; không coi lỗi fixture là evidence lỗi runtime.

| Gate | Lệnh từ repo root, sau khi `. ./tools/enter-node22.ps1` | Kết quả |
|---|---|---|
| Focused runtime/monitor | `pnpm --prefix app exec vitest run src/main/monitor src/main/db/productRuntimeRepository.test.ts src/main/controlPlane/productRuntimePipeline.test.ts --maxWorkers=4 --reporter=dot` | **135/135 PASS, 12 files**, gồm 30 test service |
| Typecheck Node + Web | `pnpm --prefix app typecheck` | PASS; cũng chạy trong build |
| Scripts | `pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json` | PASS |
| Scoped ESLint | `pnpm --prefix app exec eslint src/main/monitor/service.ts src/main/monitor/service.test.ts --max-warnings=0` | PASS, 0 errors/warnings |
| Production build | `pnpm --prefix app build` | PASS, main/preload/renderer built; không phải installer/native GUI gate |
| Whitespace / docs | `git diff --check`, `git diff --cached --check`; kiểm link tương đối trong hồ sơ | PASS; 0 missing links, UTF-8 hợp lệ |

**Giới hạn:** R0 là sửa an toàn reconciliation và kế hoạch release, không hoàn thành R1–R14. Chưa chạy lại full 1397-test baseline hoặc Python suite vì không sửa Python/ML/public contract; focused runtime/monitor phù hợp phạm vi. Không truy cập VPS/production DB, không tạo dữ liệu thí nghiệm hay nhận live PASS. Không có accepted exception. Bước tiếp theo đã khóa: R1 full H2 integration CLI thật, đồng thời R4 preflight/pilot và R11 máy sạch khi owner nhận task.

HANDOFF-LOCAL 06/11: audit và R0 đủ local gate, CHỜ REVIEW trên `feat/release-audit-20261204`. Commit chứa mục này là implementation; lấy SHA bằng `git log -1 -- app/src/main/monitor/service.ts`. Chỉ stage 10 file của task; giữ nguyên công cụ/tài liệu cá nhân untracked. Không push/PR/merge. Release tổng thể vẫn PARTIAL, task tiếp theo R1.
