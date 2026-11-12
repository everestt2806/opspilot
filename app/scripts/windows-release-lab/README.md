# Kiểm chứng full application và NSIS Windows

Từ R11c, bản ứng dụng0.2.0 có bước bảo toàn legacy model trước old uninstall. [Compatibility policy và upgrade lab](UPGRADE.md) đã kiểm actual source predecessor0.1.0→0.2.0 trong namespace riêng; ordinary uninstall đã self-delete cả folder/registry fixture. Kết quả này không thay Windows độc lập/default production identity trong checklist bên dưới.

R11b dùng chính bản `OpsPilot.exe`/`app.asar` do electron-builder tạo, không dùng một Electron host thay Main hoặc mock IPC/SQLite/ML. Giao diện là production App.tsx, preload và handler thực; CDP chỉ điều khiển qua loopback trong thời gian lab. Profile và HOME riêng, PATH chỉ System32, không truyền credential hoặc dùng VPS. Native SQLite031/safeStorage/ML bundled phải chạy trước khi test nhận PASS.

## Build và thử bản đầy đủ trên máy phát triển

```powershell
. ./tools/enter-node22.ps1
# Chuẩn bị generated resources theo R11a và protected controller catalog trước.
pnpm.cmd --prefix app build
pnpm.cmd --prefix app exec electron-builder --win nsis --x64 --publish never --config.directories.output=D:/Developing/DuAnCNTT/app/.out-scripts/<new-package-directory>
node app/scripts/windows-release-lab.mjs --run --artifact app/.out-scripts/<new-package-directory>/win-unpacked
```

Output phải mới, nằm trong ignored `.out-scripts`; không ghi đè dist/bản cài hiện tại. Lab chụp Settings, điều hướng5trang, đổi English/Light, train180mẫu tổng hợp/suy luận4method bằng đúng Python con thuộc app, đóng app và kiểm process/cổng đã dừng; mở process mới cùng profile phải giữ DB/key/model/UI. Sau hai lần chạy, hash executable/asar/ML resource không đổi; SQLite readonly integrity=ok/schema31. Chỉ dọn profile/HOME thuộc fixture khi toàn bộ gate đạt, lỗi giữ diagnostics. Không có thay đổi Main/IPC để phục vụ lab.

`--user-data-dir` được probe độc lập trước full app. HOME chỉ tách đường log hiện hành; Windows identity/DPAPI vẫn là tài khoản đang đăng nhập. Thao tác `app.getPath`/sessionData tham chiếu [Electron app API](https://www.electronjs.org/docs/latest/api/app#appgetpathname). Đây không phải máy Windows sạch hay kiểm chứng decrypt key giữa hai user.

## Thử install/reinstall/uninstall an toàn

```powershell
node app/scripts/windows-installer-lab.mjs --build --artifact app/.out-scripts/<new-package-directory>/win-unpacked
# Lấy record nonce được in sau BUILD PASS.
node app/scripts/windows-installer-lab.mjs --run --record <nonce>
```

Builder tạo bản NSIS fixture với appId/GUID/tên executable riêng và tắt shortcut/autorun/elevation/data deletion. Binary executable chỉ đổi tên; payload executable/asar phải có cùng hash với bản production build. Cả hai registry key của GUID mới phải chưa tồn tại trước install và biến mất sau uninstall. Chỉ cài vào `app/.out-scripts/windows-installer-lab/<nonce>/install/OpsPilot`, không chạy production installer trên máy phát triển để tránh đè installation/registry hiện có. Có marker/config/installer hash và guard phạm vi; không nhận record traversal, không dùng force-clean hoặc xóa registry chung.

Installed full app chạy lại toàn bộ gate phía trên; giữa hai lượt chạy thực hiện **cài lại cùng version**, kiểm DB/key/model còn nguyên, rồi chạy uninstaller fixture và kiểm executable đã gỡ nhưng dữ liệu profile riêng được giữ. Uninstaller fixture nhận `_?=<owned installation>` để caller chờ đồng bộ; file uninstaller đang chạy có thể còn lại, nên gate này không khẳng định standalone self-delete/whole-folder removal. Reinstall cùng version không chứng minh upgrade từ phiên bản cũ. Hành vi/option NSIS đối chiếu [electron-builder](https://www.electron.build/nsis/) và templates NSIS của phiên bản đang cài; fixture không thay production appId trong config sản phẩm.

## Gate còn phải làm trên Windows độc lập

Dùng Windows VM/máy khác không có môi trường dev. Windows account mới giúp kiểm profile/DPAPI mới, nhưng nếu vẫn trên máy phát triển thì không tự chứng minh hệ điều hành/môi trường độc lập. Profile riêng của lab cũng chỉ chứng minh isolation.

1. Copy **production installer** cùng SHA256SUMS từ thư mục build; so SHA bằng `Get-FileHash .\OpsPilot-0.2.0-setup.exe -Algorithm SHA256` cho bản hiện hành. Không dùng installer có tên Release-Lab để nghiệm thu release thực.
2. Ghi Windows version/architecture, xác nhận không cài Python/Node riêng. Không cần cài các tool này để chạy app. Nếu có môi trường dev cũ, ghi rõ và không gọi là clean-machine PASS.
3. Cài và mở app bằng shortcut bình thường, không truyền profile override/debug flags. Xác nhận không crash/blank screen hoặc yêu cầu Python/.venv; Apps/VPS ban đầu rỗng, Settings đổi ngôn ngữ/theme được.
4. Qua PowerShell `Invoke-RestMethod http://127.0.0.1:8765/health` (hoặc8766/8767 nếu port bận), xác nhận ML status/version. Task Manager phải cho thấy Python con nằm trong resources/ml-runtime của bản cài, không từ một Python cài riêng.
5. Đóng app, kiểm Python của app đã dừng; mở lại và xác nhận theme/ngôn ngữ còn giữ. Native SQLite và protected master key xuất hiện trong userData OpsPilot của account mới. Không gửi DB hoặc file khóa trong báo cáo.
6. Drill upgrade thực từ installer cũ được giữ lại: tạo dữ liệu fixture/ML trên version cũ, đóng app, cài version mới, kiểm DB/profile/model/credential vẫn dùng được. Không dùng bản hiện tại cài hai lần để thay gate này. Nếu version cũ ghi model vào resources, phải xử lý/kiểm migration trước khi gọi upgrade đạt.
7. Gỡ bản cài trên account/máy thử; ghi rõ app/process/shortcut/registry đã gỡ, dữ liệu người dùng giữ hay xóa theo lựa chọn. Không thử trên profile đang dùng thật.
8. Ghi PASS/FAIL/NOT_RUN riêng từng mục, ảnh lỗi và log đã redacted nếu có. Không suy diễn batch ML/pilot hoặc khả năng deploy template từ gate installer.

Build hiện hành chưa có chữ ký publisher (`Get-AuthenticodeSignature`: NotSigned). Không khẳng định signed release/distribution đã đạt. [Task và evidence hiện hành](../../../docs/tasks/tk-s7-release-r11b-windows-installer.md).
