# Review bàn giao 58a47af — 22/11/2026

**Kết luận: REQUEST_CHANGES + BLOCKED_PACKAGE. Chưa READY_FOR_MANUAL_CHECK.**

Đã kiểm tra candidate `58a47af7415db38ee8e54c178a5298e71c237f20`, nhánh `feat/kim-windows-delivery-20261116`. Không kết nối VPS, không thao tác profile thật, không dừng process thật. Phần dưới thay thế kết luận LOCAL_PASS trong bàn giao Gemini.

## Phần đã đạt

- Bundle `handoff-bundle-20261122-r1r4`: 6/6 content hashes khớp; ba scripts khớp repo. Source evidence: 19/19 hashes khớp.
- Leader chạy lại scoped ESLint `--max-warnings=0` và 12 standalone preflight probes: exit 0.
- Native backup → restore thành công trên fixture. Thiếu protected key và file ngoài manifest bị reject trước khi đổi target. Tên tham số ba lệnh bàn giao đã đúng. R1 phần missing-key và R2 phần command đã được sửa.
- Process mock: PID reuse và executable ngoài installation đều bị từ chối, không gọi Stop-Process.
- R4 đã dùng compiled ML pin/trusted controller catalog và không cấp VERIFIED khi thiếu authority. ML resource 3.12.10 cùng manifest pin `64782424b3e87ccb781553f24fc7c73bfe8a26c3f03e34fc203b24082b1038e8` được giữ nguyên; native import/production verification đã đạt trong review trước.

## R5 — P1: Rollback restore không chạy khi promote lỗi

Vị trí: `app/scripts/windows-delivery/restore-profile.ps1:218`.

`$ErrorActionPreference = "Stop"` khiến `Write-Error` đầu catch trở thành lỗi terminating. Các lệnh khôi phục từ PreRestore và dọn staging phía sau không được chạy.

Leader chèn duy nhất lỗi `SYNTHETIC_PROMOTE_FAILURE` tại lệnh promote trong bản sao script thực, kèm guard bảo đảm mọi Move/Remove nằm trong thư mục fixture. Kết quả: exit 1, **target không tồn tại**, marker profile cũ không còn tại vị trí ban đầu; PreRestore và staging vẫn còn. Dữ liệu cũ còn trong PreRestore, nhưng lời hứa tự rollback và giữ nguyên vị trí profile không đúng.

Gemini sửa catch để phục hồi trước khi phát lỗi terminating, giữ lỗi gốc và kiểm tra kết quả rollback. Không che rollback failure bằng `SilentlyContinue` rồi tự nhận thành công. Thêm regression chạy chính script: promote fail sau khi đã cất profile cũ → nonzero exit, profile cũ trở lại đúng target với hashes nguyên vẹn. Nếu rollback cũng lỗi, báo rõ đường dẫn bản cũ để phục hồi thủ công và không xóa bản đó. Các mutation chỉ trong fixture riêng.

## R6 — P2: Mất listener vẫn gọi dừng process

Vị trí: `app/scripts/windows-delivery/manage-process.ps1:160`.

Nhánh `if (-not $currentConn)` chỉ in thông báo rồi vẫn đi tiếp tới `CloseMainWindow()` và `Stop-Process`. Leader chạy script thật trong child PowerShell, mock hoàn toàn Get-Process/Get-NetTCPConnection/Stop-Process: snapshot có listener, lần kiểm tra trước stop không còn listener → **Stop-Process vẫn được gọi, exit 0**. Không process thật nào bị dừng.

Gemini cần bỏ qua/từ chối thao tác khi mất listener; cả graceful close và force stop đều không được gọi trong ca này. Thêm regression trên script thật với mocks: owned listener positive, lost listener, PID reuse, non-owned path. Đừng dùng inspect trên cổng rảnh làm bằng chứng cho Stop.

## Evidence và giới hạn

Raw evidence local: `app/.out-scripts/windows-delivery/leader-check-58a47af-20261122T142810Z/`.

- `restore-probes.json`: positive exit 0; missing-key/unlisted-file exit 1 giữ nguyên target; promote-failure exit 1 nhưng target mất vị trí.
- `process-probes.json`: owned-listener gọi mock stop; lost-listener vẫn gọi mock stop; PID reuse/unrelated không gọi stop.
- `focused-checks.json`, các stdout/stderr logs; bundle/source-evidence verification JSON.
- Restore fixtures dùng marker bytes, không chứng minh SQLite/DPAPI/model round-trip trên app thật. Fault injection dùng bản sao có guard; process probes gọi script thật với mocked cmdlets.
- Gemini source report có 2,621 PASS / 21 FAIL / 11 SKIP, source runner exit 1; 8 failing files ngoài diff delivery vẫn chưa được coordinator miễn hoặc chứng minh baseline. Provenance là `4746766` + dirty diff `6d9150b971b37c55ded46dbf7453f699888ced3110670a1f8f3d6037234e5047`, không phải clean HEAD 58a47af. Leader không rerun full suite vì core source không đổi; không nhận whole CI xanh hay “0 delivery regressions” từ report này.
- Probe 11 hiện bao phủ positive backup/restore, missing-key, unlisted-file và process Inspect. Không chứng minh toàn bộ matrix/rollback/Stop như mô tả “100%” trong bàn giao.

## Thứ tự hoàn tất và bàn giao Gemini

1. Sửa R5/R6 trong scope Kim, đưa hai ca tái hiện vào standalone checks bằng scripts thật và fixtures/mocks an toàn. Giữ nguyên ML resource đã đạt; không đổi core/pins để né gate.
2. Sửa checklist/task/report: candidate SHA đúng, chỉ nhận kết quả có evidence; source report phải lưu code commit + dirty diff nếu có. Tạo bundle mới với scripts sau sửa và hashes mới; không ghi đè bundle đã review.
3. Coordinator cung cấp **nguyên bộ** approved `app/resources/controller-releases/`: catalog + 9 release directories cùng node/payload/dependencies/runtime-lock/release-manifest và installer.cjs đúng compiled pins. Hiện thư mục này chưa có. Inventory IDs/pins: `app/.out-scripts/windows-delivery/leader-check-4746766-20261122T102516Z/controller-resources-required.json`.
4. Khi có resources: verify trusted resources → build mới/actual beforePack → NSIS + unpacked/full-app/lifecycle/upgrade automated labs phù hợp → ghi installer path/hash/logs và tạo bundle cuối. Không chỉ build NSIS rồi tự đánh dấu hoàn tất.
5. Chỉ chuyển READY_FOR_MANUAL_CHECK khi lỗi delivery hết và các gate package đã có bằng chứng. User thực hiện một lượt M0..M9 cho Windows sạch/GUI/UAC/DPAPI/credential và VPS thật nếu cần; các bước đó giữ NOT_RUN/WAITING_USER tới khi có quan sát thật.

Đầu ra Gemini cần bàn giao: commit sửa, regression logs, kết quả từng gate, bundle path/checksums, installer nếu đã có resources, blocker còn lại kèm owner và điều kiện gỡ. Nếu thiếu controller resources, hoàn tất R5/R6 và báo BLOCKED_PACKAGE chính xác, không tự tạo resource giả hoặc gọi LOCAL_PASS cho toàn bộ delivery.
