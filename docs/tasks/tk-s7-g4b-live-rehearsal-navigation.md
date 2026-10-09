# TK-S7 G4b — Diễn tập live qua đường điều hướng app đã liên kết

> G4a xác nhận `MemAvailable` khoảng 3 GiB, disk còn khoảng 18 GB và ba app đang HTTP 200. Live G4a dừng do công cụ GUI không chọn được `<select>` native. Đường sản phẩm đã có: từ chi tiết Git app bấm **Triển khai phiên bản mới**; `AppsPage.tsx` set `deployPreselect({ vpsId, appId })`, rồi `DeployPage.tsx` tự chọn app/VPS/nguồn Git sau `app:list`. Không sửa React state, SQLite hoặc IPC bằng tay để tạo bằng chứng live.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | Trước freeze 13/10/2026; không cắt gate | `feat/deploy-reachability` | P0 |

## Definition of Done

- [x] Trên Electron production build hiện tại và profile G2 biệt lập, mở chi tiết `g2-express-20261009` → bấm **Triển khai phiên bản mới**. Wizard tự chọn đúng VPS (ID 1), app (ID 1), nguồn Git, repo/ref/root và full SHA; ảnh chụp thật nằm tại `evidence/g4b-preselected-app.png`. Không sửa state/DOM/DB thủ công.
- [x] Read-only resource gate và wizard **Kiểm tra trước** đạt: MemAvailable 3104 MB (xác nhận lại 3118 MB), disk 18 GB, Docker 29.8.2; ba URL được kiểm tra HTTP 200 sau redeploy. Bằng chứng precheck đúng app/port ở `evidence/g4b-precheck-pass.png` và `evidence/g4b-precheck-confirmation.png`.
- [ ] Redeploy Git từ app đã liên kết thành công sau precheck. Đã ghi source build commit/tree, repo/ref/full SHA, app/deployment/version, timestamps, image tag, exposure và HTTP loopback/external trong `../demo-14-10/evidence.md`; remote/main/v3/v4 đều cùng SHA nên là redeploy cùng SHA. **Container ID chưa được xác minh**: SQLite không lưu ID, truy vấn SSH CLI chỉ đọc thoát 255; không suy đoán ID. Phần này còn thiếu so với DoD.
- [x] Diễn tập 7:49 và quay MP4 7:48 trên cùng build. File mở được, hình đã kiểm tra đầu/giữa/cuối, không có audio track; cập nhật `evidence.md`, script và phiếu HTML/PDF A4 một trang. Không dùng video G3 làm bằng chứng cho G4b.
- [x] Node 22 lint, Node/Web/Scripts typecheck, full Vitest, build và `git diff --check` đều đạt trên source cuối; ghi cảnh báo thật bên dưới. Đề xuất `DEMO_READY_LIVE` chờ Leader review, với giới hạn container ID nêu trên. Cập nhật board/task và commit cục bộ; không push/PR/merge.

## Nhật ký

- START 09/10/2026 — Tiếp tục trên `feat/deploy-reachability`; mở build Electron production source G4a trong profile G2 và thử đúng nút app detail **Triển khai phiên bản mới**. Xác minh nguồn/app/VPS, tài nguyên read-only và precheck trên wizard trước khi quyết định Start.
- PLAN 09/10 — Leader review G4a resource fix và thấy đường preselect app từ nút **Triển khai phiên bản mới** đã có sẵn. G4b kiểm chứng live gate trên đúng UX đó trước khi freeze.
- UPDATE 09/10/2026 — G4b live PASS: điều hướng từ Git app detail preselect đúng app/VPS/Git; Electron precheck pass trước Start; redeploy cùng SHA hoàn tất; rehearsal 7:49 được quay trên cùng build. Evidence, script và PDF A4 cập nhật. Container ID không thu được (SSH CLI read-only exit 255), nên DoD mục container ID còn mở; không bịa giá trị. Đề xuất `DEMO_READY_LIVE` để Leader review với giới hạn này.
- GATES 09/10/2026 — Node `v22.23.3`, pnpm `11.1.0`: `pnpm lint` PASS (0 ESLint errors, 5,784 Prettier CRLF warnings, Ruff PASS); `pnpm --filter @opspilot/app typecheck` PASS (Node/Web); `pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json --composite false` PASS; `pnpm --filter @opspilot/app test` PASS (71 files, 674 tests; jsdom canvas/getComputedStyle pseudo-element warnings, exit 0); `pnpm build` PASS; `git diff --check` PASS (Git CRLF→LF notices only).
- HANDOFF-LOCAL 09/10/2026 — Đã chuẩn bị commit cục bộ các file G4b và evidence; không push, PR hoặc merge.

## PR

Chưa được phép push, mở PR hoặc merge.
