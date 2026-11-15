# R7h-3d3c — Exposure của bản đang chạy khi desired env thay đổi

START15/11/2026 — Base9b6ff4c, product-mode/task-discipline. Sau pilot3b, desired env3 khác active env2 sau health rollback nên exposure trả authority_changed dù HTTP200/CID/config2 đúng. User yêu cầu tiếp tục hoàn thiện sản phẩm. Chọn thay đổi nhỏ: chỉ công nhận chênh lệch source **do environment selection** được xác minh bằng immutable source/env bindings trong cùng owner/target; không tự chấp nhận repo/ref/root/plan drift. Giữ observation CAS theo cả desired và active authority. Không migration/dependency mới, không tự thay pins/enrollment hay chạy lại pilot đã PASS.

| Yêu cầu | Gate | State |
|---|---|---|
| Contract/UI rõ active và desired | Optional source_state metadata không secret, old response vẫn đọc được; 4locale cảnh báo cấu hình chờ áp dụng, badge chỉ nói truy cập bản active. TTL/race/unknown giữ nguyên | PASS |
| Exposure active theo retained source hợp lệ | Current app pointer + settled successful H2 execution/terminal/job, same owner/target, canonical source hashes/identical repo-ref-root-plan trừ env, immutable env binding đúng target/revision. Bất kỳ lệch/mất proof đều từ chối; no active work/lease/activation. Observation CAS invalidated khi desired/active đổi | PASS |
| Chứng minh runtime/backend/UI | Focused unit/API/Main/DOM, native CLI/SQLite/HTTP gate, real Docker source/environment selection + rollback kiểm active observation không mutate runtime. Typecheck/lint/build/full suite; GUI visual nếu có UI mới | PASS |
| Handoff/push | Proof source/raw hashes, board/FR/master/HANDOFF cùng commit, Kim coauthor, push thường; không PR/merge. Installed VPS releasedb1e58c giữ nguyên cho tới final candidate+upgrade gate riêng | PASS |

Phạm vi checkpoint: code/backend/Main/renderer và native local acceptance. Rollout controller mới trên development VPS là checkpoint kế tiếp, không lấy code/local test làm proof VPS đã hỗ trợ source_state. Không bỏ runtime/source/target fence để ghi xanh; chưa đủ proof thì not_checked.

UPDATE15/11 — Backend đã nối immutable env-only proof và claim→job/attempt/target/app pointer, chặn thêm worker lease/unknown attempt/unsettled execution. Optional source_state chỉ trả khi proof hợp lệ, observation hash vẫn gồm desired row và signed active context nên đổi một phía làm CAS cũ hết hiệu lực. Unit/API/Main tập trung PASS; final full suite đang chạy. Main/renderer vẫn nhận response cũ không có source_state, giữ unsupported/outcome_unknown/TTL/read-only và app-switch race.

UI chỉ nói bản đang chạy theo deployment ID và cảnh báo cấu hình mới chưa được xác nhận; không hiển thị source generation như thể đó là env revision. Electron thật6checks/12captures,4locale/dark-light/1280×800 và1366×768, overflow false. Dùng Main/API/SQLite thật + public HTTP tới app demo sẵn có; SSH transport và H2 runtime trong UI lab là fixture, không claim GUI production profile hay controller trên VPS đã đổi.

Native HTTP6checks PASS: real auth/API/SQLite/CAS/lost reply; runtime là synthetic H2 fixture. Docker acceptance dùng actual SSH/SQLite/helper/Docker và source config/env selection thật; probe local loopback, không claim independent desktop observer. Lượt đầu bị chặn vì fixture port44207 ngoài range30000–30999; sửa allocator riêng lab sang đúng range, không nới production target guard. Bản build lab đầu có duplicate export, đã bỏ dòng lặp. Full suite chạy trong lúc sửa UI đã dùng source không đồng nhất; bỏ làm proof, chạy lại final source. Mọi attempt không PASS được lưu ignored để audit, không tự waive gate.

## HANDOFF-LOCAL15/11 — R7h-3d3c

Status: DONE **local source + native acceptance**, CHỜ REVIEW. Controller installed trên VPS chưa đổi; next protected release/live gate vẫn OPEN. Không PR/merge. Kim coauthor, normal push theo quyền user đã có; `git log -1 -- app/src/main/controlPlane/controllerExposureSource.ts` lấy SHA.

| Ledger cuối | Current-source evidence | State |
|---|---|---|
| Active/desired DTO + Main/renderer | Optional source_state; response cũ vẫn parse, metadata sai/injected bị chặn.4locale cảnh báo pending, reachability chỉ active ID; TTL, unknown-write không resend, read-only và late app-switch vẫn giữ. Electron6checks/12captures/0renderer errors, overflow false, private DB xóa | PASS |
| Proof active source và CAS | Canonical source hashes/repo/ref/root/base plan khớp app; immutable env/revision binding same owner/target, active env reference khớp H2. Job/attempt/SHA/owner/deployment link kiểm riêng. Không active job/app-worker lease/prepared activation/unknown attempt/unsettled execution. Đổi desired/active sau probe → old authority/CAS bị từ chối; không mutate H2/runtime | PASS |
| Native/local runtime | HTTP6checks auth/SQLite/CAS/lost reply; Docker39cases Express11/SPA14/Next14. Actual local SSH/SQLite/Docker env3 health rollback giữ active env2/CIDs, source3/desired4 pending, exposure reachable, signed terminal giữ nguyên, private client revoked/namespace cleanup | PASS |
| Gates/handoff | Full177files/2471tests PASS,1file/2existingLinux-only SKIP;10quality gates types/scripts/2lab configs/lint0warnings/Prettier/Ruff/build/diff exit0. Source/raw/capture hashes, board/FR/master/HANDOFF cùng commit | PASS |

Commands/raw ở `app/.out-scripts/r7h3d3c-quality/results.json`; proof portable `docs/ui-redesign/r7h3d3c-verification.json` liệt kê exact source/raw hashes, native nonces và screenshots. Bộ test cuối chạy sau khi source được chốt; JSDOM canvas/computedStyle diagnostics có sẵn, không che failure. Focused backend/Main/API/DOM PASS trước full. Thay `status` trong metadata case thành `exposure_status` để không ghi đè verdict PASS; rerun affected runtime fixtures trên report format cuối.

Ảnh Electron thật: `docs/ui-redesign/screenshots/r7h3d3c/c2e87965cbfd2a60/`,12captures gồm4locale×2theme1280×800, Vietnamese dark/light1366×768, unknown và unsupported. Đã xem ảnh Vietnamese light1366×768 và Japanese dark1280×800: nội dung đủ, không overflow/cắt cảnh báo. UI chỉ xuất deployment ID, không dùng source generation làm env revision. Screenshot public URL thuộc app demo đã có, còn runtime/SSH là fixture; không claim GUI production profile hoặc H2 runtime thật trong Electron gate.

Production VPS không có SSH mutation của checkpoint này. Public HTTP từ Main lab có gọi app demo30000, không deploy/update/reset ứng dụng. Controller VPS vẫn db1e58c/schema35, app env đã nghiệm thu ở3b. No new schema/dependency/key/target pin. Old response không source_state vẫn có hành vi cũ; controller mới cần Main tương thích, rollout theo release riêng.

## Next checkpoint

Freeze Linux candidate từ source này; giữ catalog entries/pins cũ, chọn một approved revision mới. Root/Main upgrade native gates với parent35, kiểm asset/version/protected state và packaging/tamper trước fresh VPS attestation. Upgrade35→35 bằng same UUID protocol, giữ5apps/10CIDs/key/DB/receipt/policies/client authority. Trên app env riêng đã có, stage/select revision mới không chạy app → active exposure pending; nếu thử health rollback dùng nhánh demo/version mới và ghi đúng expected contract (pilot3b historical operator vẫn đòi unavailable cho case cũ). Final restore healthy, pause/revoke/cleanup và update GUI profile riêng nếu cần. Không replay pilot record đã PASS hoặc sửa legacy gate để che failure.

Sau rollout active exposure: explicit in-place helper updater cho retained targets còn helper cũ; managed DB/PG acceptance; ML/data/report/release packaging và demo rehearsal. Không đánh dấu whole release DONE từ checkpoint này. Accepted exceptions: none.
