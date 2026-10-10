# TK-S7 G4a — Đo đúng RAM khả dụng và chốt live gate

> Blocker phát hiện khi review G4: `app/src/main/vps/connectionService.ts` chạy `free -b | awk 'NR==2{print $2,$4}'`, dùng cột `$4` (`free`); `app/src/main/deploy/precheck.ts` chạy `free -m | awk 'NR==2{print $7}'`, dùng cột `$7` (`available`). G4 đã suy ra “<512 MB khả dụng” từ UI, nên verdict recorded và PDF hiện chưa được Leader phê duyệt.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | Trước freeze 13/10/2026; không cắt gate | `feat/deploy-reachability` | P0 |

## Ranh giới

- Đầu tiên chỉ **đọc** VPS đã pin host key: `free -m`, `MemAvailable` trong `/proc/meminfo`, `docker stats --no-stream`, disk, trạng thái ba container/URL và dấu hiệu OOM. Ghi total/free/available với timestamp; không lấy `free` thay cho `available`. Không đưa credential vào log/báo cáo.
- Sửa chỉ số tài nguyên theo hướng tương thích IPC: `ram_free_mb` là field cũ nhưng phải phản ánh **MemAvailable** cho quyết định dùng được; ghi rõ semantics tại code/contract. UI `% RAM` và số MB phải dùng cùng giá trị. Deploy precheck đã dùng `$7`; bảo đảm hai đường thống nhất. Nếu cần thay contract lớn hơn, nêu quyết định và test trước khi mở rộng.
- Không dừng app, prune Docker, reset VPS hay mở firewall để có số đẹp. Chỉ redeploy khi đo `MemAvailable` ổn định **ít nhất 1 GiB**, disk còn đủ, ba app healthy và precheck trong Electron pass; nếu không đạt, giữ `RECORDED_FALLBACK` và ghi đúng lý do.

## Definition of Done

- [x] Bằng chứng read-only VPS: MemFree `321,872 kB`, MemAvailable `3,134,372 kB` (chênh `2,812,500 kB` ≈2,747 MiB); xác nhận 94% UI G4 là phép tính từ MemFree, không chứng minh thiếu MemAvailable. Disk 17,926 MB; bảy container `healthy` hoặc `Up`; OOM matches = 0.
- [x] Sửa `readVpsResources` đọc MemTotal/MemFree/MemAvailable và giữ `ram_free_mb` = MemAvailable; cập nhật comments IPC, renderer, precheck và tests. Không đổi schema/migration. Focused 3 files / 19 tests pass.
- [x] Electron production build mới fetch resource và ảnh/timestamp; RAM hiển thị khoảng `817 MB / 3.8 GB` dùng, disk `7/25 GB`, scan SSH/Docker/Compose/Git/workspace pass. Git prepare pin đúng SHA `8af16e1f9165a31557288adbc23acc420244938f`. Live redeploy/rehearsal/video mới `NOT_RUN`: không xác minh được app đích/precheck trong wizard do native dropdown không nhận thao tác GUI; dừng trước deployment, không thay đổi app. Fallback G3 giữ nguyên SHA/deployment v3, vẫn ghi rõ là build cũ.
- [x] Cập nhật `evidence.md`, kịch bản, phiếu HTML/PDF A4; loại kết luận RAM sai và giải thích verdict/fallback. PDF một trang A4, render/preview kiểm tra.
- [x] Node 22 gates: lint pass (5,784 warnings Prettier do CRLF hiện có, 0 errors), Node/Web/Scripts typecheck pass, focused tests pass, full Vitest 71 files / 674 tests pass (jsdom warnings), build pass, `git diff --check` pass. Cập nhật board/task và commit cục bộ; không push/PR/merge.

## Nhật ký

- START 09/10/2026 — Bắt đầu trên `feat/deploy-reachability`; focused tests 3 files / 19 tests pass. VPS read-only đo `MemFree=321,872 kB`, `MemAvailable=3,134,372 kB` lúc `2026-10-09T15:36:45.322Z`; UI cũ đã nhầm free với available. Đang chạy Node 22 gate và chuẩn bị xác nhận Electron build mới.
- UPDATE 09/10/2026 — Node 22 full gate pass; Electron build mới hiển thị RAM dùng khoảng 21%, VPS resource gate vượt ngưỡng. Git source prepare pin cùng SHA G3; native app selector không thể thao tác/đọc xác nhận qua GUI nên precheck chưa được chứng minh. Dừng trước deploy; live/rehearsal mới `NOT_RUN`, fallback G3 giữ nguyên. Evidence, script, phiếu và PDF đã cập nhật; chờ kiểm tra cuối và commit local.
- HANDOFF-LOCAL 09/10/2026 — source/build commit `b69d19e34541f9c04e89875f8620044fad29c453`; Node 22 focused 19/19, full Vitest 674/674, lint/typecheck/build pass; live `NOT_RUN`, evidence/PDF updated; chưa push.
- REVIEW 09/10/2026 — Leader đối chiếu code `vps:get-resources` dùng `MemAvailable`, contract comment và test; ảnh Electron cho thấy 817 MB / 3.8 GB (21%). Kiểm tra lại ba URL external HTTP 200, remote SHA đúng, `HEAD:app` trùng tree build `b69d19e`, PDF một trang A4. Duyệt phần sửa resource local; live gate vẫn mở. Apps detail đã có nút “Triển khai phiên bản mới” set `deployPreselect` với app/VPS để tránh thao tác dropdown native; giao [G4b](tk-s7-g4b-live-rehearsal-navigation.md).
- PLAN 09/10 — Leader dừng duyệt G4 `DEMO_READY_RECORDED`: số RAM UI là `MemFree`, trong khi deploy precheck dùng `MemAvailable`. Cần đo VPS và chốt lại bằng chỉ số đúng trước demo.

## PR

Chưa được phép push, mở PR hoặc merge.
