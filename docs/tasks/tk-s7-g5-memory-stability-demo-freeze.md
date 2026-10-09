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
- [ ] Trước 13/10 chốt [phiếu A4](../demo-14-10/phieu-demo.pdf) và kịch bản đúng chế độ đã chứng minh; bỏ nhãn **BẢN NHÁP** chỉ sau khi Leader review. PDF một trang, không cắt chữ; video/ảnh mở lại được. Ghi URL/port, source build và Git SHA tách biệt.
- [ ] Với bất kỳ runtime change: Node 22 lint, Node/Web/Scripts typecheck, full Vitest, build, `git diff --check`; nếu chỉ tài liệu thì kiểm tra diff/PDF/links. Cập nhật evidence/board/task, commit cục bộ, không push/PR/merge. Khi xong chỉ báo “Worker đã xong”.

## Nhật ký

- START 10/10 — Đọc CLAUDE.md, board và hồ sơ G5; giữ nguyên phạm vi chỉ đọc trên VPS, không redeploy khi chưa có ba mẫu và precheck.
- UPDATE 10/10 — Profile G2 biệt lập mở được SQLite read-only nhưng `createCredentialCipher()` trả `DB_ERROR` khi giải mã khóa profile; diagnostic Electron riêng cũng không tạo report để xác nhận safeStorage. Chưa có SSH sample mới, không dùng đường kết nối bỏ qua host pinning. Vì vậy chưa thể phân tích nguyên nhân MemAvailable giảm hay so sánh đồng thời với `/proc/meminfo`; live rehearsal/precheck `NOT_RUN`. Giữ recorded fallback G3/build cũ, không thay đổi ba app.
- HANDOFF-LOCAL — Kết quả và giới hạn được ghi vào evidence, kịch bản, phiếu A4, task và board. Không sửa runtime vì chưa có bằng chứng lỗi thuộc OpsPilot.

## Kết quả G5

- Đo mới qua VPS: `BLOCKED` — không thu được mẫu nào. Electron profile đọc DB nhưng Windows safeStorage không giải mã được khóa profile ở diagnostic; mã lỗi sanitized là `DB_ERROR`. Các lần chạy diagnostic trước đó dừng cùng giai đoạn. Không thử auth/SSH không pin hoặc thay đổi VPS.
- Phân tích mức giảm từ G4a/G4b: `BLOCKED` — dữ liệu G4a (`MemAvailable` 3,134,372 kB) và G4b correction (~0.3 GB khả dụng) không đồng thời với process/container/pressure/OOM; không đủ bằng chứng gán nguyên nhân. MemFree và MemAvailable không được đánh đồng.
- Live gate G5: `NOT_RUN` — không có chuỗi mẫu ổn định ≥1 GiB và không xác nhận được wizard precheck. Không Prepare/Start/deploy; app và ba dịch vụ giữ nguyên.
- Chế độ demo: giữ `DEMO_READY_RECORDED` đã được chấp nhận; dùng nguyên G3 457.4s video trên build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`, ghi deployment v3. Không gắn clip đó với build hiện tại hoặc deployment v4.

## PR

Chưa được phép push, mở PR hoặc merge.
