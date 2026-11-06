# R3c-4 — Authenticated controller read API

START 06/11/2026 — Base `079cffe` đã push. Dùng task-discipline; user cho phép phát triển/checkpoint push, không PR/merge/production write. Credential substrate đã gate; mở API đọc tối thiểu trong explicit execution service, loopback only.

| Yêu cầu | Gate | State |
|---|---|---|
| Bearer/current controller authorization trước đọc | Real HTTP duplicate auth/origin/URL token/revoke/error/rate tests; Linux running-process revoke10cases | PASS |
| Identity/status/capabilities/app/detail/history read-model |9HTTP tests/SQLite canonical dispatch fixture; actual systemd deployed firstSHA read DTO/history/deployments PASS, write/log unsupported | PASS |
| Bounded paging và current authorization mọi page | Keyset ceiling/offset/AES-GCM cursor; tamper/app/collection/ownership changes tested; actual installed API2app pages PASS | PASS |
| Loopback service composition/lifecycle | Explicit run-product only; native default404/health-only and running revoke/stop PASS; headers16KiB/response1MiB/time/rate bounded | PASS |
| Gates và push |30focused incl SharedIngress/9HTTP/7service; full1563 PASS/2SKIP/0FAIL/types/lint/build/native10PASS; fresh extended publicsystemd run chờ meaningful checkpoint push | IMPLEMENTED |

Không manual deploy/policy writes/rotation/SSH Desktop tunnel trong checkpoint này; capability ghi unsupported. Không public bind/admin enrollment route, không fallback SQLite Desktop. No accepted exception.

## Nhật ký / evidence

- UPDATE06/11: read-only router + current SQLite read-model và AES-GCM cursor; auth kiểm trong same read transaction với dữ liệu/ownership, không auth-cache; collection giới hạn100, first-page ceiling, recheck owner mọi page. Chỉ fields allowlist, không env hoặc raw history payload. Current deployment ID không khớp app thì null, không fallback version khác.
- DTO job target_sha nay nullable khớp canonical persistence/manual rollback; test nullable và canonical prepared deployment statusbuilding, không giả runtime success từ SQLite fixture.
- Native10PASS **5c6ab5562b3b**, raw `app/.out-scripts/controller-read-api/5c6ab5562b3b/result.json`; default run404, explicit execution/bearer/status/capability/empty/malformed/live revoke/clean shutdown. Manifest **ee8940a39b5cd661bc9ea956325425877ad2fea57bb8b7dbb73e85ebe89ec6c9**.
- Extended actual publicGit/systemd gate `f6850726e6fb` đang chạy: firstSHA **079cffe80df120d769f3ffca2ee9812061df68e2**, first runtime read detail/current SHA/job/deployment/history + cursor2apps PASS; systemctl restart giữ container/collector và1job, `authenticated_read_api_first_snapshot=true`. Đợi meaningful checkpoint push, secondsnapshot/live revoke/cleanup chưa nhận PASS.
- Test duplicate header lần đầu bị HTTP parser400 vì fixture raw headers thiếu Host, sửa fixture gửi Host đúng thì API401. Test dispatch fixture lần đầu thiếu snapshotmetadata, thêm đúng argument theo repository contract. Không nới parser/auth/dispatch authority để qua test.
- Full run đầu `release-r3c4-vitest-final.json`:1556PASS/7FAIL/2SKIP, cả7fail ở ControllerService `CONTROL_PLANE_BIND_FAILED`. Evidence: actual systemd unit đang chiếm8768; controlled `systemctl stop opspilot-lab-d20c07133de9.service` cho MainPID0 rồi focused service/API16PASS. Không sửa cổng contract hoặc skip test; chạy full Windows suite nối tiếp, sau đó restart unit để tiếp gate public push. Đây là xung đột lab, không được nhận full PASS trước rerun.
- Lượt sequential tiếp1562PASS/1FAIL/2SKIP tại SharedIngress confirmation test: fixture đợi heading luôn có, rồi `getByRole` nút trước khi `domain:ingress-list` xong. Sửa1dòng sang `await findByRole` đúng nút; giữ confirmation và thứ tự install/reconcile/check assertions. Focused SharedIngress/API/service30PASS; không sửa renderer runtime.
- Extended run `f6850726e6fb` không được nhận final gate vì phải dừng unit khi chạy full Windows tests, vượt budget12phút driver cũ. Giữ firstsnapshot như observation, chờ timeout/cleanup rồi rerun fresh. Public gate có wait publish15phút nên driver mới dùng explicit lab flag budget25phút, defaultR1/R2 vẫn12phút; thêm deadline_expired không cho checkpoint completion che timeout. Không thay runtime production timeouts, không bỏ lỗi của run cũ.
- UPDATE06/11: final full **1563PASS/2Linux-onlySKIP/0FAIL** tại `.out-scripts/release-r3c4-vitest-final-clean.json`, focused30PASS, scoped lint10files/type/build PASS. Run cũ `f6850726e6fb` finalFAIL/cleanuptrue, không miễn gate. Fresh run **ed1dbc15d458** đã start sau Windows full, dùng flag25phút; chưa nhận final secondsnapshot/cleanup trước khi có report.
- HANDOFF-LOCAL06/11: read API implementation CHỜ REVIEW, SHA `git log -1 -- app/src/main/controlPlane/controllerReadApi.ts`; native10/HTTP9/current ownership/cursor/type/full gates PASS. Có thể push implementation checkpoint để làm stimulus cho extended systemd/publicGit regression; kết quả final ghi checkpoint evidence sau. R3 tổng PARTIAL; manual writes/rotation/SSH Desktop tunnel/API UI còn task riêng.

```text
Node22: pnpm --prefix app exec vitest run src/main/controlPlane/controllerReadApi.test.ts src/main/controlPlane/controllerService.test.ts
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c4-vitest-final.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <8 changed TS/MJS files> --max-warnings=0
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c4/control-plane.cjs node app/scripts/product-runtime-lab/controller-read-api.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c4-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b/control-plane.cjs OPSPILOT_PUBLIC_SERVICE_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c4/control-plane.cjs OPSPILOT_PUBLIC_READ_API=1 node app/scripts/product-runtime-lab/public-git-systemd.mjs
```
