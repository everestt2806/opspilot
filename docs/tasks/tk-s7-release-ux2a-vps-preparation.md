# UX2a — chuẩn bị VPS để triển khai

START18/11/2026 — Base42c71bf, product-mode/task-discipline. User yêu cầu tăng tốc,
trải nghiệm chính là IP/password → chuẩn bị → folder/Git deploy → mở website.
Checkpoint này gom prerequisite vào một thao tác trên development VPS1+2 và cài
controller hiện hành trên VPS1 làm máy quản lý; VPS2 chỉ là đích triển khai/migrate.
Không gọi toàn hành trình Product/folder/Git là DONE từ đây.
Giữ lane Kim, normal checkpoint push/Kim coauthor; không PR/merge/reset/stash/
clean/rebase/force. Không admin3+4, không tái dùng identity máy cũ hết hạn.

| Requirement | Evidence | State |
|---|---|---|
| Chuẩn bị runtime một lần | CLI44focused SSH/runtime PASS; actual1+2 cài signedapt Engine29.10.0/Compose5.8.0, repeat không reinstall; scoped identity/concurrency/result guards | PASS |
| UI theo công dụng | Card1nút và wizard tự gọi prepare trước fresh review→intent/install; focused52PASS, Electron3checks/4captures PASS (synthetic SSH) | PASS |
| Bản controller mặc định đúng | Final compiled release default, missing newest không fallback; selector nằm advanced, keep existing/adopted consent; defaultwrite chỉ fresh UI, Main vẫn explicit input | PASS |
| Live development1+2 | Runtime proof8a3c791af3ab6checks; controller1 proof38be15196885d4cb11checks: fresh protected install/inspect/enroll/API/revoke, privatecleanup | PASS |
| Checks | Final full2779PASS+2existingLinuxSKIP/194files/0FAIL/353.95s; build/typesNode-Web-Scripts/scopedlint0warnings/format/parity PASS. Native runtime6/controller11/Electron3checks PASS; source/raw/capture hashes trong proof | PASS |
| Handoff | Board/task/traceability/allocation/master/plan25/proof cập nhật; indexed allowlist đúng35files,22source hashes/raw/captures trùng, staged diff/secret check PASS; Kim coauthor/normal checkpoint push | PASS |

Giả định: người dùng bấm “Chuẩn bị VPS” hoặc đồng ý cài controller cho phép cài
Docker/Compose nếu thiếu và tạo workdir. Nếu Docker đã tồn tại nhưng daemon lỗi
hoặc Compose thiếu, không tự nâng Docker/restart daemon đang phục vụ app; trả bước
xử lý cụ thể. Installer nhận đúng release mới nhất từ catalog đáng tin, không
fallback im lặng sang binary lịch sử khi thiếu artifact hiện hành.

UPDATE18/11 — Docker official docs xác nhận convenience script chỉ dành dev/test;
đã dùng signed apt repository cho production path mới, chọn exact Engine29 package
candidate trước cài, không chạy script từ mạng. Ubuntu jammy/noble được hỗ trợ cài
mới; OS khác nếu đã có Docker/Compose thì chỉ check. Không gỡ conflicting runtimes.
Nguồn: https://docs.docker.com/engine/install/ubuntu/ . Legacy `vps:install-docker`
giữ nguyên trong checkpoint này; luồng mới/card/controller dùng `vps:prepare-runtime`.

UPDATE18/11 — Runtime1+2 đã PASS qua actual production Main/SSH. Controller chỉ1
đã cài release9878eae5/payload708fbd82, UUID0c1503c9-3c59-4bdc-9eee-658652eaf4e0,
installation55f5ed57-d092-438e-b74d-56e3a618db93,UID997/systemd running+enabled.
Read-only enrollment/API apps empty ready PASS rồi revoke client; private SQLite/
DPAPI key removed. Không tạo app/deployment/PG hoặc dữ liệu giả để làm xanh gate.
VPS2 không có controller. Nếu driver thất bại sẽ giữ encrypted journal+DPAPI key,
không mất metadata intent khi chưa rõ kết quả. Operator progress print đặt lại đúng
transfer/install sau lượt live; production API behavior không đổi.

UPDATE18/11 — Native Electron mới3checks/4captures, current15e79fbd5204: production
form/panel/preload/Main/SQLite với synthetic observation+SSH; không mutate trước
click, status theo response, đúng viewport1280x800/1366x768, no overflow. Capture
đầu b17b... đổi theme chưa paint xong; đã thêm paint wait350ms, xem ảnh thật light/
dark rồi mới chọn final artifact. Lint phát hiện copy export/fixture type/refcleanup,
đã tách copy/typed fixture/capture ref object; rerun PASS, không tắt lint gate.

## HANDOFF-LOCAL18/11 — UX2a DONE scoped, CHỜ REVIEW

Status: DONE cho runtime preparation/fresh controller; chưa DONE whole UX2/E4b.
Files changed: Main runtime service/SSH principal fence/IPC contract; preparation
panel/copy/VPS overview/controller wizard+tests; CLI launch/entry/drivers/README;
proof/4captures/task/board/traceability/allocation/release plan. Không sửa lane Kim.

Checks run:

- `pnpm --prefix app exec vitest run --reporter=dot`:194files/2779PASS,1file/2existing
  Linux-only SKIP,0FAIL,353.95s. Không lấy52focused thay full.
- `pnpm --prefix app build`: PASS, gồm Node/Web typecheck. Scripts typecheck,
  scoped ESLint `--max-warnings 0`, changed-source Prettier/parity/diff PASS.
- `node app/scripts/vps-onboarding-live/launch.mjs --confirm-prepare-assigned-vps`:
  actual runtime1+2,6checks/repeat no reinstall/privatecleanup PASS.
- `node app/scripts/controller-onboarding-live-launch.mjs --confirm-install-assigned-controller`:
  actual protected latest install1,11checks/API/revoke/SQLite+DPAPI cleanup PASS.
- `pnpm --prefix app exec electron scripts/vps-onboarding-live/electron.mjs --confirm-private-vps-preparation`:
  native3checks/4captures/privateDBcleanup PASS, synthetic SSH được ghi rõ.
- [Proof/source/raw hashes](../ui-redesign/ux2a-vps-preparation-verification.json).

Assumptions / pre-existing failures:2existing Linux-only skips, jsdom/Antd warnings
không được coi là đã sửa toàn bộ. Cài mới tự động hỗ trợUbuntu22.04/24.04/Engine29;
existing Docker thiếu Compose/daemon lỗi/conflicting runtime cần kiểm tra trước,
không tự thay engine. Legacy `vps:install-docker` nằm ngoài checkpoint; luồng mới
đã đi signedrepo. Thử capture theme đầu paint chưa xong, đã sửa harness và xem ảnh
final thật; không gọi ảnh dark là light. Không app/PG deployment/ML/NSIS mới.

Accepted exceptions: không miễn failed gate. Người dùng đã cấp quyền chuẩn bị VPS;
frontend vẫn cần consent, không tự cấp quyền triển khai cho connection cũ/adopted.
Checkbox deploy được chọn mặc định chỉ ở fresh-install UI và có thể bỏ chọn.

Next action: UX2b folder/Git wizard→actual new-VPS website; E4b app/PG/reconnection
và inspector live. 25/11 là mốc candidate demo theo plan, không toàn production.
Commit lookup `git log -1 -- app/src/main/vps/runtimePreparation.ts`; Kim coauthor,
normal checkpoint push; không PR/merge/force/reset/stash/clean/rebase.
