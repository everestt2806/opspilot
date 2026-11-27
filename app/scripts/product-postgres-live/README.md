# PostgreSQL controller rollout — R7h-4b2

Đây là gate vận hành **chỉ nâng controller35→37**, chưa triển khai app PostgreSQL và chưa đóng toàn R7h-4b2. Sáu app đang chạy, helper/source/env/CID giữ nguyên. Không dùng hồ sơ Electron hiện hữu và không mở public admin port.

Chỉ chạy sau khi candidate proof `docs/ui-redesign/r7h4b2-candidate-verification.json` đã PASS: exact cc8f33f release /32167c9 payload/ac6fc27 installer, native public Git+SSHD readiness8checks, Root19/Main19, pipeline49attempts, full/types/lint/build và resource9entries đúng pin. Capacity catalog16 không tự cấp approval. Thay source/artifact phải chạy lại gate tương ứng; không sửa pin để vượt kiểm tra.

Windows Node22:

```powershell
node app/scripts/product-postgres-live/launch.mjs --start
```

Chỉ nhập credential JSON sau `PRIVATE_INPUT_READY_NO_ECHO`. Không password/private key trong argv/env/file/log. Launcher chuyển RAM stdin sang Electron-as-Node; profile riêng có DPAPI key và AES-GCM ciphertext. Unknown giữ profile, UUID và evidence; không tạo UUID khác, re-enroll hoặc sửa SQL. `--resume <nonce>` chỉ inspect state đã biết; sau khi kiểm tra rõ nguyên nhân mới dùng `--transfer-controller` hoặc `--recover-controller` với cùngUUID. Không dùng journal đã PASS.

Luồng: fresh pinned SSH baseline35/currentd89/release3782655/sáu app12CID/paused0active → Main adoption/scoped client → durable upgradeUUID/transfer/upgrade/inspect → binding refresh giữ token/client → schema37 ready → Root-sealed backup35/hash/mode0440+dir0550 khớp journal → original helpers/source/env/CIDs và sáu HTTP200 không đổi → revoke client → đóng SSH/SQLite rồi chỉ dọn private profile đúng nonce. App PG/1000rows/update/rollback/backup acceptance dùng checkpoint kế tiếp, không giả DONE từ việc nâng schema.
