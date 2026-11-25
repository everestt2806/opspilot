# Leader nghiệm thu 723af02 — 25/11/2026

**REQUEST_CHANGES_POST_STAGING_CLEANUP / KIM_NOT_YET_PASS.** Candidate được kiểm trong lượt này là `723af027ffaf849e6f231d5eb2b9189ccfe7e221`, bundle `handoff-bundle-20261125-r11`. Các ca lỗi cũ đã retest PASS và được đóng bên dưới. Còn một P1 tái hiện trên nhánh staging mới của chính R11; không suy từ lỗi của R10/e2d599d.

## Identity và nguyên tắc kiểm

- Nhánh `feat/kim-windows-delivery-20261116`, working tree sạch trước ghi ledger của Codex; không có diff source trong lượt review.
- Bundle **22/22 files + SHA256SUMS** bao phủ đủ, khớp; scripts bằng bytes repo, full SHA metadata bằng actual HEAD.
- Installer 492,055,868 bytes, SHA256 `f0c3d54d1c24fc1286d26919245dedc83ef9a7b6d1d86d3a1f8e85affa1d2d43`, bằng dist, Authenticode thực `NotSigned`.
- Upgrade fixture `c5138b00875b`: owner/GUID/installer hashes và include SHA khớp source R11; predecessor thật `d302ee39f13ee369b308582994c4554636ea7892`. Standard fixture `907f98cba5d5` đã đối chiếu owner/hash/namespace trống. Không dùng fixture R10 bị ngắt.
- Các native/install tests chạy tuần tự, output mới; không production installation/profile, VPS hoặc private commit/push. Source/core không đổi từ e2d599d tới candidate này.

## Regression cũ đã được kiểm lại

| Ca | Bằng chứng mới trên R11 |
|---|---|
| Metadata sai full SHA | **PASS**, HEAD thật và metadata bằng nhau |
| Probe foreign/missing owner, invalid fixture | **PASS** 3 guards, exit 0 |
| UTF-8 entry point | **PASS**, native script chạy mặc định trên path tiếng Việt, không PYTHONIOENCODING override |
| Khóa file trong backup trước cleanup | **PASS**, bắt được native lock, installer exit 2; **3,421/3,421 files** nguyên hash trong recovery, 0 missing/corrupt; control uninstall exit 0, registry/install/backup đã dọn |
| Hidden resources + locked ASAR | **PASS**, exit 2, 0 missing/changed; control cleanup registry 0 |
| Hidden executable + native lock | **PASS**, exit 2, 0 missing/changed; control cleanup registry 0 |
| Independent output/input guards | **PASS 4/4**: foreign owner, existing install, fixture owner mismatch, installer hash mismatch; lỗi đúng validation, marker/owner giữ nguyên, không tới bước spawn installer |
| Standard uninstaller/full installer | **PASS 8/8**, suite exit 0 sau 409.64s; C4 reinstall exit 0 với 0 missing/corrupt; C5 exit 0, payload/registry 0 |

C4 timeout 180s và C5 NOT_RUN ở R10 đã được thay bằng kết quả chạy thật trên R11 với budget hữu hạn hiện hành; không giữ chúng là lỗi/thiếu test hiện tại. C5 có thể để lại stub uninstaller khi dùng `_?=`, không còn payload app hoặc registry; đây không phải partial-install state của fixture R10.

Các PASS này đóng đúng ca lỗi cũ tương ứng, không được tiếp tục liệt kê là lỗi đang tồn tại chỉ vì R10 từng FAIL. Các kết quả dưới đây là leader chạy thật trên đúng R11, không suy từ báo cáo Gemini.

## Evidence local

`app/.out-scripts/windows-delivery/leader-retest-723af02-20261125T120012Z/`: context, bundle/fixture verification, sequential-checks, native per-case results và logs. Raw/binaries chỉ local ignored; dossier Git chỉ tóm tắt đã lọc.

## Phần Sơn

[Packet tích hợp Sơn](son-integration-handoff-20261125.md) vẫn tách riêng. 21 assertions/8 files là evidence source trước commit e2d599d, không gọi là full-suite result mới trên 723af02. Không sửa core để làm xanh delivery; không dùng counter Vitest để thay các native/installer gates của Kim.

## Kết quả cuối các gates độc lập

| Gate | Leader thực chạy |
|---|---|
| Standalone | **12/12 PASS**, exit 0, 110.05s; gồm native backup/restore/process positive/negative guards |
| Scoped ESLint | **PASS**, exit 0, 3.48s, zero warnings |
| Packaged controllers/ML | **PASS**, production verifiers của 9 controller releases và ML; ASAR version 0.2.0 |
| ASAR/build identity | Main, hai verifiers và catalog chunk khớp current compiled output |
| Source identity cuối lượt | HEAD vẫn 723af02; không diff installer/scripts/core/build config so với HEAD |

Tất cả ca regression cũ được yêu cầu sửa ở R10 đã PASS trên R11. Không nhận `KIM_SCOPE_PASS` vì ca mới ở nhánh xử lý lỗi dưới đây FAIL, không phải vì 21 core tests của Sơn hoặc vì giữ kết luận cũ trong bộ nhớ.

## P1 hiện hành — lock phát sinh sau staging rename làm cleanup xóa dần recovery

Vị trí: `app/resources/installer.nsh:125`, command mới có `Rename-Item $dst -> $trash`, sau đó `Remove-Item $trash -Recurse`, catch cố rename phần còn lại về backup. **Rename thành công không làm recursive delete trở thành giao dịch nguyên tử.** File có thể được mở sau rename; catch không thể phục hồi những file đã xóa trước lúc gặp lỗi.

Hai điều kiện khác nhau đã được kiểm riêng trên cùng candidate:

- **File đã khóa trước rename:** native stock cleanup-fault **PASS**, đủ 3,421 files nguyên hash trong backup. Ca lỗi cũ đóng.
- **File mới bị khóa sau rename:** independent native probe **FAIL** trên artifact R11 như sau.

Repro mới:

1. Dùng cặp installers old/new đã kiểm hash từ fixture `c5138b00875b`, include SHA bằng current `installer.nsh`. Cài predecessor thật vào output mới có owner, snapshot hashes; không fake version/registry, không dùng fixture R10.
2. Giữ native handle trên executable gốc để đi vào legacy fallback. Nhả handle khi backup được tạo, để move/rename có thể hoàn tất. Chỉ lấy handle mới **khi executable đã xuất hiện trong `<install>_b_trash`**, tức sau staging rename; không khóa trước rename như ca stock.
3. Handle share-read không cho write/delete; thực sự bắt được lock tại `12:14:52.604357Z`. Setup R11 exit **2** sau **33.50s**, không timeout.
4. Kiểm đủ **ba** vị trí: install, backup và staged trash. Trên **3,401** file đã snapshot, **0** còn nguyên tại install, chỉ **8** giữ đúng hash trong recovery/trash; **3,393** không còn ở cả ba nơi. `backup_exists=false`, `trash_exists=true`, registry 2.

Đây là xóa file synthetic trong fixture khi setup báo thất bại, không phải mất dữ liệu người dùng thật. Không lấy việc payload nằm ở tên thư mục mới làm bằng chứng mất file; đã kiểm union cả ba roots bằng SHA256. Không so số file predecessor bị thay trong upgrade thành công: ca này **exit 2 trước khi cài target hoàn tất**.

Thông báo macro nói "Retaining complete backup at $3" cũng không đúng trong ca này: `$3` không tồn tại, phần còn lại nằm ở trash và thiếu phần lớn file. Sau khi ghi evidence, Codex nhả handle, đưa phần fixture còn lại về install và dùng control uninstaller: exit 0, registry/install/backup/trash đều sạch. Không có app fixture còn chạy.

Evidence mới: `cleanup-after-staging.py`, `cleanup-after-staging/result.json`, logs; script kiểm fixture owner, current include SHA, predecessor source và installer hashes trước khi chạy. `inventory_roots` trong result ghi rõ install/backup/staged_trash. Các stock regression results được giữ độc lập, không sửa assertion hay đổi kết quả PASS của chúng.

## Hướng sửa để tránh lặp lại vá cùng một cơ chế

Giữ nguyên các fixes đã PASS. Không thêm một pre-check/rename khác rồi kết luận mọi lỗi delete sau đó đều được rollback. Cần giữ **bản recovery đầy đủ cho tới khi target mới đã được xác minh cài xong**, hoặc cơ chế tương đương thực sự giữ được bản sao đầy đủ khi delete thất bại.

Một hướng phù hợp: rename/stage old payload an toàn nhưng **chưa xóa**; cài/xác minh target trước, rồi mới cleanup recovery như công việc sau commit. Nếu thất bại trước commit, giữ/restore đủ old hashes và báo đúng đường dẫn. Nếu target đã commit đầy đủ, lỗi dọn old staging không được biến thành failed setup với không còn bản hoạt động; ghi trạng thái cleanup thực tế và không chặn vô cớ reinstall/uninstall sau đó. Gemini phải đối chiếu lifecycle hook thực của electron-builder, không sửa core/pins/contracts hoặc predecessor.

Postconditions phải mạnh và rõ: setup nonzero trước commit thì đủ old inventory trong install/recovery; setup success thì **đủ target inventory/ASAR hash**, registry/version, profile/key/model/migration đúng. Không chấp nhận chỉ kiểm exit code, chỉ kiểm executable (có thể bằng bytes giữa versions), đổi tên backup hoặc đổi assertion để hợp thức hóa partial payload. Nếu đổi commit point, ghi rõ lý do đổi expected outcomes và kiểm mạnh target/persistence tương ứng, không miễn lỗi cũ.

Thêm native test khóa file **sau staging rename** và giữ cả ca pre-lock cũ; test lỗi trong cleanup/rollback phải kiểm full inventories, recovery path thực và khả năng retry. Sau source fix rebuild NSIS/bundle mới và chạy lại affected upgrade, 8 standard probes, standalone/lint. Không cần viết lại phần đã đạt hoặc lấy core failures Sơn làm blocker của Kim.
