# R7h-4e3 — nhận lại dự án trên giao diện

START 17/11/2026 — Base65d41b7. Checkpoint product-mode. User tiếp tục core; áp dụng task-discipline,
CLAUDE/DECISIONS, contract E1/E2. Được commit/normal push checkpoint với coauthor
Kim; không PR/merge/force/reset/stash/clean/rebase, không sửa lane Windows của Kim.

Phạm vi: typed IPC xem trước/xác nhận/đọc lại consent, UI chọn app từ danh sách
controller thật và explicit consent; readonly inspector dùng provenance mới và
fresh current authority. Giữ nguyên đường registration/selection receipt cũ;
không tạo fake setup, không ghi intent038 hoặc thêm quyền deploy từ consent này.
Không đổi controller release/catalog/serving; actual VPS rollout thuộc E4.

| Requirement | Evidence | State |
|---|---|---|
| Contract/design | DTO và5IPC IDs-only, inspector reconnection riêng; DECISIONS trước runtime; readonly scope projection; standalone bidirectional shared/contract type parity PASS | PASS |
| Main inspector | current snapshot trước/sau I/O, binding/DB UUID/foreign source guard; giữ đường cũ; focused backend6PASS | PASS |
| IPC | review/confirm/current/latest và finite inspection; runtime strict validation, no secrets;73focused tests/4files PASS gồm IPC forwarding | PASS |
| UI | app từ verified list → metadata → explicit consent; restore/lost reply/expiry/late response/binding change/4locale; focused và Electron private PASS | PASS |
| Inspector UI | nguồn nhận lại không giả registration, normalized presentation, endpoint riêng;4focused files73PASS, final Electron5checks/24captures8bcff9f35bf3 PASS/cleanup | PASS |
| Verification | Full188files/2733tests PASS+1file/2existingLinuxSKIP,0FAIL; Node/Web/Scripts/contract parity/lint0/format/build/diff PASS; standalone5checks và Electron6checks/25captures PASS/cleanup | PASS |
| Handoff | Board/task/proof/source hashes đối chiếu PASS; stage đúng57file, cached diff check/secret-pattern scan và indexed source/PNG hashes PASS; commit message có Kim coauthor, normal push là bước bàn giao cuối | PASS |

Thiết kế chọn: tách DTO và endpoint inspector cho reconnection, tái sử dụng phần
hiển thị inspector bằng view model nội bộ có phân biệt provenance. Không đổi
input endpoint registration hoặc cast source2 thành result registration generation1.
Latest consent là lịch sử; phải current/recheck trước mỗi lần dùng. Consent không
tự chạy deploy, bật auto deploy, đổi ENV/PG hoặc pause policy.

UPDATE 17/11 — Runtime và UI đã có, Node/Web typecheck PASS sau khi tách readonly
scope projection khỏi DTO write controller. Focused đầu86PASS/1FAIL: test mới đã
đòi phát hiện mutation xảy ra sau câu query metadata cuối, điều này không thể bảo
đảm bằng optimistic snapshot. Sửa test thành mất final metadata reply (phải từ
chối); test drift trong target I/O vẫn giữ và PASS. Không thay guard sản phẩm để
làm xanh test. Mọi read là snapshot đã kiểm ở các boundary, không phải distributed
lock hoặc hứa dữ liệu không thể đổi sau response. UI focused mới16PASS/1FAIL do
selector Close trùng nút native modal/footer, đã sửa chọn footer. Kiểm tra locale
phát hiện keys hệ thống là jp/cn, đã đồng bộ copy tương ứng trước full gate.

UPDATE 17/11 — Standalone Main50875ac4c18e PASS4checks/cleanup: source2/PG riêng,
tables/rows/noSQLitewrite, reopen/recompose, foreign DB và policy drift không trả
data. Electron cuối8bcff9f35bf3 PASS5checks/24captures/cleanup, kiểm paint/overflow
và4locale×2theme×2size; đã xem ảnh English review dark và inspector light. Router
lab nối production preload vào Main classes với hai SQLite/cipher/vault thật;
admin/target synthetic, không gọi thành installed transport hoặc VPS proof. Full
suite và production build đang chạy trên source cuối. Lint0warnings/scripts và
shared/contract parity PASS. Selector lab đầu sai escape whitespace đã sửa; đồng
hồ fixture được cập nhật theo Date.now khi nhận IPC để giống production. Một
inspector test mới mismatch target revision đã sửa fixture cho khớp trước positive
path; guard vẫn giữ nguyên. Không tự miễn bất kỳ required gate nào.

UPDATE 17/11 — Rà soát E3 phát hiện A→B→A: journal dedupe snapshotA giữ UUID cũ,
latest history vẫn làB. Thêm matching_confirmation_key vào review, derive từ row
đã decrypt/authenticate khớp binding+revision+controller+app+snapshot; renderer vẫn
current/recheck trước restore. Không sửa latest thành live authority hoặc tạo
receipt mới. Unit Main/UI30PASS; standalone c122e8cd4f4e PASS5checks/cleanup.
Native Electron cuối ff5ed7f2c5d5 PASS6checks/25captures, cả chu kỳA→B→A không
xác nhận lần3. Test đầu dựng pause_reason sai enum đã sửa thành operator; không
nới constraint. Full/build trước đã PASS nhưng bị invalidated bởi fix này; v2
chạy lại cả GUI/full/build trên source cuối đều PASS.

## HANDOFF-LOCAL 17/11/2026 — E3 PASS trong phạm vi, CHỜ REVIEW

- [Proof + hashes](../ui-redesign/r7h4e3-verification.json).
- Final full:188files PASS+1file SKIP,2733tests PASS+2existingLinux-only SKIP,
  0FAIL,322.97s wall. Production build gồm Node/Web typecheck PASS,67.29s.
- ESLint scoped0warnings; Prettier TS/TSX/MJS; scripts typecheck; bidirectional
  parity cho5kênh shared/contract và diff check PASS. Focused73 trước cycle fix,
  focused Main/UI30 sau cycle fix; full cuối bao phủ tất cả source cuối.
- Standalone Main5checks/c122e8cd4f4e: hai SQLite/cipher/vault thật, source2PG,
  không samples/receipt giả/DB writes khi inspect, reopen/recompose và A→B→A.
- Actual Electron6checks/25captures/ff5ed7f2c5d5: production renderer/preload/Main
  classes qua router lab và synthetic admin/target, bốn locale/hai theme/hai size,
  explicit consent/lost reply/no resend/current restore/readonly inspector/close.
  Private DB đã dọn. Ảnh final nằm tại
  `docs/ui-redesign/screenshots/r7h4e3/ff5ed7f2c5d5/`; ảnh các lượt trước đã giữ
  ở ignored `.out-scripts/r7h4e3-superseded-captures`, không stage cùng bản cuối.
- Không gọi lab router là production DesktopControllerService/installed Root
  transport hoặc live VPS proof; E2 đã kiểm boundary riêng, E4 cần composition
  hiện hành và serving acceptance. Không có schema/catalog/VPS/DB sản phẩm hay
  file lane Kim bị sửa. Formal ML NOT_RUN, chưa nhận đủ hạ tầng riêng.
- Không có accepted exception hoặc required failure được tự miễn. Các warnings
  jsdom/pseudo-elements đã tồn tại ở baseline; không gọi full suite là stderr-free.
- Commit lookup: `git log -1 -- docs/ui-redesign/r7h4e3-verification.json`.
  Co-author Võ Thị Thiên Kim <Thienkim.dev@gmail.com>; normal push được user cho
  phép. Không PR/merge/force/reset/stash/clean/rebase; giữ file cá nhân ngoài index.

### Files changed

Main reconnection matching lookup/inspector/service;5IPC và mirrored DTOs;
ControllerPanel row action, review/confirm component, shared inspector presentation
và4locale copy; unit/CLI/Electron labs,25ảnh final; contracts/DECISIONS/board/task/proof.
Danh sách source/hash và command/raw evidence chi tiết trong proof.

### Bước tiếp: E4

Freeze/approve candidate, verify Root/native/resources và protected controller
rollout; actual Electron trên hồ sơ hợp lệ đọc hai database đúng UUID, không giả
own-selection receipt. Giữ8apps/2PG và dữ liệu đã có; không dựng production resource
chỉ để lấp gate. Backup/restore/migrate, formal ML và lane Windows Kim vẫn riêng.
