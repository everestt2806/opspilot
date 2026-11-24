# Hoàn tất Windows delivery sau khi nhận resources — 23/11/2026

Kế hoạch hiện hành, thay lịch 22/11 đã hết hạn. Codex lập plan/review/retest; Gemini implementation. Tiếp nhận nhánh `feat/kim-windows-delivery-20261116`, HEAD đã push `4f5622b`; baseline code `f699615`. Không tích hợp core mới trong task này.

## 1. Kết quả kiểm tra đầu vào

- R5/R6 đã được leader xác nhận trong [review-251cde3.md](review-251cde3.md): scoped ESLint, 12 standalone probes, 5 native restore cases và 4 process mock cases PASS. Giữ implementation đã đạt, không làm lại từ đầu.
- User đã cung cấp resource package local có yêu cầu bảo mật. Archive và catalog khớp hai checksum bàn giao. Compiled catalog của nhánh có 9 descriptors; catalog đầu vào có 10, trong đó đủ 9 descriptors khớp. Không có required release bị thiếu.
- Leader đã kiểm từng required release và gọi `verifyPackagedControllerResources()` trên nguồn local: 9/9 đạt, production verification PASS. Đây là static verification theo compiled pins hiện có, chưa phải actual beforePack/NSIS hay full packaged-app PASS.
- ML runtime/Python build environment 3.12.10 đã có. Không rebuild hoặc thay development venv chỉ để bắt đầu lại.
- Chưa đưa controller resources vào checkout Kim và chưa build installer mới. Evidence xử lý 21 full-suite failures chưa được tìm thấy trong gói bàn giao; giữ SOURCE_TESTS_OPEN.
- Hiện trạng: **PRIVATE_RESOURCES_VERIFIED / PACKAGE_PENDING / SOURCE_TESTS_OPEN**. Không còn blocker thiếu required controller bytes; catalog cần được staging đúng baseline.

## 2. Bảo mật bắt buộc

Đường dẫn private được user cung cấp trực tiếp trong chat; truyền local qua `OPSPILOT_PRIVATE_HANDOFF_DIR`, không ghi đường dẫn/nội dung private vào tài liệu tracked mới. User cấm commit/push toàn bộ input private.

Leader đã thêm `/docs/secrect docs/` vào local Git info/exclude ở cả hai checkout, kiểm tra không có private file được track. Ignore này chỉ thuộc máy local, không thay `.gitignore` chung. `app/resources/controller-releases/`, `app/resources/ml-runtime/` và `.out-scripts` vốn đã ignored.

Gemini phải kiểm lại ignore và tracked paths trước staging/commit; không `git add .`, `git add -A`, `git add -f` hoặc force-add binary. Chỉ add danh sách source/docs an toàn sau review diff. Không chép archive, checksum đầu vào, catalog/binaries private, credential/DB/key/model hoặc raw logs vào Git. Không upload private input/output lên CI artifacts, Pages, release hoặc dịch vụ ngoài. Installer chứa resource bytes cũng phải giữ trong bundle private local, chưa publish.

Giữ nguyên nguồn private, không đổi/xóa/move file trong đó. Hash nguồn, mapping và raw verification logs chỉ lưu ở ignored output mới. Git chỉ nhận tổng hợp đã làm sạch như số lượng/PASS/FAIL/owner. Mỗi Move/Remove/cleanup phải xác minh absolute path thuộc fixture/output được sở hữu.

## 3. Thứ tự thực hiện của Gemini

| Bước | Công việc | Điều kiện qua |
|---|---|---|
| P0 | Ghi START; đọc owner, kiểm branch/HEAD/status, local ignore; tạo output nonce riêng | Không thay core/pins, không private file tracked |
| P1 | Tạo controller resources view đúng compiled catalog trong ignored resource destination | Đủ toàn bộ trusted descriptors; không đưa entry ngoài catalog vào payload; source private nguyên vẹn |
| P2 | Kiểm trusted resources, Python/deps và preflight package | Production controller/ML verify PASS và package gate PASS; không skip verifier |
| P3 | Production build + actual beforePack + NSIS x64 output mới | Có unpacked app/installer, provenance và hashes local; không publish |
| P4 | Full-app, NSIS fixture, native legacy-helper và supported upgrade labs | SQLite/key/model/UI persistence; bundled ML thật; đúng process ownership; quit/reinstall/upgrade/uninstall fixture đạt |
| P5 | Chốt source failures và source checks trên candidate cuối | Không lỗi delivery chưa xử lý; full suite report trung thực; core failures có packet cho Coordinator |
| P6 | Tạo bundle private cuối và checklist M0..M9 | Installer/path/hash, scripts, sanitized report, logs private và stop/cleanup cụ thể; Codex review/retest |
| P7 | User kiểm một lượt Windows độc lập và identity/GUI/VPS thật nếu cần | Kết quả quan sát thực; chưa chạy giữ WAITING_USER |

### P1 — Chọn đúng resources, không đổi authority

Không copy nguyên catalog có 10 entries vào nhánh có 9 entries. Preflight yêu cầu runtime catalog khớp compiled catalog; electron-builder cũng copy mọi file nằm trong resource destination.

Sau build tin cậy của source hiện tại, lấy tập entry từ `builtinControllerInstallerCatalog()` và catalog generated `app/out/main/controller-installer-catalog.json`. Kiểm hai nguồn authority này thống nhất, đối chiếu từng descriptor với input, rồi copy **đủ tất cả** release directories đã ghim vào `app/resources/controller-releases/` đang chưa tồn tại; đặt runtime catalog bằng compiled catalog tin cậy. Đây là generated local staging view, không sửa source catalog/pins hoặc source private. Giữ đầy đủ historical entries thuộc trusted catalog. Entry ngoài trusted catalog chỉ được giữ trong nguồn private, không thêm vào installer.

Nếu destination bất ngờ đã tồn tại thì kiểm provenance và inventory trước; không xóa/ghi đè một bộ đang dùng. Khi tạo copy cần kiểm link/path và giữ bytes; verify lại destination sau copy, không suy từ hash nguồn. Lưu mapping/source hashes ở output ignored. Nếu descriptor required lệch pin, dừng package và báo Coordinator; không tự approve bằng checksum input.

### P2/P3 — Lệnh theo CLI hiện có

Chạy từ repo root; tạo `$packageOutput` và `$packageInventory` là absolute paths mới dưới ignored output. Không dùng output cũ hoặc production install path.

```powershell
. ./tools/enter-node22.ps1
pnpm.cmd --prefix app build
$buildPython = (Resolve-Path 'app/.out-scripts/ml-runtime-build/venv-3.12.10/Scripts/python.exe').Path
# Sau P1 và verify destination, đặt $packageInventory thành file mới trong output nonce:
node app/scripts/windows-delivery/preflight.mjs --python "$buildPython" --gate package --out "$packageInventory"
pnpm.cmd --prefix app exec electron-builder --win nsis --x64 --publish never "--config.directories.output=$packageOutput"
```

Kiểm exit code từng lệnh; không chạy tiếp khi package integrity fail. Build đầu tạo lại verifier/pins từ source hiện hành; actual beforePack vẫn phải chạy trong electron-builder, không thay bằng kết quả leader đã kiểm trên source resources.

### P4 — Labs tự động trước lượt user

Đọc [README labs](../../../app/scripts/windows-release-lab/README.md) và [upgrade policy](../../../app/scripts/windows-release-lab/UPGRADE.md), dùng exact supported arguments:

```powershell
node app/scripts/windows-release-lab.mjs --run --artifact "$packageOutput/win-unpacked"
node app/scripts/windows-installer-lab.mjs --build --artifact "$packageOutput/win-unpacked"
node app/scripts/windows-installer-lab.mjs --run --record <nonce-tu-build>
```

Tiếp native legacy-helper và actual supported predecessor upgrade theo UPGRADE.md, đúng interpreter/baseline environment đã duyệt. Không giả upgrade bằng reinstall cùng version, không nâng version/source predecessor để né lỗi. Thiếu predecessor/base-prefix/environment thì ghi đúng prerequisite, giữ upgrade NOT_RUN/BLOCKED và tiếp phần còn độc lập.

Các lab dùng namespace/install/profile/HOME/registry/port nonce riêng và full production Main/preload/renderer/SQLite/safeStorage/ML; không cài production installer lên bản đang dùng, không SSH/VPS. Positive và negative restore/ownership phải giữ đạt sau thay đổi liên quan. Synthetic training chỉ chứng minh bundled runtime, không gọi formal ML PASS.

### P5 — 21 tests fail và giới hạn acceptance

Nguồn hiện có chỉ chứng minh focused PASS; report fast mode cũ là INCOMPLETE_FAST_MODE. Chưa có evidence mới từ Coordinator gỡ 21 failures/8 failing files ngoài diff delivery. Gemini tái hiện các suite liên quan trước, ghi command/SHA/env/error và phân biệt lỗi source, fixture/cache permission, Linux/WSL/openssl hoặc environment. Không xóa cache chung, nới quyền, bỏ tests hay sửa `app/src/**` ngoài owner để xanh.

Khi khóa checkpoint implementation/package mới, chạy source runner đầy đủ một lần và lưu full JSON/logs private. Không rerun sau mỗi sửa tài liệu. Nếu không đổi core, các kết quả full cũ chỉ là lịch sử, không thay lượt candidate cuối. Full suite còn lỗi thì runner giữ nonzero và task giữ SOURCE_TESTS_OPEN/BLOCKED_CODE tương ứng. P3/P4 có thể tiếp nếu lỗi không ảnh hưởng build/lab an toàn; không suy package PASS thành release acceptance. Gửi bug packet sanitized cho Coordinator qua user; không tự gửi tin nhắn ra ngoài.

## 4. Phạm vi và đầu ra

Giữ owner theo [phân công](../../tasks/tk-s7-parallel-2026-11-16.md). Kim sửa scripts/labs, workflow riêng và dossier riêng; core/contracts/migrations/package/lock/Vite/pins/catalog source/board/DECISIONS thuộc Sơn. Không merge/rebase/reset/clean/stash/force, không publish, không VPS thật.

Một bundle private cuối gồm installer thực, SHA256SUMS local, candidate source identity, automation reports/logs, scripts đã test và checklist/manual/demo khớp artifact. Metadata nhạy cảm chỉ ở ignored bundle. Dossier tracked chỉ summary sanitized và các lỗi/owner/gate chưa đạt. Commit theo allowlist; không tự push thêm từ phiên lập plan này.

Gemini bàn giao: code SHA, từng gate PASS/FAIL/NOT_RUN, installer/bundle path riêng tư, evidence local, failures còn lại và owner. Codex review artifact/provenance/retest affected cases trước khi duyệt lượt manual. READY_FOR_MANUAL_CHECK chỉ khi không có code/package blocker ảnh hưởng acceptance; source failures chưa chốt phải hiện rõ, không tự miễn. Manual Windows sạch/GUI/UAC/DPAPI/default identity/credential và VPS thật theo luồng chọn giữ WAITING_USER tới khi user thực hiện.
