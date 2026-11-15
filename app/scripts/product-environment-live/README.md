# R7h-3d3b — Nghiệm thu env trên development VPS

Chỉ VPS development đã duyệt, pinned ED25519, current controller/install/parent
trong source. Không dùng hồ sơ Electron thật. Candidate phải là đúng approved
release và đã qua Root/Main upgrade lab trong proof3a; thiếu/tamper resource bị
verifier từ chối trước SSH mutation.

Node22 trên Windows: `node app/scripts/product-environment-live/launch.mjs --start`.
Chờ `PRIVATE_INPUT_READY_NO_ECHO`, nhập JSON credential qua stdin tắt echo; không
ghi credential vào shell command, env hoặc file. Launcher chuyển stdin sang
Electron-as-Node để dùng đúng SQLite ABI. DPAPI key + AES-GCM bảo vệ profile,
token so sánh và canary riêng trong `.out-scripts/product-environment-live/<nonce>`.

`--resume <nonce>` mở đúng journal cũ. Unknown transfer/upgrade/registration không
tự replay; unknown command/env chỉ inspect UUID cũ. Nếu cần recovery write sau
outcome chưa rõ, kiểm journal/authority trước và ghi riêng quyết định; không đổi
UUID, pin hoặc restore backup lên live DB để đi tắt. Không chạy hai driver cùng
nonce hoặc sửa source trong lúc một driver đang chạy.

Luồng: fresh attestation → adopt current → client scoped tạm → transfer/upgrade
29→35 → binding refresh giữ token/client → kiểm Root backup0440/dir0550/hash/schema29
và old4apps/8CID/key/DB/receipt → app Express mới → env revision1/first deploy →
revision2/update → build fault giữ bản cũ → revision3/health fault rollback đúng
CID/config2 → revision4/final healthy → pause/revoke/final attestation/private cleanup.

Source từ `san-nha-booking`, nhánh demo riêng `demo/environment-r7h-<nonce>` có
Kim coauthor, không merge vào sản phẩm. Fault scripts chỉ ở nhánh demo. Health
chỉ trả marker source và boolean configured, không trả runtime values. Giá trị
literal được so sánh trong RAM với Docker Config.Env; image/env-file và report
được kiểm không chứa giá trị runtime. Không log raw SSH stderr hoặc assertion.

App cuối được giữ để xem/demo; policy paused. Chỉ client tạm bị revoke. Private
journal chỉ xóa sau PASS, disconnect SSH và đóng SQLite; lỗi thì giữ mã hóa để
inspect. Kết quả thật của pilot, UUID, source/raw hashes nằm trong hồ sơ task và
proof cùng checkpoint; không coi local mock hoặc UPGRADE_READY là rollout PASS.

Sau health rollback, desired revision3 và active revision2 khác source authority.
Gate yêu cầu exposure trả `unavailable/authority_changed/not_checked` theo contract
hiện hành, đồng thời kiểm HTTP200, literal env2 và đúng CID cũ độc lập. Không nới
fence để ghi reachable dưới source mới. Initial/update/build-fault/final phải có
exposure recorded/reachable. Hiển thị riêng exposure của active deployment khi
desired khác active là phần cải thiện tiếp theo, chưa tuyên bố đã hỗ trợ.
