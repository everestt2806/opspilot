# H2 — Checkpoint runtime Product

- Owner triển khai: Kim; review, kiểm thử và hardening: Codex.
- Nhánh: `feat/product-h2-checkpoint`; PR đích `main`. Code H2 phát triển từ nền L0/H1 của PR #33; partner merge #33 trước, #34 sau.
- PR: [#34](https://github.com/everestt2806/opspilot/pull/34), mở review bình thường; code checkpoint `d8e7e40d7a8af29da44360974c3a0e895c64eb76`.
- Trạng thái: **CHỜ REVIEW, PARTIAL**. Đây là checkpoint để review code, chưa nghiệm thu toàn bộ H2 và chưa bật executor production.
- Phạm vi: Express không DB, cùng guarded SSH session/target lock; không thay UI/IPC hoặc các framework khác.

## Output đã có

| Phần | Implementation / hành vi |
|---|---|
| Policy | `productOutcomePolicy.ts`, CLI `try-product-outcome-policy.ts`: kiểm evidence/outcome và giới hạn recovery |
| C0 | `ProductRuntimeRepository.beginActivationBarrier/bindActivationBoundary`, migration 020: prepared activation trước mutation, bind B0; poller kiểm lại epoch/barrier sau await và trong writer transaction |
| Runtime | `productRuntimePipeline.ts`, `target_product_runtime.py`, guarded session/helper: prepare/activate/health/rollback/publish trên cùng session; pin runtime identity, exact-CID health, B0/R0 quarantine |
| Finalization | Receipt HMAC + atomic fsync, T1 atomic CAS giữ leases, commit attestation, ACK durable trước idle, T2 release exact leases/fences; recovery chỉ read/settle |
| Hardening | Re-probe app/collector trước seal; memory receipt chỉ publish sau durable write; mutation sau seal bị chặn; metric path/generation khớp monitor, giữ file metric 0644 hợp lệ |
| Packaging / QA | Đóng gói đủ 3 Python helpers; CLI Linux controlled, proof/auth vectors và Docker exact-CID health lab có source tái hiện |

Contract: `docs/contracts/product-h2-runtime.ts`, `product-guarded-ssh-session.ts`, `schema.sql`; quyết định H2 trong `DECISIONS.md`. Migration 020 là migration mới; không sửa migration đã triển khai trước đó.

## Điểm vào cho partner

- `app/src/main/controlPlane/productRuntimePipeline.ts`: luồng chính và settlement recovery.
- `app/src/main/db/productRuntimeRepository.ts`: C0, T1, signer, authority hậu T1 và T2.
- `app/src/main/controlPlane/target_product_runtime.py`: runtime facts, seal, durable ACK/recovery.
- `app/src/main/controlPlane/guardedSshSession.ts`: request/response, timeout, abort, no replay.
- `app/src/main/monitor/poller.ts`: rào attribution khi activation thay đổi trong lúc đọc/chấm điểm.
- `app/scripts/product-h2-review/README.md`: controlled target CLI; `app/scripts/h2-independent/README.md`: proof/auth và handoff gate.

## Kiểm chứng

Node 22, pnpm theo repo và dependencies frozen lockfile trong checkout riêng. SQLite native cho Vitest phải khớp ABI Node; không dùng chung native build/output với checkout Electron khác. Các fixture/key đều là dữ liệu tổng hợp công khai.

Từ root repository:

```powershell
pnpm --prefix app typecheck
pnpm --prefix app exec vitest run src/main/db src/main/controlPlane src/main/git src/main/ssh src/main/monitor --maxWorkers=2
pnpm --prefix app exec vitest run src/renderer --maxWorkers=2
node --test app/scripts/product-docker-lab/runner.test.mjs
node --test app/scripts/h2-independent/tool.check.mjs
node app/scripts/product-h2-review/run.mjs
node app/scripts/review-h2-live-health.mjs
pnpm --prefix app exec electron-vite build
```

| Gate | Kết quả đã kiểm ngày 28/10, sẽ đối chiếu lại trên nhánh PR |
|---|---|
| Backend / renderer | 490/490 và 273/273 PASS; renderer có warning jsdom canvas/getComputedStyle, không phải manual GUI |
| L0 regression / QA self-tests | 12/12 và 13/13 PASS |
| Proof/auth độc lập | 89/89 PASS, chỉ component schema/canonical/hash/HMAC |
| Linux target controlled | 23/23 PASS: guard/flock/files/fsync/HMAC thật, Docker operations là fake stateful; không socket/network |
| Docker health thật | 5/5 PASS: exact CID, wrong image/SHA/config, HTTP200 từ container khác; cleanup đúng resource |
| Typecheck / build / scoped lint / format | PASS; build Electron không thay thế installer/ABI smoke |

Docker CLI controlled dùng cached `python:3.12-slim`. Health lab cần cached `node:22-alpine` và image `opspilot-review-h1-ssh:20261026`. Có thể dựng image lab bằng `docker build -t opspilot-review-h1-ssh:20261026 -f app/scripts/product-h2-review/Dockerfile.health .`. Script không tự khởi động Docker/đổi setup host. Health lab chạy Node HTTP fixture, không phải deploy Express toàn tuyến. Report lab chỉ ghi metadata trong `.out-scripts` ignored.

## Lỗi đã sửa trong checkpoint

| Trigger trước sửa | Hành vi sau sửa / regression |
|---|---|
| App hoặc collector chết/drift sau health nhưng trước seal | Re-probe exact app CID, revalidate collector CID/image/labels/name/config/running; từ chối seal sai |
| Disk failure khi ghi receipt, rồi retry | Không trả memory receipt trước durable write; fault/retry phải có file hợp lệ |
| Target metric path/generation khác monitor | Dùng `/opt/opspilot/<app>/metrics/metrics.jsonl` và `dev:ino`, giữ B0/R0 cùng stream |
| Metric có sẵn 0644 bị coi là private-secret file | Giữ bytes/mode nếu regular/owner/no unsafe writer; private key/receipt vẫn kiểm quyền riêng |
| Gửi activate/configure/authorize sau seal | Adapter reject trước khi gửi mutation frame; settlement/close đi đường riêng |
| Helper import module mới nhưng lab/bundle chỉ có 2 files | Staging lab và extraResources gồm đủ guard/helper/runtime; minimal Linux import 3/3 PASS |

## Chưa đạt để đóng H2

- Runtime CLI gọi pipeline và recovery thật qua pinned SSH, SQLite scratch, Docker/collector thật, cùng một session/lock và một deployment/attempt.
- Ma trận live: healthy V1→V2, build failure giữ V1/collector, unhealthy rollback, first failure, collector/restore failure; attribution B0/R0 bằng bytes thật.
- Crash/disconnect trước/sau seal/T1/ACK/idle/T2, exact expired lease/fence và retry không duplicate; controlled tests hiện có chưa thay thế toàn bộ matrix live.
- Installer/Electron ABI smoke và kiểm chứng trên SHA tích hợp cuối. Controller vẫn polling-only; không dùng VPS/DB production để thay lab.
- Ruff Python còn 38 diagnostics trên 5 files: 13 đã có trong helper H1 ở base PR #33, 25 thuộc phần H2/tests bổ sung. Gồm import/style/type và xử lý exception/cleanup; chưa sửa trong checkpoint này, không đánh dấu Python lint PASS.

Các gate xanh riêng lẻ không đủ nhận full Product deployment. Chỉ chuyển HOÀN THÀNH sau merge và đủ DoD theo `docs/tasks/README.md`.

## Nhật ký

- START 29/10 — Đóng gói checkpoint runtime và hồ sơ bàn giao để partner review, base PR #33.
- UPDATE 29/10 — Giữ production source theo bản đã nghiệm thu; chỉnh đường dẫn công cụ lab/QA để chạy trong cùng checkout, không phụ thuộc tên worktree của máy khác. Chạy lại các gate phù hợp trước commit/push; PR dự kiến draft vì H2 còn PARTIAL.
- UPDATE 29/10 — Trên bản ghép PR: backend 490/490, Node self-tests + L0 25/25, proof/auth 89/89, Linux controlled 23/23 và Docker health 5/5 PASS; typecheck PASS. Linux/Docker cleanup true, Python runtime hash `cc5b4a191d214e17837a20f5f5b0a0e053fc140743d82d43d4322d4edbde1a61`. Renderer 273/273 là bằng chứng 28/10, source UI không đổi. Ruff check chưa PASS như ghi ở mục giới hạn. Kết quả build/scoped ESLint được bổ sung khi chốt handoff.
- HANDOFF-LOCAL 29/10 — Electron build PASS; 29 files TS/MJS được kiểm bằng ESLint, đã chỉnh một warning format trong chữ ký `applyMigrations` (không đổi logic), scoped Prettier PASS và diff check sạch. Tất cả gate nêu trên là checkpoint/component, không phải full-suite/installer/live deployment PASS. Giữ CHỜ REVIEW/PARTIAL và mở draft PR theo phạm vi này.
- REVIEW 29/10 — Đã push checkpoint `d8e7e40` và mở [Draft PR #34](https://github.com/everestt2806/opspilot/pull/34), base PR #33. Hậu kiểm Docker health trên chính code SHA này 5/5 PASS, nonce a9fb9519c25d, cleanup true. Partner review contracts/module boundaries và các gate chưa đạt ở hồ sơ này; chưa merge hoặc chuyển task HOÀN THÀNH.
- UPDATE 29/10 — Theo cách tích hợp của nhóm, cả PR #33 và #34 chuyển đích sang `main`; partner merge lần lượt #33 → #34. Dòng REVIEW phía trên giữ lịch sử lúc mở PR. Trước khi #33 merge, diff #34 có thể chứa cả L0/H1; kiểm lại diff/conflict và các gate trên SHA tích hợp trước merge H2. Chỉ cập nhật metadata/hồ sơ, không đổi code.
- REVIEW 29/10 — PR #34 chuyển từ draft sang ready for review theo quy trình merge của nhóm; cả #33/#34 đang OPEN, base `main`. Giữ nguyên trạng thái task PARTIAL và các gate còn thiếu trong hồ sơ/PR; ready for review không phải xác nhận full H2 đã đạt.
