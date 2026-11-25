# Retest bundle R7 — 25/11/2026

**R7 hai ca locked-file gốc PASS; REQUEST_CHANGES cho backup safety, source probes và bundle/upgrade gates. Chưa READY_FOR_MANUAL_CHECK.**

Candidate `85cac50eb672de88a35483185f1739c935688cf7`, nhánh Kim. Clean implementation trước retest; leader chỉ cập nhật hồ sơ. Private input/output giữ local ignored; không commit/push binary/raw logs, không production installer/profile/credential/VPS.

## Kết quả leader thực chạy

| Hạng mục | Kết quả |
|---|---|
| Bundle `handoff-bundle-20261124-r7` | 5/5 hashes khớp; probe bằng bytes repo; installer 492,054,238 bytes, NotSigned |
| Packaged runtime | Controller/ML verification PASS; Main trong ASAR khớp build hiện tại, version 0.2.0 |
| Fresh NSIS fixture | Build PASS, namespace `d3bf9e88fa32`, actual beforePack và isolated appId/GUID |
| Locked `resources/app.asar` | PASS: exit 2, không thiếu/hỏng payload files, registry giữ 2 keys |
| Locked executable | PASS: exit 2, không thiếu/hỏng payload files, registry giữ 2 keys |
| Normal uninstall sau probes | PASS: exit 0, installation đã xóa và registry còn 0 keys; không process app fixture còn chạy |
| Backup đã tồn tại trước update | **FAIL dữ liệu recovery bị xóa**, dù stock probe chỉ kiểm current payload vẫn báo PASS |
| Scoped ESLint | PASS, `--max-warnings=0` |
| Standalone preflight suite | FAIL hai lượt tại check đầu, CLI child hết 30s, status null; lượt thứ hai sau khi compression đã dừng |

Raw evidence: `app/.out-scripts/windows-delivery/leader-retest-85cac50-20261124T231017Z/`. Tên thư mục dùng UTC; ngày retest local là 25/11. Gồm context, bundle/artifact verification, fixture-build, regression-results, normal-uninstall, focused checks và stdout/stderr.

## R8 — P1: Tự xóa pre-existing recovery backup

Vị trí `app/resources/installer.nsh:131–132`: đặt backup cố định `<INSTDIR>_b`, rồi `Remove-Item -Recurse -Force` trước khi chứng minh ownership hoặc tình trạng recovery. Sau `un.safeRestoreItems` cũng xóa backup; hàm restore không kiểm kết quả từng Rename.

Leader tạo sẵn `<owned-fixture-install>_b/retained-recovery-marker.txt`, ghi hash marker, rồi chạy update-uninstall với native lock trên app.asar. Update exit 2 và current payload/registry giữ nguyên, nhưng marker recovery đã bị xóa, không chuyển vào installation. Đây là thao tác xóa dữ liệu ngoài transaction mới, có thể phá bản recovery còn lại của lượt trước. Chỉ synthetic marker trong fixture được dùng cho ca này.

Gemini cần:
- Nếu backup đã tồn tại mà chưa có authority/state hợp lệ, từ chối **trước mutation**, giữ toàn bộ backup và báo đường dẫn. Hoặc dùng transaction directory mới có nonce/ownership và không ghi đè recovery cũ.
- Kiểm restore/rollback thực sự thành công trước cleanup; rollback fail phải giữ backup, không `SilentlyContinue` rồi xóa phần có thể dùng để cứu dữ liệu.
- Thêm native backup-collision/recovery-retention test bên cạnh hai locked cases đã đạt. Stock probe hiện tìm `install/*-old-*` trong khi code dùng `OpsPilot_b`; sửa kiểm tra backup theo đúng transaction path.
- Rebuild NSIS/bundle mới sau sửa; không đổi pins, source predecessor hoặc payload ứng dụng để né gate.

## Các gate khác vẫn mở

**Source probes:** `preflight-check.mjs:41` fail `Expected exit 0 but got null` ở cả lượt ban đầu và lượt retry sau compression, mỗi CLI child có budget 30s. Default CLI diagnostic với budget 120s **exit 0 sau 32.44s**: timeout của harness không đủ trên môi trường hiện tại, không phải bằng chứng CLI/app crash. Không được dùng kết quả 12 PASS cũ cho candidate này. Đo/giảm verification lặp lại hoặc đặt budget hữu hạn có căn cứ, vẫn báo timeout/spawn errors rõ; chạy lại suite không skip assertions. Raw evidence: standalone-rerun.json và preflight-default-long.json/logs.

**Encoding probe:** gọi script mới bằng Python mặc định với captured stdout trên host này bị UnicodeEncodeError khi in đường dẫn tiếng Việt, trước install. Leader chạy native cases bằng `python -X utf8 ...`, giữ nguyên probe bytes/logic. Gemini cần thiết lập output encoding hoặc ghi exact UTF-8 invocation trong runbook; không tự nhận default command đã chạy thành công.

**Supported upgrade:** baseline builder đã tạo payload 0.1.0; actual upgrade record `f4f00459eb3d/result.json` là **FAIL sau 2 checks**, `NEW_UPGRADE_FAILED`, status null/timeout. Đây không còn chỉ là NOT_RUN. Nguyên nhân `$PLUGINSDIR` được nêu trong bàn giao chưa được chứng minh bằng error/exit/trace trong evidence đã xem. Cần repro và old/new child logs/exit state rồi align approved baseline toolchain/fixture; không sửa lịch sử predecessor/policy/version để giả PASS. Không miễn gate hoặc chuyển failure thành user manual.

**Bundle completeness:** bundle mới chỉ có installer, probe, 3 JSON reports và SHA256SUMS. Thiếu backup-profile.ps1, restore-profile.ps1, manage-process.ps1 và checklist offline cho lượt user; các lệnh đang tham chiếu repo không tự có trên máy Windows sạch. Thêm bản đã test cùng hashes và source/artifact identity, các evidence refs hợp lệ; artifact/logs vẫn private ignored.

**Full suite:** 21 core failures từ evidence trước vẫn SOURCE_TESTS_OPEN, ngoài diff implementation; leader không lặp full Vitest vì core không đổi. Không whole CI PASS hoặc release acceptance từ hai locked probes.

## Thứ tự bàn giao tiếp

Sửa R8 và regression trước; xử lý source-probe timeout/UTF-8 invocation; chốt upgrade repro/approved compatibility; rebuild và bổ sung bundle đầy đủ. Sau đó Codex retest affected cases rồi mới chọn các bước user nghiệm thu Windows độc lập/GUI/UAC/DPAPI/credential/live VPS thật. Các R7 locked cases và normal uninstall đã đạt cần giữ làm controls, không làm lại implementation từ đầu.
