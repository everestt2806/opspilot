# Review output 0fa81ad — 24/11/2026

**REQUEST_CHANGES: installer safety guards. Chưa duyệt READY_FOR_MANUAL_CHECK.**

Candidate `0fa81ad`, nhánh Kim, code baseline `f699615`. Leader kiểm tra và test bằng private local artifacts/namespace riêng; không chạy production installer lên máy đang dùng, không profile/credential/VPS thật. Không commit/push private input/output. Review này không sửa implementation thay Gemini.

## Phần đã xác nhận

- Bundle `handoff-bundle-20261123`: 7/7 SHA256SUMS khớp, scripts bằng bytes repo. Installer thực 492,049,356 bytes; hash bằng hash bàn giao. Kích thước 492,059,202 trong dossier là metadata sai.
- Production installer có trạng thái Authenticode **NotSigned**. Actual beforePack là verification hook, không phải bằng chứng ký số; cụm “hook signed nội bộ” trong bàn giao không đúng kết quả signature.
- Leader chạy lại scoped ESLint: exit 0, zero warnings; 12 standalone preflight probes: PASS; legacy native helper: 14 checks PASS.
- Fresh package preflight với build Python 3.12.10: exit 0, source_ready/package_ready=true. Discovery Windows độc lập vẫn false; blocker discovery không được suy thành clean-Windows PASS.
- Verification trên **packaged output**: 9 controller releases PASS, ML resources PASS. Main index, controller/ML verifier và compiled catalog trong ASAR khớp current compiled output; package version 0.2.0. Collector chỉ gồm ba runtime files dự kiến.
- Leader chạy lại full packaged app trên nonce `6113289bba45`: PASS 5 checks, actual Main/preload/SQLite/safeStorage/bundled ML; train180, bốn scores, cold reopen giữ DB/key/model/UI; cleanup fixture thành công. Đây là local runtime/lifecycle, không Windows sạch/formal ML.
- Source tests bàn giao có JSON mới: 184 file results, 8 failed files, 21 failed assertions, 2,621 PASS / 11 SKIP. `14 failed suites` là bộ đếm suite của Vitest, không phải 14 file. Core source không đổi trong diff; leader không lặp full suite, giữ SOURCE_TESTS_OPEN và các lỗi ngoài owner chưa được miễn.

## R7 — P1: NSIS bỏ running-app guard và atomic removal

`app/resources/installer.nsh:21` thêm `customRemoveFiles` chỉ `SetOutPath $TEMP; RMDir /r $INSTDIR`, không kiểm lỗi hoặc phục hồi. `installer.nsh:26` thêm `customCheckAppRunning` rỗng.

Đã đối chiếu với templates của app-builder-lib thực đang cài: `CHECK_APP_RUNNING` chọn custom macro thay toàn bộ default guard; `uninstaller.nsh` chọn customRemoveFiles thay nhánh update gọi `un.atomicRMDir`, kiểm file busy và `un.restoreFiles` trước abort. Hai thay đổi mới vì vậy vô hiệu hóa các guard, không chỉ xử lý khác phân vùng.

Happy-path reinstall/uninstall PASS không chứng minh update an toàn khi app/file đang bận. Cần giữ running-app/ownership guard tương đương và transactional removal có kiểm lỗi, rollback phù hợp cùng volume. Không dùng macro rỗng hoặc unchecked recursive deletion để vượt qua lỗi rename/cross-volume.

Leader đã build NSIS **fixture mới** nonce `13024bb6fb0d` từ unpacked output hiện tại, install exit 0. Negative case giữ native file handle không cho delete/rename `resources/app.asar`, rồi chạy uninstaller `/S --updated _?=<owned-install>` và lấy snapshot khi lock còn giữ. **Uninstaller exit 0, cả hai registry keys đã bị xóa, nhưng payload bị xóa dở.** So với staged payload 11,883 files, sau test thiếu 11,875 files, chỉ còn 9 installed files (gồm uninstaller). Executable và locked ASAR giữ hash, nhưng các thành phần bắt buộc như ffmpeg.dll, icudtl.dat, libEGL.dll và resources.pak đã mất; không còn full app có thể dùng. Đây là partial removal thay vì abort/restore payload cũ.

Probe đầu được giữ riêng vì thời điểm sample chưa chờ đúng lifecycle của NSIS. Verdict dùng lượt controlled native `_?=` và sample khi handle vẫn khóa, cộng kiểm inventory sau tiến trình kết thúc; không suy từ việc parent launcher exit. Private fixture lỗi được giữ làm diagnostics, không còn process/registry fixture đang chạy; không production identity nào bị thay đổi.

Gemini cần sửa trong scope installer/labs, thêm native negative regression: app/child/file busy, không có ownership evidence, update remove thất bại phải giữ/khôi phục đủ payload cũ và install metadata; không trả thành công khi partial delete. Regression phải so toàn bộ expected payload/inventory, không chỉ executable hoặc locked ASAR vì hai file đó có thể còn trong khi dependency đã mất. Chạy lại positive reinstall/uninstall và resource hashes, rồi rebuild installer/bundle mới.

## Gate upgrade chưa hoàn tất

`windows-upgrade-lab` vẫn NOT_RUN. 14 legacy-helper checks không thay old full app → new full app upgrade. `windows-upgrade-baseline.py` hiện copy nguyên current catalog/resources vào predecessor, trong khi predecessor d302ee3 có schema max8. Đây là input compatibility của baseline harness cần điều tra trong scope Kim; chưa đủ để kết luận external blocker không thể xử lý.

Chuẩn bị **approved predecessor-compatible** catalog/resource set theo authority phù hợp, giữ source/policy/version predecessor nguyên trạng. Không đưa current catalog 9 vào parser max8 hoặc sửa max8/đổi version để qua gate. Nếu thiếu approval/artifact thật, ghi exact prerequisite cho Coordinator và giữ UPGRADE_NOT_RUN; không nhận FULL_LABS_PASS/P0–P6 hoàn tất.

## Evidence và bàn giao sửa

Raw local ignored: `app/.out-scripts/windows-delivery/leader-check-0fa81ad-20261124T111914Z/`. Gồm bundle-verification, artifact-verification, package-gate, focused-checks, full-app-run, fixture-build, locked-update-probe và logs tương ứng. File DB/key/model/binary/raw logs giữ private, Git chỉ summary này.

Trước nghiệm thu: sửa R7 + regressions → rebuild NSIS và bundle mới → hoàn tất hoặc báo chính xác supported-upgrade gate → đồng bộ signature/size/source SHA và status → Codex retest. Source failures vẫn owner Coordinator; user chỉ làm Windows độc lập/GUI/UAC/DPAPI/credential/live VPS đã chọn sau khi code/package blockers được chốt.
