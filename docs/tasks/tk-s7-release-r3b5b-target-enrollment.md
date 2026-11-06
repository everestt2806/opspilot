# R3b-5b — Protected target installation and app enrollment

START 06/11/2026 — User yêu cầu tiếp tục, base `d150b40`, product-mode theo CLAUDE/ADR-011/task-discipline. Không public API/push/PR/merge/VPS người dùng; additive internal protocol + migration trước runtime.

| Yêu cầu | Implementation / gate | State |
|---|---|---|
| Exact paused Product ownership/target binding, durable SQLite enrollment và encrypted key material | Migration021, schema sync và upgrade/rollback tests; repository8/8, no source/ownership promotion | PASS |
| Protected first installation không dùng lab initializers | Production installer riêng, Linux11/11 filesystem/crash/concurrency; atomic rename-noreplace + private files | PASS |
| Strict pinned SSH/stdin và receipt verification; loss response chỉ inspect | SSH/validation9/9, repository HMAC/binding/revision tests; controller process exit73 rồi independent CLI inspect, file inode/mtime/hash giữ nguyên | PASS |
| Independent CLI/negative gates và real runtime qua production enrollment | Final7/7 `92568c6de8b7`,2apps, actual controller process death + new CLI inspect, installed helpers/packaged assets/cleanup PASS | PASS |
| Regression/handoff | Full1519 PASS/2 SKIP, Python365/365 + Linux11/11, types/scripts/lint/build, bundle14/14/fresh install/VPS CLI14/14, explicit stage/link checks | PASS |

## Phạm vi và quyết định

- Cài lần đầu cho app đã cấu hình Product-owned và paused, không chuyển Desktop mode, bật policy hoặc tạo source config. Activation/ownership transfer/API riêng ở R3c.
- Installer Python production riêng, không import/call fixture initializer. Runtime helpers hiện hành giữ nguyên protocol; Python invocation dùng -B để không sinh bytecode trong helper release.
- Target layout: private base từ trusted admin config, final directory theo controller hash/app ID; helper/state/marker/key/receipt publish cùng nhau, không adopt path hiện hữu. Generation/release khác conflict, chưa tự upgrade/rotate.
- SQLite là authority; key record chỉ material. Unknown sau dispatch không rearm/reinstall khi remote absent; operator reconciliation nếu không có positive proof. Có proof hợp lệ thì kiểm lại current SQLite authority rồi mới commit enrolled.
- CLI độc lập trước UI/service composition. Giữ service polling-only; local Linux lab không phải nghiệm thu VPS người dùng.

## Nhật ký

- START 06/11: chốt contract, local state machine, atomic target layout và strict-pinned stdin transport. Bắt đầu migration/protocol trước runtime.
- UPDATE 06/11: triển khai migration021/schema/index, production Python installer độc lập fixture, SQLite repository, HMAC proof, coordinator/ready getter và CLI `enroll-target`. SSH dùng verified principal + code SHA256/stdin, không logger/reconnect command; runtime invocation thêm `-B` để giữ helper directory không có bytecode ngoài manifest. Bundle hiện12payload files (4 Python: 3 runtime + bootstrap).
- UPDATE 06/11: Linux filesystem11/11 PASS gồm absent không tạo dir, replay không sửa file, foreign/partial/tamper/link/mode/owner, crash stage, sau rename mất reply, hai process và compatibility runtime guard. Focused repo8/8 + SSH/input9/9; DB/SSH focused45/45 trước khi thêm5 input-root boundary tests. Ruff0/0; nguồn kiểm thử subprocess đã close stdout/stderr, không còn ResourceWarning.
- UPDATE 06/11: discovery lab lỗi permission fixture (DB file phải0600) đã sửa fixture riêng; sáu runtime cases qua, ca collector failure ban đầu bị fixture thay nhầm bằng packaged collector. Sửa đúng fault override chỉ ca cuối, không sửa subject hoặc fake outcome. Preliminary actual CLI/runtime7/7 `7bd189c31034`, linked R1 `11e45df236a3`, cleanup=true; có process exit thật sau target response trước SQLite proof, independent CLI inspect không đổi inode/mtime/hash của7files.
- UPDATE 06/11: full app đầu1510 PASS/4 FAIL/2 SKIP do migration tests cũ còn expected20 và downgrade helper chưa xóa21. Cập nhật latest21/table30, drop fixture21 trước legacy downgrade, thêm cumulative schema sync021 + empty enrollment on legacy upgrade; focused migration7/7 PASS, pre-final full1514 PASS/2 SKIP. Không bỏ assertions/FK, không nhận gate lỗi là pass.
- UPDATE 06/11: thêm input guard tương thích helper path (`..`, empty/control/oversized segment/path),9/9 targeted PASS; final compiled bundle manifest `1df62ec14afbf041e61d6ac078f7d03e5b54b7d830583b51afaaabb0f92f202d`,12files. Python full **365/365 PASS**, Linux bootstrap11/11, bundle14/14 `20679ef3b142`, fresh Linux install/migration021/init/status/verify PASS. Final full app/build/runtime matrix đang đợi.
- UPDATE 06/11: final runtime **7/7 PASS** `92568c6de8b7`, linked R1 `527bbb8924b3`,2enrolled apps,6verified terminal outcomes +1collector-build-unknown không retry, process-loss reconciliation=true, cleanup/source_unchanged=true. Full app cuối **1519 PASS/2 SKIP/0 FAIL**, Node/Web/scripts/lab types, scoped ESLint0/0, Ruff lint/format và build PASS. VPS credential CLI regression `ff85f9b0f7d8`14/14; fresh native install có migration021 và bundle12files PASS.

## Gates và raw evidence

Windows Node22.23.3 sau `tools/enter-node22.ps1`; Linux/WSL Node22.23.4, Python3.12.3. Lệnh từ root:

```text
pnpm --prefix app exec vitest run src/main/controlPlane/targetEnrollment.test.ts src/main/controlPlane/targetEnrollmentSsh.test.ts src/main/db/index.test.ts src/main/db/productMigration.test.ts src/main/ssh/ssh.test.ts --reporter=dot
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3b5b-vitest-final.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec electron-vite build
python -m pytest experiments collector/tests ml-service/tests -p no:cacheprovider -q
python -m ruff check app/src/main/controlPlane/target_enrollment.py app/scripts/product-runtime-lab/test_target_enrollment.py
python -m ruff format --check app/src/main/controlPlane/target_enrollment.py app/scripts/product-runtime-lab/test_target_enrollment.py
Linux: python3 -B -W error::ResourceWarning -m unittest discover -s app/scripts/product-runtime-lab -p test_target_enrollment.py
Linux: OPSPILOT_R1_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b-lab.cjs node app/scripts/product-runtime-lab/build.mjs
Linux: OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3a-runtime/r3b5b/control-plane.cjs node app/scripts/build-control-plane.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b/control-plane.cjs node app/scripts/product-runtime-lab/target-enrollment-runtime.mjs
Linux: OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules node app/scripts/product-runtime-lab/controller-bundle.mjs
Linux: node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b/control-plane.cjs node app/scripts/product-runtime-lab/controller-enrollment.mjs
git diff --check
git diff --cached --check
```

- Windows `python` trong gate là `ml-service/.venv/Scripts/python.exe`; Linux dùng `python3` như trên. Scoped ESLint `--max-warnings=0` chạy tất cả TS/tests/scripts thay đổi (controlPlane targetEnrollment*, controllerBundle*, cli, db index/productMigration, ssh manager và lab scripts), contract/JSON kiểm Prettier.
- Raw (không stage): `app/.out-scripts/release-r3b5b-vitest-final.json`; `app/.out-scripts/target-enrollment-runtime/92568c6de8b7/{result,enrollment}.json`; linked `app/.out-scripts/product-runtime-lab/527bbb8924b3/` gồm report/SQLite/metric; bundle `20679ef3b142`, VPS CLI `ff85f9b0f7d8`. Python full365pass/77.58s và native11pass/fresh install summary trong stdout phiên.
- Release manifest SHA256 `1df62ec14afbf041e61d6ac078f7d03e5b54b7d830583b51afaaabb0f92f202d`; CLI payload SHA256 `cf36185a33c69202dfe1bf672c946741a4f110d82322e5aa068e7523a3ce783f`; runtime lab bundle SHA256 `69a285335828c1be1a192affeef05675ddd631c255ad8e36cd712ed1a605b1a4`. Base SHA chỉ baseline, không gọi là toàn bộ source mới.

## Ranh giới nghiệm thu

- R1 setup ban đầu còn tạo fixture marker ở path cũ nhưng gate mới dùng **installed production paths** từ signed proof và encrypted per-app key store. Installer production không gọi/import fixture initializer. CLI loss child là process exit thật73 sau target response, trước SQLite proof; chưa phải systemd/host power-loss gate.
- Sáu ca thường dùng packaged collector/templates; ca7 dùng đúng broken-collector fixture để inject lỗi Docker build thật. Verified local Git snapshot, không nhận public Git fetch hoặc Git push khi Desktop đóng. Không fake command/receipt/outcome.
- Pending/known calls chỉ inspect. Absent/partial/tamper sau unknown không auto-clear/reinstall; release/generation/target change không auto-upgrade. CLI reconciliation hiện yêu cầu paused/quiescent app; startup recovery với pending runtime cần phối hợp riêng ở R3b-6.
- Local enrollment chưa tự chuyển Desktop ownership, tạo Product source, enable auto-deploy, compose service hay expose public API. Service vẫn polling-only. Admission/cold startup/process restart và Desktop authority/API/UI còn tiếp, không nhận whole R3 DONE từ gate này.
- Không VPS/DB người dùng, domain/HTTPS/ML experiment/installer acceptance. Hai skips là Linux-Caddy trên Windows, jsdom canvas/pseudo-style warnings giữ baseline; không nhận GUI/live gate PASS. Không dependency mới; có additive schema021/internal contract. Review request/ledger/final diff, scoped staged files, links/secrets/diff trước commit.

HANDOFF-LOCAL 06/11 — R3b-5b **CHỜ REVIEW**, SHA `git log -1 -- app/src/main/controlPlane/targetEnrollment.ts`. Base `d150b40`. Tiếp **R3b-6**: resource admission và cold startup recovery (phân biệt enrollment unknown, pending H2 T1, pre-T1 unknown; exact historical key/profile/fence; không replay), rồi service opt-in/Git actual push/OS restart và Desktop API/UI authority (R3c). Giữ app paused đến khi activation gate đủ. Không push/PR/merge hoặc production write; không lặp bundle/key/enrollment work.

No accepted exception. R3 tổng PARTIAL; live endpoint/pin/domain vẫn thiếu.
