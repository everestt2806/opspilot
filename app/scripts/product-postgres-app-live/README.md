# PostgreSQL app acceptance trên VPS phát triển

Gate nội bộ sau controller-only `afcd6e9`: schema37/current aaf2d779/releasecc8/payload32167, sáu app cũ không đổi. Không dùng hồ sơ desktop thật, không tạo public admin port. Credential chỉ no-echo stdin/RAM và profile riêng DPAPI/AES-GCM; không argv/env/file thuần/log.

Windows Node22: `node app/scripts/product-postgres-app-live/launch.mjs --start`. Chỉ gửi JSON credential sau `PRIVATE_INPUT_READY_NO_ECHO`. Khi lỗi giữ nguyên nonce/private profile/UUID: `node app/scripts/product-postgres-app-live/launch.mjs --resume <nonce>`. Không dùng journal PASS hoặc tạo UUID thay cho thao tác có kết quả unknown.

Luồng: fresh SSH pin + schema/Root release/sáu app12CIDs/quiescence → Main adopt/scoped client/register app Git nonce riêng/enroll helper hiện hành → Unix997 CLI prepare/review/select PostgreSQL bằng đúng source/target authority → actual public Git verification/readiness → Main manual command có scope và specific SHA đã quan sát. Bốn lượt initial/update/health-fault/final: health rollback phải giữ đúng container/volume/system identifier và1.000rows; signed H2 terminal đã settle/release leases. Sáu app cũ/helpers/source/env/key/DB inode giữ nguyên, HTTP200. Policy mọi app paused; revoke scoped client, đóng SSH/DB rồi dọn đúng private profile nonce.

Đây là kiểm chứng operator nội bộ. Main chưa có journal chọn PG; script không fake ENV receipt/tự sửa pin SQL để vượt source CAS. Không gọi kết quả này là GUI first-deploy PostgreSQL. Logical backup/operator restore/instance UI vẫn OPEN; proof chỉ ghi những gate thực sự chạy.

Sau app record PASS và private profile đã dọn:

- `node app/scripts/product-postgres-app-live/inspect-launch.mjs <nonce>`: fresh SSH pin, schema/release/current app/paused0jobs và metric database mới ≤90s. Credential chỉ RAM, không ghi profile.
- `node app/scripts/product-postgres-app-live/backup-launch.mjs <nonce>`: local durable UUID trước SSH, Root-only private archive ≤64MiB/60s bằng application pgpass; đối chiếu current source/database/paused0clients0leases, chỉ phục hồi sang clone riêng pinned image/networknone/tmpfs. So sánh count/content, dọn đúng CID+label clone và giữ archive Root0600. Unknown giữ intent/slot; cùngUUID chỉ đọc receipt hoàn tất, không dump/restore lại. Không dùng như product backup API hoặc restore vào database đang chạy.

Raw result/metrics/backup nằm tại ignored `app/.out-scripts/product-postgres-app-live/<nonce>/`. Public proof chỉ metadata/hash, không token/credential/dump data. App PG thật hiện là `pg-live-f3ba42f10b94`, cổng30006, policy paused.
