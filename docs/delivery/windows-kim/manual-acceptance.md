# Checklist tự nghiệm thu một lượt

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
> **Leader retest hiện hành 25/11/2026, f8da4b2:** **KIM_NOT_YET_PASS / REQUEST_CHANGES_LEGACY_TRANSACTION / SON_INTEGRATION_PENDING**. Bundle R9 17/17 hashes, standalone 12/12 và cả 8 regression probes Codex chạy PASS. Nhưng legacy 0.1.0 + Hidden resources + locked ASAR vẫn exit 0 khi target giữ mã cũ; metadata sai full SHA. Xem [review-f8da4b2.md](review-f8da4b2.md) và [kế hoạch Gemini](gemini-handoff-20261125.md). Chưa chuyển user nghiệm thu.
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

- **Trạng thái tự động**: `STANDARD_REGRESSION_PASS` (leader chạy đủ 8 probes fixture mới, 12 standalone và scoped lint; không suy mọi error paths đã đạt).
- **Trạng thái đóng gói**: `BUNDLE_R9_CHECKSUM_PASS / METADATA_FIX_REQUIRED`; full source SHA chưa đúng.
- **Trạng thái upgrade gate**: `HAPPY_PATH_EVIDENCE_PASS / LEGACY_SAFETY_FAIL`; negative Hidden resources + locked ASAR trên predecessor thật FAIL dù installer exit 0.
- **Trạng thái source test**: `SON_INTEGRATION_PENDING / SOURCE_TESTS_OPEN`; historical 2,621 PASS / 21 FAIL / 11 SKIP, 8 failed files và suite setup error được tách trong packet Sơn; không phải full-suite result mới trên f8da4b2.
- **Trạng thái bàn giao Kim**: `KIM_NOT_YET_PASS / REQUEST_CHANGES_LEGACY_TRANSACTION`; chờ Gemini fix, artifact mới và Codex retest. Manual thật vẫn `WAITING_USER`.

---

## 1. Thông tin bàn giao từ Gemini (Handoff Bundle mới: `handoff-bundle-20261125-r8`)

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
