# E4a — kiểm bản phát hành nhận lại dự án

Descriptor mới: `desktop-project-reconnection-release.json`. Không thay pin cũ.
Source freeze, hai build độc lập và snapshot11release cũ nằm tại
`docs/ui-redesign/r7h4e4-freeze-verification.json`.

Build Linux x64 với Node22.23.4/glibc2.39 và dependency lock đã duyệt. Các script
`build-control-plane.mjs`, `build-controller-release.mjs`,
`build-controller-installer.mjs` nhận output directory mới và module directory
đã duyệt như README của release lab trước. Builder phải chạy dưới UID sở hữu input,
không bỏ ownership guard. Đối chiếu hai build với pin trong freeze proof; giữ nguyên
998file và installer. Binary resources ignored, không tự có sau clone.

Copy release/installer vào
`app/resources/controller-releases/linux-x64-node22-20261118-project-reconnection/`.
Sau `pnpm --prefix app build`, chạy Node22:

```powershell
node app/scripts/product-project-reconnection-release-lab/run.mjs --confirm-project-reconnection-resources
```

Gate đọc compiled verifier/catalog thật, kiểm12release và giữ11pin cũ; installer
và payload phải đúng hash. Runtime catalog không được ghi đè pin đã compile;
installer bị sửa hoặc thiếu bị từ chối trước thực thi. Chỉ copy/tamper/dọn scratch
nonce riêng, không chạy installer hoặc dùng VPS. Raw result ở
`app/.out-scripts/r7h4e4-resources.json`.

Native gates riêng: source/admin/Docker PG, Root35→37, Main37→37 từ cả4bc và63d1;
thêm `OPSPILOT_RECONNECTION_NATIVE_GATE=1` và
`OPSPILOT_RECONNECTION_INSPECTOR_NATIVE_GATE=1` cho Main lab. Inspector case dùng
PG prepared/target chưa enroll nên phải NOT_READY; đây không phải positive runtime
inspection. Không chạy các native service lab hoặc full Windows suite đồng thời
trên cổng8768. Tất cả fixture phải có cleanup proof.

E4a không nâng VPS. VPS cũ đã hết hạn theo user ngày18/11; E4b cần hạ tầng mới và
baseline mới. Không áp dụng UUID/CID/receipt lịch sử của máy cũ cho máy mới.
