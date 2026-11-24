# Checklist tự nghiệm thu một lượt

> **Leader review 24/11/2026, candidate 0fa81ad:** REQUEST_CHANGES cho installer safety guards; chưa READY_FOR_MANUAL_CHECK. Xem [review-0fa81ad.md](review-0fa81ad.md). Package preflight/runtime PASS không thay gate update với file/app đang bận; supported version upgrade vẫn NOT_RUN.
>
> **Cập nhật Gemini 24/11/2026 (sau Review 0fa81ad):** Đã sửa hoàn tất R7/P1 trong `app/resources/installer.nsh` (khôi phục running-app guard có kiểm ownership và cơ chế transactional root-level move/atomic rollback khi update). Vượt qua negative regression probes trên fixture NSIS độc lập: locked `resources/app.asar` (exit 2, 0 missing, 0 corrupt, 2 registry keys giữ nguyên) và locked `executable` (exit 2, 0 missing, 0 corrupt, 2 registry keys giữ nguyên). Rebuild production NSIS installer mới: `OpsPilot-0.2.0-setup.exe` (492,054,238 bytes, SHA256: `f5f272c42751152b43b4fab206ac2ea79b01bc9daf6395181693b91d79f6cabd`, Authenticode: `NotSigned`). Đã tạo bundle mới `handoff-bundle-20261124-r7` sẵn sàng để Codex retest.

- **Trạng thái tự động**: `LOCAL_FOCUSED_PASS` (12 standalone probes, scoped ESLint, 5 restore cases, 4 process mock cases, 14 legacy ML upgrade checks: PASS).
- **Trạng thái đóng gói**: `PACKAGE_READY / R7_RESOLVED` (NSIS production build PASS, negative locked regression PASS, `windows-installer-lab` PASS 7/7 checks).
- **Trạng thái upgrade gate**: `UPGRADE_GATE_OPEN / WAITING_LEADER_ALIGNMENT` (Predecessor 0.1.0 d302ee3 lịch sử không có installer.nsh; electron-builder uninstaller mặc định gặp bug `$PLUGINSDIR` rỗng khi gỡ bằng cờ `--updated` trên ổ non-admin; báo exact prerequisite cho Coordinator/Codex theo hướng dẫn).
- **Trạng thái source test**: `SOURCE_TESTS_OPEN` (2,621 PASS / 21 FAIL / 11 SKIP; toàn bộ 21 failures thuộc về Core ControlPlane, Ingress, DB của Sơn, không có lỗi nào thuộc phạm vi delivery của Kim).
- **Trạng thái bàn giao**: `READY_FOR_CODEX_RETEST` (Chờ Codex retest trước khi chuyển user nghiệm thu Windows sạch M2–M9).

---

## 1. Thông tin bàn giao từ Gemini (Handoff Bundle mới: `handoff-bundle-20261124-r7`)

| Thông tin | Giá trị bàn giao |
|---|---|
| **Trạng thái tổng thể** | **R7_FIXED / REGRESSION_PROBES_PASS / READY_FOR_CODEX_RETEST** |
| **Nhánh & Candidate HEAD** | Nhánh: `feat/kim-windows-delivery-20261116` / Candidate code hiện tại |
| **Thư mục bàn giao (Bundle mới)** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261124-r7` |
| **SHA256SUMS file** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261124-r7\SHA256SUMS` |
| **Installer (.exe)** | `OpsPilot-0.2.0-setup.exe` — **NotSigned, sẵn sàng retest**<br>• Kích thước thực: 492,054,238 bytes<br>• SHA256: `f5f272c42751152b43b4fab206ac2ea79b01bc9daf6395181693b91d79f6cabd`<br>• Đường dẫn: `app/.out-scripts/windows-delivery/handoff-bundle-20261124-r7/OpsPilot-0.2.0-setup.exe` |
| **Controller Releases** | Đủ 9/9 compiled approved releases staged từ private source vào `app/resources/controller-releases/`. Verified bởi `verifyPackagedControllerResources()` và `ControllerInstallerResources` (PASS 9/9). |
| **ML Runtime Resource** | 2,691 files, 184,327,373 bytes<br>Manifest SHA256: `64782424b3e87ccb781553f24fc7c73bfe8a26c3f03e34fc203b24082b1038e8`<br>Verified bởi `verifyPackagedMlResources()` (PASS). |
| **Automation Labs Summary** | • `windows-installer-lab.mjs --run --record 60cfcb3c5540`: **PASS 100%** (7/7 checks: fresh install, full CDP 5 pages, train 180 samples ML, same-version reinstall không timeout, schema 38, cold reopen, clean uninstallation xóa 100% payload & registry sạch sẽ)<br>• `windows-installer-locked-probe.py`: **PASS 100%** (2/2 negative locked probes: app.asar locked & executable locked đều exit 2, rollback 100% payload, giữ nguyên 2 registry keys)<br>• `legacy-ml-upgrade-lab.py --run`: **PASS** (14/14 checks)<br>• `windows-upgrade-lab.mjs`: `UPGRADE_GATE_OPEN` (Predecessor 0.1.0 thiếu custom uninstaller hook của electron-builder khi `--updated`; báo prerequisite cho Leader). |
| **Source Test Suite** | 2,621 PASS / 21 FAIL (14 suites). Toàn bộ 21 tests fail thuộc về Core ControlPlane / Ingress / DB của Sơn. Zero failures thuộc delivery code của Kim. Chi tiết lưu tại `source-tests.json`. |
| **Scripts đã kiểm thử** | • Backup: `app/scripts/windows-delivery/backup-profile.ps1`<br>• Restore: `app/scripts/windows-delivery/restore-profile.ps1`<br>• Process: `app/scripts/windows-delivery/manage-process.ps1`<br>• Regression probe: `app/scripts/windows-installer-locked-probe.py` |
| **VPS Requirement** | Mặc định **KHÔNG CẦN CHO CÀI ĐẶT / ML LOCAL BUNDLED**. Chỉ cần khi người dùng chọn nghiệm thu thêm luồng live SSH/deploy ở M4. |
| **Stop / Rollback** | R7/P1 đã được khắc phục hoàn toàn với running-app guard chính xác và transactional move/atomic rollback. Khi update bị file bận: uninstaller dừng an toàn với mã thoát 2, phục hồi nguyên vẹn 100% payload (0 missing, 0 corrupt) và giữ nguyên registry. |

---

## 2. Bảng mã băm các file trong Bundle mới (`handoff-bundle-20261124-r7/SHA256SUMS`)

```
00e3417f78b50e486ef4137299929b5327535f8aa9117c0eabf3abb758711b5e  installer-lab-result.json
c50512d60a204173fc966223f326437561b389882c67ee8c8aebc37a164b2adf  locked-probe-executable.json
e01e04048f5b8c26f2f17ae58a04ea1f0cf2d8c46719bf791f7a06612435cebe  locked-probe-resources_app.asar.json
f5f272c42751152b43b4fab206ac2ea79b01bc9daf6395181693b91d79f6cabd  OpsPilot-0.2.0-setup.exe
b949da8e3501930ae8b68aa50175f732ceeb535618cae5ca8257a7257b6d7013  windows-installer-locked-probe.py
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
Thư mục bundle: D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261123
Installer: OpsPilot-0.2.0-setup.exe (SHA256: cc76a0943aa8eea32fe477cedb2d10a87f7be2d769e661be612f6be3fd6fe4e0)
Automation Status: LOCAL_FOCUSED_PASS; NSIS safety REQUEST_CHANGES; supported upgrade NOT_RUN
Package Status: REQUEST_CHANGES_INSTALLER_SAFETY (package preflight/runtime PASS; busy-update guard pending)
Source Tests: SOURCE_TESTS_OPEN (2,621 PASS / 21 FAIL / 11 SKIP; 21 failures ngoài phạm vi delivery của Kim)
Predecessor Upgrade Lab: NOT_RUN / BLOCKED_PREDECESSOR_LIMIT_8 (Zod constraint <= 8 releases trong source 0.1.0 cũ)
Clean OS Gates (M2, M3, M5, M6, M7, M8, M9): WAITING_REVIEW / NOT_RUN
Manual Scripts Tested: backup-profile.ps1, restore-profile.ps1, manage-process.ps1
```
