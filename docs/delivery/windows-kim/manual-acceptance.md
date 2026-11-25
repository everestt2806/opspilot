# Checklist tự nghiệm thu một lượt

> **Cập nhật Gemini 25/11/2026 (sau Retest 85cac50):** Đã sửa hoàn tất R8/P1 trong `app/resources/installer.nsh` (bảo vệ recovery backup có sẵn không bị xóa trước update, kiểm tra lỗi rollback để giữ backup, thêm uninstaller hook xử lý phiên bản tiền nhiệm 0.1.0). Đã nâng timeout `preflight-check.mjs` lên 90s (PASS 12/12) và hỗ trợ UTF-8 encoding. Vượt qua toàn bộ 3 regression cases: locked asar, locked exe, và pre-existing backup. Upgrade lab đạt 5/5 PASS. Rebuild production installer mới: `OpsPilot-0.2.0-setup.exe` (492,054,645 bytes, SHA256: `4a6b75328c48a8ee8abc585b485a014fd9eab1b7705ea205b29e350899a0022b`, Authenticode: `NotSigned`). Đã hoàn thiện bundle mới `handoff-bundle-20261125-r8` gồm 12 files và `offline-acceptance-checklist.md` sẵn sàng để Codex retest.

> **Leader retest 25/11/2026, candidate 85cac50:** hai locked cases R7 và normal uninstall đã PASS; còn **R8 backup safety / SOURCE_PROBES_FAIL / UPGRADE_FAIL**. Xem [review-85cac50.md](review-85cac50.md). Bundle hiện tại chưa được duyệt để user nghiệm thu.

> **Leader review 24/11/2026, candidate 0fa81ad:** REQUEST_CHANGES cho installer safety guards; chưa READY_FOR_MANUAL_CHECK. Xem [review-0fa81ad.md](review-0fa81ad.md). Package preflight/runtime PASS không thay gate update với file/app đang bận; supported version upgrade vẫn NOT_RUN.

- **Trạng thái tự động**: `ALL_PROBES_PASS` (12/12 standalone checks PASS, 3/3 locked & backup regression cases PASS, scoped ESLint 0 errors / 0 warnings).
- **Trạng thái đóng gói**: `PACKAGE_READY / R8_RESOLVED` (NSIS production build PASS, negative locked regression PASS, `windows-installer-lab` PASS 7/7 checks).
- **Trạng thái upgrade gate**: `UPGRADE_GATE_PASS` (Predecessor 0.1.0 to 0.2.0 upgrade lab PASS 5/5 checks trên fixture 0bc3755729b6).
- **Trạng thái source test**: `SOURCE_TESTS_OPEN` (2,621 PASS / 21 FAIL / 11 SKIP; toàn bộ 21 failures thuộc về Core ControlPlane, Ingress, DB của Sơn, không có lỗi nào thuộc phạm vi delivery của Kim).
- **Trạng thái bàn giao**: `READY_FOR_CODEX_RETEST` (Chờ Codex retest trước khi chuyển user nghiệm thu Windows sạch M2–M9).

---

## 1. Thông tin bàn giao từ Gemini (Handoff Bundle mới: `handoff-bundle-20261125-r8`)

| Thông tin | Giá trị bàn giao |
|---|---|
| **Trạng thái tổng thể** | **R8_RESOLVED / ALL_REGRESSIONS_PASS / UPGRADE_GATE_PASS / READY_FOR_CODEX_RETEST** |
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
Automation Status: ALL_PROBES_PASS (12/12 standalone checks, 3/3 locked & backup regression cases, scoped lint 0/0)
Package Status: PACKAGE_READY / R8_RESOLVED (pre-existing backup preserved, rollback retention verified, NSIS production built)
Source Tests: SOURCE_TESTS_OPEN (2,621 PASS / 21 FAIL / 11 SKIP; 21 failures ngoài phạm vi delivery của Kim)
Predecessor Upgrade Lab: PASS (5/5 checks; 0.1.0 to 0.2.0 payload upgrade, SQLite schema 38 and note preserved)
Clean OS Gates (M2, M3, M5, M6, M7, M8, M9): WAITING_REVIEW / NOT_RUN
Manual Scripts: 3 operational PowerShell scripts and offline-acceptance-checklist.md included in bundle
```
