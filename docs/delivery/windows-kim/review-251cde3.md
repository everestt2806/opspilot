# Review sửa R5/R6 — 22/11/2026

**R5/R6 PASS trong phạm vi kiểm thử local; PACKAGE vẫn BLOCKED. Chưa READY_FOR_MANUAL_CHECK.**

Candidate: `251cde3cd141492e7db5b340f2e9f11b9847e79f`, nhánh `feat/kim-windows-delivery-20261116`. Leader chỉ sửa hồ sơ review/checklist; không sửa implementation. Không kết nối VPS, dùng credential/profile thật hay dừng process thật.

## Kết quả kiểm tra lại

| Hạng mục | Kết quả leader |
|---|---|
| R5: promote lỗi sau khi cất profile cũ | PASS: exit 1, profile cũ trở về đúng target, toàn bộ fixture hashes khớp, hết staging/PreRestore dư |
| R5: rollback cũng lỗi | PASS: exit 1, bản cũ nguyên hashes trong PreRestore; error stream giữ lỗi promote gốc, lỗi rollback và đường dẫn bản cũ |
| Restore positive | PASS: exit 0, 5 file markers khớp source; giữ bản cũ ở PreRestore theo thiết kế |
| Thiếu protected key / file ngoài manifest | PASS: exit 1 trước mutation, target cũ nguyên hashes |
| R6: mất listener trước stop | PASS: không gọi cả CloseMainWindow lẫn Stop-Process |
| R6 controls | Owned listener gọi hai mock actions; PID reuse và executable ngoài installation exit 1, không gọi action |
| Scoped ESLint / standalone preflight | PASS: leader chạy lại, zero warnings / 12 probes exit 0 |
| Bundle mới | 6/6 hashes khớp; ba scripts bằng bytes repo; không có installer |
| Source evidence Gemini | 16/16 hashes khớp, 7/7 steps PASS; report overall INCOMPLETE_FAST_MODE |

Native restore probes gọi script hiện hành trong child PowerShell, có guard trước mọi Move/Remove để mutation chỉ nằm trong fixture. Lỗi được tạo ở Move-Item tại bước promote/rollback, không dựa vào env flags của production script. Wrapper truyền đúng LASTEXITCODE của script con. Process probes gọi script hiện hành với mocked cmdlets, ghi marker riêng cho CloseMainWindow và Stop-Process. Các file DB/key/model đều là marker bytes, không thay thế nghiệm thu SQLite/DPAPI/model thật.

Raw local: `app/.out-scripts/windows-delivery/leader-check-251cde3-20261122-r1/`:
- `native-review.py`, `restore-probes.json`, `process-probes.json` và stdout/stderr từng ca.
- `focused-checks.json`, lint/preflight logs, `bundle-verification.json`, `context.json`.
- Kết quả restore cuối nằm trong `native-restore-v3/`, process trong `process-probes-v2/`; các lượt chuẩn bị harness trước đó không dùng làm verdict.

Không còn yêu cầu sửa implementation R5/R6 từ review này. Có thể tăng độ bền regression sau này bằng marker CloseMainWindow trong test Gemini: test hiện tại chỉ ghi marker Stop-Process, còn leader đã xác minh cả hai action riêng.

## Giới hạn và bước còn lại

Source runner Gemini `run-1795359591375-16972-18a573` là fast mode, provenance `58a47af` + dirty diff `fdf2994fc839c62ee6f21fe37fe75e90d680232773a8e126cee0d4cebdd1158f`; không phải một full source run sạch tại 251cde3. Typecheck/build PASS là evidence Gemini đã được đối chiếu hashes; leader chạy lại lint, standalone và native regressions, không lặp build/full suite cho core không đổi.

Full-suite evidence trước vẫn **2,621 PASS / 21 FAIL / 11 SKIP**, chưa được coordinator miễn hoặc chứng minh baseline. Không kết luận whole CI xanh hay không còn mọi delivery regression từ các focused checks.

ML resource manifest vẫn `64782424b3e87ccb781553f24fc7c73bfe8a26c3f03e34fc203b24082b1038e8`, bằng pin/bundle đã verified trước. Không rebuild resource.

`app/resources/controller-releases/` vẫn chưa có. Coordinator cần cung cấp nguyên bộ approved catalog + 9 release directories và các thành phần đúng compiled pins. Khi có: verify → production build/actual beforePack → NSIS → automated package/full-app/lifecycle/upgrade labs phù hợp → bundle cuối có installer path/hash/evidence. Sau đó mới user nghiệm thu một lượt Windows sạch/GUI/UAC/DPAPI/credential và VPS thật nếu cần.

Đã sửa candidate SHA cũ trong checklist (`f4ae454` → candidate review 251cde3), phân biệt focused PASS với fast-mode/full-suite/package status. Trạng thái bàn giao hiện tại: **LOCAL_FOCUSED_PASS + BLOCKED_PACKAGE**.
