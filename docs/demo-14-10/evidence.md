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

**Trạng thái:** `DEMO_READY_RECORDED` — đề xuất để Leader review, chưa freeze. G4 dùng fallback G3; video cũ không đại diện UI build hiện tại. Phần kết luận RAM ở G4 đã được sửa theo đo đạc G4a bên dưới.

## Build UI G4

- Runtime source commit: `4addec37b66a4d5145bb55fec21012fdc3acfb0c`; `git rev-parse HEAD:app`: `4fa92683f89b77255ea3417131bb12e8914779e1`.
- Node 22.23.3 production Electron build mở bằng profile biệt lập `%TEMP%\opspilot-g2-20261009`. Không có thay đổi source/runtime sau build.
- Mô tả Deploy trung tính cho kho Git và folder local trong `en`, `vi`, `cn` (Chinese), `jp` (Japanese). DeployPage tests chuyển qua cả hai lựa chọn ở cả bốn locale. Ảnh Electron của build này: [Deploy local](evidence/g4-deploy-source-local.png), [Deploy Git](evidence/g4-deploy-source-git.png).
- Lịch sử thật trên app Git: v3 có nhãn `Đang kích hoạt`; v1/v2 chỉ hiện trạng thái `running` đã ghi nhận và không được mô tả là ba container cùng chạy: [history G4](evidence/g4-git-history-recorded.png).

## Preflight và quyết định không redeploy

- Kiểm tra live ngày 2026-10-09 trước khi deploy: remote `main` full SHA `8af16e1f9165a31557288adbc23acc420244938f`; Git Express `/health`, Vite `/` và Next `/` cùng route bài viết đều trả external HTTP 200.
- G4 UI cũ hiện `3.6/3.8 GB` dùng (`94%`) vì lấy `MemFree`; số này **không chứng minh** dưới 512 MB RAM khả dụng. `MemAvailable` được đo lại tại G4a bên dưới và không xác nhận kết luận thiếu RAM. Disk ở lần ghi G4 là `7/25 GB` dùng (18 GB còn trống).
- Rehearsal G4 dùng [video G3 09/10/2026](evidence/g3-rehearsal-20261009.mp4) đã được review: 457.4 giây (7:37), source build cũ HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; thao tác Git thật app 1/deployment 5/v3, source SHA `8af16e1f9165a31557288adbc23acc420244938f`. Video im lặng, H.264, không audio stream. Đây **không** phải bản ghi G4 hay video trên build mới; không gọi phần deploy đã ghi là live G4.
- Không có deployment G4 mới, vì vậy app/deployment/image/container IDs vẫn theo v3 G3, không gán ID mới.

## Phiếu A4 và giới hạn

- [Phiếu HTML](phieu-demo.html) là bản nháp chờ Leader; [PDF A4 một trang](phieu-demo.pdf) được cập nhật sau phép đo G4a bên dưới.
- Verdict chỉ đề xuất: `DEMO_READY_RECORDED`, với điều kiện Leader chấp nhận video G3 trên build cũ. Live rehearsal G4a là `NOT_RUN`: tài nguyên đã vượt ngưỡng, nhưng không xác minh được bước precheck trong wizard Electron trước khi cho phép deploy. Không thay đổi deployment; fallback giữ nguyên app 1/deployment 5/v3 và source SHA `8af16e1f9165a31557288adbc23acc420244938f`.
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

## G4b — live rehearsal qua điều hướng từ app Git

**Kết quả:** `PASS` — trên Electron production build G4a và profile G2 biệt lập, mở chi tiết app Git rồi bấm **Triển khai phiên bản mới**. Wizard tự chọn VPS/app/nguồn Git; precheck đạt trước khi Start; redeploy thành công và rehearsal được quay trên cùng build. Không dùng video G3 làm bằng chứng cho phiên này.

- Build Electron đang chạy: UI source commit `b69d19e34541f9c04e89875f8620044fad29c453`; `HEAD:app` = `d2aa94a8c56dc6cdebf8d2def7740ea45dcfc810`. HEAD tài liệu tại lúc làm G4b là `54a7fd9a6dc1e87eb5db57b1eef248ce574578f5`; không có thay đổi runtime sau build.
- Điều hướng từ app `g2-express-20261009` (app ID 1) qua nút **Triển khai phiên bản mới** tự chọn `G2 Development VPS` (VPS ID 1, port 22), đúng app và Git source `https://github.com/everestt2806/opspilot.git`, ref `main`, root `demo-apps/express-api`. Prepare ghim full SHA `8af16e1f9165a31557288adbc23acc420244938f`; kiểm tra `git ls-remote` sau rehearsal vẫn trả cùng SHA.
- Ảnh chụp Electron thật, không chỉnh state/DOM/DB: [preselect](evidence/g4b-preselected-app.png), [precheck đạt trước Start](evidence/g4b-precheck-pass.png), [precheck lần xác nhận trong rehearsal](evidence/g4b-precheck-confirmation.png), [deploy thành công](evidence/g4b-deploy-success.png).
- Wizard precheck đạt trước Start: RAM available `3104 MB` (yêu cầu UI >512 MB; gate rehearsal ≥1 GiB), disk `18 GB` (yêu cầu >2 GB), Docker `29.8.2`; URL đích `http://160.191.243.89:30000`. Lượt precheck xác nhận lại sau đó: RAM available `3118 MB`, disk `18 GB`, Docker `29.8.2`. Không đọc hoặc ghi giá trị secret trong wizard.
- Redeploy cùng app qua UI thành công trong `32s`: DB profile biệt lập ghi app 1/current deployment 6; deployment 6/version 4, `running`, `reachable`, tag `g2-express-20261009:v4`, bắt đầu `2026-10-09T16:21:28Z`, hoàn tất `2026-10-09T16:21:59.781Z`, source Git SHA `8af16e1f9165a31557288adbc23acc420244938f`. `main`, v3 và v4 cùng SHA; đây là **redeploy cùng SHA**, không phải commit mới. Ứng dụng báo runtime đang chạy và truy cập ngoài đạt. SQLite không lưu container ID; truy vấn SSH CLI chỉ đọc với `BatchMode`/`StrictHostKeyChecking` kết thúc exit 255 (stderr không lưu), nên container ID chưa được xác minh và không được suy đoán. Không làm gián đoạn ba ứng dụng khác.
- Từ máy điều khiển sau redeploy: Git `/health` → HTTP 200; Vite `/` → HTTP 200; Next `/` → HTTP 200; Next route `/bai-viet/ops-pilot-la-gi` → HTTP 200. SHA remote `main` xác minh lại vẫn là `8af16e1f9165a31557288adbc23acc420244938f`.
- Rehearsal trên Electron cùng build: `2026-10-09 16:23:40–16:31:29 UTC` (7:49 thực tế; MP4 dài 7:48). Nội dung: app Git/detail và history SHA, hai app folder Vite/Next, đường điều hướng mới, Prepare/pinned SHA, detector Express và precheck. Bản ghi tạo qua Snipping Tool, microphone/system audio muted; Clipchamp export 720p/1280×720/30fps để giảm dung lượng. Đã mở file MP4 bằng Media Player, xác nhận dài 7:48 và xem hình ở đầu, 3:54, 7:30; file không có audio metadata/track, không có lời dẫn. File 24,640,419 bytes: [G4b live rehearsal](evidence/g4b-live-rehearsal-20261009.mp4).
- Verdict tại lần live ngày 09/10: deployment v4 đã chạy và HTTP ngoài đạt, nhưng clip không phải bản ghi đầy đủ và không được dùng làm video freeze. Xem correction 10/10 bên dưới; container ID vẫn là giới hạn chưa xác minh.

## Review G4 — chỉ số RAM cần xác minh lại

Leader review 09/10/2026: số 94% trên UI G4 đến từ `MemFree`, không thể dùng để kết luận `MemAvailable` dưới ngưỡng. G4a đã đo lại, đồng bộ semantics UI và precheck, và cập nhật phiếu/evidence ở dưới. Ba URL external HTTP 200 và video G3 là bằng chứng riêng vẫn có giá trị.

## G4a — MemAvailable và quyết định live gate

- Đo VPS chỉ đọc lúc `2026-10-09T15:36:45.322Z` UTC: `MemTotal=4,010,040 kB`, `MemFree=321,872 kB`, `MemAvailable=3,134,372 kB`. `MemFree` ≈314 MiB; `MemAvailable` ≈3,061 MiB; chênh lệch ≈2,747 MiB. Vì vậy UI G4 cũ báo 94% dùng không có nghĩa dưới 512 MiB khả dụng. `free -m` cũng báo 314 MB free; `MemAvailable` vượt gate 1 GiB.
- Cùng lượt probe read-only: disk trống 17,926 MB; bảy container kiểm tra ở trạng thái `healthy` hoặc `Up`; Docker stats cho thấy từng container dùng ít RAM; OOM matches từ 01/10 là 0. Trước đó Git Express `/health`, Vite `/` và Next `/` cùng route bài viết đều external HTTP 200. Không dừng app, prune Docker hay đổi firewall.
- Sửa `vps:get-resources` đọc riêng `MemTotal`, `MemFree`, `MemAvailable` từ `/proc/meminfo`; giữ IPC field `ram_free_mb` để tương thích nhưng giá trị giờ là `MemAvailable`, cùng nguồn với deploy precheck. Test bảo vệ parser, lệnh SSH, gate precheck và phần trăm RAM UI.
- Production Electron build source commit `b69d19e34541f9c04e89875f8620044fad29c453`; app tree `d2aa94a8c56dc6cdebf8d2def7740ea45dcfc810`, chạy trong profile G2 biệt lập. `vps:get-resources` fetch lúc khoảng `2026-10-09T15:44:16Z`; ảnh UI lúc khoảng `2026-10-09T15:46Z` hiện `817 MB / 3.8 GB` dùng (21%), disk `7/25 GB`, SSH/Docker/Compose/Git/workspace scan đạt: [Electron VPS resources](evidence/g4a-resources-memavailable.png). Public Git source prepare pin cùng full SHA `8af16e1f9165a31557288adbc23acc420244938f`.
- **Live redeploy/rehearsal G4a: `NOT_RUN`.** Dù phép đo tài nguyên vượt gate, không thể xác nhận app đích trong native dropdown wizard để chạy và ghi nhận precheck ngay trên build này. Vì precheck trong Electron là điều kiện bắt buộc trước deploy, dừng trước bước chạy; không có SSH deploy command/deployment mới nào. Không diễn giải điều này là VPS thiếu RAM. Fallback G3 giữ nguyên SHA/source và deployment v3 như trên.
- Đề xuất verdict `DEMO_READY_RECORDED` vẫn chờ Leader review; điều kiện chấp nhận video G3 trên build cũ vẫn cần nêu. PDF A4 đã cập nhật; không có video mới vì live gate chưa được xác minh hoàn chỉnh.

## G4a gates trên build UI đã kiểm tra

- Source commit `b69d19e34541f9c04e89875f8620044fad29c453`, app tree `d2aa94a8c56dc6cdebf8d2def7740ea45dcfc810`; Node `v22.23.3`, pnpm `11.1.0`.
- Focused: `pnpm --filter @opspilot/app exec vitest run src/main/vps/connectionService.test.ts src/main/deploy/precheck.test.ts src/renderer/src/components/VpsResourcesCell.test.tsx` — PASS, 3 files / 19 tests.
- `pnpm lint` — PASS, ESLint 0 errors; 5,784 Prettier warnings về CRLF trên các tệp Windows; Ruff pass.
- `pnpm --filter @opspilot/app typecheck` và `pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json --composite false` — PASS.
- `pnpm --filter @opspilot/app test` — PASS, 71 files / 674 tests. Vitest ghi jsdom warnings `getComputedStyle` pseudo-elements/canvas, exit code 0.
- `pnpm build` — PASS, production Electron/Vite build.
- `git diff --check` — PASS; Git có cảnh báo CRLF→LF khi chạm các tài liệu Windows.

## Review G4b — video và verdict chưa chốt

Leader kiểm tra lại 10/10/2026: SQLite app 1/current deployment 6/v4 là `running/reachable`, full SHA khớp remote; ảnh Electron preselect, precheck và deploy thành công có thật, bốn URL external HTTP 200. Phần live deploy core đạt. Tuy nhiên MP4 `g4b-live-rehearsal-20261009.mp4` có track `soun` trong cấu trúc file (chưa kết luận có âm thanh nghe được), trái với câu “không có audio track”; timestamp video 16:23:40Z bắt đầu sau khi deploy v4 hoàn tất 16:21:59Z, nên clip chỉ quay rehearsal/kiểm tra lại, **không ghi chính lượt deploy v4**. Verdict `DEMO_READY_LIVE` và phiếu PDF vẫn chờ correction G4b; container ID chưa xác minh được giữ là giới hạn minh bạch, không bịa giá trị.

## G4b correction — ảnh RAM lịch sử từ Electron cũ

- Ảnh [resource gate](evidence/g4b-correction-resource-gate-failed.png) được giữ làm bằng chứng UI lịch sử ngày `2026-10-10 00:05` UTC+07 (`2026-10-09T17:05Z`): tiến trình Electron cũ hiển thị `3.5/3.8 GB` (`91%`). Leader xác nhận PID `26684` khởi động ngày 09/10 lúc 15:35 giờ địa phương, trước fix `MemAvailable` trong `b69d19e` lúc 22:51. Mức 91% là kết quả của UI/process cũ; không chứng minh VPS thật dưới ngưỡng RAM; không suy ra `MemAvailable` hay trạng thái gate từ UI này.
- Ở lần đó đã dừng trước Prepare, wizard precheck và Start dựa trên UI hiển thị; do vậy precheck/redeploy correction vẫn `NOT_RUN`, không có SSH deploy/start command và không tạo deployment v5. Kết quả G5c sau đó thay thế cách diễn giải số 91%: collector deployment 6 cùng thời điểm ghi `host_mem_pct=20.58%`, còn ba lần refresh trên build hiện tại khớp collector khoảng 20–21%. Không thay đổi deployment 6/v4.
- Không thể tạo video liên tục mới cho correction vì không được Start. G3 full deploy video là fallback được chọn: [G3 rehearsal](evidence/g3-rehearsal-20261009.mp4), file `8,999,624` bytes, duration MP4 `457.4s` (7:37), source build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; video cho thấy deployment G3/v3, không phải build UI hiện tại hoặc deployment v4. MP4 có handler `vide` và `mdir` (metadata), không có handler `soun`; vì vậy không có audio track. Các khung nội dung đã được review kèm ảnh [trước history](evidence/g3-before-history.png), [Prepare/source](evidence/g3-prepare-source.png), [deployment thành công](evidence/g3-deploy-success.png), [history v3](evidence/g3-git-v3-history.png); hồ sơ G3 ghi toàn bộ video đã giải mã thành công. Clip G4b cũ giữ làm tư liệu lịch sử nhưng bị loại khỏi vai trò fallback vì có `soun` và bắt đầu sau khi deployment kết thúc.
- Bằng chứng G3 chỉ đại diện buổi deploy đã quay trên build cũ. Dữ liệu live riêng từ G4b 09/10 vẫn chứng minh v4/reachable, full SHA và URL như phần trên; không ghép nó với video thành một lượt quay liên tục. Đề xuất cuối: `DEMO_READY_RECORDED` chờ Leader review, kèm nhãn build cũ và trạng thái correction live `NOT_RUN`.
- Container ID vẫn chưa xác minh được (SQLite không lưu; truy vấn SSH read-only trước đó thoát 255); giữ nguyên giới hạn, không suy đoán ID.

## Leader review 10/10 — recorded fallback đã được chấp nhận

Leader kiểm tra độc lập: MP4 G3 có track `vide` và không có `soun`; MP4 G4b cũ có `vide`+`soun` và không dùng làm fallback. PDF hiện tại là A4 một trang, đã render xem không cắt chữ. App Git/Vite/Next vẫn external HTTP 200; `HEAD:app` giữ nguyên tree source build G4a. **`DEMO_READY_RECORDED` được chấp nhận làm phương án dự phòng**, với lời dẫn nói rõ video G3 là build cũ và deployment v3, còn app hiện tại đã tới v4. Live v4 có bằng chứng riêng. Kết luận resource dưới 1 GiB của correction khi đó dựa trên UI Electron cũ, đã được G5c đính chính; live vẫn chưa chạy vì thiếu kiểm tra vận hành và video liên tục trên build mới. [G5](../tasks/tk-s7-g5-memory-stability-demo-freeze.md) sẽ chẩn đoán RAM và chốt chế độ trước 14/10.

## G5 — chẩn đoán RAM và kết luận hiện hành

- G5 ban đầu bị chặn khi diagnostic riêng không giải mã được credential (`DB_ERROR`); đây là kết quả của diagnostic đó, không chứng minh app Electron đang chạy không thể kết nối. G5b cũng chưa xác minh được thao tác UI. Hai trạng thái này được cập nhật bởi phép thử trực tiếp G5c bên dưới.
- Ảnh correction G4b vẫn được giữ nguyên. Số `3.5/3.8 GB` (91%) đến từ Electron PID `26684`, được khởi động trước fix `b69d19e`; không phải phép đo đáng tin cậy để suy ra `MemAvailable` hoặc trạng thái gate của VPS. Collector deployment 6 ghi `host_mem_pct=20.58%` tại `2026-10-09T19:31:41Z` (SQLite nhận lúc `19:31:45Z`).
- G5c mở build hiện tại bằng cùng profile G2 sau khi đóng tiến trình cũ bình thường. `vps:get-resources` hoạt động qua SSH đã pin host key. Ba cặp UI/collector cùng phút UTC: 19:40 UI 801 MB/~21% và collector 20.29–20.56%; 19:43 UI 800 MB/~20% và collector 20.18–20.70%; 19:45 UI 792 MB/~20% và collector 20.34–20.53%. Các nguồn khớp khoảng 20–21%.
- **Kết luận G5:** sai lệch 91% trên UI đã được giải thích phù hợp với tiến trình Electron cũ chạy trước fix; lỗi hiển thị này không tái hiện trên build hiện tại. Không suy luận VPS đã giải phóng RAM vì restart chỉ áp dụng cho app cục bộ. Nguyên nhân vật lý của biến động lịch sử `MemAvailable` giữa các mốc G4a/G4b không được khẳng định từ bằng chứng hiện có.
- **Live rehearsal vẫn `NOT_RUN`** vì các kiểm tra vận hành còn thiếu chưa hoàn tất và chưa có video ghi liên tục một lượt deploy trên build mới từ trước Start đến kết quả/history/HTTP ngoài. Đây không phải do bằng chứng G5c cho thấy VPS dưới ngưỡng RAM. Giữ `DEMO_READY_RECORDED`, video G3 457.4s trên build cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`, deployment v3; container ID vẫn chưa xác minh.
- Điều kiện vận hành/video live còn thiếu được chuyển sang [checkpoint riêng](../tasks/tk-s7-g5-live-checkpoint.md). Không Prepare/Start/deploy trong G5c; không thay đổi credential hoặc VPS.
- Gates G5c: docs-only; kiểm tra `git diff --check`, PDF A4 một trang/nội dung trích xuất/render, relative links và MP4 fallback. Không chạy lint/typecheck/Vitest/build vì không thay đổi runtime.

## G5a — chốt phiếu theo recorded fallback

- Leader đã chấp nhận `DEMO_READY_RECORDED`; phiếu bỏ nhãn “BẢN NHÁP”. Phiếu mô tả video G3 là build cũ/deployment v3, app Git hiện tại là deployment 6/v4 và có bằng chứng HTTP riêng từ G4b ngày 09/10. Không nhập dữ liệu HTTP G4b vào phần mô tả video G3.
- Lịch chiếu toàn bộ video 7:37 được đổi thành tổng chương trình 10–12 phút. Kịch bản 6–8 phút chỉ dùng các đoạn tua chọn, gắn nhãn trích đoạn G3 không liên tục và giữ file đầy đủ làm đối chứng.
- Tại thời điểm G5a, RAM chưa được xác minh vì G5b chưa có kết quả UI. Kết luận đó được cập nhật bởi G5c; phiếu hiện hành nêu UI cũ 91% không chứng minh VPS dưới ngưỡng, UI mới khớp collector, và live rehearsal chưa chạy do thiếu kiểm tra vận hành cùng video liên tục trên build mới.
- PDF được in từ HTML bằng Edge headless với tùy chọn bỏ header/footer của trình duyệt; `pdfinfo` xác nhận 1 trang/A4, render đã xem, text trích xuất không có timestamp/header/footer hoặc URI `file:///`. Relative links không thiếu; MP4 G3 đọc được, 457.4s, handlers `vide`/`mdir`, không có `soun`; `git diff --check` pass.

## G5b — kiểm tra refresh tài nguyên trong Electron đang chạy

- Thời điểm: `2026-10-09T19:22Z` UTC. Mở cửa sổ OpsPilot đang chạy (Electron PID 26684) ở trang Servers. UI liệt kê VPS G2 Development VPS và ba app; cột lần kết nối vẫn hiện `2 hours ago`.
- Gọi nút **Refresh** của trang bằng UI Automation; `InvokePattern.Invoke()` trả về. Sau đó accessibility snapshot vẫn hiện `2 hours ago`, với bộ đếm `Vừa kiểm tra 0` và `Không thể kiểm tra 0`. Không thấy trạng thái `checking`, lỗi hay giá trị tài nguyên mới.
- Sau thao tác, ảnh được chụp bởi computer-use provider hiển thị một cửa sổ toàn màn hình khác thay vì Electron. Vì trạng thái giao diện không đổi và ảnh không xác nhận đúng cửa sổ, không thể khẳng định `vps:get-resources` đã chạy hoặc đọc được SSH; cũng không kết luận rằng SSH host-pinned thất bại. Đây là **điểm chặn xác minh UI**, không phải bằng chứng về lỗi safeStorage trong app thật.
- Không thu mẫu VPS ở G5b và không thử kết nối khác. Không sửa credential/fingerprint, không tạo lệnh SSH ngoài app, không redeploy và không tác động VPS.
- **Điều kiện gỡ (đã hoàn tất ở G5c):** foreground cửa sổ Electron, xác nhận một refresh mới trên build hiện tại, rồi đối chiếu ba mẫu chỉ đọc với collector deployment 6. Kết quả thành công qua SSH host pinning được ghi ở G5c; các điều kiện vận hành/live còn mở được theo dõi ở checkpoint riêng.


## G5c — xác minh app mới và đối chiếu RAM với collector

- Leader cung cấp bằng chứng lịch sử: OpsPilot PID `26684` khởi động ngày 09/10 lúc 15:35 giờ địa phương, trước commit `b69d19e` sửa `MemAvailable` lúc 22:51; bundle hiện tại được ghi lúc 23:52. Ở lần Refresh cũ, UI báo `3.5/3.8 GB` (91%). Tuy nhiên collector của deployment 6 ghi `host_mem_pct=20.58` tại `2026-10-09T19:31:41Z`, được SQLite nhận lúc `19:31:45Z`. Các mốc này phù hợp giả thuyết cửa sổ UI đang chạy process cũ chưa có bản sửa.
- Trước khi thay process, xác nhận profile biệt lập G2 `%LOCALAPPDATA%\Temp\opspilot-g2-20261009`, DB và protected key còn tồn tại, chỉ có một Electron main instance dùng profile, process chạy dưới Windows user hiện tại. Đóng PID `26684` bình thường; xác nhận mọi process dùng profile đã thoát. Mở production build hiện tại từ `app/out` dưới cùng Windows user và cùng profile; PID mới là `32832`, không tạo lại key hay profile. Sau khi mở, xác nhận chỉ PID main `32832` cùng các process con dùng profile này.
- Resource panel tự refresh khi mở. Sau đó các lần Refresh bằng nút **Làm mới** trong cửa sổ Electron mới thành công qua SSH host pinning. Ba cặp mẫu cùng phút UTC, với SQLite truy vấn `mode=ro` chỉ các cột timestamp/deployment/RAM (không đọc `raw_json`):

| Phút UTC | UI Electron hiện tại | Collector deployment 6 trong cùng phút |
|---|---:|---:|
| 19:40 | 801 MB / 3.8 GB (~21%) | `host_mem_pct` 20.29–20.56%; mẫu `19:40:31Z` được nhận `19:40:35.307Z`: 20.5511% |
| 19:43 | 800 MB / 3.8 GB (~20%) | `host_mem_pct` 20.18–20.70% |
| 19:45 | 792 MB / 3.8 GB (~20%) | `host_mem_pct` 20.34–20.53% |

- Kết quả hiện tại xác nhận `vps:get-resources` hoạt động trên app thật và giá trị RAM UI mới khớp collector cùng phút. Giả thuyết stale Electron process được hỗ trợ mạnh: PID cũ chạy từ trước bản sửa; sau khi đóng bình thường và mở build mới với nguyên profile, UI chuyển từ 91% xuống khoảng 20%, đồng thời collector cũng khoảng 20%. Không suy luận rằng VPS đã giải phóng RAM do restart app; chỉ app cục bộ được đóng/mở. Điều tra nguyên nhân của khác biệt lịch sử G4a/G4b vẫn chưa đủ chuỗi process/container/pressure để quy nguyên nhân VPS.
- G5c chỉ đọc dữ liệu resource qua app và SQLite cục bộ; không deploy, không chạy lệnh thay đổi VPS, không thay credential/fingerprint. Live rehearsal vẫn `NOT_RUN`; giữ `DEMO_READY_RECORDED` và video G3 build cũ/deployment v3. Container ID vẫn chưa xác minh.

## G5-live — kiểm tra vận hành và điểm dừng trước Start (2026-10-09 UTC)

**Kết quả:** `BLOCKED / NOT_RUN`. Lượt này dùng Electron production build `app/out` trên branch `feat/deploy-reachability`, HEAD lúc bắt đầu `b3b784e`, cùng profile G2 hiện có. `vps:get-resources` thành công qua SSH host key đã pin. Không chạy SSH ngoài app, không thay credential, không thay đổi dịch vụ VPS.

| Mẫu UTC | RAM UI | Disk UI | SQLite collector deployment 6 | Container |
|---|---:|---:|---:|---|
| 20:38 | 807 MB / 3.8 GB (~21%) | 7 / 25 GB | host_mem_pct 20.50–20.85% | `container_up=1` |
| 20:39 | 816 MB / 3.8 GB (~21%) | 7 / 25 GB | host_mem_pct 20.43–20.85% | `container_up=1` |
| 20:41 | 796 MB / 3.8 GB (~20%) | 7 / 25 GB | 20:41:01Z 20.72%; 20:41:11Z 20.71% | `container_up=1` |

Docker version hiển thị 29.8.2. Ba URL từ máy điều khiển lúc `2026-10-09T20:41:53Z` đều trả HTTP 200: Git Express `/health` trên cổng 30000, Vite `/` trên cổng 30001, Next.js `/` trên cổng 30002.

**Gate chưa đạt:** app hiện tại không cung cấp process RSS hoặc memory pressure/OOM counters qua đường chẩn đoán đã dùng; các mục này là `NOT_VERIFIED`. Wizard mở từ App detail → **Triển khai phiên bản mới**, chuẩn bị nguồn Git public và nhận diện Express, nhưng bước cấu hình chặn với thông báo thiếu `PORT` và `ENABLE_FAULT_ENDPOINTS`; vì vậy precheck là `NOT_RUN`. Thoát wizard trước Start. Không tạo job/deployment, không redeploy, không ghi video.

Giữ `DEMO_READY_RECORDED`: video G3 là build cũ/deployment v3; app Git hiện tại vẫn deployment v4 với bằng chứng HTTP riêng đã ghi. Không có video liên tục cùng build mới từ trước Start tới history/HTTP; không tuyên bố live readiness. PDF A4 không đổi vì verdict vẫn là recorded fallback.

## G5-live C2d — operational gate thật trên Electron, dừng trước Start (2026-10-09 UTC)

- Xác minh và mở đúng production build `app/out` trên branch `feat/deploy-reachability`, HEAD `4bba7c232d64443ee383dade607ca9d9c57fea5f`; cửa sổ Electron mới có PID `35168`. Đóng instance cũ bình thường, giữ profile G2/SQLite/key hiện có; không tạo lại profile/key và không tác động process/service khác. Diagnostics chỉ được gọi thủ công trong VPS Overview qua app và SSH host pinning đã lưu.
- Ba mẫu dưới đây cách nhau ít nhất 60 giây. RAM/disk lấy qua `vps:get-resources`; collector là deployment 6 trong cùng phút. Mỗi lần diagnostics có process list khả dụng; PSI `avg10` được hiển thị theo phần trăm. OOM là counter tích lũy, không tăng trong ba lần lấy mẫu.

| Mẫu UTC | RAM dùng / tổng; disk dùng / tổng | PSI some/full avg10 | OOM kill tích lũy | Top process theo RSS (MB) | Collector container / host RAM |
|---|---|---:|---:|---|---|
| `2026-10-09T21:52:53Z` | 828 MB / 3.8 GB (~21%); 7 / 25 GB | 0.00% / 0.00% | 0 | `dockerd` 139.63; `next-server (v1` 103.43; `node` 79.61; `npm start` 75.52; `containerd` 57.58; `python` 36.00, 29.21; `multipathd` 26.50; `postgres` 26.38 | `container_up=1`; 20.6776% |
| `2026-10-09T21:54:39Z` | 795 MB / 3.8 GB (~20%); 7 / 25 GB | 0.00% / 0.00% | 0 | `dockerd` 139.63; `next-server (v1` 103.53; `node` 79.59; `npm start` 75.52; `containerd` 57.58; `python` 36.00; `docker` 29.25; `python` 29.21, 29.08; `multipathd` 26.50 | `container_up=1`; 20.7258% |
| `2026-10-09T21:56:33Z` | 797 MB / 3.8 GB (~20%); 7 / 25 GB | 0.00% / 0.00% | 0 | `dockerd` 139.63; `next-server (v1` 103.68; `node` 79.75; `npm start` 75.52; `containerd` 57.58; `python` 36.00, 29.21, 29.08; `multipathd` 26.50; `postgres` 26.38 | `container_up=1`; 20.5352% |

- Operational sample gate: `PASS` for the requested read-only RAM, disk, process RSS, pressure, OOM and container observations. Git Express is app `g2-express-20261009`, deployment v4, ref `main`, root `demo-apps/express-api`, full source SHA `8af16e1f9165a31557288adbc23acc420244938f`; exposure was shown reachable. No fingerprint, credential, or sensitive command output is recorded.
- Existing-app redeploy wizard was inspected and exited before Start. It showed detector-derived `PORT=3000`, explicit safe `ENABLE_FAULT_ENDPOINTS=false`, and warned that existing VPS environment values are not loaded and secrets are not auto-filled. `DATABASE_URL` remains required but blank/unavailable locally; precheck is `NOT_RUN` because supplying it would require guessing or re-entering an unknown secret. No job, Start, deployment, redeploy, or VPS mutation occurred.
- External HTTP GET verification at `2026-10-09T22:01:28Z`: `http://160.191.243.89:30000/health` — 200; `http://160.191.243.89:30001/` — 200; `http://160.191.243.89:30002/` — 200.
- Overall G5-live remains `BLOCKED / NOT_RUN`: precheck and same-build deploy/video gates are incomplete. Retain `DEMO_READY_RECORDED`, with the G3 recording labeled old build/deployment v3; current Git app remains v4 with its separate HTTP evidence. This checkpoint does not claim live readiness and does not change the PDF or VPS services.

## G5-live C3b - C3a verification and safe precheck (2026-10-10 UTC)

**Result:** C3b precheck `PASS`; G5-live overall remains `BLOCKED / NOT_RUN` because C3b intentionally stopped before Start and no same-build deployment/video was attempted. C3c may proceed with its single planned redeploy, subject to its own final checks; the live/video gates remain open.

- Node 22.23.3 gates were run by Leader on application-source commit `f68018c035ceaf29b02942cc9c9ad64833d3e5d2`: full Vitest `72 files / 712 tests PASS`; Node/Web/Scripts typecheck PASS; lint PASS with 0 errors and 18 Prettier warnings; production build PASS. Current branch HEAD `83c88c445a636e3c556ec5481da0ba5a7c6d0ebe` is a docs-only demo-planning commit and does not change app source; no source files changed during C3b.
- Production Electron PID `37064` showed `file:///D:/Developing/DuAnCNTT/app/out/renderer/index.html`; only one OpsPilot main window remained. The existing `%TEMP%/opspilot-g2-20261009` profile, SQLite DB and protected-key file existed before launch; UI showed the saved G2 Development VPS, three existing apps and Git Express v4. No profile, DB, key, credential or fingerprint was recreated or changed.
- Existing Git app: `g2-express-20261009`, deployment v4; repo `https://github.com/everestt2806/opspilot.git`, ref `main`, root `demo-apps/express-api`. App history and prepared snapshot UI both showed full SHA `8af16e1f9165a31557288adbc23acc420244938f`.
- One explicit diagnostics sample at `2026-10-10T06:58:28Z` (UI local `13:58:28`, UTC+7): `vps:get-resources` showed RAM `801 MB / 3.8 GB` and disk `8 / 25 GB` used; diagnostics showed PSI some/full avg10 `0.00% / 0.00%`, cumulative `oom_kill_count=0`, and process data available. The ten highest RSS processes (name / MB): `dockerd` 139.35; `next-server (v1` 103.17; `node` 80.13; `npm start` 75.52; `containerd` 58.06; `fwupd` 42.38; `python` 36.00; `python` 29.34; `python` 29.08; `docker` 28.88. Wizard precheck separately reported 3115 MB RAM free and 18 GB disk free.
- Wizard was opened from the existing app detail and pinned `main` to the SHA above. User explicitly reviewed environment reuse; only known safe values `PORT=3000` and `ENABLE_FAULT_ENDPOINTS=false` were entered. `DATABASE_URL` remained blank; no secret was supplied or displayed. Precheck at `2026-10-10T07:02:56Z`: RAM free `3115 MB` PASS; disk free `18 GB` PASS; Docker `29.8.2` PASS; required environment check PASS (values were not returned).
- External HTTP GET at `2026-10-10T06:59:23Z` returned `200` for `http://160.191.243.89:30000/health`, `http://160.191.243.89:30001/`, and `http://160.191.243.89:30002/`. An initial PowerShell request produced no status; the final `curl.exe` GET check is authoritative.
- `Bắt đầu triển khai` remained untouched. No job, deployment, Start, SSH command outside OpsPilot, service change, firewall change or VPS mutation occurred. No credential or fingerprint is included here. Keep `DEMO_READY_RECORDED` until C3c supplies continuous silent-video and post-deploy evidence.

## G5-live C3c - stop before Start: continuous capture unavailable (2026-10-10 UTC)

**Result:** redeploy `NOT_RUN`; G5-live remains `BLOCKED / NOT_RUN` and fallback `DEMO_READY_RECORDED` stays in force.

- At `2026-10-10T07:09Z`, checked capture readiness before Start. `orca computer capabilities --json` reports screenshots but no video recording capability; local `ffmpeg`, `obs64` and `obs` commands/processes were not available. No continuous silent recorder or reliable audio-track validation was ready, so the required recording gate failed.
- Current Electron PID `37064` is the production renderer `file:///D:/Developing/DuAnCNTT/app/out/renderer/index.html`, with the existing G2 profile. The visible wizard was at the final Check & Run step for `g2-express-20261009`; repo/ref/root matched the C3b source, whose full SHA was `8af16e1f9165a31557288adbc23acc420244938f` (not re-prepared in this attempt). It showed the prior resource and required-environment checks. That precheck was sampled at `2026-10-10T07:02:56Z`, older than the 5-minute token lifetime at this checkpoint, and was not reused as a fresh gate.
- Fresh diagnostics, resource/PSI/OOM, external HTTP checks and a new precheck were `NOT_RUN` because capture was unavailable before Start. No Start click, job, deployment/redeploy, SSH outside OpsPilot, service/firewall change or VPS mutation occurred; no secret was entered, read or recorded.
- Resume only when a continuous screen recorder can be started before Start and the resulting MP4 can be checked for no audio track. Then repeat the full fresh gates and source pin checks; if any gate fails, stop before Start. Keep the G3 video explicitly labeled old build/deployment v3 until a continuous same-build redeploy recording and post-deploy evidence pass.

## G5-live C3d - redeploy v5 succeeded; continuous evidence rejected (2026-10-10 UTC)

**Result:** one authorized same-SHA redeploy completed and the post-deploy app/HTTP checks passed. The recording file did not contain the full session through Start, so G5-live remains `BLOCKED / PARTIAL`; retain `DEMO_READY_RECORDED` and the G3 old-build/deployment-v3 fallback. No second redeploy was attempted.

| Gate | UTC / result | Evidence |
|---|---|---|
| Electron/profile | Before checks; PASS | Existing production renderer `app/out/renderer/index.html`, Electron PID `37064`, existing G2 profile, one OpsPilot app window; branch `feat/deploy-reachability`, worktree HEAD `359f1af2ea02f62574abdd6825bf61e2cc1ee049`. No profile, SQLite, key, credential or fingerprint was recreated or changed. |
| Existing app/source | Before Prepare; PASS | Git app `g2-express-20261009`, v4, repo `https://github.com/everestt2806/opspilot.git`, ref `main`, root `demo-apps/express-api`; history SHA `8af16e1f9165a31557288adbc23acc420244938f`. |
| Read-only VPS sample | `2026-10-10T07:37:51Z`; PASS for returned fields | In app VPS Overview, manual diagnostics sample: RAM `799 MB / 3.8 GB`, disk `8 / 25 GB`; PSI some/full avg10 `0.00% / 0.00%`; cumulative OOM count `0`; top-process RSS available. Top processes (PID/name/RSS MB): `7810/dockerd/139.35`, `35463/next-server (name truncated)/103.33`, `452580/node/80.29`, `35381/npm start/75.52`, `7679/containerd/57.75`, `452496/python/36.00`, `1139660/docker/29.75`, `35293/python/29.34`, `31987/python/29.08`, `300/systemd-journal/28.21`. These are one observation only; OOM trend was not re-sampled. Collector `container_up` at the same minute: `NOT_RUN`. |
| Environment review | Before precheck; PASS | Explicit review checkbox checked; only known values entered: `PORT=3000`, `ENABLE_FAULT_ENDPOINTS=false`; `DATABASE_URL` stayed blank and was not read/displayed. UI stated blank values reuse existing VPS `.env` only after precheck verification and PostgreSQL credentials are preserved. |
| Fresh precheck | Approximately `2026-10-10T07:40Z`; PASS | Electron reported free RAM `3104 MB`, free disk `18 GB`, Docker `29.8.2`, required remote environment keys available. No values were returned. Precheck was current when the single Start click occurred at `2026-10-10T07:41:01Z`. |
| Pre-deploy HTTP | `2026-10-10T07:40:52Z`; PASS | Incognito browser/curl GETs: Express `/health`, Vite `/`, Next `/` each HTTP 200. |
| Deploy | Started `2026-10-10T07:41:01Z`; PASS | Exactly one App detail → **Triển khai phiên bản mới** run on the prepared same SHA. OpsPilot showed all 7 stages complete and success in 35s; history shows app `g2-express-20261009`, v5, `running`, `Reachable`, build 33s, full SHA `8af16e1f9165a31557288adbc23acc420244938f`. A separate deployment ID was not surfaced in the UI. |
| Post-deploy proof | `2026-10-10T07:41:49Z`; PASS | OpsPilot app overview/history showed v5 `running/reachable`; HTTP GETs to Express `/health`, Vite `/`, Next `/` each returned 200. Incognito pages showed Express JSON health response, Vite API health `OK`, and the Next blog page. |
| Continuous video | Capture ran before Start; FAIL | Snipping Tool toolbar showed recording active with microphone and system audio muted before Start. Saved raw file `Screen Recording 2026-10-10 144355.mp4` was only `148.433 s` (`2:28`) and contained H.264 video plus a 2-channel AAC track, despite both mute indicators. FFmpeg `-map 0:v:0 -c:v copy -an -movflags +faststart` produced a temporary video-only file (one H.264 stream, `148.433 s`), but review at the beginning, middle and end showed it ended at the environment configuration screen before precheck/Start; it did not record the deployment, history or external HTTP. Neither raw nor incomplete remux was added to the repository. |

No credential, private key, fingerprint, secret value, raw SSH command/output, or full environment content was recorded in this evidence. The one intended Git Express redeploy is the only deployment action; no firewall or other VPS service was changed. The failed capture means the task does not meet continuous same-build video acceptance even though the v5 runtime and external HTTP checks passed.
