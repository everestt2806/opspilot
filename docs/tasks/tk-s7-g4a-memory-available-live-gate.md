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

- [ ] Bằng chứng read-only VPS chứng minh cột `free` và `available` khác nhau bao nhiêu; xác nhận nguyên nhân RAM 94% ở G4. Nếu `available` thật sự thấp, ghi container/process chiếm RAM và dấu hiệu OOM; không suy đoán.
- [ ] Sửa `readVpsResources` và test để phân biệt rõ `free`/`available` trong output lệnh; cập nhật comments/IPC contract và UI wording cần thiết. Thêm test bảo vệ chỉ số hiển thị và precheck cùng dùng available. Không đổi schema hay migration.
- [ ] Chạy lại resource fetch trong Electron build mới, chụp ảnh/timestamp. Nếu đủ gate an toàn, diễn tập live Git trên build này, kiểm tra URL/status của Git/Vite/Next, quay video dự phòng mới cùng build và ghi deployment/SHA thực tế. Nếu không đủ, ghi `NOT_RUN` chính xác; fallback G3 vẫn chỉ đại diện build cũ.
- [ ] Sửa `evidence.md`, kịch bản và phiếu HTML/PDF A4: bỏ mọi câu khẳng định “dưới 512 MB **khả dụng**” nếu đo available không xác nhận; ghi verdict đề xuất dựa trên số mới, build/video đúng nhau. PDF vẫn một trang A4, mở xem không cắt chữ.
- [ ] Node 22 lint, Node/Web/Scripts typecheck, focused tests, full Vitest, build, `git diff --check` trên source cuối. Ghi warning thật, không gọi `0 warnings` nếu còn CRLF warnings. Board/task trạng thái hợp lệ và commit cục bộ; không push/PR/merge. Khi xong chỉ báo “Worker đã xong”.

## Nhật ký

- PLAN 09/10 — Leader dừng duyệt G4 `DEMO_READY_RECORDED`: số RAM UI là `MemFree`, trong khi deploy precheck dùng `MemAvailable`. Cần đo VPS và chốt lại bằng chỉ số đúng trước demo.

## PR

Chưa được phép push, mở PR hoặc merge.
