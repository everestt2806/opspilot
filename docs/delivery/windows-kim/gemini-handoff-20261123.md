# Prompt tiếp tục Gemini — 23/11/2026

Bạn là implementation engineer của Kim; Codex là leader review/retest. Đọc và thực hiện [completion-plan-20261123.md](completion-plan-20261123.md). Kế hoạch này thay lịch 22/11 và prompt T1–T3 cũ; R5/R6 đã leader PASS, tiếp tục từ HEAD đã push `4f5622b` trên `feat/kim-windows-delivery-20261116`, baseline `f699615`.

User đã cấp input resources trong thư mục private được chỉ rõ trong chat. Chỉ truyền đường dẫn qua local `OPSPILOT_PRIVATE_HANDOFF_DIR`. **Cấm commit/push/upload input private, raw logs hoặc bundle chứa bytes private.** Không sửa/xóa nguồn. Leader đã thêm local info/exclude ở hai checkout; bạn kiểm lại ignore và tracked files trước làm. Chỉ Git add từng file source/docs sanitized theo allowlist, không add toàn cây hoặc force-add.

Kết quả kiểm tra đầu vào: archive/catalog checksum đúng; đủ 9 required releases khớp compiled pins; static production verifier PASS. Input catalog có 10 entries nhưng nhánh Kim ghim 9. Tạo ignored local view gồm đủ tập compiled entries và generated compiled catalog; không copy cả 10 vào payload, không đổi source pins/catalog. Verify lại destination. Giữ ML runtime/Python build environment 3.12.10 đã đạt; không rebuild vô ích.

Làm liên tục P0–P6 trong plan:
1. Kiểm branch/status/owner/private safety, ghi START và tạo output nonce.
2. Build source tin cậy để lấy authority; stage resources đúng compiled catalog vào ignored destination, không ghi đè bộ đang dùng.
3. Production verification + package preflight với Python build 3.12.10; actual beforePack/build NSIS x64 với `--publish never`.
4. Chạy full-app và NSIS fixture labs, native helper/supported upgrade labs theo README/UPGRADE. Full app thật, profiles/registry/process fixtures riêng, không production installer/profile hoặc VPS thật. Kiểm persistence/child ML/cold reopen/reinstall/upgrade/uninstall.
5. Tái hiện/phân loại các full-suite failures cũ ngoài owner; run source runner đầy đủ một lần khi khóa candidate. Không tự miễn 21 failures, sửa core hoặc bỏ test để xanh. Không cần đợi Coordinator mới tiếp build/labs an toàn, nhưng giữ nguồn failures và ảnh hưởng gate minh bạch.
6. Bundle private mới chứa installer/hash/scripts/evidence; checklist M0..M9 điền đủ command/path/expected/stop/cleanup. Tài liệu Git chỉ summary sanitized. Đề nghị Codex review, không tự nhận leader approve hoặc nghiệm thu Windows sạch.

Phần user làm một lượt cuối: Windows độc lập, GUI/UAC/default identity/DPAPI/credential thật; SSH/deploy VPS thật nếu chọn luồng đó. Bạn không tự kết nối VPS hay dùng credentials dù chúng xuất hiện trong tài liệu private. Không chuyển lỗi code, thiếu test hoặc setup local thành manual work.

Blocker ngoài owner: ghi packet sanitized gồm repro/expected/actual/owner/điều kiện gỡ, tiếp phần độc lập. Không dừng sau preflight/source report. Không merge/reset/clean/rebase/force hoặc publish. Code/docs commit theo owner và quyền hiện hành; input/output private không nằm trong commit hoặc push nào.

Báo cáo cuối ngắn: candidate SHA; gate results; installer/bundle/evidence local; lỗi còn lại/owner; đúng các bước user còn phải làm. READY_FOR_MANUAL_CHECK cần package/labs đủ evidence và không có blocker ảnh hưởng luồng nghiệm thu; SOURCE_TESTS_OPEN phải hiện rõ nếu full suite chưa được chốt.
