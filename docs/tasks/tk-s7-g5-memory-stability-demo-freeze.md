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

- PLAN 10/10 — Leader chấp nhận recorded fallback G3 sau khi kiểm tra video không audio, PDF A4 và ba URL HTTP 200. Live v4 từng thành công nhưng resource correction rơi dưới 1 GiB; G5 chẩn đoán ổn định trước khi quyết định live cuối.

## PR

Chưa được phép push, mở PR hoặc merge.
