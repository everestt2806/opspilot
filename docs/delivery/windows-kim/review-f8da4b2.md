# Leader retest f8da4b2 — 25/11/2026

**REQUEST_CHANGES_LEGACY_TRANSACTION / KIM_NOT_YET_PASS.** R9 đã chặn đúng lỗi uninstaller ở nhánh 0.2.0. Giao dịch thay thế dành cho predecessor 0.1.0 vẫn có ca báo thành công dù payload mới chưa được cài. Chưa chuyển user nghiệm thu.

Candidate: `f8da4b29b09b1914b2be6b58ef92dd38e767949a`, nhánh `feat/kim-windows-delivery-20261116`. Bundle được kiểm: `handoff-bundle-20261125-r9`. Codex kiểm thử trong namespace lab riêng, không sửa implementation thay Gemini.

## Các kết quả Codex đã chạy và xác nhận

| Hạng mục | Kết quả thực tế |
|---|---|
| SHA256SUMS bundle | 17/17 file khớp; operational scripts/probe khớp source |
| Installer production | 492,055,460 bytes; SHA256 `7f2de238058bf6df77cbe06a4c6c9ed4ad1423aae13a68931fdadf26372a7523`; bằng dist; NotSigned |
| Resources đóng gói | Production verifiers controller 9 releases và ML PASS; ASAR version 0.2.0; Main, hai verifier và compiled catalog chunk khớp current output |
| Scoped ESLint | Exit 0, zero warnings |
| Standalone suite | 12/12 PASS; exit 0; tổng lượt chạy 154.24s |
| Ba uninstaller probes | Locked ASAR, locked executable, backup có sẵn: PASS; không mất/hỏng payload |
| Full installer C1–C3 | Backup pending, locked ASAR, locked executable: PASS; exit 2, 0 missing/corrupt, giữ registry và markers |
| Full installer C4 | Same-version reinstall: PASS; exit 0, 0 missing/corrupt, registry 2 |
| C5 normal uninstall | PASS; exit 0, payload và registry đã gỡ. Chỉ còn stub uninstaller trong thư mục lab do chạy `_?=` |

Fixture mới của Codex: `c314879c4345`; builder và cả 8 regression probes đều exit 0/PASS. Không dùng kết quả uninstaller riêng để suy ra full installer an toàn.

## P1 còn trong phạm vi Kim: legacy transaction bỏ sót thư mục ẩn

Vị trí: `app/resources/installer.nsh:96`, rollback tại dòng 100, cleanup tại dòng 115. `Get-ChildItem -LiteralPath` thiếu `-Force`, nên không liệt kê root entry có thuộc tính Hidden/System. Giao dịch có thể báo đã chuyển hết, xóa backup rồi tiếp tục cài trong khi entry bị bỏ sót vẫn ở đích; cleanup còn nuốt lỗi với `SilentlyContinue`.

Codex đã tái hiện bằng **installer predecessor 0.1.0 thật**, không sửa registry version để giả predecessor:

1. Dùng approved source `d302ee39f13ee369b308582994c4554636ea7892` và upgrade fixture `5705eecb5da5`. Hash old/new installers khớp plan; include SHA khớp `installer.nsh` hiện tại. Dùng install path riêng và kiểm namespace trống trước test.
2. Cài bản 0.1.0 thành công, đặt thuộc tính Hidden cho root `resources`, giữ native read handle trên `resources/app.asar` với share mode không cho write/delete.
3. Chạy full installer mới `/S /D=<owned-install>` trong khi vẫn giữ lock.
4. **Actual:** installer mới exit **0** sau **105.73s**, không timeout; ASAR tại đích vẫn khớp hash bản **0.1.0**, **không khớp target 0.2.0**. Backup không còn, registry còn 2 keys. Đây là false-success và payload chưa nâng cấp đúng.
5. **Expected:** installer trả nonzero, payload/registry cũ được bảo toàn; không tiếp tục cài khi giao dịch chưa chuyển đủ và không xóa recovery khi chưa kiểm chứng rollback.

Kết luận dựa trên hash ASAR cũ/mới, không dựa vào số file predecessor biến mất: upgrade hợp lệ vốn có thể thay inventory. Ca chẩn đoán khác với hidden executable không được dùng làm bằng chứng mất dữ liệu. Không có kết luận về mất DB/profile người dùng thật. Sau test, normal control uninstaller exit 0, namespace registry trống, target legacy fixture đã dọn.

Gemini cần sửa:

- Liệt kê đủ Hidden/System cho cả move và rollback; lỗi enumeration phải terminating/fail closed. Kiểm đầy đủ inventory trước khi coi giao dịch thành công.
- Kiểm kết quả move/rollback/cleanup; không biến lỗi thành thành công bằng `SilentlyContinue`/`ClearErrors`. Khi rollback không hoàn tất, giữ recovery và báo trạng thái chính xác.
- Thêm native regression với predecessor thật: locked ASAR khi `resources` visible và Hidden; giữ negative backup/running/rollback cùng các positive controls. Case từ chối phải nonzero và giữ hashes/registry; case upgrade thành công phải khớp payload target.
- Giữ migration schema 38, note/key/model bytes và anomaly scores của happy-path upgrade. Không sửa predecessor/core/policy/version để đổi verdict.

## Metadata identity cần sửa

`bundle-metadata.json` ghi `candidate_commit_sha = f8da4b24f5bf77b212f451f28b7fa9ebffbdfae8`, khác actual HEAD `f8da4b29b09b1914b2be6b58ef92dd38e767949a`. Cùng short prefix không đủ xác thực provenance. Lấy full SHA bằng Git, đối chiếu source/build identity và tái tạo manifest. Checksum đúng chỉ chứng minh bytes metadata không đổi, không chứng minh nội dung metadata đúng.

Giữ bundle R9 làm lịch sử; sau source fix phải rebuild NSIS và tạo bundle mới. Không sửa bundle cũ để che kết quả đã review.

## Tiêu chí chốt theo yêu cầu user

**Kim chỉ được đánh dấu PASS khi toàn bộ ca thuộc Kim đạt thật qua kiểm thử, không skip/xfail/nới assertion/miễn lỗi để xanh.** P1 legacy và metadata trên vẫn thuộc Kim. [Kế hoạch/prompt Gemini](gemini-handoff-20261125.md) quy định gates còn lại.

Các lỗi và ca tích hợp thuộc Sơn được ghi ở [bàn giao Sơn](son-integration-handoff-20261125.md), để Sơn chạy lại sau khi kéo và tích hợp code. Không coi những lỗi đó đã PASS, không dùng chúng để miễn lỗi installer của Kim. Chốt `KIM_SCOPE_PASS` và `SON_INTEGRATION_PENDING` độc lập; không tuyên bố whole CI/release xanh khi chưa có evidence tích hợp.

Full Vitest không chạy lại trong lượt NSIS này: evidence source gần nhất còn 2,621 PASS / 21 FAIL / 11 SKIP, 8 failed files; nguồn JSON bắt đầu 24/11/2026. Đây là lịch sử để bàn giao Sơn, không phải kết quả full suite trên f8da4b2.

## Evidence local ignored

`app/.out-scripts/windows-delivery/leader-retest-f8da4b2-20261125T065041Z/`:

- `context.json`, `bundle-verification.json`, `artifact-verification.json`, `focused-checks.json`, `fixture-build.json`.
- `stock-probes-result.json`, `stock-probes/*.json`: đủ 8 reports PASS.
- `legacy-locked-hidden.py`, `legacy-hidden-resources-busy/result.json`: native repro, target-hash assertions và cleanup.

Raw output/binary/resources private chỉ local ignored; không commit/push/upload. Codex chỉ cập nhật dossier sanitized, không chạy VPS hoặc dùng profile/credential thật.
