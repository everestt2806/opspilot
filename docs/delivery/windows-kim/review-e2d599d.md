# Leader retest e2d599d — 25/11/2026

**REQUEST_CHANGES_RECOVERY_CLEANUP / KIM_NOT_YET_PASS / SON_INTEGRATION_PENDING.** Lỗi Hidden resources ở lượt trước đã sửa và Codex retest đạt. Nhưng khi cleanup gặp file bị khóa trong backup, installer dừng sau khi đã xóa phần lớn payload cũ. Scope Kim còn lỗi thực tế, chưa chốt PASS.

Actual candidate: `e2d599d7e28326c8f25beb7d634a889abc299724`, nhánh `feat/kim-windows-delivery-20261116`. Bundle `handoff-bundle-20261125-r10`: **21 files + SHA256SUMS**, không phải 19 files như một số dòng dossier.

## P1 — Cleanup phá bản recovery trước khi giao dịch cài đặt hoàn tất

Vị trí: `app/resources/installer.nsh:125`. Sau move, installer gọi recursive `Remove-Item` trên `$3` với `-ErrorAction Stop`, rồi mới cho tiến trình cài tiếp. `ErrorAction Stop` dừng khi gặp lỗi nhưng không hoàn tác các file đã xóa trước đó. Nhánh lỗi cleanup chỉ `SetErrorLevel 2; Quit`; không còn payload đầy đủ để rollback.

Native repro Codex trên predecessor thật, không fake registry/version:

1. Dùng upgrade fixture `6d161b63a117`; owner/GUID/installer hashes đã kiểm. Source predecessor `d302ee39f13ee369b308582994c4554636ea7892`, include SHA của fixture khớp source hiện tại. Install/profile/registry riêng, không production state.
2. Cài 0.1.0 vào output riêng, snapshot toàn bộ file hashes. Giữ read handle không share delete trên executable để đi qua nhánh fallback của legacy uninstaller.
3. Khi `$INSTDIR_b` được tạo, nhả handle gốc để transactional move có thể hoàn tất. Khi executable đã nằm trong backup, giữ native read handle mới trên **bản trong backup**, không cho cleanup xóa file đó. Timestamp nhả lock gốc `10:33:38.114131Z`, lock backup `10:33:38.899940Z`; không mock PowerShell.
4. **Actual:** new installer exit **2** sau **41.36s**; 0/3,067 file cũ còn nguyên tại install; chỉ **8** file giữ đúng hash trong recovery; **3,059 file không còn ở cả install lẫn backup**. Registry còn 2 keys và backup vẫn tồn tại, nhưng backup đó không đầy đủ.
5. **Expected:** rejected upgrade phải giữ đủ payload để phục hồi, tại install hoặc recovery với hashes khớp; không xóa dần bản sao duy nhất rồi coi việc dừng nonzero là an toàn.

Đây là mất file synthetic trong fixture, không có kết luận mất DB/profile thật. Kết luận dựa trên union inventory **install + recovery** sau khi setup nonzero; không dùng việc upgrade thành công thay inventory làm bằng chứng lỗi. Ca chẩn đoán đầu tiên không bắt được backup lock đã được ghi rõ NOT_EXERCISED và không dùng để kết luận.

Sau evidence, Codex nhả handle, đưa phần fixture còn lại về install và dùng control uninstaller gỡ namespace: exit 0, registry 0, cả install/backup đã dọn. Raw evidence local ignored.

Gemini cần giữ nguyên recovery đầy đủ tới khi đã xác nhận target payload cài thành công và có chiến lược xử lý cleanup failure an toàn. Có thể trì hoãn cleanup, giữ recovery có ownership/state rõ hoặc cách phù hợp NSIS hiện có; không chỉ thêm `-Force`/`ErrorAction Stop`, đổi exit code, hoặc bỏ assertion. Thêm native regression khóa file **sau move, trước cleanup** và kiểm đủ hash inventory ở install/recovery, kèm rollback-incomplete/backup-pending controls. Không sửa predecessor/core để tránh lỗi.

## P2 — Probe mới chưa bảo vệ output và invocation Windows

File `app/scripts/windows-legacy-locked-probe.py`:

- Dòng 23 chỉ kiểm `.owner` tồn tại; không đối chiếu owner, scope/provenance hoặc installer hashes như lab guard. Dòng 43–50 nhận output có sẵn, ghi đè owner rồi `shutil.rmtree(install, ignore_errors=True)`.
- Codex tạo synthetic output chứa marker và owner khác, dùng fixture `.owner` không khớp và installer không tồn tại. Script **xóa marker và ghi đè owner trước khi lỗi khởi chạy installer**. Không có NSIS process nào được chạy trong ca này. Đây là guard failure, không phải test fixture không hợp lệ được từ chối an toàn.
- Chạy mặc định trên checkout tiếng Việt phát sinh `UnicodeEncodeError` tại dòng print install path trước cài đặt. Chạy lại với `PYTHONIOENCODING=utf-8` mới thực hiện được native test. Không nhận invocation mặc định PASS.

Yêu cầu: kiểm owner/paths/GUID/provenance/hash trước mutation; output mới exclusive hoặc từ chối output đã có; không tự xóa dữ liệu có sẵn/ghi đè owner để hợp thức hóa. Bảo vệ symlink/reparse và scope giống labs hiện có. Thiết lập UTF-8 stdout/stderr trong entry point. Thêm negative controls kiểm marker/owner còn nguyên và không chạy installer khi input bị từ chối. Không cần thay đổi product core.

## Các phần đã kiểm và đạt

| Hạng mục | Evidence Codex |
|---|---|
| Bundle integrity | 21/21 files khớp; manifest bao phủ toàn bộ files; scripts bằng bytes repo |
| Metadata identity | Full candidate SHA bằng actual HEAD; lỗi SHA R9 đã đóng |
| Installer | 492,055,731 bytes; SHA256 `be450b2777ee607e4a81a8ed5b7a63dbd7da451249c64879738cd6fb70af8fc6`; bằng dist; NotSigned |
| Packaged resources | 9 controller releases và ML production verifiers PASS; ASAR version 0.2.0; Main, hai verifiers và catalog chunk bằng compiled output |
| Hidden resources + locked ASAR | Với UTF-8: installer exit 2, **0 missing / 0 changed**, old ASAR/executable giữ hash, registry 2; cleanup exit 0, registry 0 |
| Scoped lint | Exit 0, zero warnings |

Standard probes và standalone rerun được ghi ở phần kết quả cuối bên dưới. Gemini cung cấp positive installer lab 7 checks và upgrade lab 5 checks; các happy paths không thay thế cleanup-failure gate vừa FAIL. Codex không lặp full GUI/ML lab khi blocker độc lập đã tái hiện.

## Source tests và phần Sơn

Source report checksum `f879a7fb6a0f60932ce3df933f0074cd641cfd432ef59ee392938bc6888fe594` khớp bundle/source-run. 7/8 source steps PASS, full Vitest exit 1: 2,621 PASS / 21 failed assertions / 11 SKIP, 8 failed files. `app/src/**` không đổi từ f8da4b2 tới e2d599d. Giữ [packet Sơn](son-integration-handoff-20261125.md) để Sơn tích hợp và retest, không bắt Kim sửa core.

Provenance của report là **f8da4b2 + dirty tree**, không phải clean e2d599d: dirty diff SHA `c41ae46f9f62c0cecf8330e48e1ee5ab643dbce595c7a7fff05e358ab838ee59`. Ghi đúng precommit run, không đổi provenance thành HEAD mới. `delivery_failures_count: 0` là phân loại Vitest; không chứng minh mọi NSIS/native/probe case của Kim PASS hoặc `REGRESSION: NONE`.

## Evidence và bước tiếp

Local ignored: `app/.out-scripts/windows-delivery/leader-retest-e2d599d-20261125T102429Z/`.

- `bundle-verification.json`, `fixture-validation.json`, `artifact-verification.json`, `source-report-verification.json`.
- `legacy-resources-utf8/result.json`; `legacy-default.stderr.log` cho invocation không override UTF-8.
- `legacy-cleanup-fault-v2.py`, `legacy-cleanup-fault-v2/result.json`: P1 native loss + cleanup; ca đầu `legacy-cleanup-fault/result.json` chỉ diagnostic.
- `probe-output-guard/result.json`: output guard negative test.
- `standard-probes/*.json`, `standard-run.json`, `focused-checks.json` và logs tương ứng.

Theo tiêu chí user: **mọi ca Kim phải PASS thật**; các lỗi trên vẫn thuộc Kim và cần Gemini sửa. Xem prompt cập nhật [gemini-handoff-20261125.md](gemini-handoff-20261125.md). Rebuild/bundle mới khi sửa NSIS; giữ R10 và raw evidence nguyên trạng. Không commit/push/upload private input/output, không VPS/production profile, không tự merge/publish. Manual thật giữ WAITING_USER; phần core giữ SON_INTEGRATION_PENDING.

## Kết quả cuối của các controls

| Control | Kết quả lượt Codex |
|---|---|
| Standalone 12 checks | **PASS 12/12** khi chạy riêng: exit 0, 205.25s; gồm backup/restore/process positive và negative guards |
| Standalone lượt có tải | Exit 1 sau 91.86s, child CLI timeout 90s; giữ log lịch sử, không dùng lượt này làm bằng chứng lỗi logic khi lượt chạy riêng đã đạt |
| Ba uninstaller probes | **PASS 3/3**, payload hashes/registry được bảo toàn |
| Full installer C1–C3 | **PASS 3/3**, installer exit 2 và payload/markers/registry đúng |
| Full installer C4 reinstall | **TIMEOUT 180s**, stock script exit 1, không có report C4 PASS; lượt này có các lab khác tranh tài nguyên, chưa kết luận nguyên nhân là logic installer |
| C5 stock normal uninstall | **NOT_RUN**, suite đã dừng ở C4; không nhận bộ 8/8 PASS cho lượt leader |
| Scope Kim tổng thể | **FAIL** do P1 cleanup + P2 probe guard/encoding; các ca chưa chạy phải retest, không miễn lỗi để xanh |

Sau timeout C4, fixture `1aec6a5f4c96` còn 5,242 partial files, không có uninstaller; registry 0, không còn app/installer process. Đã lưu snapshot trạng thái. Bộ duyệt tự động từ chối lệnh recursive cleanup đã có ownership/path/registry guards với lý do **blocked by policy**; lệnh không chạy, không đổi shell/cách xóa để vượt chặn. Giữ partial fixture local ignored làm diagnostic, không báo đó là C5 PASS. Hai legacy test namespaces đã normal-control uninstall sạch như ghi ở evidence.

Gemini cần chạy C4/C5 tuần tự trên fixture mới có provenance sau sửa, ghi elapsed/exit/postconditions thật; phân biệt giải nén chậm/harness timeout với crash. Không biến TIMEOUT/NOT_RUN thành PASS từ các JSON của lượt trước. Hai vấn đề P1/P2 độc lập với contention và đã có native/synthetic evidence tái hiện.
