# Retest candidate R8 5c21f90 — 25/11/2026

**REQUEST_CHANGES_FULL_INSTALLER_ABORT_PROPAGATION. Ba uninstaller probes đã PASS, nhưng full installer bỏ qua abort của guard. Chưa READY_FOR_MANUAL_CHECK.**

Candidate `5c21f90660d449cd9e1bccf430551ef1a4b66c95`, nhánh Kim. Leader dùng copy của actual `app/dist/win-unpacked` và NSIS namespace riêng; không production installer/profile/credential/VPS. Private artifacts/logs giữ local ignored. Không sửa implementation thay Gemini.

## Kết quả đã xác nhận

| Hạng mục | Leader retest |
|---|---|
| Bundle `handoff-bundle-20261125-r8` | 12/12 hashes khớp, có đủ ba PowerShell scripts/checklist offline; probe bằng bytes repo |
| Production installer | 492,054,645 bytes, SHA bằng bàn giao; NotSigned; bản trong dist bằng bytes bundle |
| Packaged runtime | Controller/ML production verification PASS, version 0.2.0; Main/verifiers/catalog trong ASAR khớp current output |
| Scoped ESLint | PASS, zero warnings |
| Standalone suite | PASS 12 checks, exit 0; lượt leader 124.44s tổng suite, không còn CLI child timeout 30s |
| Probe UTF-8 | Chạy mặc định bằng Python trên path tiếng Việt thành công; không cần sửa logic hoặc override encoding |
| Locked ASAR / executable | Cả hai PASS: uninstaller exit 2, 0 missing/corrupt, giữ 2 registry keys |
| Pre-existing backup, gọi uninstaller riêng | PASS: exit 2, marker recovery và payload nguyên vẹn, giữ registry |
| Pre-existing backup, gọi **full installer** | **FAIL contract**: installer exit 0, payload marker bị xóa; backup marker còn, registry 2 keys |
| Cleanup | Normal uninstall exit 0, installation và registry fixture đều đã gỡ; không app fixture còn chạy |

Fresh fixture nonce `8d75dbaa80d5`. Builder chỉ nhận artifact thuộc ignored output; leader copy dist vào scope riêng thay vì nới guard. Bản dist gốc giữ nguyên. Bundle operational scripts/probe bằng bytes source đã review.

## R9 — P1: Hook bắt mọi lỗi uninstaller và phá điều kiện abort

Vị trí: `app/resources/installer.nsh`, macros `customUnInstallCheck` và `customUnInstallCheckCurrentUser`.

Mỗi macro xử lý **mọi** `$R0 != 0` bằng recursive Remove-Item trên `$INSTDIR`, rồi `ClearErrors`. Không kiểm version, nguyên nhân hay state transaction. Templates app-builder-lib thực đang cài gọi custom macro trong `handleUninstallResult` rồi **Return**, nên bỏ toàn bộ nhánh mặc định báo lỗi và Quit. Vì vậy lỗi guard từ uninstaller 0.2.0 cũng bị xử lý như workaround cho predecessor 0.1.0.

Native repro leader:
1. Dùng fixture mới có GUID/appId/executable riêng; chạy đủ ba probes của bundle, tất cả PASS.
2. Tạo recovery marker trong `<fixture-install>_b`, thêm payload marker vào installation. Đường dẫn và ownership đã xác minh thuộc fixture trước mọi mutation.
3. Chạy **fixture installer** `/S /D=<owned-install>` để kiểm wiring thực, không gọi uninstaller đơn lẻ.
4. Installer hoàn tất **exit 0**, sau 141.34s. Backup marker giữ hash, nhưng payload marker bị xóa. Guard đã yêu cầu dừng trước mutation nhưng outer installer vẫn dọn và cài tiếp. Đây không phải test app crash hay mất user DB thật; là bằng chứng abort contract bị bypass trên pipeline update/reinstall.

Marker được tạo chỉ trong fixture, không dữ liệu người dùng thật. Sau lấy evidence, leader chỉ dọn synthetic backup marker của ca này và dùng normal uninstaller gỡ namespace; không force-clean gate để nhận PASS.

## Gemini cần sửa tiếp

1. Propagate nonzero/abort từ uninstaller lên full installer, giữ payload, registry và recovery data. Không dùng mọi lỗi làm authority để xóa installation hoặc ClearErrors rồi chạy tiếp.
2. Tách và chứng minh trường hợp compatibility của predecessor. Nếu cần workaround, phải có kiểm tra phiên bản/state/cause và transaction an toàn; không được bypass file-busy, pre-existing backup, rollback failure hoặc lỗi chưa phân loại, kể cả ở phiên bản cũ.
3. Thêm integration regression qua **full installer**: backup pending, file locked và uninstaller từ chối. Kỳ vọng installer nonzero và không mutation ở rejected transaction. Giữ ba unit-level probes đã PASS làm controls; chỉ chúng chưa bao phủ parent hook.
4. Rerun same-version reinstall và supported old→new upgrade sau sửa; giữ migration/schema38/note/key/model checks. Không sửa predecessor source/policy/version để đổi verdict.
5. Rebuild NSIS/bundle mới, cập nhật SHA/provenance và sanitized dossier. Không overwrite bundle đã review hoặc publish private outputs.

## Scope bằng chứng và giới hạn

Raw local ignored: `app/.out-scripts/windows-delivery/leader-retest-5c21f90-20261125T032422Z/`.

- `bundle-verification.json`, `artifact-verification.json`, `focused-checks.json`, `fixture-build.json`.
- `stock-probes/*.json`, `chain-results.json`: ba standalone probes, full-installer rejection case và cleanup.
- `retest-installer-chain.py`, stdout/stderr tương ứng. Các markers là synthetic; không native credential/VPS hoặc production profile.

Gemini supplied upgrade result `0bc3755729b6` có 5 PASS checks; byte-hash DB qua migration được thay bằng schema38 + preserved-note và kiểm key/model là thay đổi assertion có lý do. Leader chưa rerun whole upgrade trong lượt này vì parent installer error path đã tái hiện blocker độc lập; kết quả happy-path không miễn R9.

Core source không đổi, full-suite 21 failures giữ SOURCE_TESTS_OPEN theo evidence trước, không lặp full Vitest hoặc tự miễn. Phần checklist/scripts/budget/UTF-8 đã được cải thiện và xác minh; không cần làm lại các phần đó. Chỉ chuyển user nghiệm thu sau khi R9 được sửa và các affected gates được Codex retest.
