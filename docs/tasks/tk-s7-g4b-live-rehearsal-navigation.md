# TK-S7 G4b — Diễn tập live qua đường điều hướng app đã liên kết

> G4a xác nhận `MemAvailable` khoảng 3 GiB, disk còn khoảng 18 GB và ba app đang HTTP 200. Live G4a dừng do công cụ GUI không chọn được `<select>` native. Đường sản phẩm đã có: từ chi tiết Git app bấm **Triển khai phiên bản mới**; `AppsPage.tsx` set `deployPreselect({ vpsId, appId })`, rồi `DeployPage.tsx` tự chọn app/VPS/nguồn Git sau `app:list`. Không sửa React state, SQLite hoặc IPC bằng tay để tạo bằng chứng live.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | Trước freeze 13/10/2026; không cắt gate | `feat/deploy-reachability` | P0 |

## Definition of Done

- [x] Trên Electron production build hiện tại và profile G2 biệt lập, mở chi tiết `g2-express-20261009` → bấm **Triển khai phiên bản mới**. Wizard tự chọn đúng VPS (ID 1), app (ID 1), nguồn Git, repo/ref/root và full SHA; ảnh chụp thật nằm tại `evidence/g4b-preselected-app.png`. Không sửa state/DOM/DB thủ công.
- [x] Ở lượt live ngày 09/10, read-only resource gate và wizard **Kiểm tra trước** đạt: MemAvailable 3104 MB (xác nhận lại 3118 MB), disk 18 GB, Docker 29.8.2; ba URL được kiểm tra HTTP 200 sau redeploy. Bằng chứng precheck đúng app/port ở `evidence/g4b-precheck-pass.png` và `evidence/g4b-precheck-confirmation.png`. Correction 10/10 có gate riêng không đạt, xem phần dưới.
- [x] Redeploy Git từ app đã liên kết thành công trong lượt G4b ngày 09/10 sau precheck. Đã ghi source build commit/tree, repo/ref/full SHA, app/deployment/version, timestamps, image tag, exposure và HTTP loopback/external trong `../demo-14-10/evidence.md`; remote/main/v3/v4 đều cùng SHA nên là redeploy cùng SHA. **Container ID chưa được xác minh**: SQLite không lưu ID, truy vấn SSH CLI chỉ đọc thoát 255; giữ là giới hạn, không suy đoán.
- [x] G4b clip cũ bị loại khỏi vai trò fallback: metadata có handler `soun` và clip bắt đầu sau khi v4 hoàn tất, nên không chứng minh lượt redeploy liên tục. Correction ngày 10/10 dừng an toàn vì resource gate không đạt; dùng video G3 làm fallback có nhãn build cũ, không gọi đó là video của build G4b.
- [x] Node 22 lint, Node/Web/Scripts typecheck, full Vitest, build và `git diff --check` đạt trên source runtime cuối; correction không đổi runtime. Đề xuất `DEMO_READY_RECORDED` chờ Leader review, dùng G3 với nhãn build cũ do resource gate correction không đạt; giữ giới hạn container ID. Cập nhật board/task và commit cục bộ; không push/PR/merge.

## Nhật ký

- START 09/10/2026 — Tiếp tục trên `feat/deploy-reachability`; mở build Electron production source G4a trong profile G2 và thử đúng nút app detail **Triển khai phiên bản mới**. Xác minh nguồn/app/VPS, tài nguyên read-only và precheck trên wizard trước khi quyết định Start.
- PLAN 09/10 — Leader review G4a resource fix và thấy đường preselect app từ nút **Triển khai phiên bản mới** đã có sẵn. G4b kiểm chứng live gate trên đúng UX đó trước khi freeze.
- UPDATE 09/10/2026 — G4b live PASS: điều hướng từ Git app detail preselect đúng app/VPS/Git; Electron precheck pass trước Start; redeploy cùng SHA hoàn tất; rehearsal 7:49 được quay trên cùng build. Evidence, script và PDF A4 cập nhật. Container ID không thu được (SSH CLI read-only exit 255), nên DoD mục container ID còn mở; không bịa giá trị. Đề xuất `DEMO_READY_LIVE` để Leader review với giới hạn này.
- GATES 09/10/2026 — Node `v22.23.3`, pnpm `11.1.0`: `pnpm lint` PASS (0 ESLint errors, 5,784 Prettier CRLF warnings, Ruff PASS); `pnpm --filter @opspilot/app typecheck` PASS (Node/Web); `pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json --composite false` PASS; `pnpm --filter @opspilot/app test` PASS (71 files, 674 tests; jsdom canvas/getComputedStyle pseudo-element warnings, exit 0); `pnpm build` PASS; `git diff --check` PASS (Git CRLF→LF notices only).
- HANDOFF-LOCAL 09/10/2026 — Đã chuẩn bị commit cục bộ các file G4b và evidence; không push, PR hoặc merge.
- REVIEW 10/10/2026 — Leader xác minh SQLite app 1/current deployment 6/v4 `running/reachable` cùng SHA remote, ảnh preselect/precheck/finished và bốn URL public HTTP 200. PDF A4 một trang. **Live deploy core PASS**, container ID còn thiếu nhưng không cần để chứng minh URL/deployment và được ghi là giới hạn. **Freeze/video chưa PASS**: MP4 G4b chứa track `soun` (chưa kết luận có âm thanh nghe được) và chỉ quay rehearsal sau deploy. Không duyệt `DEMO_READY_LIVE` đến khi sửa bằng chứng video và phiếu; làm correction dưới đây.

## Correction trước freeze

- [x] Correction 10/10/2026 kiểm tra resource trên Electron production build/profile G2. Sau refresh, UI hiển thị RAM dùng 3.5/3.8 GB (91%, khả dụng xấp xỉ 0.3 GB, dưới gate 1 GiB), disk 7/25 GB và Docker 29.8.2. Dừng trước wizard precheck/Start; precheck và redeploy mới `NOT_RUN`, không có deployment v5.
- [x] Không xuất video G4b mới do gate RAM không đạt. Chọn G3 full deploy MP4 `g3-rehearsal-20261009.mp4` làm fallback với nhãn build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; không dùng clip G4b lỗi làm fallback. Duration 457.4 giây; MP4 handlers `vide` + `mdir` (metadata), không có `soun` audio handler; evidence ghi phần đã kiểm chứng.
- [x] Đồng bộ script, evidence, phiếu HTML/PDF A4 và board theo `DEMO_READY_RECORDED` chờ Leader review; giữ container ID là giới hạn, không dùng SSH ngoài luồng hoặc đoán ID. Gate docs/PDF và `git diff --check` đạt; commit cục bộ, không push/PR/merge.

### Nhật ký correction

- CORRECTION 10/10/2026 — Làm mới tài nguyên trên Electron trước khi redeploy. UI báo RAM 3.5/3.8 GB dùng (91%; MemAvailable xấp xỉ 0.3 GB), disk 7/25 GB, Docker 29.8.2. RAM dưới gate rehearsal ≥1 GiB nên dừng trước Prepare/precheck/Start; lượt redeploy và video G4b liên tục mới là `NOT_RUN`, app giữ deployment 6/v4. Dùng G3 MP4 457.4 giây làm fallback, ghi rõ build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; video G4b cũ không được phát thay. MP4 G3 handlers `vide` + `mdir` (metadata), không có `soun`; `pdfinfo` xác nhận PDF A4 một trang. Ảnh resource mới: `../demo-14-10/evidence/g4b-correction-resource-gate-failed.png`. Container ID tiếp tục là giới hạn đã công bố.
- GATES CORRECTION 10/10/2026 — Không đổi runtime source. Chạy `git diff --check`, kiểm tra PDF A4 một trang và MP4 G3 có handlers `vide` + metadata `mdir`, không có audio handler `soun`; không chạy lại lint/typecheck/Vitest/build vì diff correction chỉ gồm task/evidence/script/PDF, không có source hoặc test thay đổi.
- HANDOFF-LOCAL CORRECTION 10/10/2026 — Verdict điều chỉnh thành `DEMO_READY_RECORDED` chờ Leader review, với video G3/build cũ và resource gate G4b `NOT_RUN`; commit cục bộ, không push/PR/merge.

## PR

Chưa được phép push, mở PR hoặc merge.
