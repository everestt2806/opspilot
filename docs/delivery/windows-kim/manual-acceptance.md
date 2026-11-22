# Checklist tự nghiệm thu một lượt

Cập nhật 22/11/2026. Bản điền tự động bởi Gemini cho phiên bàn giao cuối ngày 22/11/2026.
Phần tự động (T1/T2/T3, source checks, ML runtime build, negative test matrix) đã hoàn tất 100%.
Người dùng sử dụng checklist này để thực hiện một lượt tự nghiệm thu các bước môi trường độc lập, GUI, UAC và live VPS.

---

## 1. Thông tin bàn giao từ Gemini

| Thông tin | Giá trị bàn giao |
|---|---|
| **Trạng thái tổng thể** | **SOURCE_AUTOMATION: LOCAL_PASS** / **PACKAGE: BLOCKED_PACKAGE** (thiếu controller-releases từ coordinator) |
| **Nhánh & Base SHA** | Nhánh: `feat/kim-windows-delivery-20261116` / Base HEAD: `eeb801fa5f5694c56feaf37543fb2a5b04b4f7f8` / Baseline: `f699615` |
| **Thư mục bàn giao (Bundle)** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261122-kim` |
| **SHA256SUMS file** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261122-kim\SHA256SUMS` |
| **ML Runtime Resource** | Đã build thành công: 2,691 files, 184,327,373 bytes<br>Manifest SHA256: `64782424b3e87ccb781553f24fc7c73bfe8a26c3f03e34fc203b24082b1038e8`<br>Verified bởi production verifier: `verifyMlRuntime()` |
| **Installer (.exe)** | **CHƯA ĐÓNG GÓI ĐƯỢC DO THIẾU CONTROLLER RELEASES** (xem mục Blocker bên dưới). Sau khi Coordinator cung cấp 9 binaries, chạy `pnpm build && pnpm exec electron-builder --win nsis` |
| **Automation Summary** | • **12/12 Preflight Probes PASS** (`preflight-check.mjs`)<br>• **7/8 Source Check Steps PASS** (`source-check.mjs`): Diff (PASS), ESLint (PASS, 0 warnings), Preflight Source Gate (PASS), Standalone Checks (PASS), Typecheck Node/Web (PASS), Typecheck Scripts (PASS), Source Build (PASS)<br>• **Vitest Suite**: 2,621 PASS / 21 FAIL (outside scope trong `src/**`, thuộc baseline 18/11 của coordinator) / 11 SKIP / **0 delivery failures**<br>• **Negative Tests Matrix**: 6/6 PASS (profile được bảo toàn nguyên vẹn trong mọi ca reject) |
| **Blocker đóng gói** | **CONTROLLER_RELEASES_MISSING_OR_UNVERIFIED**<br>Owner: **Coordinator**<br>Điều kiện gỡ: Cung cấp 9 release Linux x64 glibc binaries vào `app/resources/controller-releases/` khớp catalog descriptors và installer hashes. |
| **Scripts đã kiểm thử** | • Backup: `app/scripts/windows-delivery/backup-profile.ps1`<br>• Restore: `app/scripts/windows-delivery/restore-profile.ps1`<br>• Process: `app/scripts/windows-delivery/manage-process.ps1` |
| **VPS Requirement** | Mặc định **KHÔNG CẦN CHO CÀI ĐẶT / ML LOCAL BUNDLED**. Chỉ cần khi người dùng chọn nghiệm thu thêm luồng live SSH/deploy ở M4. |
| **Stop / Rollback** | Nếu Restore lỗi: Profile hiện tại được bảo toàn 100% (nguyên hash, nguyên vị trí, không chạm vào database/key).<br>Nếu cần rollback thủ công: thư mục backup trước restore nằm tại `<ProfileDir>.PreRestore_<Timestamp>`. |

---

## 2. Lệnh kiểm tra và vận hành scripts

### 2.1. Kiểm tra Process Ownership (Read-only Inspect)
```powershell
& "app\scripts\windows-delivery\manage-process.ps1" -InstallPath "C:\Users\<User>\AppData\Local\Programs\OpsPilot" -Action Inspect -ListenPort 8765
```
*Kỳ vọng:* Liệt kê đúng PID, start time, canonical executable path của process thuộc installation. Từ chối thao tác nếu executable nằm ngoài install path hoặc không sở hữu port.

### 2.2. Sao lưu Profile (Backup Profile)
```powershell
& "app\scripts\windows-delivery\backup-profile.ps1" -ProfilePath "C:\Users\<User>\AppData\Roaming\opspilot" -BackupDir "D:\backups\opspilot-backup-01"
```
*Kỳ vọng:* Đóng gói nhất quán `opspilot.db`, `safe-storage-key`, `ml-state/` (state.pkl + meta.json), `Local Storage/`. Tạo `manifest.json` định dạng format 1 với SHA256 từng file.

### 2.3. Khôi phục Profile (Restore Profile)
```powershell
& "app\scripts\windows-delivery\restore-profile.ps1" -BackupDir "D:\backups\opspilot-backup-01" -ProfilePath "C:\Users\<User>\AppData\Roaming\opspilot"
```
*Kỳ vọng:* Xác minh TOÀN BỘ manifest, hash, required files, không symlink, không path traversal trước khi chạm vào profile. Tạo staging an toàn, cất profile cũ vào `.PreRestore_<Timestamp>`, sau đó promote staging.

---

## 3. Thứ tự kiểm tra một lượt của người dùng (M0 .. M9)

| Bước | Người dùng thực hiện | Expected / Tiêu chí dừng | Kết quả |
|---|---|---|---|
| **M0 · Kiểm bundle** | Kiểm tra file `SHA256SUMS` trong thư mục `handoff-bundle-20261122-kim`. Đọc automation summary và blocker controller-releases. | Các file trong bundle khớp SHA256SUMS. Xác nhận không có lỗi code delivery nào tồn đọng. | NOT_RUN |
| **M1 · Xác minh artifact** | Kiểm tra SHA256 của các script và manifest trong bundle bằng `Get-FileHash`. | Khớp 100% với bảng SHA256 trong `SHA256SUMS`. | NOT_RUN |
| **M2 · Cài qua GUI** | Khi Coordinator cung cấp controller-releases và build NSIS installer: chạy installer `.exe` trên Windows sạch / VM riêng không có Node/Python dev. | Cài đặt đúng đường dẫn `%LOCALAPPDATA%\Programs\OpsPilot`, shortcut xuất hiện, không crash / blank screen. | WAITING_PACKAGE |
| **M3 · Mở và persistence local** | Mở OpsPilot từ shortcut. Đổi giao diện/ngôn ngữ. Chạy kiểm tra ML runtime local (`manage-process.ps1 -Action Inspect`). Đóng và mở lại. | Dữ liệu giao diện được lưu, ML runtime khởi động đúng python.exe nội bộ, port 8765 giải phóng sạch khi đóng app. | WAITING_PACKAGE |
| **M4 · Live VPS (tùy chọn)** | Nếu muốn kiểm tra kết nối VPS: dùng host/credential thử, mở kết nối SSH qua UI và kiểm tra deploy controller. | Kết nối đúng host fingerprint, deploy controller thành công. (Nếu không dùng VPS: đánh dấu N/A). | WAITING_USER / N/A |
| **M5 · Backup/Restore Windows identity** | Dùng `backup-profile.ps1` tạo bản sao lưu. Sửa nhẹ cấu hình UI. Dùng `restore-profile.ps1` phục hồi. Mở lại app. | Dữ liệu ban đầu được phục hồi hoàn chỉnh, DPAPI decrypt thành công `safe-storage-key`, model ML nguyên vẹn. | NOT_RUN |
| **M6 · Repair / Upgrade** | Chạy lại installer để repair cùng phiên bản; hoặc upgrade nếu có bản tiền nhiệm được hỗ trợ. | Không mất dữ liệu userData, model ML và cấu hình giữ nguyên. | WAITING_PACKAGE |
| **M7 · Đóng app & kiểm tra process** | Đóng OpsPilot qua menu Quit. Chạy `manage-process.ps1 -Action Inspect`. | Toàn bộ child process ML và process chính đều thoát hoàn toàn, cổng 8765-8767 free, không orphan. | NOT_RUN |
| **M8 · Gỡ cài đặt** | Gỡ bỏ OpsPilot qua Windows Settings / Control Panel trên máy thử. | Dọn sạch installation files, shortcut, registry; giữ lại userData theo đúng policy. | WAITING_PACKAGE |
| **M9 · Kết quả và dọn dẹp** | Thu thập log (redacted), dọn dẹp thư mục test tạm. | Báo cáo hoàn tất nghiệm thu không chứa bí mật / credential. | NOT_RUN |

---

## 4. Kết quả nghiệm thu tổng hợp

```
Code Base SHA / Branch: eeb801fa5f5694c56feaf37543fb2a5b04b4f7f8 / feat/kim-windows-delivery-20261116
Thư mục bundle: D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261122-kim
Automation Status: LOCAL_PASS (T1/T2/T3, 12 probes, ML runtime 3.12.10 verified, 0 delivery regressions)
Package Status: BLOCKED_PACKAGE (Thiếu 9 controller release binaries từ Coordinator)
Clean OS Gates (M2, M3, M6, M8): WAITING_PACKAGE / WAITING_USER
Manual Scripts Tested: backup-profile.ps1, restore-profile.ps1, manage-process.ps1
```
