# Leader nghiệm thu e5f8e33 / R12 — 25/11/2026

**R11_P1_CLOSED / REQUEST_CHANGES_RETIRED_RETRY_P2 / KIM_NOT_YET_PASS / SON_INTEGRATION_PENDING.** R12 đã sửa được lỗi mất recovery trước commit của R11. Một lỗi P2 còn tái hiện ở việc cài lại sau cleanup staging thất bại: marker `.retired` mất, installer tiếp tục từ chối sau khi lock đã nhả. Không có mất/hỏng current payload trong ca này.

Actual HEAD `e5f8e334fc6062e7774ff5f8e747128047f89643`, nhánh Kim, bundle `handoff-bundle-20261125-r12`. Codex không sửa implementation. Working tree sạch trước ledger; end-of-review source/artifact identity được kiểm lại. Các kết luận R10/R11 chỉ là lịch sử và danh mục regression, không tự dùng để đánh FAIL R12.

## Các kết quả đã kiểm trực tiếp

| Hạng mục | Leader retest R12 |
|---|---|
| Bundle | **22/22 files** khớp SHA256SUMS; manifest bao phủ đủ; scripts bằng bytes source |
| Identity | Full candidate SHA đúng HEAD; installer bằng dist, 492,056,049 bytes, SHA256 `89a33e77868977af661edd757e56afb907c4bac1dd39f9c3aa22bb545c0b0188`, NotSigned |
| Packaged resources | Production verifiers **9 controller releases + ML PASS**; ASAR 0.2.0; Main/hai verifiers/catalog chunk khớp compiled output |
| Scoped lint | **PASS**, zero warnings, 4.00s |
| Probe guards | **3/3 PASS** trên script R12 |
| Lock staging trước rename | Setup **exit 0**, target **11,883/11,883 files** đúng hash, ASAR đúng 0.2.0, registry 2; recovery 3,859 files giữ nguyên |
| Lock sau staging rename | Setup **exit 0**, target **11,883/11,883 files** đúng hash, ASAR đúng 0.2.0, registry 2; commit hoàn tất trước cleanup lỗi |
| Retry trong lúc retired staging còn khóa | Exit **2**, nhưng **11,884/11,884 current files** nguyên vẹn, registry 2: từ chối an toàn; marker `.retired` bị mất |
| Retry sau khi nhả lock | **FAIL chức năng retry**: full installer tiếp tục exit **2** sau 16.95s; current files vẫn nguyên vẹn, backup còn nhưng marker không còn |
| Normal uninstall | Exit **0**, installation/registry đã gỡ; retired backup giữ local làm diagnostic |

NSIS fixtures được kiểm owner/GUID/hash trước chạy: upgrade `10f97fb96732`, installer `0aab2cd6b266`; predecessor thật `d302ee39f13ee369b308582994c4554636ea7892`. Upgrade include SHA khớp current `installer.nsh` (`bd9f1f1e8f3e09310e11e17d250e512696eb7c1df94b171dae35cb0ff336af27`). Không production installer/profile/credential/VPS.

## R11 đã đóng đúng theo commit point mới

R11 từng exit nonzero trước khi target cài xong và mất phần lớn old inventory. Trên R12, Codex bắt được lock cả trước và sau staging rename, setup success và **đủ toàn bộ target inventory**. Không chỉ kiểm executable hoặc file tồn tại: so SHA256 đủ 11,883 target files từ current prepackaged artifact, gồm ASAR và resources, registry 2.

Sau khi target mới đã commit đúng, các file 0.1.0 retired có thể bị dọn/thay đổi; không lấy số old files biến mất trong successful upgrade để báo lại lỗi mất dữ liệu của R11. Ở ca post-rename, old inventory thay đổi nhưng target mới đầy đủ, setup exit 0: **PASS commit-point safety**, không phải R11 FAIL. Chính sách expected outcome mới đã được nêu trong review/prompt trước, không miễn lỗi bằng đổi exit code đơn thuần.

## P2 còn lại — mất marker sau một lần cleanup lỗi khiến retry bị kẹt

Vị trí: `app/resources/installer.nsh`, retired cleanup ở khoảng dòng 78 và 314; sau đó vẫn `CreateDirectory "$unBackupDir"` / `Call un.safeMoveItems` dù cleanup thất bại.

Repro hiện hành, trên install path ngắn có owner và inventory đầy đủ:

1. Cài predecessor thật, upgrade R12 trong khi giữ native handle trên old executable đã vào backup. Target 0.2.0 cài thành công, backup được đánh `.retired`.
2. **Chưa nhả handle**, chạy lại full installer. Nhánh retired cleanup gọi recursive Remove-Item, nuốt lỗi bằng `catch {}` rồi vẫn đi tiếp với backup chưa sạch. Installer exit 2, current inventory không mất/hỏng, nhưng `.retired` trong backup **không còn**.
3. **Nhả toàn bộ native handles**, chạy full installer thêm lần nữa. Vẫn exit 2 vì backup có sẵn không có `.retired` bị coi là pending recovery. Không có process app hoặc handle từ probe còn giữ file. Snapshot current inventory tiếp tục 0 missing/corrupt.
4. Control uninstaller `--updated` cũng exit 2; normal uninstall `/S` vẫn exit 0 và registry 0. Đây là lỗi cập nhật/cài lại sau sự cố tạm thời, không phải lỗi cài mới hoặc mất dữ liệu của R11.

Expected: khi retired staging đang bận có thể từ chối an toàn; **sau khi nhả lock phải retry được**, target/registry/profile đúng, không cần user tự xóa một backup mà hệ thống đã làm mất thông tin phân loại.

Probe Gemini `cleanup-fault` đang tự xóa backup ở phần dọn fixture trước khi chạy control uninstall. Vì vậy PASS của ca đó và C4 trên fixture sạch chưa bao phủ retry với retired staging còn tồn tại. Cần thêm state transition này vào regression, không xóa staging trước khi test retry.

## Sửa nhỏ, giữ nguyên thiết kế post-commit đã đúng

- Khi cleanup của một thư mục **đã được xác nhận retired** thất bại, giữ/khôi phục marker retired hợp lệ; báo rõ trạng thái/đường dẫn nếu không thể ghi lại marker.
- Kiểm exit/result cleanup. Nếu staging chưa dọn xong, **dừng trước khi dùng lại nó làm backup của transaction mới**, không tiếp tục CreateDirectory/move/rollback trộn dữ liệu cũ với transaction hiện tại.
- Áp dụng nhất quán cho cả retired branch installer và update-uninstaller. Giữ nguyên guard từ chối backup không có authority retired; không sửa bằng cách bỏ guard hoặc xóa recovery vô điều kiện.
- Native regression ba bước: lock retained staging → retry từ chối nhưng giữ current hashes/registry và authority state → release lock → retry exit 0 với đủ target hashes → normal uninstall exit 0. Giữ hai commit-point controls đã PASS; không viết lại lifecycle R11 hoặc core/pins/contracts.

Chỉ chốt Kim PASS khi state transition này đạt. [Prompt Gemini hiện hành](gemini-handoff-20261125.md). Core/Sơn và manual thật vẫn tách riêng.

## Điều kiện lab và giới hạn evidence

Lượt chẩn đoán đầu dùng install path dài 147 ký tự và target paths tới hơn 300 ký tự, thiếu 6,468 files. **Không tính ca đó thành lỗi cleanup hay verdict sản phẩm mặc định.** Codex chạy lại cùng artifact tại root ngắn (install path 62, longest target 232), xác minh đủ 11,883/11,883 files ở cả hai ca. Không sửa source, không giảm inventory/assertion để nhận PASS. Raw ca sâu được đánh diagnostic-only; không yêu cầu Gemini sửa một lỗi từ setup kiểm thử này.

R12 supplied reports installer 7 checks, supported upgrade 5 checks, standard probes 8 PASS được đối chiếu checksum/fixture provenance và ghi là **Gemini thực chạy, leader kiểm evidence**, không nhận là Codex đã lặp toàn bộ GUI/labs trong lượt này. Codex tập trung native changed paths và retry; đã tái hiện blocker độc lập nên không lặp toàn bộ suite không liên quan.

Standalone 12 checks và 8 standard probes leader đã chạy trên 723af02; source standalone/JS labs/core/dependency/build config không đổi tới e5f8e33. Không gọi historical runs là fresh R12 execution. Full source report 21 failures/8 files vẫn là evidence trước commit e2d599d; phần Sơn giữ [packet riêng](son-integration-handoff-20261125.md), không lấy chúng làm lý do FAIL Kim.

## Evidence local ignored

`app/.out-scripts/windows-delivery/leader-retest-e5f8e33-20261125T135845Z/`:

- Context, bundle/fixture/artifact verification, scoped lint, guard-tests, supplied-report-index, unchanged-controls.
- `post-commit-probe.py` / `post-commit-short-probe.py`: current include/installer hashes, native locks, full target inventory và retry.
- `r12a07c2/result.json`, `retry-after-release.json`, `normal-cleanup.json` và logs: first commit, safe rejection, persistent retry failure và normal uninstall.
- `r12b07c2/result.json` và logs: native post-rename commit-point PASS, updated cleanup registry 0.

Physical short cases ở `app/.out-scripts/r12a07c2/` và `r12b07c2/`, đều có owner. Không app fixture còn chạy; namespace registry 0. Retired/staged files còn lại giữ ignored làm diagnostic, không force-delete để làm xanh. Source không đổi trong lượt review; không commit/push/upload private input/binaries/logs.
