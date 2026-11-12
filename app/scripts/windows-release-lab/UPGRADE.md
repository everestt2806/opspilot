# Nâng cấp0.1.0 →0.2.0 và bảo toàn model cũ

## Hành vi sản phẩm

Bản0.1.0 trước R11a ghi model vào `<installation>/resources/ml-service/state/<deployment_id>/{state.pkl,meta.json}`. NSIS thường gỡ bản cũ trước khi giải nén bản mới, nên chỉ chuyển đường dẫn ML trong Main không đủ giữ model. Bản0.2.0 thêm `resources/installer.nsh` vào customInit trước `uninstallOldVersion`; helper PowerShell được nhúng trong installer, không lấy script từ bản cũ hoặc renderer.

Không có state hoặc state rỗng: tiếp tục. Có state: đóng app cũ trước; source ML phải khớp policy từ exact predecessor d302ee3 và scientific-library versions phải khớp runtime hiện hành. Helper chỉ đọc bytes/JSON, không thực thi Python/joblib/pickle để kiểm model. Model đang có trong local installation được coi là dữ liệu người dùng đã tin ở bản cũ, không phải nguồn model nhập bất kỳ từ Internet. Hash/pins là ranh giới tương thích và chống copy nhầm, không biến pickle không rõ nguồn thành dữ liệu an toàn.

Mỗi deployment cần đúng cặp file, positive numeric ID, feature version hợp lệ và ít nhất150train samples trong metadata. Giới hạn256deployments, state.pkl128MiB, meta64KiB, tổng512MiB; source/target không junction/symlink. Giữ read handles không chia sẻ ghi/xóa trong lúc kiểm/copy. File được hash, ghi vào staging trong userData và promote nguyên thư mục `ml-state` bằng same-volume rename. Nguồn không bị sửa/xóa bởi helper. Target đã có model khác hoặc thiếu một phần thì abort trước gỡ bản cũ, không merge/overwrite/retrain âm thầm. Target đã có cùng bytes thì chấp nhận chạy lại.

Policy nằm ở `app/resources/legacy-ml-policy.json`; source pins từ Git được review độc lập với bản cài cũ, package versions từ `ml-service/runtime-lock.json`. Hiện hỗ trợ đúng source/dependency family này. Bản cũ khác phiên bản thư viện hoặc source chưa được duyệt phải giữ bản cũ và sao lưu; không ép vượt gate hoặc nới policy theo hash do chính một nguồn lạ đưa ra. Windows profile/key/safeStorage/SQLite không đổi vị trí trong migration này. Không chuyển khóa giữa hai Windows account, không chạy VPS.

Nếu installer báo không bảo toàn được model: giữ thư mục cài cũ, đóng OpsPilot/Python con của đúng bản đó rồi thử lại. Nếu vẫn lỗi, sao lưu toàn bộ userData (gồm DB/khóa) và legacy state sang nơi riêng trước khi xử lý. Không gửi DB, protected key hoặc pickle cho người khác qua báo cáo. Không xóa state cũ để “làm xanh” installer; cần xem lỗi tương thích/xung đột và chọn bản source/dependency được hỗ trợ hoặc retrain có chủ đích.

## Kiểm chứng native helper

```powershell
. ./tools/enter-node22.ps1
ml-service/.venv/Scripts/python.exe app/scripts/legacy-ml-upgrade-lab.py --run
```

Lab tạo fixture source từ exact Git commit trong policy, không cài dependency mới.14checks gồm preserve/idempotency/conflict/source/library/layout/meta/links/size/profile overlap/actual running process. `state.pkl` là opaque bytes không hợp lệ để chứng minh helper không unpickle; đây không phải model ML thật. Kết quả/log trong ignored `.out-scripts/legacy-ml-upgrade-lab`, scenario directories được dọn khi PASS.

## Dựng và chạy hai full app payloads

```powershell
. ./tools/enter-node22.ps1
ml-service/.venv/Scripts/python.exe app/scripts/windows-upgrade-baseline.py --build
pnpm.cmd --prefix app build
# Build new production0.2.0 tới output mới theo README R11b.
node app/scripts/windows-upgrade-lab.mjs --build --old app/.out-scripts/windows-upgrade-baseline/<record>/package/win-unpacked --new app/.out-scripts/<new-package-directory>/win-unpacked
node app/scripts/windows-upgrade-lab.mjs --run --record <nonce>
```

Baseline builder lấy source0.1.0 từ exact Git predecessor, không reset/switch working tree. Dùng existing approved Node/Electron/npm dependencies, copied production scientific wheels và **đúng venv redirector/base-prefix dependency của thiết kế cũ**. Không chỉnh Main/config/thuật toán cũ để giả portable; vì vậy baseline này chỉ chạy trên máy development có Python base tương ứng. Đây là source rebuild có nguồn rõ ràng, không phải chứng minh mọi installer0.1.0 từng phân phối đều tương thích. Hai package versions lấy từ actual package.json trong ASAR; baseline không bị đổi version để giả upgrade. Bản mới0.2.0 có resource ML độc lập + pre-uninstall preservation.

Hai NSIS fixture dùng cùng GUID/appId/tên executable riêng, tắt shortcut/autorun/elevation; riêng migration profile được trỏ tới fixture bằng compile-time define. Payload executable chỉ đổi tên, actual Main/preload/UI/SQLite/safeStorage/ML không mock. Lab cài full0.1, train180mẫu thật bằng service cũ để sinh legacy model, đóng app và ghi hash. Thử nâng khi thiếu meta phải abort và giữ payload/model cũ; trả meta lại rồi nâng actual0.2 phải chuyển model trước gỡ bản cũ, giữ DB/key/localStorage. App mới phải nhận cùng trained_at/model bytes và tiếp tục trả4scores; không train lại để né lỗi. Ordinary asynchronous NSIS uninstall không `_?=` phải self-delete toàn folder/registry của fixture, giữ dữ liệu profile. Chỉ dọn profile/HOME thuộc record khi toàn bộ gate đạt.

Lượt12/11 đầu tiên của predecessor chưa báo MLready trong timeout30s cũ; kết quả FAIL giữ riêng. Native import probe sau đó đạt. `--resume --record <nonce>` chỉ nhận đúng record FAIL này với0checks, installation vẫn đúng old payload hash, không có model của lab hoặc target `ml-state`; tạo `failed-first-launch.json` trước khi tiếp tục. Không reinstall, tăng timeout hoặc sửa code bản cũ; không gọi lượt cold đầu là PASS. Lượt tiếp tục train thành công rồi hoàn tất5upgrade checks. Record đã PASS/đã có model hoặc phase khác không được resume/replay bằng đường này.

Windows sạch/default production installer identity vẫn là gate riêng. Không suy credential portability giữa accounts, compatibility với mọi library version, pilot75phút/50runs hoặc signed release từ upgrade lab này. [Ledger và evidence](../../../docs/tasks/tk-s7-release-r11c-upgrade-compatibility.md).
