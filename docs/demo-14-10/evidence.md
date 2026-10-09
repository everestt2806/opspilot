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

## G4b correction — resource gate dừng trước redeploy

- Làm mới resource trong Electron production build/profile G2 ngày `2026-10-10 00:05` UTC+07 (`2026-10-09T17:05Z`). Ảnh mới: [resource gate không đạt](evidence/g4b-correction-resource-gate-failed.png). UI hiển thị RAM dùng `3.5/3.8 GB` (`91%`), tương đương khoảng `0.3 GB` khả dụng theo semantics `MemAvailable` đã đồng bộ ở G4a; ngưỡng rehearsal là `≥1 GiB`. Disk dùng `7/25 GB` (khoảng `18 GB` trống), Docker `29.8.2`.
- Do RAM khả dụng dưới gate, dừng trước Prepare, wizard precheck và Start. Precheck/redeploy của correction là `NOT_RUN`; không có SSH deploy/start command, không tạo deployment v5. App vẫn ở deployment 6/v4 từ lượt G4b trước. Không chạy lại trên VPS khi tài nguyên chưa đạt.
- Không thể tạo video liên tục mới cho correction vì không được Start. G3 full deploy video là fallback được chọn: [G3 rehearsal](evidence/g3-rehearsal-20261009.mp4), file `8,999,624` bytes, duration MP4 `457.4s` (7:37), source build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; video cho thấy deployment G3/v3, không phải build UI hiện tại hoặc deployment v4. MP4 có handler `vide` và `mdir` (metadata), không có handler `soun`; vì vậy không có audio track. Các khung nội dung đã được review kèm ảnh [trước history](evidence/g3-before-history.png), [Prepare/source](evidence/g3-prepare-source.png), [deployment thành công](evidence/g3-deploy-success.png), [history v3](evidence/g3-git-v3-history.png); hồ sơ G3 ghi toàn bộ video đã giải mã thành công. Clip G4b cũ giữ làm tư liệu lịch sử nhưng bị loại khỏi vai trò fallback vì có `soun` và bắt đầu sau khi deployment kết thúc.
- Bằng chứng G3 chỉ đại diện buổi deploy đã quay trên build cũ. Dữ liệu live riêng từ G4b 09/10 vẫn chứng minh v4/reachable, full SHA và URL như phần trên; không ghép nó với video thành một lượt quay liên tục. Đề xuất cuối: `DEMO_READY_RECORDED` chờ Leader review, kèm nhãn build cũ và trạng thái correction live `NOT_RUN`.
- Container ID vẫn chưa xác minh được (SQLite không lưu; truy vấn SSH read-only trước đó thoát 255); giữ nguyên giới hạn, không suy đoán ID.

## Leader review 10/10 — recorded fallback đã được chấp nhận

Leader kiểm tra độc lập: MP4 G3 có track `vide` và không có `soun`; MP4 G4b cũ có `vide`+`soun` và không dùng làm fallback. PDF hiện tại là A4 một trang, đã render xem không cắt chữ. App Git/Vite/Next vẫn external HTTP 200; `HEAD:app` giữ nguyên tree source build G4a. **`DEMO_READY_RECORDED` được chấp nhận làm phương án dự phòng**, với lời dẫn nói rõ video G3 là build cũ và deployment v3, còn app hiện tại đã tới v4. Live v4 có bằng chứng riêng nhưng correction resource dưới 1 GiB nên chưa nâng verdict live. [G5](../tasks/tk-s7-g5-memory-stability-demo-freeze.md) sẽ chẩn đoán RAM và chốt chế độ trước 14/10.

## G5 — chẩn đoán RAM và verdict freeze

- Thời điểm điều tra: `2026-10-09T17:39Z` UTC. Dùng profile Electron G2 biệt lập `%LOCALAPPDATA%\Temp\opspilot-g2-20261009`; mở database `opspilot.db` chỉ đọc. Không xuất giá trị credential, private key hay secret.
- **Không thu được mẫu VPS mới (`BLOCKED`).** Diagnostic dừng ở giai đoạn khởi tạo cipher: mã lỗi `DB_ERROR` khi Windows safeStorage giải mã `credential-master-key.protected`. Diagnostic Electron riêng cũng không ghi report để xác nhận safeStorage. Không tạo SSH connection, không thay fingerprint/auth method, không dùng console ngoài vì không có kênh console được cung cấp/xác minh trong phiên này.
- Do không có SSH sample, không có timestamp `free -m`, `/proc/meminfo`, process RSS, Docker stats/status, PSI/OOM, disk hoặc URL probe mới ở G5; cũng không có số `vps:get-resources` đồng thời để đối chiếu. Không tuyên bố trạng thái hiện tại của VPS từ dữ liệu cũ.
- **Nguyên nhân giảm MemAvailable chưa xác định.** G4a ghi `MemAvailable=3,134,372 kB` (2026-10-09T15:36:45Z); G4b correction hiển thị khoảng `0.3 GB` khả dụng (10/10 00:05 UTC+07). Hai lần đo cách thời điểm và thiếu chuỗi process/container/pressure nên không quy được phần giảm cho OpsPilot hay tiến trình nào. Không sửa runtime vì chưa có bằng chứng lỗi product.
- **Live rehearsal G5: `NOT_RUN`.** Không đủ bằng chứng RAM ổn định ≥1 GiB và không chạy wizard precheck; dừng trước Prepare/Start. Không redeploy, restart, stop, prune hoặc tác động dữ liệu. Các ứng dụng giữ nguyên thông tin đã xác nhận gần nhất: Git Express deployment 6/v4, Vite và Next. Container ID vẫn chưa xác minh.
- Verdict giữ `DEMO_READY_RECORDED` đã được Leader chấp nhận. Fallback là nguyên video [G3 rehearsal](evidence/g3-rehearsal-20261009.mp4), 457.4s, build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`, deployment v3; không đại diện build hiện tại hoặc deployment v4.
- Gates G5: chỉ thay đổi tài liệu; `git diff --check` pass, PDF xác minh A4 một trang và render xem không cắt chữ, toàn bộ relative links tồn tại, fallback G3 MP4 tồn tại (8,999,624 bytes). Cấu trúc video không đổi so với kiểm tra G4 đã ghi ở trên. Không chạy lint/typecheck/Vitest/build vì không có thay đổi runtime.

## G5a — chốt phiếu theo recorded fallback

- Leader đã chấp nhận `DEMO_READY_RECORDED`; phiếu bỏ nhãn “BẢN NHÁP”. Phiếu mô tả video G3 là build cũ/deployment v3, app Git hiện tại là deployment 6/v4 và có bằng chứng HTTP riêng từ G4b ngày 09/10. Không nhập dữ liệu HTTP G4b vào phần mô tả video G3.
- Lịch chiếu toàn bộ video 7:37 được đổi thành tổng chương trình 10–12 phút. Kịch bản 6–8 phút chỉ dùng các đoạn tua chọn, gắn nhãn trích đoạn G3 không liên tục và giữ file đầy đủ làm đối chứng.
- Phiếu chỉ ghi “RAM hiện chưa xác minh được; không diễn tập deploy live”. Chi tiết `DB_ERROR` và chẩn đoán nằm trong phần evidence G5, không nằm trên phiếu.
- PDF được in từ HTML bằng Edge headless với tùy chọn bỏ header/footer của trình duyệt; `pdfinfo` xác nhận 1 trang/A4, render đã xem, text trích xuất không có timestamp/header/footer hoặc URI `file:///`. Relative links không thiếu; MP4 G3 đọc được, 457.4s, handlers `vide`/`mdir`, không có `soun`; `git diff --check` pass.

## G5b — kiểm tra refresh tài nguyên trong Electron đang chạy

- Thời điểm: `2026-10-09T19:22Z` UTC. Mở cửa sổ OpsPilot đang chạy (Electron PID 26684) ở trang Servers. UI liệt kê VPS G2 Development VPS và ba app; cột lần kết nối vẫn hiện `2 hours ago`.
- Gọi nút **Refresh** của trang bằng UI Automation; `InvokePattern.Invoke()` trả về. Sau đó accessibility snapshot vẫn hiện `2 hours ago`, với bộ đếm `Vừa kiểm tra 0` và `Không thể kiểm tra 0`. Không thấy trạng thái `checking`, lỗi hay giá trị tài nguyên mới.
- Sau thao tác, ảnh được chụp bởi computer-use provider hiển thị một cửa sổ toàn màn hình khác thay vì Electron. Vì trạng thái giao diện không đổi và ảnh không xác nhận đúng cửa sổ, không thể khẳng định `vps:get-resources` đã chạy hoặc đọc được SSH; cũng không kết luận rằng SSH host-pinned thất bại. Đây là **điểm chặn xác minh UI**, không phải bằng chứng về lỗi safeStorage trong app thật.
- Không thu mẫu VPS ở G5b và không thử kết nối khác. Không sửa credential/fingerprint, không tạo lệnh SSH ngoài app, không redeploy và không tác động VPS.
- **Điều kiện gỡ:** đưa cửa sổ OpsPilot lên foreground nhìn thấy được thay vì cửa sổ fullscreen phủ lên, bấm Refresh trong app, rồi xác nhận tại cùng cửa sổ một trạng thái mới (`checked_now`/giá trị RAM-disk mới hoặc `check_failed` cùng thông báo). Nếu refresh trả thành công qua SSH đã pin, tiếp tục ba mẫu chỉ đọc cách nhau vài phút và đối chiếu với resource result. Giữ demo recorded cho tới khi xác minh được.


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
