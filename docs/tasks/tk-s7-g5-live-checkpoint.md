# TK-S7 G5-live — kiểm tra vận hành và rehearsal trên build hiện tại

**Trạng thái mới nhất:** `BLOCKED / NOT_RUN` (C3b, 2026-10-10 UTC). C3b verified the production Electron/G2 profile, Git source pin, one read-only diagnostics sample, three external HTTP 200 results, and Electron precheck PASS without entering secrets. No Start or deployment occurred; C3c may proceed with its single planned redeploy subject to repeating its final checks. Overall G5-live stays blocked pending continuous silent-video and post-deploy evidence.

## Điều kiện còn thiếu

- Khi có `DATABASE_URL` từ nguồn được phép và đã xác minh, nhập qua UI trong wizard hiện tại và chạy precheck Electron; không đoán hoặc ghi giá trị vào evidence. `PORT=3000` và `ENABLE_FAULT_ENDPOINTS=false` đã được xác nhận an toàn trong C2d.
- Chỉ khi mọi kiểm tra vận hành và precheck đạt mới thực hiện một deploy/redeploy theo UI trên đúng build hiện tại.
- Quay liên tục từ trước Start qua pipeline, result, history và HTTP ngoài trên cùng build. Không ghép các lượt; kiểm tra MP4 không có audio track và review nội dung.
- Nếu điều kiện không đạt, dừng trước Start, ghi chính xác điểm chặn và giữ `DEMO_READY_RECORDED` với video G3 được gắn nhãn build cũ/deployment v3.

## Kết quả đợt kiểm tra 2026-10-09 UTC

- Build Electron: `app/out`, nhánh `feat/deploy-reachability`, HEAD lúc bắt đầu `b3b784e`; dùng profile G2 hiện có. Refresh `vps:get-resources` qua SSH host key đã pin thành công; RAM UI và disk giữ ổn định ở khoảng 20–21% và 7/25 GB.

| Mẫu UTC | RAM UI | Disk UI | Collector deployment 6 cùng phút | Container | Kết quả |
|---|---:|---:|---:|---|---|
| 2026-10-09 20:38 | 807 MB / 3.8 GB (~21%) | 7 / 25 GB | host_mem_pct 20.50–20.85% | `container_up=1` | `PASS` cho chỉ số quan sát được |
| 2026-10-09 20:39 | 816 MB / 3.8 GB (~21%) | 7 / 25 GB | host_mem_pct 20.43–20.85% | `container_up=1` | `PASS` cho chỉ số quan sát được |
| 2026-10-09 20:41 | 796 MB / 3.8 GB (~20%) | 7 / 25 GB | 20:41:01Z 20.72%, 20:41:11Z 20.71% | `container_up=1` | `PASS` cho chỉ số quan sát được |

- Docker version trên VPS: 29.8.2. `vps:get-resources` trả dữ liệu trên build hiện tại. Không có trường process RSS, pressure stall information hoặc OOM counter trong màn hình/chẩn đoán Electron đã dùng; các gate đó là `NOT_VERIFIED`, không được suy diễn là sạch.
- Wizard tại App detail → **Triển khai phiên bản mới** đã ghim nguồn Git public (ref `main`, root `demo-apps/express-api`) và nhận diện Express. Sang cấu hình, wizard dừng với lỗi thiếu biến bắt buộc `PORT` và `ENABLE_FAULT_ENDPOINTS`; do đó **precheck `NOT_RUN`**. Rời wizard trước Start; không có job hoặc deployment mới và không có thay đổi VPS từ lượt này.
- HTTP từ máy điều khiển lúc `2026-10-09T20:41:53Z`: `http://160.191.243.89:30000/health` 200; `http://160.191.243.89:30001/` 200; `http://160.191.243.89:30002/` 200.
- Deploy, quay video liên tục và kiểm tra silent MP4: `NOT_RUN` vì các gate bắt buộc chưa xác minh/đạt. Giữ `DEMO_READY_RECORDED`, dùng video G3 build cũ/deployment v3 theo phiếu; không đổi kết luận hay PDF A4.

## Giới hạn

Không đổi credential/fingerprint, không chạy pilot ML, không thực hiện deploy hay thay đổi dịch vụ VPS khi các gate chưa đạt. Deployment hiện tại Git v4 cùng các app folder giữ nguyên bằng chứng đã ghi ở evidence G5.

## G5-live C1 — UX env defaults an toàn

- START 2026-10-10: bắt đầu sửa UX cấu hình env local/Git theo task G5-live C1; runtime/backend/DB/IPC/contracts/VPS ngoài phạm vi.
- Nguyên nhân: detector trả `required_env` và `container_port`; renderer trước đó để trống mọi env nên `requiredMissing()` dừng trước precheck. UI mới chỉ gợi ý `PORT` từ `container_port` khi khóa này required và đặt `ENABLE_FAULT_ENDPOINTS=false` khi required. Không đọc giá trị `.env.example`, không tự điền secret, `DATABASE_URL` hay biến khác; giá trị bắt buộc khác vẫn được kiểm tra như cũ.
- Local/Git source, repo/ref/root, VPS và app đổi đều xóa env/detection cũ, hủy/nhả prepared Git handle khi cần và vô hiệu precheck. Chỉnh tay env vẫn giữ nguyên đến khi người dùng sửa nguồn/đích; mọi chỉnh sửa tiếp tục invalidates precheck. Redeploy app hiện có hiển thị cảnh báo rằng env cũ không được tải từ VPS, yêu cầu xác nhận rõ trước precheck và để trống secret/giá trị không lưu.
- Test UI bổ sung cho local/Git × app mới/app hiện có; xác nhận detector port, fault endpoint mặc định false, nhập tay override, secret/DATABASE_URL/biến tùy ý không được tự điền, required env chưa nhập chặn, và precheck nhận đúng env. Test DeployPage đầy đủ: `pnpm --filter @opspilot/app exec vitest run src/renderer/src/pages/DeployPage.test.tsx --reporter=dot` — PASS, 52/52.
- Xác minh hiệu chỉnh trên source C1 `41c3c2c` bằng Node `v22.23.3` tại `C:\Users\everestt28\AppData\Local\pnpm\bin\node.exe` (đã xác nhận `pnpm exec node -p process.execPath` trỏ đúng executable; đáp ứng `>=22 <23`). `pnpm --filter @opspilot/app exec vitest run src/renderer/src/pages/DeployPage.test.tsx --reporter=dot`: PASS, 1 file/52 test; Vitest in các thông báo jsdom `getComputedStyle()` với pseudo-elements chưa implement. `pnpm --filter @opspilot/app typecheck`: PASS (node + web); `pnpm --filter @opspilot/app lint`: PASS, không có warning; `pnpm --filter @opspilot/app build`: PASS (typecheck + electron-vite production build; không có cảnh báo build); `git diff --check`: PASS. Không sửa code trong lượt xác minh, không có thay đổi runtime/backend/DB/IPC/contracts và không kết nối VPS.
- Trước đó các gate C1 từng chạy bằng Node `v24.16.0` và có cảnh báo engine; kết quả Node 24 chỉ là lịch sử, bằng chứng gate chuẩn hiện tại là lần chạy Node `v22.23.3` ở trên.
- UPDATE 2026-10-10: hoàn tất xác minh gate C1 theo Node 22; không phát hiện lỗi UI/test cần sửa. HEAD trước commit hồ sơ: `516d460` (docs) trên code `41c3c2c`.
- `HANDOFF-LOCAL`: code commit `41c3c2c`; live deploy/rehearsal vẫn `NOT_RUN` do blocker operational đã ghi phía trên, giữ `DEMO_READY_RECORDED` và video G3 cũ/v3. Board tiếp tục ghi live là `BLOCKED / NOT_RUN`; C1 chỉ xử lý UX configuration/precheck, không nâng trạng thái live readiness.

## G5-live C2a — contract diagnostics chỉ đọc

- START 2026-10-10: checkpoint này chỉ sửa contract, quyết định và hồ sơ task/board; không sửa `app/src/shared/ipc.ts`, runtime, DB, UI, hoặc truy cập VPS.
- Contract đã thêm `vps:get-operational-diagnostics(vpsId:number) -> IpcResult<VpsOperationalDiagnostics>`. Payload có `sampled_at` (ISO-8601 UTC), `top_processes_available`, danh sách giới hạn `{pid,name,rss_mb}`, `memory_pressure:{some_avg10,full_avg10}|null`, và `oom_kill_count:number|null`. `top_processes_available=false` nghĩa là `ps` thiếu/lỗi; `true` với danh sách rỗng nghĩa là sample hợp lệ nhưng không có mục. PSI/OOM null nghĩa là kernel source không có hoặc không đọc/parse được, tuyệt đối không thay bằng zero.
- C2b acceptance: thêm handler trong main process, chỉ gọi SshManager/SSH transport hiện có đã xác minh fingerprint; renderer chỉ truyền `vpsId`, không thể gửi free-form command, credential hay đường dẫn shell. Chạy đúng các nguồn đọc-only: `/proc/pressure/memory` để parse `some avg10` và `full avg10`; `/proc/vmstat` để parse counter `oom_kill`; `ps -eo pid,rss,comm` để lấy PID/RSS/tên process (không lấy argv/command line), sắp theo RSS giảm dần và giới hạn danh sách ở mức cố định (contract/runtime C2b chốt 10 mục). Giới hạn output/thời gian, parse output theo schema, không log raw command output/credential, và không ghi bất kỳ dữ liệu nào vào DB.
- Error semantics C2b: VPS ID không hợp lệ trả `VALIDATION`; SSH auth/timeout/unreachable trả `IpcResult` lỗi tương ứng (`SSH_AUTH_FAILED`, `SSH_TIMEOUT`, `SSH_HOST_UNREACHABLE`) và không trả một sample giả. Lệnh/nguồn kernel không hỗ trợ hoặc parse/read thất bại chỉ làm field nguồn tương ứng unavailable (`top_processes_available=false`/`[]`, hoặc field nullable `null`); nếu SSH còn hoạt động thì kết quả tổng vẫn `ok:true` để hiển thị rõ phần dữ liệu thiếu, không biến thiếu thành 0. Không retry qua host key khác hoặc học key mới.
- Không có migration DB. Tại handoff C2a, contract chờ được nối vào `app/src/shared/ipc.ts` và runtime trong checkpoint C2b.

## G5-live C2b — triển khai diagnostics cục bộ

- C2b triển khai bản copy contract trong `app/src/shared/ipc.ts`, channel handler chỉ nhận `vpsId`, và `readVpsOperationalDiagnostics` gọi SshManager hiện có cho đúng ba command cố định. Command process lấy tối đa 10 dòng process qua `head`, thời hạn mỗi lệnh là 5 giây; output nguồn được giới hạn khi parse, `logCommand:false`, không log raw output/stderr, không ghi DB và không có credential trong renderer. `comm` là tên process, không đọc argv.
- Parser trả PSI/OOM `null` khi nguồn thiếu, command lỗi hoặc dữ liệu malformed; process source dùng `top_processes_available=false` với `[]` trong các trường hợp đó, nhưng `true` với `[]` là kết quả trống hợp lệ. RSS từ `ps` KB được đổi sang MB; SSH auth/timeout/disconnect (kể cả exit không xác định/255) và unknown VPS giữ lỗi IPC, không biến thành sample giả. ID không phải positive safe integer bị từ chối trước SSH.
- Kiểm tra Node `v22.23.3` (`pnpm exec node -p process.execPath` xác nhận `C:\Users\everestt28\AppData\Local\pnpm\bin\node.exe`): `pnpm --filter @opspilot/app exec vitest run src/main/vps/operationalDiagnostics.test.ts src/main/ipc.test.ts --reporter=dot` PASS, 2 files/24 tests; `pnpm --filter @opspilot/app try:vps-diagnostics -- --fixture` PASS offline; `typecheck:node`, `typecheck:web`, `tsc --noEmit -p tsconfig.scripts.json`, lint, build, và `git diff --check` PASS, không có warning lint/build. Các lệnh SSH có timeout 5 giây từng nguồn (tối đa 15 giây tuần tự); `ps` chỉ trả header + 10 process, parser từ chối output quá 16 KiB.
- `docs/05-truy-vet-yeu-cau.md` FR-A3 ghi nhận diagnostics parser/IPC/fixture là kiểm tra local; không đổi mức tuyên bố live. C2b không truy cập VPS và không chứng minh số liệu thực tế trên VPS; vận hành/live rehearsal vẫn `BLOCKED / NOT_RUN` cho tới khi chẩn đoán được chạy trên VPS qua profile đã pin, các gate khác đạt và tồn tại video liên tục cùng build. Giữ `DEMO_READY_RECORDED`/G3 deployment v3 làm fallback.

## G5-live C2c — card diagnostics trong VPS Overview

- START 2026-10-10: UI local בלבד; không đổi backend, shared IPC contract, DB hoặc VPS và không chạy diagnostics live.
- Overview có card diagnostics chỉ gọi `vps:get-operational-diagnostics(vps.id)` sau thao tác Check/Refresh; không tự gọi khi mount. Card hiển thị thời gian local, PSI avg10 theo %, tối đa 10 process và RSS, OOM counter tích lũy kèm giới hạn diễn giải; null/unavailable khác số 0.
- Khi đổi VPS hoặc có request mới, response cũ bị bỏ; lỗi IPC an toàn được giữ để retry, lỗi ném/handler không sẵn sàng dùng thông báo chung, không hiện technical/raw SSH output. `vps:scan` và refresh tài nguyên vẫn độc lập.
- Tests component: 12/12 PASS gồm không auto-call, success/zero, partial unavailable, SSH error/retry, response đảo thứ tự, chuyển VPS và độc lập scan/resource.
- Node `v22.23.3`, `pnpm exec node -p process.execPath` xác nhận `C:\Users\everestt28\AppData\Local\pnpm\bin\node.exe`. `pnpm --dir app exec vitest run src/renderer/src/components/VpsOverviewTab.test.tsx --reporter=dot`: PASS 1 file/12 tests. `pnpm --dir app run typecheck:node`, `typecheck:web`, `pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json`, `pnpm --dir app run lint`, `pnpm --dir app run build`, `git diff --check`: PASS; lint/build không warning.
- Visual review dark/light 1280×800: `NOT_RUN`; Electron đang chạy dùng renderer bundle cũ tại thời điểm build, không reload/chuyển profile hoặc gọi diagnostics trên VPS trong checkpoint này.
- Live diagnostics/deploy và same-build continuous video: `NOT_RUN`; giữ `BLOCKED / NOT_RUN` và fallback `DEMO_READY_RECORDED`/video G3 deployment v3.

## G5-live C2d — kết quả operational gate trên Electron thật (2026-10-09 UTC)

Kết quả cập nhật: phần đo vận hành read-only đạt, nhưng checkpoint tổng thể vẫn `BLOCKED / NOT_RUN` vì precheck không thể chạy an toàn khi `DATABASE_URL` bắt buộc chưa có giá trị đã xác minh. Không bấm Start và không redeploy.

- Production build `app/out`, branch `feat/deploy-reachability`, HEAD `4bba7c232d64443ee383dade607ca9d9c57fea5f`, Electron PID `35168`; dùng lại profile G2 hiện có sau khi đóng instance cũ bình thường. Diagnostics gọi thủ công từ VPS Overview qua SSH pin, `vps:get-resources` và collector deployment 6 đối chiếu cùng phút.
- Ba mẫu UTC: `21:52:53Z`, `21:54:39Z`, `21:56:33Z` (cách nhau trên 60 giây). Lần lượt RAM `828/795/797 MB` trên `3.8 GB` (~20–21%), disk đều `7/25 GB`; PSI some/full avg10 đều `0.00%`; OOM kill counter `0` ở cả ba mẫu, không tăng. Process RSS có dữ liệu ở cả ba mẫu; top RSS khoảng `dockerd` 139.63 MB, `next-server` 103.43–103.68 MB, `node` 79.59–79.75 MB, `npm start` 75.52 MB và `containerd` 57.58 MB. Collector cùng phút báo `container_up=1` và host RAM lần lượt `20.6776%`, `20.7258%`, `20.5352%`. Chi tiết danh sách process từng mẫu nằm trong `docs/demo-14-10/evidence.md`, mục G5-live C2d.
- Ba external HTTP GET tại `2026-10-09T22:01:28Z` đều `200`: Git Express `:30000/health`, Vite `:30001/`, Next `:30002/`.
- App Git hiện có: `g2-express-20261009`, v4, `main`, root `demo-apps/express-api`, full SHA `8af16e1f9165a31557288adbc23acc420244938f`, exposure reachable. Wizard xác nhận `PORT=3000`, `ENABLE_FAULT_ENDPOINTS=false` và cảnh báo cấu hình môi trường hiện hữu không được tải từ VPS/secret không tự điền. `DATABASE_URL` Required nhưng blank; precheck `NOT_RUN` vì không đoán hoặc nhập lại secret chưa được xác minh. Wizard thoát trước Start, không có job/deployment/VPS thay đổi.
- Redeploy, same-build continuous video qua pipeline/result/history/HTTP và kiểm tra MP4 silent: `NOT_RUN`. Giữ verdict `BLOCKED / NOT_RUN`, `DEMO_READY_RECORDED`, video G3 build cũ/deployment v3; không nâng thành live-ready. Lượt này không đổi credential/fingerprint, không dùng SSH ngoài app và không tác động VPS.

## G5-live C3b - verify C3a and run safe precheck only (2026-10-10 UTC)

- Node 22.23.3 full gates on application-source commit `f68018c035ceaf29b02942cc9c9ad64833d3e5d2`, verified by Leader before C3b: Vitest 72 files / 712 tests PASS; Node/Web/Scripts typecheck PASS; lint 0 errors / 18 Prettier warnings; production build PASS. Current branch HEAD `83c88c445a636e3c556ec5481da0ba5a7c6d0ebe` adds only demo-planning documentation and does not change app source.
- Production Electron opened `app/out/renderer/index.html` under the existing G2 profile; app PID `37064`, one main window remained. The existing SQLite DB and protected key were present before launch and UI showed G2 Development VPS plus its three apps.
- Existing Git Express v4 remains pinned to repo `https://github.com/everestt2806/opspilot.git`, `main`, root `demo-apps/express-api`, full SHA `8af16e1f9165a31557288adbc23acc420244938f`.
- Diagnostics sample `2026-10-10T06:58:28Z`: RAM `801 MB / 3.8 GB`, disk `8 / 25 GB`, PSI some/full `0.00% / 0.00%`, OOM count `0`, top-process data available. Full process list and RSS are in `docs/demo-14-10/evidence.md`.
- Wizard env review was explicitly acknowledged; only `PORT=3000` and `ENABLE_FAULT_ENDPOINTS=false` were entered. `DATABASE_URL` stayed blank; no credential value was guessed or supplied. Electron precheck PASS at `2026-10-10T07:02:56Z`: RAM free 3115 MB, disk free 18 GB, Docker 29.8.2, required remote env keys available (values were not returned).
- Three public HTTP GETs via `curl.exe` at `2026-10-10T06:59:23Z`: Git Express health, Vite root and Next.js root all HTTP 200. One initial PowerShell attempt did not return statuses; final curl results are authoritative.
- No Start/job/deployment or VPS change occurred. C3c may proceed with its one planned redeploy, while repeating final gates; overall G5-live verdict stays `BLOCKED / NOT_RUN` and `DEMO_READY_RECORDED` until continuous silent-video/post-deploy evidence exists.
