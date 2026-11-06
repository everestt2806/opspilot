# R3c-6a — Kênh SSH cố định tới loopback controller API

START06/11/2026 — R3c-5b `baabc06` đã push, remote khớp local. Theo ADR011, Desktop cần kênh tới API loopback của controller, không mở public management port. Áp dụng task-discipline; không renderer/IPC credential hoặc fallback Desktop pipeline.

| Yêu cầu | Kiểm chứng | State |
|---|---|---|
| Chỉ forward tới127.0.0.1:8768, không tạo local listener/exec/arbitrary destination | openControllerApiChannel, main-only contract; focused args khớp contract + actual SSH/HTTP7PASS `207ed0ebe45f` | PASS |
| Principal pin trước kết nối và trước khi trả channel | Expected/current resolver trước authentication; actual host key và fresh resolver sau open; native wrong pin0auth/forward, đổi principal fresh auth; unit rejects endpoint/user/auth/pin mismatch | PASS |
| Abort/timeout/disconnect/late callback không leak/replay | Whole-open deadline, abort/stalled resolver/disconnect/late callback/post-open resolver/closed stream; unit12 + native late-channel close event PASS | PASS |
| Gates/handoff/checkpoint push | Focused40/native7/fresh023/full1597PASS/2SKIP/Node-Web-scripts-lab types/scopedlint3/build; docs/index/secret checks và normal checkpoint push đối chiếu trước bàn giao | PASS |

Đây là transport primitive cho main; chưa enrollment UI/token vault/DTO HTTP client/credential rotation. Không quảng cáo Desktop controller authority hoàn chỉnh từ channel gate. Không chạm production DB/VPS, không PR/merge. Assumption: trusted main supplies independently pinned full controller SSH principal; renderer không được chọn destination.

## Nhật ký / evidence

- UPDATE06/11: `SshManager.openControllerApiChannel(expectedPrincipal,{signal,timeoutMs})` chỉ direct-tcpip tới127.0.0.1:8768, trả verified identity+caller-owned stream. Validate current resolver trước mở SSH; nếu pool còn principal cũ thì mở kết nối mới. Sau await channel re-resolve/current principal/actual pin/connection instance/liveness; không đưa token hoặc request vào stream trước khi caller nhận authority. Toàn deadline≤30s/default15s bao gồm resolver/handshake/open/verification; abort sau timeout không mở late API channel. Shared pooled SSH vẫn do manager quản lý, caller destroy API stream sau request.
- Focused **40PASS** =12API-channel +28SSH/fingerprint baseline, types Node/Web/scripts/lab và scoped lint3files PASS. Native accepted **207ed0ebe45f 7PASS**, raw `app/.out-scripts/controller-api-channel/207ed0ebe45f/result.json`; Linux Node22.23.4/actual ssh2 handshake/key pin/forwardOut/loopbackHTTP, wrong pin trước authentication, fresh principal thay pooled, deadline/abort hủy late channel bằng SSH close event, cleanup=true; không VPS production/real management bearer.
- Lab artifact `/var/tmp/opspilot-p3e3a-runtime/r3c6a-accepted-lab.cjs`, SHA256 **f5a57b3842f72a15c663e0b2415352c3cf9cc6552434373c429319f0b7da6f7c**. Management regression trước constant-copy: nativeHTTP **a5334d627669 11PASS**(default404/auth/revoke/SIGTERM incomplete POST/0lateSQL), chưa nhận đây là Desktop transport/UI acceptance.
- Các lỗi phát hiện và đã sửa:2TS test declaration errors; scripts rootDir không nhận runtime import docs nên runtime fixed values copy đúng contract và unit đối chiếu destination qua source contract (không mở rộng rootDir); native lab HTTP Agent nhận Duplex không có Socket.setTimeout nên dùng external deadline; ssh2 ServerConnection dùng end(), không destroy(); auth attempt `none` không đếm là successful credential auth; ssh2 Channel.destroy() gửi protocol close nhưng không set Node destroyed, nên actual gate kiểm close event và production post-open guard bổ sung liveness/close event. Không sửa safety để bỏ gate. Failed lab directories chỉ2scratch riêng đã verify exact /tmp path/owner/no-symlink rồi xóa, không chạm working tree hoặc VM.

```text
Node22: pnpm --prefix app exec vitest run src/main/ssh/controllerApiChannel.test.ts src/main/ssh/ssh.test.ts src/main/ssh/hostFingerprint.test.ts --maxWorkers=2
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint src/main/ssh/manager.ts src/main/ssh/controllerApiChannel.test.ts scripts/product-runtime-lab/controller-api-channel.mjs --max-warnings=0
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c6a-vitest-final.json
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6a-accepted-lab.cjs node app/scripts/product-runtime-lab/controller-api-channel.mjs
Linux: node app/scripts/product-runtime-lab/verify-deps.mjs
```

No accepted exceptions. Tiếp R3c-6b bounded HTTP DTO transport/token vault/enrollment cùng actual controller, rồi UI đọc controller authority và rotation; R3 tổng PARTIAL. Không PR/merge hoặc production write.

- HANDOFF-LOCAL06/11: final full **1597PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c6a-vitest-final.json`, console `.out-scripts/release-r3c6a-vitest-final.log`; types Node/Web/scripts/lab và lint3files0/0, build/fresh npmci/schema023/bundle12/init/status PASS. Không đổi Python;365baseline không phải fresh ML proof. Board/FR/handoff và original4requirements đã đối soát; chỉ stage exact scope, không temporary/private host keys; user đã cho phép normal checkpoint push, không PR/merge. Source SHA xem git log file test, local/remote kiểm trước bàn giao.
