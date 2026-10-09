# TK-S7 G5-live — kiểm tra vận hành và rehearsal trên build hiện tại

**Trạng thái:** `BLOCKED / NOT_RUN` (2026-10-09 UTC). G5c đã giải thích sai lệch RAM UI: ảnh G4b 91% đến từ Electron cũ và không chứng minh VPS dưới ngưỡng; ba cặp refresh trên build mới khớp collector khoảng 20–21%. Không dùng lại con số 91% làm gate RAM. Đợt kiểm tra vận hành này xác minh được RAM, disk, trạng thái container qua collector và HTTP ngoài; chưa xác minh được process RSS hoặc memory pressure/OOM, vì app hiện tại không cung cấp các số liệu đó qua đường SSH đã pin. Wizard Git dừng trước precheck do thiếu `PORT` và `ENABLE_FAULT_ENDPOINTS`; không bấm Start.

## Điều kiện còn thiếu

- Trước khi thử lại, bổ sung một đường chẩn đoán chỉ đọc qua SSH đã pin hoặc provider console đã xác minh để thu process RSS và memory pressure/OOM; giữ các kết quả này cùng mẫu RAM/disk/container. Không dùng SSH không pin hoặc thay đổi dịch vụ VPS.
- Chuẩn bị wizard app Git hiện tại với các biến bắt buộc `PORT` và `ENABLE_FAULT_ENDPOINTS` hợp lệ từ cấu hình nguồn đã kiểm tra; chạy precheck trong Electron và lưu kết quả. Precheck ở lượt này là `NOT_RUN` vì wizard chặn tại bước cấu hình với thông báo thiếu hai biến trên.
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
- Không có migration DB. C2a contract ready; cần đồng bộ `app/src/shared/ipc.ts`, main handler và tests trong checkpoint C2b được duyệt riêng. VPS/live vẫn `BLOCKED / NOT_RUN`; phải thu đủ gate vận hành và precheck trước Start, sau đó mới cân nhắc video deploy liên tục; giữ fallback `DEMO_READY_RECORDED`/G3 deployment v3 cho tới khi có bằng chứng cùng build.
