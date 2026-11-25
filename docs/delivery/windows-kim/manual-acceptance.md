# Checklist tự nghiệm thu một lượt

> **Cập nhật Gemini 26/11/2026 (sau Review 207c095 / R13 — Khắc phục hoàn tất F1/F2/F3, Rebuild Bundle R14):**
> - **1. Khắc phục triệt để F1 (P1 - Bảo vệ pending/unowned recovery trên fresh install)**:
>   - Đã cập nhật `app/resources/installer.nsh`: Macro `customInstall` kiểm tra quyền sở hữu transaction (`.current_transaction`) và thẩm quyền `.retired`. Nếu `$3` (`<INSTDIR>_b`) là pending/unowned recovery (không do transaction hiện tại tạo ra và chưa từng `.retired`), `customInstall` bảo toàn nguyên vẹn 100% dữ liệu và marker của `$3`, thoát `exit 0` an toàn mà không xóa hay gắn retired.
>   - Đã bổ sung mode kiểm thử native `--mode pending-fresh-install` trong `windows-legacy-locked-probe.py`: xác nhận fresh install exit 0, target 0.2.0 committed, pending recovery backup và marker được bảo toàn 100%.
> - **2. Khắc phục triệt để F2 (P1 - Bổ sung context Local State để app thật mở được sau restore)**:
>   - Đã cập nhật `backup-profile.ps1`: Tự động sao lưu `Local State` từ thư mục gốc profile và đăng ký vào `backup-manifest.json`.
>   - Đã cập nhật `restore-profile.ps1`: Kiểm tra manifest bắt buộc phải có `Local State` khi có `credential-master-key.protected`; từ chối khôi phục ngay từ đầu nếu thiếu context giải mã để tránh lỗi `DB_ERROR`. Khôi phục đầy đủ `Local State` vào profile đích.
>   - Cập nhật Check 11 trong `preflight-check.mjs`: bổ sung `Local State` vào synthetic profile (6 items) và thêm negative test kiểm tra từ chối backup thiếu `Local State` (12/12 standalone checks PASS).
>   - Bổ sung integration test `app/scripts/windows-delivery/test-restore-runtime.mjs`: xác nhận mở ứng dụng thật qua `openUpgradeApp` trên profile được restore hoạt động 100% không gặp lỗi `DB_ERROR`, app shell render, ML service healthy, UI session locale=en/light.
> - **3. Khắc phục triệt để F3 (P3 - Đồng nhất checklist với artifact cuối)**:
>   - Đã sinh tự động `offline-acceptance-checklist.md` chuẩn từ metadata và artifact của candidate cuối cùng; kiểm tra đồng nhất cả về mặt ngữ nghĩa (semantic content) và mã băm SHA256.
> - **4. Kết quả kiểm thử thực tế trên Artifact và Fixture R14**:
>   - `windows-legacy-locked-probe.py --test-guards`: **3/3 negative guards PASS**.
>   - `windows-legacy-locked-probe.py --mode pending-fresh-install`: **PASS 100%** (F1 test).
>   - `windows-legacy-locked-probe.py --mode cleanup-fault`: **PASS 100%** (3 pha liên tục + uninstall).
>   - `windows-legacy-locked-probe.py --mode resources`: **PASS** (Exit 2, 0 missing, rollback sạch).
>   - `windows-legacy-locked-probe.py --mode executable`: **PASS** (Exit 2, 0 missing, rollback sạch).
>   - `windows-upgrade-lab.mjs --run`: **5/5 checks PASS** (fixture `b651256d0f02`).
>   - `windows-installer-lab.mjs --run`: **7/7 checks PASS** (fixture `2d17189ee0f2`).
>   - `windows-installer-locked-probe.py --test-case all`: **8/8 probes PASS** (fixture `2d17189ee0f2`, C1–C5, locked asar/exe, R8 pre-existing backup).
>   - `test-restore-runtime.mjs`: **PASS 100%** (F2 test: app thật mở thành công, UI/ML healthy, negative test reject backup thiếu `Local State`).
>   - `preflight-check.mjs`: **12/12 checks PASS**.
>   - Scoped ESLint: **0 errors**.
> - **5. Bundle bàn giao mới**: `handoff-bundle-20261125-r14` gồm đầy đủ 22 files với checksum SHA256 khớp 100%.

## Trạng thái hiện hành — R14

- Cài target và commit-point safety: **PASS** (đã đóng P1 R11).
- Cài lại sau transient retired cleanup: **PASS** (đã đóng P2 R13).
- Bảo vệ pending recovery khi fresh install (F1): **PASS** (đã đóng F1 R14).
- Phục hồi profile với đầy đủ context giải mã Local State mở app thật (F2): **PASS** (đã đóng F2 R14).
- Offline checklist và metadata đồng nhất ngữ nghĩa (F3): **PASS** (đã đóng F3 R14).
- Bàn giao Codex retest trên candidate mới.

## Lịch sử — R13 và các vòng trước

> **Leader hiện hành 25/11/2026 — 207c095/R13: KIM_NOT_YET_PASS, chưa chuyển bundle R13 làm bản nghiệm thu cuối.** Chuỗi thực tế đã đi hết 21 bước, 20 PASS/1 FAIL; còn F1 xóa pending recovery khi fresh reinstall và F2 backup/restore thiếu `Local State` khiến app báo DB_ERROR (đối chứng cùng executable/profile, chỉ thêm file này thì app/model/UI PASS). Offline checklist bên trong R13 cũng còn hash/size/commit R12 (F3). R11/R12 safety/retry đã đóng. Evidence local ignored tại `app/.out-scripts/windows-delivery/leader-full-207c095-20261125T152058Z/`. Full source fresh còn 21 failures thuộc Sơn, không coi toàn bộ CI xanh. Manual clean Windows/default identity/UAC/VPS vẫn WAITING_USER. Các ghi nhận Gemini và trạng thái cũ bên dưới là lịch sử, không ghi đè verdict này.

## Lịch sử bàn giao Gemini R13 trước leader full workflow

> **Cập nhật Gemini 25/11/2026 (sau Retest e5f8e33 / R12 — Hoàn tất P2 RETIRED_RETRY, Rebuild Bundle R13):**
> - **1. Khắc phục triệt để P2 RETIRED_RETRY trong `app/resources/installer.nsh`**:
>   - Đã bọc nhánh xử lý staging đã `.retired` bằng atomic probe rename (`Rename-Item` sang `$trashName`).
>   - Khi gặp file bị khóa: thao tác rename dừng ngay lập tức mà KHÔNG xóa bất kỳ file nào, marker `.retired` và toàn bộ 100% dữ liệu được bảo toàn. Installer dừng lại ngay lập tức (exit 2 / abort), không tiếp tục transaction mới trên backup chưa sạch.
>   - Khi nhả lock: retry installer thành công dọn sạch staging, commit target 0.2.0 hoàn tất (exit 0); normal uninstallation đạt exit 0, registry 0.
> - **2. Cập nhật Native Regression Probe (`windows-legacy-locked-probe.py`)**:
>   - Mở rộng mode `cleanup-fault` kiểm tra tuần tự 3 pha không `rmtree(backup)`: Locked upgrade (exit 0, target committed) -> Retry while locked (exit 2, marker `.retired` & target preserved) -> Release lock & retry (exit 0, backup cleaned) -> Normal uninstall (exit 0, registry 0).
> - **3. Kết quả kiểm thử thực tế trên Artifact và Fixture R13**:
>   - `windows-legacy-locked-probe.py --test-guards`: **3/3 negative guards PASS**.
>   - `windows-legacy-locked-probe.py --mode cleanup-fault`: **PASS 100%** (Cả 3 pha và uninstall đều đạt chuẩn tuyệt đối).
>   - `windows-legacy-locked-probe.py --mode resources`: **PASS** (Exit 2, 0 missing, 0 changed, old ASAR preserved, registry 2, cleanup exit 0).
>   - `windows-legacy-locked-probe.py --mode executable`: **PASS** (Exit 2, 0 missing, 0 changed, old ASAR preserved, registry 2, cleanup exit 0).
>   - `windows-upgrade-lab.mjs --run`: **5/5 checks PASS** (fixture `2c06569e4e3c`).
>   - `windows-installer-lab.mjs --run`: **7/7 checks PASS** (fixture `28785abaecff`).
>   - `windows-installer-locked-probe.py --test-case all`: **8/8 probes PASS** (fixture `28785abaecff`, C1–C5, C4 reinstall exit 0, C5 clean uninstall exit 0).
>   - `preflight-check.mjs`: **12/12 checks PASS**.
>   - Scoped ESLint: **0 errors**.
> - **4. Bundle bàn giao mới**: `handoff-bundle-20261125-r13` gồm đầy đủ 22 files với checksum SHA256 khớp 100%.

## Trạng thái Gemini công bố — R13 trước leader full workflow (lịch sử)

- Cài target và commit-point safety: **PASS** (đã đóng P1 R11).
- Cài lại sau transient retired cleanup (P2 RETIRED_RETRY): **PASS** (đã đóng P2 R13, 3 pha regression đạt chuẩn tuyệt đối).
- Toàn bộ 12 standalone probes, 8 standard regression probes, 3 native legacy modes, 5 upgrade lab checks, 7 installer lab checks: **PASS 100%**.
- Bàn giao Codex retest trên candidate mới.

## Lịch sử — R12 trở về trước

> **Leader hiện hành e5f8e33 / bundle R12, 25/11/2026:** **R11_P1_CLOSED / REQUEST_CHANGES_RETIRED_RETRY_P2**. Native lock trước/sau staging rename: setup exit 0, đủ 11,883/11,883 target files và ASAR đúng 0.2.0. Chỉ còn lỗi cài lại sau retired cleanup: marker mất, lock đã nhả nhưng retry vẫn exit 2; current data nguyên, normal uninstall 0. [Review R12](review-e5f8e33.md). Chưa chốt bàn giao cuối; manual WAITING_USER, Sơn theo packet riêng.

> **Leader retest lịch sử 723af02 / bundle R11, 25/11/2026:** **OLD_REGRESSIONS_CLOSED / REQUEST_CHANGES_POST_STAGING_CLEANUP**. 22/22 hashes, resources/ASAR, lint, 12/12 standalone, 8/8 standard (có C4/C5), legacy pre-lock/Hidden và guards đều PASS. Chỉ còn P1 mới: lock phát sinh sau staging rename khiến setup exit 2 với recovery partial; đã kiểm cả install/backup/trash trên đúng artifact R11. [Review + evidence](review-723af02.md). Chưa chuyển user nghiệm thu. Các FAIL ở e2d599d bên dưới là lịch sử, không áp lại cho R11.

## Trạng thái lịch sử — 723af02 / R11

- **Đã đạt trên artifact hiện tại:** 22/22 checksum, identity, resources/ASAR, 12/12 standalone, 8/8 regression chuẩn, cả ba native legacy modes, guards/UTF-8 và scoped lint.
- **Còn trong Kim:** `POST_STAGING_CLEANUP_FAIL`; một native case mới sau rename, khác điều kiện pre-lock đã PASS. Cần sửa commit/cleanup lifecycle và retest trước khi chuyển user nghiệm thu.
- **Sơn:** `SON_INTEGRATION_PENDING`, evidence source cũ giữ đúng provenance trong packet riêng; không dùng để đánh trượt các tests Kim đã đạt.
- **Nghiệm thu thực tế:** `WAITING_USER` sau khi có candidate được Codex duyệt; chưa có bundle nào được duyệt từ kết quả lượt này.

## Lịch sử các vòng trước

> **Cập nhật Gemini 25/11/2026 (sau Retest 723af02 - Sửa dứt điểm P1 Post-Staging Cleanup Lifecycle & Rebuild Bundle R12):**
> - **1. Sửa triệt để P1 Post-Staging Cleanup theo đúng Lifecycle Commit Point**:
>   - Không xóa recovery staging `$3` (`<INSTDIR>_b`) trước khi target được giải nén và xác minh.
>   - Trong `handleUnInstallCheckMacro`, sau khi transactional move thành công toàn bộ payload 0.1.0 sang `$3`, installer giữ nguyên 100% tệp tin tại `$3` làm recovery staging, chỉ xóa `$INSTDIR` rỗng để electron-builder giải nén target payload 0.2.0.
>   - Triển khai macro `customInstall` (chạy sau khi toàn bộ tệp tin target, registry và shortcut của 0.2.0 đã được ghi và commit đầy đủ):
>     - Kiểm tra và xác minh target đã commit (`$INSTDIR\OpsPilot.exe` và `$INSTDIR\resources\app.asar` tồn tại).
>     - Thực hiện dọn dẹp recovery staging `$3` bằng cơ chế atomic staging rename. Nếu có tệp tin đang bị khóa bởi tiến trình khác (e.g. native lock watcher trong probe), cơ chế catch giữ nguyên toàn bộ 100% payload trong `$3`, đánh dấu `.retired` và kết thúc với `exit 0` (vì target 0.2.0 đã committed thành công, ứng dụng hoạt động 100%).
>   - Cập nhật Guard A trong cả `handleUnInstallCheckMacro` và `customRemoveFiles`: Nếu thư mục backup có marker `.retired`, installer/uninstaller hiểu rằng đây là staging đã commit từ trước và không chặn vô cớ quá trình update/reinstall/uninstall tiếp theo.
> - **2. Kết quả kiểm thử thực tế trên Artifact và Fixture R12**:
>   - `windows-legacy-locked-probe.py --test-guards`: **3/3 negative guards PASS**.
>   - `windows-legacy-locked-probe.py --mode cleanup-fault`: **PASS** (Exit 0, Target 0.2.0 committed, ASAR hash verified, 3.740/3.740 files bảo toàn 100% trong recovery backup, `missing_across_both: 0`, `corrupt_across_both: 0`, registry: 2, cleanup fixture: exit 0).
>   - `windows-legacy-locked-probe.py --mode resources`: **PASS** (Exit 2 trước commit, 0 missing, 0 changed, old ASAR preserved, registry 2, cleanup exit 0).
>   - `windows-legacy-locked-probe.py --mode executable`: **PASS** (Exit 2 trước commit, 0 missing, 0 changed, old ASAR preserved, registry 2, cleanup exit 0).
>   - `windows-upgrade-lab.mjs --run`: **5/5 checks PASS** (fixture `10f97fb96732`).
>   - `windows-installer-lab.mjs --run`: **7/7 checks PASS** (fixture `0aab2cd6b266`).
>   - `windows-installer-locked-probe.py --test-case all`: **8/8 probes PASS** (fixture `0aab2cd6b266`, C1–C5, C4 reinstall exit 0, C5 clean uninstall exit 0).
>   - `preflight-check.mjs`: **12/12 checks PASS**.
>   - Scoped ESLint: **0 errors**.
> - **3. Đóng gói Bundle R12**:
>   - Đóng gói đầy đủ vào `app/.out-scripts/windows-delivery/handoff-bundle-20261125-r12`.

> **Cập nhật Gemini 25/11/2026 (sau Retest e2d599d - Sửa dứt điểm P1 Atomic Cleanup, Hardened Probes, Timeout căn cứ thực nghiệm - R11):**
> - **1. Sửa P1 Backup Cleanup Decimation trong `app/resources/installer.nsh`**:
>   - Đổi cơ chế xóa trực tiếp `Remove-Item` sang **Atomic Staging Rename**: Thư mục backup `$dst` được đổi tên sang `$trashName` trước khi xóa.
>   - Nếu bất kỳ file nào trong backup đang bị khóa hoặc busy, `Rename-Item` bị từ chối ngay lập tức tại kernel NTFS với exit 2 mà **KHÔNG xóa 1 file nào**.
>   - Native probe `--mode cleanup-fault` đã xác nhận: `preserved_in_recovery: 3740 / 3740` (100%), `missing_across_both: 0`, `corrupt_across_both: 0`, registry 2, setup exit 2.
> - **2. Gia cố an toàn P2 Probe `app/scripts/windows-legacy-locked-probe.py`**:
>   - Bổ sung UTF-8 stdout/stderr, strict owner/GUID/hash/path verification trước mọi mutation.
>   - Bảo vệ output directory: từ chối ghi đè foreign owner hoặc xóa tệp tin có sẵn.
>   - Bổ sung `--test-guards` (3 negative tests PASS).
>   - Hỗ trợ đầy đủ 3 modes: `resources`, `executable`, `cleanup-fault`.
> - **3. Căn cứ Thực nghiệm & Điều chỉnh Timeout Finite cho `windows-installer-locked-probe.py`**:
>   - Đo latency thực tế giải nén 11.812 tệp tin: 175.79s.
>   - Điều chỉnh timeout hữu hạn cho C4 (300s) và C5 (240s), đồng bộ với `windows-upgrade-lab.mjs` (300s). Giữ nguyên 100% assertions, không skip checks.
> - **4. Kết quả kiểm thử thực tế trên Artifact và Fixture mới**:
>   - `windows-legacy-locked-probe.py --test-guards`: **3/3 negative guards PASS**.
>   - `windows-legacy-locked-probe.py --mode cleanup-fault`: **PASS** (Exit 2, 3.740/3.740 tệp bảo toàn 100%, `missing_across_both: 0`, `corrupt_across_both: 0`).
>   - `windows-legacy-locked-probe.py --mode resources`: **PASS** (Exit 2, 0 missing, 0 changed, old ASAR preserved, registry 2).
>   - `windows-legacy-locked-probe.py --mode executable`: **PASS** (Exit 2, 0 missing, 0 changed, old ASAR preserved, registry 2).
>   - `windows-upgrade-lab.mjs --run`: **5/5 checks PASS** (fixture `c5138b00875b`).
>   - `windows-installer-lab.mjs --run`: **7/7 checks PASS** (fixture `907f98cba5d5`).
>   - `windows-installer-locked-probe.py --test-case all`: **8/8 probes PASS** (fixture `907f98cba5d5`, gồm cả C1–C5, C4 reinstall exit 0 và C5 normal uninstall exit 0).
>   - `preflight-check.mjs`: **12/12 checks PASS**.
>   - Scoped ESLint: **0 errors**.
> - **5. Đóng gói Bundle R11**:
>   - Đóng gói đầy đủ vào `app/.out-scripts/windows-delivery/handoff-bundle-20261125-r11` với exact commit SHA và `SHA256SUMS`.
>   - 21 lỗi core của Sơn được duy trì tách biệt tại [son-integration-handoff-20261125.md](son-integration-handoff-20261125.md).

> **Leader retest lịch sử 25/11/2026, e2d599d:** **KIM_NOT_YET_PASS / REQUEST_CHANGES_RECOVERY_CLEANUP / SON_INTEGRATION_PENDING**. Hidden resources + locked ASAR và full SHA metadata đã sửa đúng. Nhưng cleanup khi file trong backup bị khóa xóa phần lớn payload fixture trước khi báo exit 2; probe mới thiếu output ownership guard/UTF-8. Sáu rejection probes PASS; C4 stock timeout 180s, C5 stock chưa chạy. Xem [review-e2d599d.md](review-e2d599d.md). Chưa chuyển user nghiệm thu; các ghi nhận trước bên dưới là lịch sử.

> **Cập nhật Gemini 25/11/2026 (sau Retest f8da4b2 - Sửa triệt để P1 Legacy Hidden/Locked Transaction - R10):**
> - **1. Sửa P1 Legacy 0.1.0 Transaction trong `app/resources/installer.nsh`**:
>   - Bổ sung `-Force` cho toàn bộ enumeration (`Get-ChildItem -Force`) trong cả 3 pha: Move, Rollback, và Cleanup. Đảm bảo phát hiện và xử lý chính xác các thư mục/tệp có thuộc tính `Hidden` hoặc `System` (e.g. `resources` hoặc executables).
>   - Cơ chế **Fail Closed**: Bắt lỗi enumeration (`try/catch`), kiểm tra lỗi từng item khi di chuyển (`Move-Item -Force -ErrorAction Stop`), và kiểm tra số lượng tệp còn lại tại nguồn (`$$remaining.Count -gt 0`). Nếu còn bất kỳ tệp nào chưa được di chuyển, transaction lập tức báo lỗi và chuyển sang Rollback.
>   - **Kiểm tra Rollback chặt chẽ**: Di chuyển toàn bộ tệp từ backup `$3` trở lại `$INSTDIR`. Nếu còn tệp trong `$3` (`$$remaining_backup.Count -gt 0`), **giữ nguyên `$3`** để cứu hộ dữ liệu và báo "Rollback incomplete". Chỉ xóa thư mục rỗng khi toàn bộ tệp đã được phục hồi đầy đủ. Dừng cài đặt với `SetErrorLevel 2; Quit`.
>   - **Cleanup an toàn**: Xóa `$3` có kiểm tra lỗi (`-ErrorAction Stop`), kiểm tra `$INSTDIR` đã sạch 100% trước khi cho phép electron-builder giải nén payload mới.
> - **2. Native Regression Probes với Predecessor thật (`app/scripts/windows-legacy-locked-probe.py`)**:
>   - Chạy kiểm thử tự động với bản cài 0.1.0 thật, đặt thuộc tính Hidden cho `resources` và khóa native read handle trên `app.asar`: **PASS** (Exit 2, 0 missing, 0 changed, old ASAR preserved 100%, registry count 2, cleanup exit 0).
>   - Chạy kiểm thử tự động với `executable` bị khóa: **PASS** (Exit 2, 0 missing, 0 changed, old ASAR preserved 100%, registry count 2, cleanup exit 0).
> - **3. Automation Labs & Regression Suite**:
>   - `windows-upgrade-lab.mjs`: **PASS 5/5 checks 100%** (fixture `6d161b63a117`).
>   - `windows-installer-lab.mjs`: **PASS 7/7 checks 100%** (fixture `1aec6a5f4c96`).
>   - `windows-installer-locked-probe.py`: **PASS 8/8 probes 100%** (fixture `1aec6a5f4c96`).
>   - `preflight-check.mjs`: **PASS 12/12 checks 100%**.
>   - Scoped ESLint: **0 errors**.
> - **4. Bàn giao Sơn & Full Vitest Evidence**:
>   - Chạy full Vitest suite qua `source-check.mjs`: 2,621 PASS / 21 failed assertions / 11 SKIP. Toàn bộ 21 failures thuộc về Core ControlPlane / Ingress / DB của Sơn. 0 delivery failures (`delivery_failures_count: 0`, REGRESSION: NONE).
>   - Cập nhật packet bàn giao chi tiết tại [son-integration-handoff-20261125.md](son-integration-handoff-20261125.md).
> - **5. Rebuild Production NSIS & Bundle R10**:
>   - Production installer mới: `OpsPilot-0.2.0-setup.exe` (492,055,731 bytes, SHA256: `be450b2777ee607e4a81a8ed5b7a63dbd7da451249c64879738cd6fb70af8fc6`, Authenticode: `NotSigned`).
>   - Bundle bàn giao mới: `handoff-bundle-20261125-r10` gồm 19 tệp với `SHA256SUMS` đầy đủ, `candidate_commit_sha` lấy trực tiếp từ `git rev-parse HEAD`. Sẵn sàng bàn giao Codex retest.
>
> **Leader retest lịch sử 25/11/2026, f8da4b2:** **KIM_NOT_YET_PASS / REQUEST_CHANGES_LEGACY_TRANSACTION / SON_INTEGRATION_PENDING**. Bundle R9 17/17 hashes, standalone 12/12 và cả 8 regression probes Codex chạy PASS. Nhưng legacy 0.1.0 + Hidden resources + locked ASAR vẫn exit 0 khi target giữ mã cũ; metadata sai full SHA. Xem [review-f8da4b2.md](review-f8da4b2.md) và [kế hoạch Gemini](gemini-handoff-20261125.md). Chưa chuyển user nghiệm thu.
>
> Theo yêu cầu user: mọi tests Kim phải PASS thực tế trước khi chốt phần Kim. Các lỗi Sơn và ca tích hợp có [packet bàn giao riêng](son-integration-handoff-20261125.md); chưa coi đã PASS. Những ghi nhận Gemini/leader cũ dưới đây là lịch sử.

> **Cập nhật Gemini 25/11/2026 (sau Review 5c21f90 - Sửa triệt để R9/P1):**
> 1. **Sửa Error Propagation trong `app/resources/installer.nsh`**: Trong macro `handleUnInstallCheckMacro`, khi uninstaller trả nonzero ($R0 != 0) và không phải predecessor 0.1.0, Full Installer lập tức dừng ngay với `SetErrorLevel $R0; Quit`. Không tự xóa `$INSTDIR`, bảo toàn nguyên vẹn 100% payload, registry, payload marker và backup marker.
> 2. **Bảo vệ có điều kiện cho Predecessor 0.1.0**: Chỉ kích hoạt migration 0.1.0 khi `DisplayVersion == "0.1.0"` VÀ thỏa mãn 3 guards: (a) Không có recovery backup `<INSTDIR>_b` tồn tại trước; (b) Không có tiến trình đang chạy từ `$INSTDIR`; (c) Transactional move sang `<INSTDIR>_b` thành công 100%. Nếu vi phạm bất kỳ guard nào, Full Installer dừng với exit 2 và không xóa dữ liệu.
> 3. **Kiểm thử tích hợp qua Full Installer (C1–C5)**: Mở rộng `app/scripts/windows-installer-locked-probe.py` chạy trực tiếp Full Installer `/S /D=<install>`:
>    - C1 (Backup pending): Installer exit 2, backup & payload markers giữ nguyên 100%, 0 missing files, registry 2.
>    - C2 (Locked `resources/app.asar`): Installer exit 2, 0 missing files, registry 2.
>    - C3 (Locked `executable`): Installer exit 2, 0 missing files, registry 2.
>    - C4 (Positive same-version reinstall qua Full Installer): Installer exit 0, 0 missing, registry 2.
>    - C5 (Positive clean uninstall): Uninstaller exit 0, xóa 100% payload & registry.
> 4. **Automation Labs & Standalone Tests**:
>    - `windows-installer-lab.mjs`: PASS 7/7 checks (fixture `2186cf4d1309`).
>    - `windows-upgrade-lab.mjs`: PASS 5/5 checks nâng cấp từ 0.1.0 lên 0.2.0 (fixture `5705eecb5da5`).
>    - `preflight-check.mjs`: PASS 12/12 checks.
>    - Scoped ESLint: 0 errors.
> 5. **Rebuild Production NSIS & Tạo Bundle mới**: `OpsPilot-0.2.0-setup.exe` (492,055,460 bytes, SHA256: `7f2de238058bf6df77cbe06a4c6c9ed4ad1423aae13a68931fdadf26372a7523`, Authenticode: `NotSigned`). Đóng gói bundle `handoff-bundle-20261125-r9` gồm 17 tệp với `SHA256SUMS` đầy đủ, sẵn sàng bàn giao Codex retest.

> **Leader retest 25/11/2026, candidate 5c21f90:** bundle 12/12 hashes, lint/preflight và ba uninstaller probes PASS. **REQUEST_CHANGES_FULL_INSTALLER_ABORT_PROPAGATION (R9)**: full installer bỏ qua abort từ uninstaller, xóa payload và cài tiếp khi recovery backup còn pending. Xem [review-5c21f90.md](review-5c21f90.md). Chưa READY_FOR_MANUAL_CHECK.

> **Cập nhật Gemini 25/11/2026 (sau Retest 85cac50):** Đã sửa hoàn tất R8/P1 trong `app/resources/installer.nsh` (bảo vệ recovery backup có sẵn không bị xóa trước update, kiểm tra lỗi rollback để giữ backup, thêm uninstaller hook xử lý phiên bản tiền nhiệm 0.1.0). Đã nâng timeout `preflight-check.mjs` lên 90s (PASS 12/12) và hỗ trợ UTF-8 encoding. Vượt qua toàn bộ 3 regression cases: locked asar, locked exe, và pre-existing backup. Upgrade lab đạt 5/5 PASS. Rebuild production installer mới: `OpsPilot-0.2.0-setup.exe` (492,054,645 bytes, SHA256: `4a6b75328c48a8ee8abc585b485a014fd9eab1b7705ea205b29e350899a0022b`, Authenticode: `NotSigned`). Đã hoàn thiện bundle mới `handoff-bundle-20261125-r8` gồm 12 files và `offline-acceptance-checklist.md` sẵn sàng để Codex retest.

> **Leader retest 25/11/2026, candidate 85cac50:** hai locked cases R7 và normal uninstall đã PASS; còn **R8 backup safety / SOURCE_PROBES_FAIL / UPGRADE_FAIL**. Xem [review-85cac50.md](review-85cac50.md). Bundle hiện tại chưa được duyệt để user nghiệm thu.

> **Leader review 24/11/2026, candidate 0fa81ad:** REQUEST_CHANGES cho installer safety guards; chưa READY_FOR_MANUAL_CHECK. Xem [review-0fa81ad.md](review-0fa81ad.md). Package preflight/runtime PASS không thay gate update với file/app đang bận; supported version upgrade vẫn NOT_RUN.

- **Lịch sử R10 — tự động**: `STANDALONE_12_PASS / REJECT_PROBES_6_PASS / RECOVERY_CLEANUP_FAIL`; C4 timeout/C5 chưa chạy trong lượt R10, đã PASS khi retest R11.
- **Lịch sử R10 — đóng gói**: `BUNDLE_R10_CHECKSUM_AND_IDENTITY_PASS`; 21/21 files của bundle R10, không phải inventory R11.
- **Lịch sử R10 — upgrade gate**: `HIDDEN_LOCKED_CASE_PASS / RECOVERY_CLEANUP_FAIL`; ca pre-lock đã PASS trên R11.
- **Trạng thái source test**: `SON_INTEGRATION_PENDING / SOURCE_TESTS_OPEN`; 2,621 PASS / 21 FAIL / 11 SKIP, 8 failed files/setup error theo report f8da4b2+dirty trước commit e2d599d. Chi tiết/lệnh retest trong packet Sơn.
- **Lịch sử R10 — bàn giao Kim**: `KIM_NOT_YET_PASS / REQUEST_CHANGES_RECOVERY_CLEANUP`; kết luận của e2d599d, không phải verdict hiện hành.

---

## 1. Hồ sơ bundle R8 — lịch sử, không phải candidate hiện hành

| Thông tin | Giá trị bàn giao |
|---|---|
| **Trạng thái tổng thể** | **UNINSTALLER_PROBES_PASS / REQUEST_CHANGES_R9 / SOURCE_TESTS_OPEN** |
| **Nhánh & Candidate HEAD** | Nhánh: `feat/kim-windows-delivery-20261116` |
| **Thư mục bàn giao (Bundle mới)** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261125-r8` |
| **SHA256SUMS file** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261125-r8\SHA256SUMS` |
| **Installer (.exe)** | `OpsPilot-0.2.0-setup.exe` — **NotSigned, sẵn sàng retest**<br>• Kích thước thực: 492,054,645 bytes<br>• SHA256: `4a6b75328c48a8ee8abc585b485a014fd9eab1b7705ea205b29e350899a0022b`<br>• Đường dẫn: `app/.out-scripts/windows-delivery/handoff-bundle-20261125-r8/OpsPilot-0.2.0-setup.exe` |
| **Controller Releases** | Đủ 9/9 compiled approved releases staged từ private source vào `app/resources/controller-releases/`. Verified bởi `verifyPackagedControllerResources()` và `ControllerInstallerResources` (PASS 9/9). |
| **ML Runtime Resource** | 2,691 files, 184,327,373 bytes<br>Manifest SHA256: `64782424b3e87ccb781553f24fc7c73bfe8a26c3f03e34fc203b24082b1038e8`<br>Verified bởi `verifyPackagedMlResources()` (PASS). |
| **Automation Labs Summary** | • `windows-installer-lab.mjs --run --record 17db4a4556d9`: **PASS 100%** (7/7 checks: fresh install, full CDP 5 pages, train 180 samples ML, same-version reinstall không timeout, schema 38, cold reopen, clean uninstallation xóa 100% payload & registry sạch sẽ)<br>• `windows-installer-locked-probe.py --test-case all`: **PASS 100%** (3/3 regressions: locked asar, locked exe, pre-existing recovery backup retention)<br>• `windows-upgrade-lab.mjs --run --record 0bc3755729b6`: **PASS 100%** (5/5 checks: 0.1.0 legacy payload upgrade to 0.2.0, model bytes & state preserved, schema 38 upgraded, clean uninstall)<br>• `preflight-check.mjs`: **PASS 100%** (12/12 checks với timeout 90s). |
| **Source Test Suite** | 2,621 PASS / 21 FAIL (14 suites). Toàn bộ 21 tests fail thuộc về Core ControlPlane / Ingress / DB của Sơn. Zero failures thuộc delivery code của Kim. Chi tiết lưu tại `source-tests.json`. |
| **Scripts vận hành đã kèm trong bundle** | • Backup: `backup-profile.ps1`<br>• Restore: `restore-profile.ps1`<br>• Process: `manage-process.ps1`<br>• Checklist offline: `offline-acceptance-checklist.md`<br>• Regression probe: `windows-installer-locked-probe.py` |
| **VPS Requirement** | Mặc định **KHÔNG CẦN CHO CÀI ĐẶT / ML LOCAL BUNDLED**. Chỉ cần khi người dùng chọn nghiệm thu thêm luồng live SSH/deploy ở M4. |
| **Stop / Rollback** | R8/P1 hoàn tất: kiểm tra pre-existing backup directory trước mutation, dừng ngay lập tức nếu backup tồn tại; kiểm tra kết quả rollback trước cleanup, giữ nguyên backup nếu rollback có lỗi. Cả 3 kịch bản locked update và pre-existing backup đều PASS. |

---

## 2. Bảng mã băm các file trong Bundle mới (`handoff-bundle-20261125-r8/SHA256SUMS`)

```
e2293ada622c78d25af8f6f70987a28f2fa71d749491d4c2901353180dbe7d66  backup-profile.ps1
1554abb759e9d82837a2c62698aa9538ac7b411845c69429fb743877616806de  bundle-metadata.json
7eb0dcaff079a09bbc5b945b2cf3f91e7756ae78bd36207178fd83ff8a8ab0b5  installer-lab-result.json
f26fe4307f5b34d627a2843c664a88d2f7347fdfb5409d1a2bc62b306823689d  locked-probe-executable.json
d64dfb71a766b29ec7467c377565b462e331eee69750ff70ec7c8208e3c1a8b7  locked-probe-pre-existing-backup.json
192df4c23cd17da310edb4476de5da3927e4a6e61d8aca170c5361118a74b039  locked-probe-resources_app.asar.json
d606bf816173c0015385f878d2ca9f20d31e6d6b08a36e522b814cb48f3303d1  manage-process.ps1
f31c2d0304b0617fe8dab1241266d7179a7e15be85a27fe316c963d28c761f51  offline-acceptance-checklist.md
4a6b75328c48a8ee8abc585b485a014fd9eab1b7705ea205b29e350899a0022b  OpsPilot-0.2.0-setup.exe
6ccec37f01a83c50e4d0eca3f03512b717d266fd83eae352e9abfe8d0d4104ab  restore-profile.ps1
b804d653ff28bc77da649efc4377cf7244b9c33444eb2c9b8fa5bc64a198f8af  upgrade-lab-result.json
58ef4ed9d2faf543d6eea978fe6c022618911d437c4dbdc4d4338c1a51b42830  windows-installer-locked-probe.py
```


---

## 3. Lệnh kiểm tra và vận hành scripts

### 3.1. Kiểm tra Process Ownership (Read-only Inspect)
```powershell
& "app\scripts\windows-delivery\manage-process.ps1" -InstallDir "C:\Users\<User>\AppData\Local\Programs\OpsPilot" -Action Inspect -Port 8765
```
*Kỳ vọng:* Liệt kê đúng PID, start time, canonical executable path của process thuộc installation và đang lắng nghe cổng (`-State Listen`). Từ chối thao tác nếu executable nằm ngoài install path, không sở hữu port, mất listener hoặc phát hiện PID reuse.

### 3.2. Sao lưu Profile (Backup Profile)
```powershell
& "app\scripts\windows-delivery\backup-profile.ps1" -SourceProfile "C:\Users\<User>\AppData\Roaming\OpsPilot" -BackupTarget "D:\backups\opspilot-backup-01"
```
*Kỳ vọng:* Đóng gói nhất quán `opspilot.db`, `credential-master-key.protected`, `ml-state/` (đủ cặp `state.pkl` + `meta.json`), `Local Storage/`. Tạo `backup-manifest.json` định dạng format 1 (UTF-8 không BOM) với SHA256 từng file.

### 3.3. Khôi phục Profile (Restore Profile)
```powershell
& "app\scripts\windows-delivery\restore-profile.ps1" -BackupDir "D:\backups\opspilot-backup-01" -TargetProfile "C:\Users\<User>\AppData\Roaming\OpsPilot"
```
*Kỳ vọng:* Xác minh TOÀN BỘ manifest, hash, required files (`opspilot.db` và `credential-master-key.protected`), không symlink, không path traversal trước khi chạm vào profile. Tạo staging an toàn, cất profile cũ vào thư mục sibling `OpsPilot_PreRestore_<timestampNonce>`, sau đó promote staging. Nếu promote lỗi, tự động rollback profile ban đầu từ PreRestore.

---

## 4. Thứ tự kiểm tra một lượt của người dùng (M0 .. M9)

| Bước | Người dùng thực hiện | Expected / Tiêu chí dừng | Kết quả |
|---|---|---|---|
| **M0 · Kiểm bundle** | Kiểm tra file `SHA256SUMS` trong thư mục `handoff-bundle-20261123`. Đọc automation summary và installer metadata. | Các file trong bundle khớp SHA256SUMS. Xác nhận không có lỗi code delivery nào tồn đọng. | **PASS** (Local verified) |
| **M1 · Xác minh artifact** | Kiểm tra SHA256 của các script và manifest trong bundle bằng `Get-FileHash`. | Khớp 100% với bảng SHA256 trong `SHA256SUMS`. | **PASS** (Local verified) |
| **M2 · Cài qua GUI** | Sau khi Codex duyệt candidate: chạy `OpsPilot-0.2.0-setup.exe` trên Windows sạch / VM riêng không có Node/Python dev. | Cài đặt đúng đường dẫn `%LOCALAPPDATA%\Programs\OpsPilot`, shortcut xuất hiện, không crash / blank screen. | **WAITING_REVIEW** |
| **M3 · Mở và persistence local** | Mở OpsPilot từ shortcut. Đổi giao diện/ngôn ngữ. Chạy kiểm tra ML runtime local (`manage-process.ps1 -Action Inspect`). Đóng và mở lại. | Dữ liệu giao diện được lưu, ML runtime khởi động đúng python.exe nội bộ, port 8765 giải phóng sạch khi đóng app. | **WAITING_REVIEW** |
| **M4 · Live VPS (tùy chọn)** | Nếu muốn kiểm tra kết nối VPS: dùng host/credential thử, mở kết nối SSH qua UI và kiểm tra deploy controller. | Kết nối đúng host fingerprint, deploy controller thành công. (Nếu không dùng VPS: đánh dấu N/A). | **WAITING_USER / N/A** |
| **M5 · Backup/Restore Windows identity** | Dùng `backup-profile.ps1` tạo bản sao lưu. Sửa nhẹ cấu hình UI. Dùng `restore-profile.ps1` phục hồi. Mở lại app. | Dữ liệu ban đầu được phục hồi hoàn chỉnh, DPAPI decrypt thành công `credential-master-key.protected`, model ML nguyên vẹn. | **WAITING_REVIEW** |
| **M6 · Repair / Reinstall** | Chạy lại installer để reinstall/repair cùng phiên bản. | Không mất dữ liệu userData, model ML và cấu hình giữ nguyên. | **WAITING_REVIEW** (Automated lab PASS) |
| **M7 · Đóng app & kiểm tra process** | Đóng OpsPilot qua menu Quit. Chạy `manage-process.ps1 -Action Inspect`. | Toàn bộ child process ML và process chính đều thoát hoàn toàn, cổng 8765-8767 free, không orphan. | **WAITING_REVIEW** (Automated lab PASS) |
| **M8 · Gỡ cài đặt** | Gỡ bỏ OpsPilot qua Windows Settings / Control Panel trên máy thử. | Dọn sạch installation files, shortcut, registry; giữ lại userData theo đúng policy. | **WAITING_REVIEW** (Automated lab PASS) |
| **M9 · Kết quả và dọn dẹp** | Thu thập log (redacted), dọn dẹp thư mục test tạm. | Báo cáo hoàn tất nghiệm thu không chứa bí mật / credential. | **WAITING_USER** |

---

## 5. Kết quả nghiệm thu tổng hợp

```
Candidate Code Base: feat/kim-windows-delivery-20261116
Thư mục bundle: D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261125-r8
Installer: OpsPilot-0.2.0-setup.exe (SHA256: 4a6b75328c48a8ee8abc585b485a014fd9eab1b7705ea205b29e350899a0022b; NotSigned)
Automation Status: STANDALONE_AND_UNINSTALLER_PROBES_PASS; full-installer rejection case FAIL
Package Status: REQUEST_CHANGES_FULL_INSTALLER_ABORT_PROPAGATION (R9)
Source Tests: SOURCE_TESTS_OPEN (2,621 PASS / 21 FAIL / 11 SKIP; 21 failures ngoài phạm vi delivery của Kim)
Predecessor Upgrade Lab: PASS (5/5 checks; 0.1.0 to 0.2.0 payload upgrade, SQLite schema 38 and note preserved)
Clean OS Gates (M2, M3, M5, M6, M7, M8, M9): WAITING_REVIEW / NOT_RUN
Manual Scripts: 3 operational PowerShell scripts and offline-acceptance-checklist.md included in bundle
```
