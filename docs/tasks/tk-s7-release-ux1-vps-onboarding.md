# UX1 — thêm VPS bằng IP và mật khẩu

START 18/11/2026 — Base e353c1f. User chốt trải nghiệm người dùng làm tiêu chí
chính: thêm VPS không cần lấy fingerprint thủ công; app tự xử lý bước kỹ thuật.
Ngoại lệ này mở rộng quyết định operator18/11 thành luồng sản phẩm được yêu cầu.
Task-discipline/CLAUDE/DECISIONS; giữ lane Kim, normal commit/push checkpoint,
không PR/merge/reset/clean/stash/rebase/force. Không đổi dữ liệu app đã deploy.

| Requirement | Evidence | State |
|---|---|---|
| IP/password mặc định | Form mặc định root/22/password, tên mặc định theo host, fingerprint/nâng cao không bắt buộc;7DOM +2native Electron checks PASS/2captures, footer/layout ở1280x800 và1366x768 | PASS |
| Pin trước xác thực | Main observation reject trước auth, unchanged strict SshManager; actual create→encrypted profile→pinned SSH inventory1+2 PASS | PASS |
| Giữ danh tính đã biết | Saved/archived endpoint pin thắng first-contact;69focused SSH/Main +2actual SQLite archive/re-add checks PASS | PASS |
| Contract/error/locale | Optional input pin/test response,4locale advanced hint; không fake console trust, runtime guards giữ nguyên; build Node/Web và scripts types/scoped lint PASS | PASS |
| Proof |Final full2757PASS+2existingLinuxSKIP/192files,13focused concurrency/SQLite, typesNode-Web-Scripts/lint0warnings/format/build/parity2types PASS; actual inventory1+2 và native Electron form2checks/2captures PASS | PASS |
| Handoff | Board/task/traceability/master/allocation/plan25/proof cập nhật; indexed allowlist đúng29file, source/raw/2PNG hashes trùng, staged diff/secret check PASS; Kim coauthor/normal checkpoint push | PASS |

App ghi nhớ khóa nhận ở lần đầu, không tuyên bố đã đối chiếu nhà cung cấp. Người
dùng vẫn có thể chỉ định fingerprint ở nâng cao trước kết nối. Các đường deploy/
controller khác tiếp tục bắt buộc pin đã lưu và giữ mọi guard hiện có.

E4a đã push e353c1f. E4b fresh install/deploy/reconnect trên1+2 vẫn OPEN; không dùng
identity/receipt/data của máy cũ hết hạn. Ưu tiên UX1 trước để nghiệm thu trên đúng
luồng người dùng. Đánh giá mốc25/11 sẽ ghi rõ phần nào còn chưa chứng minh.

UPDATE18/11 — Live readonly inventory nonce df177d840b29: cả1+2 Ubuntu24.04.5/x64/
glibc2.39/2CPU/~4GBRAM, chưa Docker/controller. Auto-observe không auth, đối chiếu
operator pin đã biết trước khi dùng password, actual encrypted local profile và
strict SshManager đọc inventory. Không mutation remote/không dùng3+4; private DB/key
fixture đã dọn. Password chỉ RAM/no-echo stdin, không argv/env/report.

UPDATE18/11 — DOM gate lần đầu lỗi selector Password trùng radio và input, đã sửa
selector rồi7/7PASS. Native Electron harness đầu cleanup đụng Chromium DIPS lock;
đã tách runtime cache khỏi privateDB và giữ failure log. Actual layout proof cho
thấy footerVisible=false ở1280x800; thêm centered/scrollable modal body, không miễn
gate hoặc gọi ảnh lỗi là PASS. Full suite trước chỉnh style không thay final gate.

UPDATE18/11 — Native Electron cuối nonce6376f088ebbe PASS2checks/2captures: production
form/preload/Main onboarding/SQLite với synthetic host observation. Đã đo đúng
content viewport1280x800 và1366x768, footer hiện/không cuộn ngang; Save chỉ IP/password
ghi đúng pin và tên mặc định. Không suy từ đây ra actual GUI→VPS deployment. Chỉ
copy nâng cao/optional-pin mới đủ4locale; các nhãn form cũ giữ coverage hiện có.
Build đầu lỗi typed Vps stub thiếu publicfields; đã sửa fixture đầy đủ, không cast
unknown hoặc nới type. Build production/Node/Web đã PASS, final full suite đang chạy.

## HANDOFF-LOCAL18/11 — UX1 DONE scoped, CHỜ REVIEW

Status: DONE cho UX1; E4b và toàn release vẫn OPEN.

Files changed: Main first-contact/onboarding/repository/IPC và validation schema
export; VpsFormModal/copy/tests; IPC contract/shared; standalone inventory/Electron
gate; [proof](../ui-redesign/ux1-vps-onboarding-verification.json),2ảnh và task/board/
traceability/release master/allocation/kế hoạch25/11. Không sửa lane Kim/migration.

Checks run:

- `pnpm --prefix app exec vitest run --reporter=dot`:192files/2757PASS,1file/2existing
  Linux-only SKIP,0FAIL,388.88s. Raw `app/.out-scripts/ux1-final-current-full.log`.
- `pnpm --prefix app build`: PASS gồm Node/Web typecheck. Scripts typecheck,
  scoped ESLint `--max-warnings 0`, Prettier và diff/parity hai DTO PASS.
- Native final readonly inventory9c0c8dafafa0: auto-pin/create/encrypted profile →
  strict SSH trên1+2,4checks PASS/privatecleanup. Không Docker/controller install.
- Native Electron final b157c1cacf09: form/preload/Main/SQLite,2checks/2captures,
  viewport1280x800 và1366x768/visiblefooter/nohorizontaloverflow PASS/privateDBcleanup.
  Host observation synthetic; không thay bằng actual GUI→VPS deployment claim.
- Rà soát cuối thêm recheck endpoint/principal/pin sau await trước update;13focused
  concurrency/SQLite PASS. Typed Mock mới cần generic callable signature; sửa chỉ
  annotation, kiểm emitted JavaScript byte-identical rồi final build/full PASS.

Assumptions / pre-existing failures: giữ2Linux-only skips hiện có. DOM phát jsdom/
Antd warnings (getComputedStyle/canvas/useForm), không tự gọi chúng là production
bug hoặc toàn bộ đã sửa; native form acceptance riêng PASS. Các lần lỗi fixture/
layout/typecheck trước giữ log, không tính thành PASS. Coverage locale chỉ copy
nâng cao/optional pin mới; nhãn form cũ chưa được dịch hết. Cache Chromium synthetic
trong ignored nonce, private DB/credential fixture đã dọn.

Accepted exceptions: không miễn gate. First-contact trust là quyết định UX user
đã yêu cầu, không giả console verification; đổi khóa đã biết vẫn dừng, rotation
wizard còn ở backlog.

Next action: UX2 guided prepare/deploy hai nguồn, E4b cài/deploy/reconnect trên1+2.
Mốc25/11 theo plan, không gọi toàn bộ production/formalML/Windows đã hoàn tất.
Commit lookup `git log -1 -- app/src/main/vps/onboarding.ts`; Kim coauthor, normal
push nhánh core, không PR/merge/force/reset/stash/clean/rebase.
