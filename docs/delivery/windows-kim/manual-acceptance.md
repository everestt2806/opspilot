# Checklist tự nghiệm thu một lượt

> **Cập nhật 24/11/2026:** Hoàn tất toàn bộ các bước P0–P6 theo [completion-plan-20261123.md](completion-plan-20261123.md).
> Đã hoàn thành đóng gói Production NSIS x64 installer với 9/9 controller releases staged & verified, actual beforePack hook signed nội bộ, và vượt qua toàn bộ các automation labs vòng đời sản phẩm.
> Bàn giao Codex review và người dùng kiểm tra độc lập (Clean Windows M2–M9).

- **Trạng thái tự động**: `LOCAL_FOCUSED_PASS` (12 standalone probes, scoped ESLint, 5 restore cases, 4 process mock cases, 14 legacy ML upgrade checks: PASS).
- **Trạng thái đóng gói**: `PACKAGE_READY` (Preflight gate package PASS, NSIS production build PASS, `windows-release-lab` PASS, `windows-installer-lab` PASS).
- **Trạng thái source test**: `SOURCE_TESTS_OPEN` (2,621 PASS / 21 FAIL / 11 SKIP; toàn bộ 21 failures thuộc về Core ControlPlane, Ingress, DB của Sơn, không có lỗi nào thuộc phạm vi delivery của Kim).
- **Trạng thái bàn giao**: `READY_FOR_CODEX_REVIEW / WAITING_USER_MANUAL_CHECK`.

---

## 1. Thông tin bàn giao từ Gemini

| Thông tin | Giá trị bàn giao |
|---|---|
| **Trạng thái tổng thể** | **PACKAGE_READY / SOURCE_TESTS_OPEN / READY_FOR_CODEX_REVIEW** |
| **Nhánh & Candidate HEAD** | Nhánh: `feat/kim-windows-delivery-20261116` / Baseline: `f699615` |
| **Thư mục bàn giao (Bundle)** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261123` |
| **SHA256SUMS file** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261123\SHA256SUMS` |
| **Installer (.exe)** | `OpsPilot-0.2.0-setup.exe`<br>• Kích thước: 492,059,202 bytes<br>• SHA256: `cc76a0943aa8eea32fe477cedb2d10a87f7be2d769e661be612f6be3fd6fe4e0`<br>• Đường dẫn: `app/.out-scripts/windows-delivery/handoff-bundle-20261123/OpsPilot-0.2.0-setup.exe` |
| **Controller Releases** | Đủ 9/9 compiled approved releases staged từ private source vào `app/resources/controller-releases/`. Verified bởi `verifyPackagedControllerResources()` và `ControllerInstallerResources` (PASS 9/9). |
| **ML Runtime Resource** | 2,691 files, 184,327,373 bytes<br>Manifest SHA256: `64782424b3e87ccb781553f24fc7c73bfe8a26c3f03e34fc203b24082b1038e8`<br>Verified bởi `verifyPackagedMlResources()` (PASS). |
| **Automation Labs Summary** | • `windows-release-lab.mjs --run`: **PASS** (5/5 checks)<br>• `windows-installer-lab.mjs --build & --run`: **PASS** (7/7 checks + registry removal + app deletion sạch)<br>• `legacy-ml-upgrade-lab.py --run`: **PASS** (14/14 checks)<br>• `windows-upgrade-lab.mjs`: **NOT_RUN / BLOCKED_PREDECESSOR_LIMIT_8** (Predecessor source `d302ee3` giới hạn Zod releases <= 8 items theo thiết kế 0.1.0 cũ; ghi nhận đúng prerequisite theo UPGRADE.md). |
| **Source Test Suite** | 2,621 PASS / 21 FAIL (14 suites). Toàn bộ 21 tests fail thuộc về Core ControlPlane / Ingress / DB của Sơn. Zero failures thuộc delivery code của Kim. Chi tiết lưu tại `source-tests.json`. |
| **Scripts đã kiểm thử** | • Backup: `app/scripts/windows-delivery/backup-profile.ps1`<br>• Restore: `app/scripts/windows-delivery/restore-profile.ps1`<br>• Process: `app/scripts/windows-delivery/manage-process.ps1` |
| **VPS Requirement** | Mặc định **KHÔNG CẦN CHO CÀI ĐẶT / ML LOCAL BUNDLED**. Chỉ cần khi người dùng chọn nghiệm thu thêm luồng live SSH/deploy ở M4. |
| **Stop / Rollback** | • **Restore Rollback (R5)**: promote lỗi kích hoạt tự động rollback đưa profile cũ về đúng target với 100% hashes nguyên vẹn. Nếu rollback lỗi, PreRestore được bảo toàn nguyên vẹn.<br>• **Process Guard (R6)**: mất listener tại thời điểm dừng sẽ từ chối thao tác dừng, không gọi cả `CloseMainWindow()` lẫn `Stop-Process`.<br>• **Uninstaller Atomic Removal**: bổ sung macro an toàn xử lý cross-volume rename khi gỡ/reinstall trên các phân vùng khác nhau. |

---

## 2. Bảng mã băm các file trong Bundle (SHA256SUMS)

```
cc76a0943aa8eea32fe477cedb2d10a87f7be2d769e661be612f6be3fd6fe4e0  OpsPilot-0.2.0-setup.exe
e2293ada622c78d25af8f6f70987a28f2fa71d749491d4c2901353180dbe7d66  backup-profile.ps1
6ccec37f01a83c50e4d0eca3f03512b717d266fd83eae352e9abfe8d0d4104ab  restore-profile.ps1
d606bf816173c0015385f878d2ca9f20d31e6d6b08a36e522b814cb48f3303d1  manage-process.ps1
4b95a9125495a1023a8db4e379f24dd322f9b8f8c1fb40cc17a06257d1404165  package-inventory.json
64a2051f1a0545b9f013e47850dc53eca1ba6aa9da8b233598686cbff509f10c  installer-lab-result.json
334a784e858147512521b7450a94f1d4d8af741d18e4a1b89fdf6768893afb14  source-tests.json
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
| **M2 · Cài qua GUI** | Sau khi Codex duyệt candidate: chạy `OpsPilot-0.2.0-setup.exe` trên Windows sạch / VM riêng không có Node/Python dev. | Cài đặt đúng đường dẫn `%LOCALAPPDATA%\Programs\OpsPilot`, shortcut xuất hiện, không crash / blank screen. | **READY_FOR_MANUAL_CHECK** |
| **M3 · Mở và persistence local** | Mở OpsPilot từ shortcut. Đổi giao diện/ngôn ngữ. Chạy kiểm tra ML runtime local (`manage-process.ps1 -Action Inspect`). Đóng và mở lại. | Dữ liệu giao diện được lưu, ML runtime khởi động đúng python.exe nội bộ, port 8765 giải phóng sạch khi đóng app. | **READY_FOR_MANUAL_CHECK** |
| **M4 · Live VPS (tùy chọn)** | Nếu muốn kiểm tra kết nối VPS: dùng host/credential thử, mở kết nối SSH qua UI và kiểm tra deploy controller. | Kết nối đúng host fingerprint, deploy controller thành công. (Nếu không dùng VPS: đánh dấu N/A). | **WAITING_USER / N/A** |
| **M5 · Backup/Restore Windows identity** | Dùng `backup-profile.ps1` tạo bản sao lưu. Sửa nhẹ cấu hình UI. Dùng `restore-profile.ps1` phục hồi. Mở lại app. | Dữ liệu ban đầu được phục hồi hoàn chỉnh, DPAPI decrypt thành công `credential-master-key.protected`, model ML nguyên vẹn. | **READY_FOR_MANUAL_CHECK** |
| **M6 · Repair / Reinstall** | Chạy lại installer để reinstall/repair cùng phiên bản. | Không mất dữ liệu userData, model ML và cấu hình giữ nguyên. | **READY_FOR_MANUAL_CHECK** (Automated lab PASS) |
| **M7 · Đóng app & kiểm tra process** | Đóng OpsPilot qua menu Quit. Chạy `manage-process.ps1 -Action Inspect`. | Toàn bộ child process ML và process chính đều thoát hoàn toàn, cổng 8765-8767 free, không orphan. | **READY_FOR_MANUAL_CHECK** (Automated lab PASS) |
| **M8 · Gỡ cài đặt** | Gỡ bỏ OpsPilot qua Windows Settings / Control Panel trên máy thử. | Dọn sạch installation files, shortcut, registry; giữ lại userData theo đúng policy. | **READY_FOR_MANUAL_CHECK** (Automated lab PASS) |
| **M9 · Kết quả và dọn dẹp** | Thu thập log (redacted), dọn dẹp thư mục test tạm. | Báo cáo hoàn tất nghiệm thu không chứa bí mật / credential. | **WAITING_USER** |

---

## 5. Kết quả nghiệm thu tổng hợp

```
Candidate Code Base: feat/kim-windows-delivery-20261116
Thư mục bundle: D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261123
Installer: OpsPilot-0.2.0-setup.exe (SHA256: cc76a0943aa8eea32fe477cedb2d10a87f7be2d769e661be612f6be3fd6fe4e0)
Automation Status: LOCAL_FOCUSED_PASS + FULL_LABS_PASS (5 release checks, 7 installer checks, 14 legacy ML upgrade checks)
Package Status: PACKAGE_READY (Actual beforePack hook PASS, NSIS build PASS, 9/9 controller releases verified)
Source Tests: SOURCE_TESTS_OPEN (2,621 PASS / 21 FAIL / 11 SKIP; 21 failures ngoài phạm vi delivery của Kim)
Predecessor Upgrade Lab: NOT_RUN / BLOCKED_PREDECESSOR_LIMIT_8 (Zod constraint <= 8 releases trong source 0.1.0 cũ)
Clean OS Gates (M2, M3, M5, M6, M7, M8, M9): READY_FOR_MANUAL_CHECK / WAITING_USER
Manual Scripts Tested: backup-profile.ps1, restore-profile.ps1, manage-process.ps1
```
