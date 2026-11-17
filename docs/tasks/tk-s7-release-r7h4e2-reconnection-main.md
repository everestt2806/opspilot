# R7h-4e2 — xác nhận nhận lại dự án trong Main

START 17/11/2026 — Base9954019. User tiếp tục E2; giữ phạm vi core và không sửa
lane Windows của Kim. Dùng task-discipline, CLAUDE.md, DECISIONS và contract E1.
Được commit/normal push checkpoint; không PR/merge/force/reset/stash/clean/rebase.

Giả định phạm vi: review metadata qua installed administrator, consent rõ ràng,
fresh recheck trước commit, journal Desktop riêng có authenticated provenance.
Không tạo registration/selection receipt giả, không tự bật quyền deploy, không
đụng foreign key của intent038 để lách guard. Inspector/IPC/UI và serving rollout
tiếp tục E3/E4. Controller giữ schema37; migration mới chỉ áp dụng Desktop.

| Requirement | Evidence | State |
|---|---|---|
| Contract/schema | DTO/DECISIONS/schema.sql +039 Desktop append-only encrypted context; role tests Desktop39/Controller37 PASS | PASS |
| Main consent/journal | Unit và standalone Main8b5b03e49de5:6checks/PASS/cleanup, real SQLite/cipher/vault với synthetic admin; source2 PG không fake legacy receipts, close/reopen/recompose/idempotency/drift/re-consent/revoke | PASS |
| Trusted transport | Finite installed-only guard + payload IDs/digest; native sameUID Python admin16checks/301360148fd2 và installed Root/Main23checks/3953da9eb784 PASS, private cleanup; chưa serving | PASS |
| Verification | Full186files/2712tests PASS+1file/2existingLinuxSKIP,0FAIL; affected184PASS; Node/Web/Scripts/contract types, scoped lint/format/Ruff/build/diff và exact DDL contract copy PASS | PASS |
| Handoff | Board/task/proof/source hashes đối chiếu PASS; stage đúng37file theo manifest riêng, cached diff check/secret-pattern scan PASS. Commit message có coauthor Kim; SHA tra bằng git log, normal push theo quyền đã cấp là bước bàn giao cuối. Không serving/GUI hoặc toàn tính năng claim từ E2 | PASS |

Gate bắt buộc của E2 gồm cả Main riêng và luồng installed Root/native. Không
đánh dấu E2 đầy đủ từ synthetic transport; E3/E4 có phạm vi nghiệm thu riêng.

UPDATE17/11 — Main039 ghi consent riêng, không đổi bất kỳ FK/receipt của038.
Các test tamper/copy/foreign-purpose, expiry, scope/token/revoke, plaintext/privacy,
idempotency/race/caller transaction đã qua focused gate. Full đầu dừng đúng khi7
test migration cũ còn chốt max38; sửa expectation39 và bỏ migration039 khi dựng
fixture legacy, không bỏ test hoặc gọi lần lỗi là PASS. Seed cho native Root dùng
production registration/PG stores dưới service UID, chỉ target metadata giả trong
lab và PG prepared; không target SSH/runtime/provisioning/Docker claim.

UPDATE17/11 — Affected migration fixtures đã rerun184tests/PASS; scoped ESLint0,
Prettier, scripts/contract typecheck và Python admin Ruff lint/format PASS. Native
lần đầu dừng tại assertion cold-process max38; đổi39. Lần tiếp theo qua14checks
nhưng seed fixture trỏ nhầm runtime/payload/node_modules. Đã đối chiếu layout
release thật, đổi runtime/node_modules; smoke riêng dưới nonroot UID với candidate
runtime thật init/secrets-init/seed source2 PG thành công và đã dọn. Đang rerun
toàn native gate, không bỏ qua failure hoặc dùng smoke thay Root/Main proof.

UPDATE17/11 — Native đã chứng minh positive Main→SSH→Root→UID→CLI cho source2/PG
và consent/idempotency, nhưng lượt sau còn lỗi ADMIN_NOT_READY/rollback. Mã lỗi
Root đã xác định được qua diagnostic chỉ chứa enum: CONTROLLER_INSTALL_UPGRADE_
ADMIN_NOT_READY. Kiểm tra source thấy Git poller vẫn poll app paused; seed dùng
repo giả example/metadata-demo.git làm service degraded sau tick, khiến lần đọc
hoặc rollback bị từ chối tùy thời điểm. Đổi riêng fixture sang repo public thật
everestt2806/opspilot, xác minh refs/heads/main bằng git ls-remote. Thêm gate đợi
branch observation thật, xác nhận0jobs và health ready trước consent; không tăng
timeout/giảm readiness guard của sản phẩm. Main Linux riêng lặp20confirm với
SQLite/cipher/vault thật và synthetic admin PASS/cleanup; không dùng thay native.

UPDATE17/11 — Native cuối cùng3953da9eb784 PASS23checks,301.93s,54SSHexecs,
12authentications, runtime/PID/token/legacy receipts giữ đúng, rollback và refresh
cũng PASS. Fixture root/unit/account đều đã dọn. Branch observation của repo thật
được tạo khi app paused, không job; controller ready. Candidate manifest9878eae5
chỉ là release private, chưa approve catalog/serving. Đang chạy full/build cuối
cùng trên source hiện tại; không chạy song song khi native còn giữ cổng8768.

## Tái hiện

- Node22 Windows: `. ./tools/enter-node22.ps1`.
- Full: `pnpm --prefix app exec vitest run --reporter=dot`; build/typecheck Node+Web:
  `pnpm --prefix app build`.
- Scripts: `pnpm --prefix app exec tsc -p tsconfig.scripts.json --noEmit`.
- Contract: `pnpm --prefix app exec tsc --noEmit --skipLibCheck --target ES2022
  --module ESNext --moduleResolution bundler ../docs/contracts/desktop-project-reconnection.ts`.
- Standalone Main: `node app/scripts/run-as-node.js
  app/scripts/product-project-reconnection-desktop-lab/run.mjs
  --confirm-local-project-reconnection-desktop`.
- Native same-UID admin: selection lab với `OPSPILOT_PROJECT_RECONNECTION_GATE=1`
  và `OPSPILOT_PROJECT_RECONNECTION_ADMIN_GATE=1`, bundle/modules Linux riêng.
- Installed Root/Main: xem README của reconnection Desktop lab; chạy Linux
  systemd/Node22/root, baseline37/candidate+pins độc lập, reconnection gate opt-in.
  Không chạy đồng thời full suite vì cùng cổng8768.
- ESLint/Prettier trên các TS/MJS thay đổi; Ruff check và format check
  `app/src/main/controlPlane/desktop_controller_admin.py`; `git diff --check`.

## Giới hạn và bước kế tiếp

E2 chỉ xác nhận metadata sau reconnect, không cấp runtime/deploy capability và
không dùng journal mới thay registration/selection receipt cũ. `latest` là lịch
sử; mọi lần dùng phải qua `current` kiểm lại remote và authenticated authority.
E3 nối typed IPC/UI và read-only inspector, giữ guard nguồn cũ; E4 duyệt release,
rollout và nghiệm thu GUI thật riêng. Approved catalog/serving/VPS/DB sản phẩm,
lane Kim và formal ML không đổi trong E2.

## HANDOFF-LOCAL 17/11/2026 — PASS trong phạm vi E2, CHỜ REVIEW

- [Proof và source/raw hashes](../ui-redesign/r7h4e2-verification.json).
- Full cuối:186files PASS+1file SKIP;2712tests PASS+2existingLinux-only SKIP,
  0FAIL,385.01s wall. Build gồm Node/Web typecheck PASS,126.03s. Các thông báo
  getComputedStyle/pseudo-elements của jsdom cũng có trong raw baseline E1;
  không phải lỗi test mới, không gọi full suite là không có stderr.
- Native installed Root/Main23checks/3953da9eb784 PASS,301.93s/cleanup, cùng
  runtime/payload9a33e131 của same-UID admin16checks/301360148fd2. Foreign app
  được trả đúng PROJECT_RECONNECTION_AUTHORITY_CHANGED; rollback rolled_back.
- Standalone Main6checks/8b5b03e49de5 PASS/cleanup: SQLite/cipher/vault thật,
  synthetic admin, không chứng minh GUI/DPAPI/OS process restart.
- Raw full/build: `app/.out-scripts/r7h4e2-final-{full,build}.log`; raw native và
  Main nằm ở các thư mục nonce tương ứng trong proof. Release private9878eae5,
  không thêm vào approved catalog; controller serving vẫn là release của D4.
- Các failure fixture trước đã giữ raw riêng và mô tả nguyên nhân ở trên;
  không có exception hay gate fail được tự miễn. Chỉ final PASS dùng nghiệm thu.
- Commit lookup: `git log -1 -- docs/ui-redesign/r7h4e2-verification.json`.
  Co-author: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>. Normal push được user
  cho phép; không PR/merge/force/reset/stash/clean/rebase hoặc stage file cá nhân.

### Files changed

Main journal/service/enrollment, strict installed-admin protocol/Python adapter;
Desktop migration039 + role/downgrade fixtures; reconnection unit/standalone và
same-UID/installed Root labs; contracts/schema/DECISIONS, board và task/proof.
Danh sách source cùng SHA256 chi tiết nằm trong proof; không sửa renderer,
approved release resources, DB sản phẩm hoặc file lane Windows của Kim.

### E3/E4 chưa thực hiện trong E2

- E3 cần typed IPC và UI review/consent; inspector dùng fresh `current()` của
  provenance mới. Không cast source2 thành registration generation1, không tạo
  receipt giả để lách foreign key038. `latest()` chỉ là lịch sử, không live authority.
- E4 cần build/approve release và Root/serving/GUI acceptance riêng. Không dùng
  private Root proof làm bằng chứng đã triển khai lên VPS hay UI đã hoàn tất.
- Formal ML vẫn NOT_RUN; backup/restore/migrate là các task release riêng.
