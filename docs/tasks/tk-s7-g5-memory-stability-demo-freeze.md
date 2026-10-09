# TK-S7 G5 — Chẩn đoán RAM VPS và chốt chế độ demo 14/10

> Baseline an toàn đã có: [G3 full deploy video](../demo-14-10/evidence/g3-rehearsal-20261009.mp4) trên build cũ, không audio track; Leader chấp nhận `DEMO_READY_RECORDED` làm fallback. G4b live deploy v4 đã đạt nhưng correction 10/10 dừng vì `MemAvailable` giảm từ khoảng 3 GiB xuống 0,3 GiB. G5 tìm nguyên nhân để quyết định có thể diễn tập live trên build hiện tại hay giữ fallback.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | Trước freeze 13/10/2026 | `feat/deploy-reachability` | P0 |

## Ranh giới

- Đo VPS chỉ đọc bằng đường SSH đã pin host key hoặc console nhà cung cấp: ít nhất ba mẫu cách nhau vài phút gồm `free -m`, `MemAvailable`/`AnonPages`/`Cached`/`SReclaimable`/swap từ `/proc/meminfo`, top process theo `comm`+RSS, `docker stats --no-stream`, trạng thái container, memory pressure/OOM, disk và ba URL. Không in command line đầy đủ, env hay credential. Đối chiếu số `vps:get-resources` trong Electron với `/proc/meminfo` cùng thời điểm.
- Không restart/stop/prune VPS hoặc app chỉ để có số RAM đẹp. Nếu tìm thấy process/container của **chính demo** tăng RAM bất thường, ghi nguyên nhân và tác động trước khi sửa nhỏ có test; giữ ba app và dữ liệu. Process ngoài phạm vi OpsPilot thì báo cáo, không tự can thiệp.
- Chỉ thử full live rehearsal/video mới khi `MemAvailable` ổn định ≥1 GiB, disk đủ, không OOM, ba app healthy và wizard precheck pass. Dùng đúng đường app detail → **Triển khai phiên bản mới**; quay từ trước Start qua pipeline/result/history/HTTP trên cùng build. Video xuất không audio track và được kiểm tra cấu trúc lẫn hình đầu/giữa/cuối. Không ghép video các lượt để ngụ ý một deploy liên tục.

## Definition of Done

- [ ] Bảng mẫu RAM/process/container có timestamp đủ giải thích hoặc khoanh vùng được mức giảm ~2,8 GiB từ G4a sang G4b. Phân biệt MemFree và MemAvailable; ghi rõ phần nào chưa thể quy nguyên nhân. Nếu có lỗi product rõ ràng, sửa scoped code/test và chạy lại gate.
- [ ] Nếu live đạt: ghi deployment mới, full SHA, version, exposure, loopback/external HTTP, ảnh/video trên cùng build; cập nhật verdict `DEMO_READY_LIVE` và bản in. Nếu không đạt: giữ `DEMO_READY_RECORDED`, video G3/build cũ và ghi chính xác lý do; không lặp deploy khi gate thấp.
- [x] Chốt [phiếu A4](../demo-14-10/phieu-demo.pdf) theo recorded fallback Leader đã chấp nhận; bỏ nhãn **BẢN NHÁP**. PDF một trang, không cắt chữ; kịch bản phân biệt chiếu toàn bộ 10–12 phút với trích đoạn 6–8 phút có nhãn; video đầy đủ giữ làm đối chứng.
- [ ] Với bất kỳ runtime change: Node 22 lint, Node/Web/Scripts typecheck, full Vitest, build, `git diff --check`; nếu chỉ tài liệu thì kiểm tra diff/PDF/links. Cập nhật evidence/board/task, commit cục bộ, không push/PR/merge. Khi xong chỉ báo “Worker đã xong”.

## Nhật ký

- START 10/10 — Đọc CLAUDE.md, board và hồ sơ G5; giữ nguyên phạm vi chỉ đọc trên VPS, không redeploy khi chưa có ba mẫu và precheck.
- UPDATE 10/10 — Profile G2 biệt lập mở được SQLite read-only nhưng `createCredentialCipher()` trả `DB_ERROR` khi giải mã khóa profile; diagnostic Electron riêng cũng không tạo report để xác nhận safeStorage. Chưa có SSH sample mới, không dùng đường kết nối bỏ qua host pinning. Vì vậy chưa thể phân tích nguyên nhân MemAvailable giảm hay so sánh đồng thời với `/proc/meminfo`; live rehearsal/precheck `NOT_RUN`. Giữ recorded fallback G3/build cũ, không thay đổi ba app.
- HANDOFF-LOCAL — Kết quả và giới hạn được ghi vào evidence, kịch bản, phiếu A4, task và board. Docs-only gates: `git diff --check` PASS; `pdfinfo` PASS (A4, 1 trang), render preview đã xem; relative links 0 thiếu; fallback MP4 tồn tại, 8,999,624 bytes. Không sửa runtime vì chưa có bằng chứng lỗi thuộc OpsPilot.
- Commit local `0f83d28` (`docs: ghi nhận G5 bị chặn và giữ recorded fallback`); chưa push/PR/merge.
- G5a UPDATE 10/10 — Chốt phiếu bỏ nhãn bản nháp; nội dung tách G3 build cũ/v3 khỏi app Git v4 và HTTP G4b. Kịch bản ghi rõ tổng 10–12 phút khi chiếu nguyên video 7:37, hoặc 6–8 phút với trích đoạn có nhãn.
- G5a gates — PDF Edge headless không header/footer, A4 một trang; render và text đã kiểm tra. Relative links 0 thiếu; MP4 G3 457.4s, handlers `vide`/`mdir`, không `soun`; `git diff --check` PASS.
- G5a commit local `f0d55e2` (`docs: chốt phiếu demo recorded cho G5a`); không push/PR/merge.
- G5b UPDATE 10/10 — Kiểm tra trang Servers trên Electron PID 26684. Gọi UI Automation cho nút Refresh nhưng status vẫn `2 hours ago`, counters checked/failed đều 0; screenshot provider trả cửa sổ fullscreen khác nên chưa xác minh `vps:get-resources` hay SSH. Không thu mẫu, không thử đường SSH khác, không sửa credential/fingerprint hoặc tác động VPS. Điều kiện gỡ: hiện đúng cửa sổ Electron, refresh và xác nhận status/error/resource mới; chỉ khi SSH đã pin thành công mới lấy ba mẫu chỉ đọc.
- G5b commit local `48ee04c` (`docs: ghi blocker xác minh resource Electron G5b`); chưa push/PR/merge.

## Kết quả G5

- Đo mới qua VPS: `BLOCKED` — không thu được mẫu nào. Electron profile đọc DB nhưng Windows safeStorage không giải mã được khóa profile ở diagnostic; mã lỗi sanitized là `DB_ERROR`. Các lần chạy diagnostic trước đó dừng cùng giai đoạn. Không thử auth/SSH không pin hoặc thay đổi VPS.
- Phân tích mức giảm từ G4a/G4b: `BLOCKED` — dữ liệu G4a (`MemAvailable` 3,134,372 kB) và G4b correction (~0.3 GB khả dụng) không đồng thời với process/container/pressure/OOM; không đủ bằng chứng gán nguyên nhân. MemFree và MemAvailable không được đánh đồng.
- Live gate G5: `NOT_RUN` — không có chuỗi mẫu ổn định ≥1 GiB và không xác nhận được wizard precheck. Không Prepare/Start/deploy; app và ba dịch vụ giữ nguyên.
- Chế độ demo: giữ `DEMO_READY_RECORDED` đã được chấp nhận; dùng nguyên G3 457.4s video trên build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`, ghi deployment v3. Không gắn clip đó với build hiện tại hoặc deployment v4.

## PR

Chưa được phép push, mở PR hoặc merge.


- G5c UPDATE 10/10 — Leader cung cấp mốc PID cũ `26684` (09/10 15:35 local), commit MemAvailable `b69d19e` (22:51), bundle hiện tại (23:52), UI cũ 91% và collector deployment 6 ở 20.58% lúc 19:31:41Z. Đã xác nhận profile G2 còn nguyên và chỉ một Electron main dùng profile; đóng app cũ bình thường, xác nhận process thoát hết, mở build `app/out` hiện tại bằng cùng Windows user/profile (PID `32832`). Không tạo lại key.
- G5c đối chiếu thành công ba lần Refresh qua SSH host pinning với collector SQLite cùng phút: 19:40 UI 801 MB/~21%, collector 20.29–20.56%; 19:43 UI 800 MB/~20%, collector 20.18–20.70%; 19:45 UI 792 MB/~20%, collector 20.34–20.53%. Collector chỉ được truy vấn read-only theo cột, không đọc raw payload. UI cũ 91% được giải thích phù hợp nhất bởi process Electron cũ chạy trước fix; không kết luận VPS đã giải phóng RAM khi restart app.
- G5c kết luận: lỗi hiển thị hiện tại trong app cũ, không tái hiện trên build hiện tại; nguyên nhân vật lý của thay đổi MemAvailable lịch sử giữa G4a/G4b vẫn chưa được khoanh vùng vì không có mẫu process/container/pressure đồng thời. Không tác động VPS/credential, không deploy. Live rehearsal giữ `NOT_RUN`, verdict `DEMO_READY_RECORDED`; video G3 vẫn là build cũ/deployment v3.
- G5c gate docs-only: chạy `git diff --check` và relative-link check; không cần lint/typecheck/Vitest/build do không đổi runtime. Commit cục bộ, không push/PR/merge.
