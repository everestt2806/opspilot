# R3b-6 — Resource admission and cold startup recovery

START 06/11/2026 — User yêu cầu làm tiếp tới hoàn tất và chia checkpoint để push. Base `ff4f836`; user đã cho phép checkpoint pushes, không PR/merge. Đã push checkpoint trước tới `origin/feat/release-audit-20261204` tại `ff4f836`; notices “không push” cũ là lịch sử trước authorization mới. Dùng task-discipline/CLAUDE/ADR-011, không production VPS/DB write.

| Yêu cầu | Implementation / gate | State |
|---|---|---|
| Management resource admission fail closed | Linux MemAvailable/statfs/CPU thật; boundary/malformed/abort/recovery barrier tests | PASS |
| Target read-only admission trước dispatch | 7 real SSH resource probes, Docker/port/current SQLite principal; 2 executor deferral tests không vào pipeline | PASS |
| Read-only enrollment reconciliation độc lập quiescence/install | Management manifest khác historical target manifest; actual helpers/exact key/proof, unpaused/pending T1 inspect không first-install | PASS |
| Cold T1 settle không source fetch/replay, pre-T1 unknown giữ barrier | Independent CLI process + bounded SQL scanner; T1→T2 giữ app/collector CID/image/StartedAt/restarts; pre-T1 unknown giữ lease | PASS |
| Gate, checkpoint và push | 27 focused/full1534 PASS/2 SKIP/Python365/types/lint/build/diff; explicit25files/secret/link checks; commit `8e8d65d` normal push, local=remote | PASS |

## Phạm vi

- Không mặc định bật executor. Admission/recovery là prerequisites cho service composition R3c; hồi phục trước khi worker claim.
- Quản lý/vps workspace resource snapshot, Docker availability và port check không phải giữ chỗ CPU/RAM/port hay bảo đảm mọi partition Docker đủ disk.
- Historical installed release có thể khác management bundle mới; phải kiểm full historical manifest SHA và actual3runtime helper hashes, không giả receipt mới hoặc sửa generation.
- Read-only probe không Docker build/run/stop, không firewall/app/key/marker writes. Startup không tự cài target khi absent/unknown và không dùng fixture initializer.
- Gate thực trong Linux scratch; VPS/live/ML/HTTPS/migrate/installer còn theo release plan, không suy ra DONE từ unit counts.

## Nhật ký

- START 06/11: xác nhận queue đã có admission seam nhưng chưa provider; recovery T1 cũ phụ thuộc snapshot wrapper dù không đọc source. Chốt bounded startup scanner, resource providers và readonly inspection cho historical enrollment.

## Gate và tái hiện

```text
Node22: pnpm --prefix app exec vitest run src/main/controlPlane/controllerStartupRecovery.test.ts src/main/controlPlane/controllerResources.test.ts src/main/controlPlane/targetEnrollment.test.ts src/main/controlPlane/productRuntimeExecutor.test.ts
=> 27/27 PASS
pnpm --prefix app exec vitest run --reporter=json --outputFile=.out-scripts/release-r3b6-vitest-final.json
=> 1534 PASS, 2 Linux Caddy SKIP, 0 FAIL
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
=> Node/Web/scripts/lab PASS
pnpm --prefix app exec eslint <17 changed TS/MJS files> --max-warnings=0 => 0 errors/warnings
pnpm --prefix app exec electron-vite build => PASS
ml-service/.venv/Scripts/python.exe -m pytest experiments/ collector/tests ml-service/tests -p no:cacheprovider -q
=> 365 PASS/100.91s
ml-service/.venv/Scripts/python.exe -m ruff check experiments/ collector/ ml-service/ => clean
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b6-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b/control-plane.cjs OPSPILOT_CONTROLLER_READINESS_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b6/control-plane.cjs node app/scripts/product-runtime-lab/target-enrollment-runtime.mjs
=> 7/7 PASS, nonce72c388ef9626, linked runtime f97947d8453c, cleanup/source_unchanged=true
```

- Management manifest `2fd30ecf338aa9472366ca2d7349d7a1fa0a58d20c8091455e93a6a9dc21f1e1`; historical pin `1df62ec14afbf041e61d6ac078f7d03e5b54b7d830583b51afaaabb0f92f202d`, không re-enroll/upgrade để né mismatch.
- Lab bundle SHA `96089ef4b60c21983fbe6e52324df3aced12d19671fe44af0dfb1345bb82bc05`. Raw không stage: `app/.out-scripts/target-enrollment-runtime/72c388ef9626/{result,enrollment}.json`, `app/.out-scripts/product-runtime-lab/f97947d8453c/`, Vitest JSON trên.
- Fault sau T1 là injected transport/controller loss; recovery dùng **new CLI process** thật, fresh SQLite/retained keys. Không nhận đây là systemd restart hoặc public Git push gate; hai gate đó thuộc R3c. Baseline B5b actual exit73 enrollment regression vẫn chạy.
- UPDATE/HANDOFF-LOCAL 06/11: code `controllerResources`, `controllerTargetProbe/Admission`, `controllerStartupRecovery`; executor admission trước dispatch, cold API chỉ attempt ID; CLI `recover-runtime` stdin approved bundle/pin, phân biệt ready/reconciliation_required/aborted. Không bật worker/tạo key/sửa policy. CHỜ REVIEW; SHA `git log -1 -- app/src/main/controlPlane/controllerStartupRecovery.ts`.
- Baseline jsdom canvas/getComputedStyle warnings/2 Linux-only Caddy skips giữ nguyên, không GUI acceptance. Lỗi fixture pause provenance và test cast/Prettier đã sửa; final checks PASS.

No accepted exception. Push checkpoint được user cho phép từ phiên này; không force push/PR/merge. Default run vẫn polling-only; service composition còn R3c.
