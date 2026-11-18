# R7h-4e4 — phát hành và nghiệm thu nhận lại dự án

START 18/11/2026 — Base339250d. Product-mode, task-discipline/CLAUDE/DECISIONS.
User tiếp tục core và cho phép normal commit/push checkpoint, triển khai development
VPS đã cấp. Giữ lane Windows Kim; không PR/merge/force/reset/stash/clean/rebase.

Phạm vi: freeze candidate từ source hiện hành, build/pin độc lập và native gates;
approve descriptor mới giữ toàn bộ pin cũ; protected Main upgrade development VPS,
rồi actual Electron/IPC/Main/installed Root/SSH nhận lại hai app PG hiện có và đọc
đúng UUID. Không provision/deploy app mới, không tạo receipt giả, không đổi dữ liệu
app hay policy. Mỗi pha có proof riêng để không nhầm candidate với serving.

| Requirement | Evidence | State |
|---|---|---|
| Frozen candidate | Hai builds a/b independently verified998files/145394238bytes, release9878eae5/payload manifest708fbd82/controller artifact9a33e131/installerf53555b5 trùng; chỉ control-plane.cjs khác D4, target/collector/template bytes giữ nguyên | PASS |
| Native composition | Source/admin/Docker PG22checks0ae542f9a325, Root19checks7ef8947b372b, Main24/3937976fdaed từ4bc và Main24/debddb3d2fd7 từ đúng serving63d1 đều PASS/cleanup. Safe inspector refusal không phải positive runtime PG read | PASS |
| Protected catalog |12compiled descriptors/all11prior pins retained; full2733PASS+2existingLinuxSKIP/types/scripts/lint/build và5resource/tamper/missing checks PASS/cleanup | PASS |
| VPS baseline | Máy cũ hết hạn, không thử credential tiếp. User đã cấp4máy mới; chỉ1+2 cho Sơn/assistant,3+4 Kim. Public ED25519 keys cả4 đã lấy/đối chiếu OpenSSH theo TOFU được cho phép; fresh authenticated inventory chưa chạy | OPEN |
| Protected serving install/upgrade | Chưa chuyển/install/upgrade; E4b dùng fresh identity/onboarding/baseline trên1+2, không dùng UUID/CID/receipt của instance cũ | OPEN |
| Actual GUI acceptance | Chưa chạy live; cần genuine deployment/profile/consent039 trên máy mới. Không thay bằng lab synthetic hoặc tạo receipt giả | OPEN |
| Handoff E4a | Freeze/candidate/source hashes và raw evidence; board/task/allocation cập nhật, native/resource cleanup đạt. Indexed allowlist đúng15file, source SHA trùng proof, diff/secret check PASS; normal push checkpoint. Không có live client cần revoke | PASS |

Nếu VPS không truy cập được, ghi lỗi cụ thể và tiếp tục các gate private. Mặc định
không học host key qua mạng; ngoại lệ operator mới do user cho phép18/11 ở dưới,
không bỏ host verifier hoặc thay key đã ghim khi mismatch. Credential RAM/no-echo stdin
hoặc profile nonce mã hóa; không argv/env/plaintext/log. Gate fail không tự miễn.
Có thể chốt E4a candidate riêng nếu serving bị chặn; không gọi E4 toàn bộ DONE.

UPDATE 18/11 — Hai build riêng a/b dưới UID chủ input đã đối chiếu từng file,
manifest và installer; raw freeze `app/.out-scripts/r7h4e4-frozen-build.json`.
Payload manifest pin708fbd82 khác controller artifact hash9a33e131; không tráo
hai ý nghĩa. Node22.23.4/glibc2.39, controller schema37/Desktop39 giữ nguyên.
So bundle D4 chỉ entrypoint thay đổi; compatibility helper/template/collector giữ
historical exact-byte evidence, native PG/inspector source suite chạy mới22checks.

UPDATE 18/11 — Readonly baseline ban đầu không nhận TTY trong Electron-as-Node;
đã thêm Node no-echo launcher và giữ credential RAM/stdin. Lượt thật dừng ở SSH
handshake timeout, chưa thực hiện snapshot/upgrade; Windows và WSL TCP probe không
auth xác nhận timeout nhiều cổng. Raw network `app/.out-scripts/r7h4e4-network.log`.
Đã hỏi user kiểm tra trạng thái VPS qua nhà cung cấp, không kết luận hết hạn từ
timeout. Launcher nay preflightTCP22 trước khi hỏi credential; baseline compile
current Main code thay vì lệ thuộc artifact cũ trên máy. Tiếp tục private gates.

UPDATE 18/11 — User xác nhận VPS hết hạn, sáng mai mới có máy mới. Dừng thử kết nối
hoặc credential tới IP cũ; private gates tiếp tục. Old retained baseline/live proof
vẫn BLOCKED, không đổi thành PASS hoặc coi dữ liệu cũ đã khôi phục. Máy mới cần
scope fresh onboarding/deploy rồi reconnection acceptance; không sửa old baseline
guard để làm xanh gate. E4a chỉ chốt candidate/package; E4b live chờ hạ tầng.

UPDATE 18/11 — Native final PASS: source22 (Docker PG thật), Root19 (35→37), Main24
từ4bc và Main24 từ đúng parent63d1. Current Main+Root+CLI kiểm consent039 và từ
chối limit101 trước SSH, foreign DB và PG prepared/target chưa enroll bằng đúng
NOT_READY; giữ token/PID/legacy receipts. Tất cả fixture đã dọn. Hai builds thống
nhất và mọi target/collector/template bytes giữ nguyên; đang chạy final full/build/
compiled12resource tamper gate trước chốt E4a. CLI readonly build-only PASS không
SSH/credential; thêm launcher preflight, chỉ dùng lại baseline cũ nếu đúng instance
được chủ máy khôi phục và cho phép.

UPDATE 18/11 — User nói rõ chỉ cung cấp IP+password VPS mới và yêu cầu tự làm toàn
bộ. Ngoại lệ operator đã ghi DECISIONS: được lấy public host key không auth ở lần
đầu, ghim trước khi gửi password, giữ strict verifier và lưu provenance first-contact
do user cho phép; không giả là console-verified. Không tự thay key đã biết khi đổi,
không dùng lại identity máy đã hết hạn. Không yêu cầu user gửi fingerprint console
lại cho workflow mới đã được cho phép này. App mặc định vẫn giữ contract cũ; chưa
có VPS mới nên chưa thực hiện bootstrap/SSH/credential theo ngoại lệ.

UPDATE 18/11 — User tiếp tục cấp4IP/password và phân công rõ: máy1+2 cho chúng
ta,3+4 cho Kim. Đã lấy public ED25519 key bằng ssh-keyscan không auth, tính hash
và kiểm lại cả4 bằng OpenSSH ssh-keygen. Không nhập password/SSH admin/setup trên
bất kỳ máy mới nào trong bước lấy key; không lưu password. [Allocation/pins](tk-s7-vps-allocation-20261118.md).
E4b không còn chờ địa chỉ máy, nhưng authenticated inventory/serving/GUI vẫn OPEN.

## HANDOFF-LOCAL 18/11 — E4a candidate PASS, E4b live OPEN

- [Freeze proof](../ui-redesign/r7h4e4-freeze-verification.json),
  [candidate proof](../ui-redesign/r7h4e4-candidate-verification.json).
- Full188files/2733tests PASS+1file/2existingLinux-only SKIP,0FAIL,314.30s wall.
  Production build gồm Node/Web typecheck PASS103.99s. Scoped ESLint0warnings,
  scripts typecheck/format/diff PASS. Lint ban đầu thiếu annotation JS launcher
  và unused directive/import đã sửa, rerun PASS; không tự miễn gate.
- Source/admin/Docker22, Root19, Main24/old4bc và Main24/exact63d1 PASS/cleanup.
  Main safe inspector refusal không được ghi là positive runtime inspection.
- Hai build độc lập giống từng file; rebuild sau catalog vẫn đúng9878/708f/9a33/
  f535.12compiled descriptors/11prior exact +5packaged-resource/tamper/missing
  checks PASS/cleanup126.71s. Binary resources ignored, có README tái tạo/pins.
- Chưa chuyển artifact/install/upgrade hoặc chạy actual GUI trên VPS. Máy cũ
  không còn dùng được; máy mới chỉ keyscan không auth. Không nhận dữ liệu cũ đã
  khôi phục và không tạo registration/selection receipt giả.
- Không có exception cho failed gate; ngoại lệ SSH operator mới là yêu cầu user
  đã chốt, được ghi provenance riêng, không thay default contract app.
- Commit lookup: `git log -1 -- docs/ui-redesign/r7h4e4-candidate-verification.json`.
  Kim coauthor, normal push được phép; không PR/merge/force/reset/stash/clean/rebase.
  Files: descriptor/config, native lab, readonly build/launcher và resource CLI,
  README/freeze/candidate/task/board/DECISIONS/allocation. Không sửa file lane Kim.

Tiếp E4b ngay trên máy1+2: strict pinned SSH với key đã chấp nhận lần đầu, inventory
và onboarding thật; deploy/configure, fresh Desktop reconnection039, actual GUI
đọc đúng DB UUID. Máy3+4 chỉ chuyển thông tin cho Kim, không tự quản trị.

UPDATE18/11 — User yêu cầu sản phẩm ưu tiên tiện dụng, không bắt nhập SHA256 trong
luồng thêm VPS. Chuyển UX1 lên trước install/deploy: optional advanced pin/Main
auto-first-contact/strict saved-key verifier. Actual create/encrypted-profile/SSH
readonly inventory1+2 đã PASS, chưa install/Docker/deploy; xem [UX1](tk-s7-release-ux1-vps-onboarding.md).
Không sửa lại E4a historical proof để nhận các bước live chưa chạy là PASS.
