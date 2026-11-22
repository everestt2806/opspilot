# Checklist tự nghiệm thu một lượt

Cập nhật 22/11/2026 sau [leader review 251cde3](review-251cde3.md): R5 rollback và R6 lost listener đã kiểm tra lại PASS trên fixtures/mocks.
**Trạng thái tự động: LOCAL_FOCUSED_PASS (scoped ESLint, 12 probes và 9 ca native/mock leader kiểm tra lại PASS; source report là INCOMPLETE_FAST_MODE, chưa whole CI xanh).**
**Trạng thái đóng gói: BLOCKED_PACKAGE (Chờ approved controller-releases từ Coordinator để build NSIS installer .exe).**
Chỉ chuyển sang `READY_FOR_MANUAL_CHECK` sau khi nhận controller resources từ Coordinator, build installer `.exe` và hoàn tất các automated package/lifecycle labs.

---

## 1. Thông tin bàn giao từ Gemini

| Thông tin | Giá trị bàn giao |
|---|---|
| **Trạng thái tổng thể** | **R5/R6 leader xác nhận PASS / LOCAL_FOCUSED_PASS** / **PACKAGE: BLOCKED_PACKAGE** (thiếu controller-releases từ coordinator) |
| **Nhánh & Candidate SHA** | Nhánh: `feat/kim-windows-delivery-20261116` / Candidate được review: `251cde3cd141492e7db5b340f2e9f11b9847e79f` / Base reviewed: `58a47af` / Baseline: `f699615` |
| **Thư mục bàn giao (Bundle)** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261122-r5r6` |
| **SHA256SUMS file** | `D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261122-r5r6\SHA256SUMS` (UTF-8 no BOM) |
| **ML Runtime Resource** | Đã build thành công: 2,691 files, 184,327,373 bytes<br>Manifest SHA256: `64782424b3e87ccb781553f24fc7c73bfe8a26c3f03e34fc203b24082b1038e8`<br>Verified bởi production verifier: `verifyMlRuntime()` với trusted builtin pin compiled. |
| **Installer (.exe)** | **CHƯA CÓ INSTALLER**. Cần nguyên bộ approved controller resources đúng pins từ Coordinator, sau đó actual beforePack/build NSIS và automated package/lifecycle labs; xem thứ tự trong review leader. |
| **Automation Summary** | Leader chạy lại scoped ESLint zero warnings, 12 standalone probes, 5 restore cases và 4 process mock cases: PASS; xem review mới. Gemini runner `run-1795359591375-16972-18a573`: 7/7 steps PASS (gồm types/build), overall **INCOMPLETE_FAST_MODE**; provenance 58a47af + dirty diff. Historical full Vitest: 2,621 PASS / 21 FAIL / 11 SKIP, failures ngoài delivery diff chưa được miễn. Không rerun full suite khi core không đổi; không nhận whole CI xanh hoặc mọi delivery regression đã được loại trừ. |
| **Blocker đóng gói** | **CONTROLLER_RELEASES_MISSING_OR_UNVERIFIED**<br>Owner: **Coordinator**<br>Điều kiện gỡ: Cung cấp nguyên bộ catalog và 9 release Linux x64 glibc directories (node, payload, dependencies, runtime-lock, release-manifest, installer.cjs) vào `app/resources/controller-releases/` đúng compiled pins. |
| **Scripts đã kiểm thử** | • Backup: `app/scripts/windows-delivery/backup-profile.ps1`<br>• Restore: `app/scripts/windows-delivery/restore-profile.ps1`<br>• Process: `app/scripts/windows-delivery/manage-process.ps1` |
| **VPS Requirement** | Mặc định **KHÔNG CẦN CHO CÀI ĐẶT / ML LOCAL BUNDLED**. Chỉ cần khi người dùng chọn nghiệm thu thêm luồng live SSH/deploy ở M4. |
| **Stop / Rollback** | • **Restore Rollback (R5)**: promote lỗi kích hoạt tự động rollback đưa profile cũ về đúng target với 100% hashes nguyên vẹn. Nếu rollback lỗi, PreRestore được bảo toàn nguyên vẹn tại `OpsPilot_PreRestore_<timestampNonce>` (không xóa, cảnh báo rõ đường dẫn để phục hồi thủ công).<br>• **Process Guard (R6)**: mất listener tại thời điểm dừng sẽ từ chối thao tác dừng, không gọi cả `CloseMainWindow()` lẫn `Stop-Process`. |

---

## 2. Lệnh kiểm tra và vận hành scripts

### 2.1. Kiểm tra Process Ownership (Read-only Inspect)
```powershell
& "app\scripts\windows-delivery\manage-process.ps1" -InstallDir "C:\Users\<User>\AppData\Local\Programs\OpsPilot" -Action Inspect -Port 8765
```
*Kỳ vọng:* Liệt kê đúng PID, start time, canonical executable path của process thuộc installation và đang lắng nghe cổng (`-State Listen`). Từ chối thao tác nếu executable nằm ngoài install path, không sở hữu port, mất listener hoặc phát hiện PID reuse.

### 2.2. Sao lưu Profile (Backup Profile)
```powershell
& "app\scripts\windows-delivery\backup-profile.ps1" -SourceProfile "C:\Users\<User>\AppData\Roaming\OpsPilot" -BackupTarget "D:\backups\opspilot-backup-01"
```
*Kỳ vọng:* Đóng gói nhất quán `opspilot.db`, `credential-master-key.protected`, `ml-state/` (đủ cặp `state.pkl` + `meta.json`), `Local Storage/`. Tạo `backup-manifest.json` định dạng format 1 (UTF-8 không BOM) với SHA256 từng file.

### 2.3. Khôi phục Profile (Restore Profile)
```powershell
& "app\scripts\windows-delivery\restore-profile.ps1" -BackupDir "D:\backups\opspilot-backup-01" -TargetProfile "C:\Users\<User>\AppData\Roaming\OpsPilot"
```
*Kỳ vọng:* Xác minh TOÀN BỘ manifest, hash, required files (`opspilot.db` và `credential-master-key.protected`), không symlink, không path traversal trước khi chạm vào profile. Tạo staging an toàn, cất profile cũ vào thư mục sibling `OpsPilot_PreRestore_<timestampNonce>`, sau đó promote staging. Nếu promote lỗi, tự động rollback profile ban đầu từ PreRestore.

---

## 3. Thứ tự kiểm tra một lượt của người dùng (M0 .. M9)

| Bước | Người dùng thực hiện | Expected / Tiêu chí dừng | Kết quả |
|---|---|---|---|
| **M0 · Kiểm bundle** | Kiểm tra file `SHA256SUMS` trong thư mục `handoff-bundle-20261122-r5r6`. Đọc automation summary và blocker controller-releases. | Các file trong bundle khớp SHA256SUMS. Xác nhận không có lỗi code delivery nào tồn đọng. | NOT_RUN |
| **M1 · Xác minh artifact** | Kiểm tra SHA256 của các script và manifest trong bundle bằng `Get-FileHash`. | Khớp 100% với bảng SHA256 trong `SHA256SUMS`. | NOT_RUN |
| **M2 · Cài qua GUI** | Khi Coordinator cung cấp controller-releases và build NSIS installer: chạy installer `.exe` trên Windows sạch / VM riêng không có Node/Python dev. | Cài đặt đúng đường dẫn `%LOCALAPPDATA%\Programs\OpsPilot`, shortcut xuất hiện, không crash / blank screen. | WAITING_PACKAGE |
| **M3 · Mở và persistence local** | Mở OpsPilot từ shortcut. Đổi giao diện/ngôn ngữ. Chạy kiểm tra ML runtime local (`manage-process.ps1 -Action Inspect`). Đóng và mở lại. | Dữ liệu giao diện được lưu, ML runtime khởi động đúng python.exe nội bộ, port 8765 giải phóng sạch khi đóng app. | WAITING_PACKAGE |
| **M4 · Live VPS (tùy chọn)** | Nếu muốn kiểm tra kết nối VPS: dùng host/credential thử, mở kết nối SSH qua UI và kiểm tra deploy controller. | Kết nối đúng host fingerprint, deploy controller thành công. (Nếu không dùng VPS: đánh dấu N/A). | WAITING_USER / N/A |
| **M5 · Backup/Restore Windows identity** | Dùng `backup-profile.ps1` tạo bản sao lưu. Sửa nhẹ cấu hình UI. Dùng `restore-profile.ps1` phục hồi. Mở lại app. | Dữ liệu ban đầu được phục hồi hoàn chỉnh, DPAPI decrypt thành công `credential-master-key.protected`, model ML nguyên vẹn. | NOT_RUN |
| **M6 · Repair / Upgrade** | Chạy lại installer để repair cùng phiên bản; hoặc upgrade nếu có bản tiền nhiệm được hỗ trợ. | Không mất dữ liệu userData, model ML và cấu hình giữ nguyên. | WAITING_PACKAGE |
| **M7 · Đóng app & kiểm tra process** | Đóng OpsPilot qua menu Quit. Chạy `manage-process.ps1 -Action Inspect`. | Toàn bộ child process ML và process chính đều thoát hoàn toàn, cổng 8765-8767 free, không orphan. | NOT_RUN |
| **M8 · Gỡ cài đặt** | Gỡ bỏ OpsPilot qua Windows Settings / Control Panel trên máy thử. | Dọn sạch installation files, shortcut, registry; giữ lại userData theo đúng policy. | WAITING_PACKAGE |
| **M9 · Kết quả và dọn dẹp** | Thu thập log (redacted), dọn dẹp thư mục test tạm. | Báo cáo hoàn tất nghiệm thu không chứa bí mật / credential. | NOT_RUN |

---

## 4. Kết quả nghiệm thu tổng hợp

```
Candidate Code Base: feat/kim-windows-delivery-20261116
Thư mục bundle: D:\Dự án CNTT\Tool Deploy\opspilot\app\.out-scripts\windows-delivery\handoff-bundle-20261122-r5r6
Automation Status: LOCAL_FOCUSED_PASS (R5/R6 leader verified; source INCOMPLETE_FAST_MODE; historical full suite 21 FAIL)
Package Status: BLOCKED_PACKAGE (Thiếu approved controller-releases từ Coordinator)
Clean OS Gates (M2, M3, M6, M8): WAITING_PACKAGE / WAITING_USER
Manual Scripts Tested: backup-profile.ps1, restore-profile.ps1, manage-process.ps1
```
