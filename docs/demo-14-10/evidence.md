# Bằng chứng G2 — live Git deploy trên VPS phát triển

**Kết quả:** `LIVE_VPS` — manual Git deploy và redeploy thành công. **Pilot ML: NOT_RUN. Migrate sau rollback: NOT_RUN / DoD còn mở.** Không thử rollback.

## Build và nguồn

- Thời điểm thao tác: 2026-10-09, múi giờ UTC+07 (DB ghi UTC).
- OpsPilot branch: `feat/deploy-reachability`; HEAD: `d4ceb81d814b13dfae27f376014395a1dde1f8e7`.
- `git status` trước khi mở build: không có thay đổi tracked; chỉ có các file công cụ cục bộ chưa track (`.agents/`, `SKILL.md`, `run.ps1`, `start-opspilot.bat`), không đưa vào commit.
- Electron mở `app/out/renderer/index.html`, dùng `userData` riêng trong `%TEMP%\opspilot-g2-20261009`; không dùng profile hiện có.
- VPS trong profile biệt lập được thêm và kiểm tra từ Electron với SSH key cùng fingerprint host đã xác minh độc lập, đều lưu ngoài repository. `vps:test-connection` thành công. Scan trước deploy xác nhận SSH, Docker 29.8.2, Compose 5.6.0, Git 2.43.0; `/opt/opspilot` chưa tồn tại ở thời điểm đó. Sau upload/deploy, scan lại cho SSH, Docker, Compose, Git và workspace `/opt/opspilot` đều đạt. Không ghi credential/fingerprint vào tài liệu.

## Deploy từ wizard Git

- Repository công khai: `https://github.com/everestt2806/opspilot.git`; ref `main`; root `demo-apps/express-api`.
- Prepare pin full SHA `8af16e1f9165a31557288adbc23acc420244938f`; detector nhận diện Express 4.21.2, port 3000, healthcheck `/health`.
- App: `g2-express-20261009`; VPS: `G2 Development VPS`; host port 30000 → container port 3000.
- DB xác nhận app `source_type=git`, `source_path=NULL`, URL/ref/root đúng, `current_deployment_id=2`.

| Deployment ID | Version | Thời gian UTC | Trạng thái / exposure | Image tag | Git SHA |
|---:|---:|---|---|---|---|
| 1 | v1 | 2026-10-09 06:20:54–06:22:14Z | running / reachable | `g2-express-20261009:v1` | `8af16e1f9165a31557288adbc23acc420244938f` |
| 2 | v2 redeploy | 2026-10-09 06:24:46–06:25:11Z | running / reachable | `g2-express-20261009:v2` | `8af16e1f9165a31557288adbc23acc420244938f` |

Redeploy cùng app qua wizard Git đã tăng version 1 → 2. **Same SHA** ở cả hai deployment; không tạo hay tuyên bố commit thứ hai.

## Runtime và truy cập

- Deployment v2 container: `5d68841812dd36dbbe513d5a2e1f1e7693f984081f6a80ce32994a4ce1ae894d`, `running`, `healthy`, publish `0.0.0.0:30000` và `[::]:30000` → `3000/tcp`.
- Image ID: `sha256:417452a447e17559b58fc99dbacda193254ac67c0bbdc29d961e77e9c85141a6`.
- DB exposure của v1/v2: `reachable`; màn kết quả deploy ghi “Truy cập ngoài đạt”.
- Probe loopback trên VPS: `http://127.0.0.1:30000/health` → HTTP 200, body `{"ok":true,"uptime_s":78}`.
- Probe từ máy điều khiển: `http://160.191.243.89:30000/health` → HTTP 200, body `{"ok":true,"uptime_s":13}`. Đây là external probe thật; exposure được ghi `reachable`.
- Diagnosis / lỗi deploy: không có. Lỗi công cụ cục bộ duy nhất: `Invoke-WebRequest` ném `NullReferenceException`; probe được xác minh lại bằng `curl.exe` và nhận HTTP 200.

## Ảnh Electron thật

- [Kết quả redeploy v2](evidence/g2-redeploy-success.png)
- [Lịch sử v1/v2, SHA đầy đủ và exposure](evidence/g2-deployment-history.png)
- [Scan VPS sau deploy](evidence/g2-vps-scan.png)

Ảnh không chứa credential, private key, fingerprint hay env secret.

## Gate

Đã chạy trên Node 22.23.3, không có thay đổi runtime sau live smoke:

- `pnpm lint` — PASS (ESLint và Ruff).
- `pnpm --filter @opspilot/app typecheck` — PASS (Node + Web).
- `pnpm exec tsc --noEmit -p tsconfig.scripts.json --composite false` — PASS.
- `pnpm --filter @opspilot/app test` — PASS, 71 test files / 666 tests. Vitest in các cảnh báo jsdom “Not implemented” nhưng exit code 0.
- `pnpm build` — PASS (typecheck + Electron/Vite production build).
- `git diff --check` — PASS.

Các lệnh trên chạy với source HEAD `d4ceb81d814b13dfae27f376014395a1dde1f8e7`, cùng source đã dùng để build Electron cho smoke.

## G2b — live smoke nguồn folder local và template

**Kết quả:** `PASS` cho Vite SPA và Next.js trên VPS phát triển. Không sửa runtime code sau live smoke; build được thử là Electron `app/out/renderer/index.html` trên HEAD `47327f2a8b96f46759c7fa73a458d95fa51f6b01`, branch `feat/deploy-reachability`, profile Electron biệt lập `%TEMP%\opspilot-g2-20261009`. App Git G2 Express giữ nguyên và vẫn reachable. Các deployment timestamps trong SQLite là UTC.

| Trường | Vite SPA | Next.js |
|---|---|---|
| Kết quả | `PASS` | `PASS` |
| Nguồn trong Electron | Folder picker, `demo-apps/vite-spa` | Folder picker, `demo-apps/next-blog` |
| Detector / phiên bản | Vite SPA `5.4.11` | Next.js `14.2.35` |
| Template / runtime | `static-spa.Dockerfile`, nginx | `nextjs.Dockerfile`, `npm start` |
| App ID / tên | `2` / `g2b-vite-20261009` | `3` / `g2b-next-20261009` |
| Deployment ID / version | `3` / v1 | `4` / v1 |
| Source DB | `source_type=local`, `source_path=D:\Developing\DuAnCNTT\demo-apps\vite-spa`; app Git fields NULL | `source_type=local`, `source_path=D:\Developing\DuAnCNTT\demo-apps\next-blog`; app Git fields NULL |
| Bắt đầu → hoàn tất (UTC) | `2026-10-09T07:02:44Z` → `2026-10-09T07:03:09.088Z` | `2026-10-09T07:05:43Z` → `2026-10-09T07:07:29.203Z` |
| Host → container port | `30001` → `80` | `30002` → `3000` |
| Image tag / image ID | `g2b-vite-20261009:v1` / `sha256:cf5cbfcb413c8e5cf33a399505ff35b8abf4f16f606b156e82730e8e01cfa795` | `g2b-next-20261009:v1` / `sha256:5fa4b413c4d8c6359a0a67c0da04682cb5434609d4e9ce116203e63c86ed9743` |
| Container ID | `f123687d5755b23ea3b1be1caf9a424eeb229189962f3d1c7fe04f32099c11a8` | `fcc932edcc8296339a01632c490e79691eb90a59afc87f0b688f9678fddfc869` |
| Runtime / exposure | `running`, `healthy`; listen `0.0.0.0:30001` and `[::]:30001`; SQLite `reachable` | `running`, `healthy`; listen `0.0.0.0:30002` and `[::]:30002`; SQLite `reachable` |
| Loopback trên VPS | `http://127.0.0.1:30001/` → HTTP 200 | `http://127.0.0.1:30002/` → HTTP 200 |
| External từ máy điều khiển | `http://160.191.243.89:30001/` → HTTP 200, title `OpsPilot Demo SPA` | `http://160.191.243.89:30002/` → HTTP 200, title `OpsPilot Demo Blog`; `/bai-viet/ops-pilot-la-gi` → HTTP 200 |
| Tài nguyên VPS | Sau build: RAM khả dụng `3232 MB`, disk trống `19 GB` | Trước build: RAM khả dụng `3257 MB`, disk trống `19 GB`; trong build `3121 MB`, `18 GB`; sau build probe `3132 MB`, `18 GB` |

Các ảnh là chụp Electron thật, không dùng fixture: [Vite kết quả deploy](evidence/g2b-vite-success.png), [Vite runtime](evidence/g2b-vite-runtime.png), [Vite lịch sử](evidence/g2b-vite-history.png), [Next runtime](evidence/g2b-next-success.png), [Next lịch sử deployment](evidence/g2b-next-history.png). Ảnh lịch sử hiển thị v1 `running`, `Reachable` và image tag. SQLite chỉ được đọc các metadata app/deployment cần thiết, không truy vấn `env_json`.

### Giữ app Git G2 hoạt động

- `g2-express-20261009` vẫn deployment v2, container `5d68841812dd36dbbe513d5a2e1f1e7693f984081f6a80ce32994a4ce1ae894d`, image ID `sha256:417452a447e17559b58fc99dbacda193254ac67c0bbdc29d961e77e9c85141a6`, `running` / `healthy`, host port `30000`.
- Loopback `http://127.0.0.1:30000/` → HTTP 200; external `http://160.191.243.89:30000/health` → HTTP 200. App vẫn nằm trong profile G2; không reset hoặc prune tài nguyên VPS.

### Gates

Các gate bên dưới chạy trên Node 22.23.3, cùng HEAD/source và build Electron đã live smoke; không có thay đổi runtime code sau smoke:

- `pnpm lint` — PASS.
- `pnpm --filter @opspilot/app typecheck` — PASS (Node + Web).
- `pnpm exec tsc --noEmit -p tsconfig.scripts.json --composite false` — PASS.
- `pnpm --filter @opspilot/app test` — PASS, Vitest 71 files / 666 tests.
- `pnpm build` — PASS.
- `git diff --check` — PASS.



# G3 — diễn tập demo

**Kết quả:** `PASS` — một rehearsal thật bằng Electron, profile G2 biệt lập, redeploy Git trên VPS phát triển; ba app vẫn hoạt động. **RECORDED_FALLBACK:** sẵn sàng, video im lặng (không có audio stream). Không có lỗi deploy hay thời gian khắc phục.

- Ngày: 2026-10-09, giờ máy UTC+07. Rehearsal từ mở app đến câu kết: **14:52:05–14:59:43**, tổng **7:38** (video 7:37; chênh lệch làm tròn/điểm bấm giờ). Build OpsPilot: branch `feat/deploy-reachability`, HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; runtime source không đổi trong buổi diễn tập.
- Live Git: repo `https://github.com/everestt2806/opspilot.git`, ref `main`, root `demo-apps/express-api`; app `g2-express-20261009` (ID 1), deployment ID 5 / v3. Remote `main`, v2 và v3 đều dùng full SHA `8af16e1f9165a31557288adbc23acc420244938f` (**redeploy cùng SHA**, không phải commit mới hay push-to-deploy).
- Các mốc deploy UTC: bắt đầu `2026-10-09T07:57:46Z`, hoàn tất `2026-10-09T07:58:27.483Z`; trạng thái `running`, exposure `reachable`; host port 30000 → container port 3000. Container `7a5a07fc2c4b4aedacd5f1d86dc77ff639243859fdc401c285468a3fcd384b6a`; image `sha256:e5ba5a127e50633946e717d6c5301ffa281ec0cb66b4f4580a459c62683c8422`.
- Sau rehearsal, từ máy điều khiển: Git `http://160.191.243.89:30000/health` → 200; Vite `http://160.191.243.89:30001/` → 200; Next `http://160.191.243.89:30002/` → 200; Next route `/bai-viet/ops-pilot-la-gi` → 200. Tài nguyên VPS sau deploy: RAM khả dụng 3101 MB, disk trống 18 GB. Các URL/ứng dụng G2b local-folder vẫn hoạt động.
- Thứ tự rehearsal: 14:52:05 mở Electron; 14:52:05–14:57:46 giới thiệu hai kiểu nguồn và xem Vite/Next/Git history; 14:57:46 bắt đầu deploy; 14:58:27.483 hoàn tất; phần còn lại đối chiếu lịch sử, HTTP và kết luận đến 14:59:43.
- Video dự phòng thật: [G3 rehearsal 09/10/2026](evidence/g3-rehearsal-20261009.mp4), H.264 1920×1200, 457.4 giây, 8,999,624 bytes, không audio stream; toàn bộ video giải mã kiểm tra thành công. Snipping Tool thu system audio dù microphone tắt; audio đã được loại khỏi bản lưu. Video không có lời dẫn thu âm. Ảnh đã kiểm tra: [trước history](evidence/g3-before-history.png), [Prepare và nguồn](evidence/g3-prepare-source.png), [deploy thành công](evidence/g3-deploy-success.png), [history v3 và SHA](evidence/g3-git-v3-history.png).

## G3 gate trên build đã diễn tập

Build và rehearsal dùng cùng source HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; không sửa runtime sau rehearsal. Gates chạy lại bằng Node 22.23.3 / pnpm 11.1.0:

- `pnpm lint` — PASS (ESLint và Ruff).
- `pnpm --filter @opspilot/app typecheck` — PASS (Node + Web).
- `pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json --composite false` — PASS.
- `pnpm --filter @opspilot/app test` — PASS, 71 file / 666 test; jsdom in cảnh báo canvas/getComputedStyle nhưng exit code 0.
- `pnpm build` — PASS, Electron/Vite production build.
- `git diff --check` — PASS.


# G4 — rehearsal cuối và verdict đề xuất

**Trạng thái:** `DEMO_READY_RECORDED` — đề xuất để Leader review, chưa freeze. Live redeploy G4 là `NOT_RUN` theo điều kiện preflight; VPS còn dưới ngưỡng RAM tối thiểu. Giữ nguyên cả ba app. G4 dùng đúng fallback G3 đã được Leader review, và ghi rõ video cũ không đại diện UI build hiện tại.

## Build UI G4

- Runtime source commit: `4addec37b66a4d5145bb55fec21012fdc3acfb0c`; `git rev-parse HEAD:app`: `4fa92683f89b77255ea3417131bb12e8914779e1`.
- Node 22.23.3 production Electron build mở bằng profile biệt lập `%TEMP%\opspilot-g2-20261009`. Không có thay đổi source/runtime sau build.
- Mô tả Deploy trung tính cho kho Git và folder local trong `en`, `vi`, `cn` (Chinese), `jp` (Japanese). DeployPage tests chuyển qua cả hai lựa chọn ở cả bốn locale. Ảnh Electron của build này: [Deploy local](evidence/g4-deploy-source-local.png), [Deploy Git](evidence/g4-deploy-source-git.png).
- Lịch sử thật trên app Git: v3 có nhãn `Đang kích hoạt`; v1/v2 chỉ hiện trạng thái `running` đã ghi nhận và không được mô tả là ba container cùng chạy: [history G4](evidence/g4-git-history-recorded.png).

## Preflight và quyết định không redeploy

- Kiểm tra live ngày 2026-10-09 trước khi deploy: remote `main` full SHA `8af16e1f9165a31557288adbc23acc420244938f`; Git Express `/health`, Vite `/` và Next `/` cùng route bài viết đều trả external HTTP 200.
- Electron VPS resource: RAM `3.6/3.8 GB` dùng (`94%`, dưới 512 MB còn trống); disk `7/25 GB` dùng (18 GB còn trống). Vì thiếu ngưỡng RAM precheck >512 MB, **không chạy prepare/precheck/start hoặc redeploy Git**, không thay đổi deployment nào.
- Rehearsal vì thế chọn `RECORDED_FALLBACK`. Dùng [video G3 09/10/2026](evidence/g3-rehearsal-20261009.mp4) đã được review: 457.4 giây (7:37), source build cũ HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; thao tác Git thật app 1/deployment 5/v3, source SHA `8af16e1f9165a31557288adbc23acc420244938f`. Video im lặng, H.264, không audio stream. Đây **không** phải bản ghi G4 hay video trên build mới; build/SHA mới chỉ được xác nhận bằng UI screenshot, test và build gate. Không gọi phần deploy đã ghi là live G4.
- G4 session ghi nhận: UI current build đã mở và kiểm tra source local/Git + history; preflight xác nhận resource thiếu ngưỡng; ba URL external PASS; chuyển verdict sang recorded fallback. Không có lỗi deploy để khắc phục. Không có deployment G4 mới, vì vậy app/deployment/image/container IDs vẫn theo v3 G3, không gán ID mới.

## Phiếu A4 và giới hạn

- [Phiếu HTML](phieu-demo.html) là bản nháp chờ Leader; [PDF A4 một trang](phieu-demo.pdf) được render từ HTML ngày 09/10/2026, 1 trang, A4, đã render PNG và xem trực quan: [preview](evidence/g4-a4-preview.png).
- Verdict chỉ đề xuất: `DEMO_READY_RECORDED`, với điều kiện Leader chấp nhận video G3 trên build cũ. Nếu cần video cùng build mới hoặc live demo, đợi VPS đạt >512 MB RAM khả dụng, kiểm tra lại URLs/SHA/resource rồi rehearsal/redeploy và quay video mới trên build đó.
- Giới hạn vẫn nêu trên phiếu: Git deploy thủ công; G3 redeploy cùng SHA; chưa chứng minh push-to-deploy/webhook, HTTPS ingress, migrate sau rollback hoặc ML pilot.


## G4 gates trên source cuối

- Node `v22.23.3`, pnpm `11.1.0`.
- `pnpm lint` — PASS, ESLint 0 errors và Ruff pass; ESLint/prettier phát 5,784 warnings về CRLF trên file Windows hiện có/được sửa.
- `pnpm --filter @opspilot/app typecheck` — PASS (Node + Web).
- `pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json --composite false` — PASS.
- `pnpm --filter @opspilot/app test` — PASS, 71 file / 670 test; jsdom ghi cảnh báo canvas/getComputedStyle, exit code 0.
- `pnpm build` — PASS, production Electron/Vite build; cùng UI source commit `4addec37b66a4d5145bb55fec21012fdc3acfb0c`, app tree `4fa92683f89b77255ea3417131bb12e8914779e1` đã rehearsal UI và không đổi sau build.
- `git diff --check` — PASS.
- Focused test: `pnpm --filter @opspilot/app exec vitest run src/pages/DeployPage.test.tsx` — PASS, 48 test.

## Review G4 — chỉ số RAM cần xác minh lại

Leader review 09/10/2026: câu “dưới 512 MB khả dụng” và verdict `DEMO_READY_RECORDED` ở G4 **chưa được phê duyệt**. `vps:get-resources` lấy cột `free` (`$4`) của lệnh `free`, trong khi deploy precheck lấy cột `available` (`$7`). Số 94% trên UI chưa chứng minh RAM có thể dùng cho deploy dưới ngưỡng. [TK-S7 G4a](../tasks/tk-s7-g4a-memory-available-live-gate.md) sẽ đo lại VPS, sửa phép tính UI và cập nhật cả PDF/verdict. Ba URL external HTTP 200 và video G3 là bằng chứng riêng vẫn có giá trị.
