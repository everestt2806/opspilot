# Gate PostgreSQL riêng tư

Các script này dùng SQLite/key/SSHD/Docker fixture có nonce riêng. Không nhận credential VPS, không dùng DB production. Giữ bằng chứng lỗi, chỉ dọn resource xác định thuộc fixture.

## Actor Docker

```powershell
. ./tools/enter-node22.ps1
node app/scripts/product-postgres-lab/docker.mjs --confirm-local-postgres-runtime
```

Wrapper dùng image Linux lab đã pin, Docker socket và volume scratch riêng để bind path thuộc đúng daemon. Gate chạy PostgreSQL16 thật,1000rows, cold reopen/restart, mất phản hồi create/DDL, quyền app, pg_dump và restore clone. Có thể chạy trực tiếp `runtime.py --confirm-local-postgres-runtime` trong Linux có Python/Docker; script tự cleanup đúng label/CID/UUID.

## CLI và schema

Linux Node22, approved Linux modules và Root riêng trong lab:

```sh
export NODE_PATH=/var/tmp/opspilot-p3e3a-runtime/node_modules
export OPSPILOT_CONTROL_PLANE_MODULES="$NODE_PATH"
export OPSPILOT_CONTROL_PLANE_OUTPUT=/private/scratch/payload/control-plane.cjs
node app/scripts/build-control-plane.mjs
node app/scripts/product-postgres-lab/prepare.mjs --confirm-local-postgres-preparation
node app/scripts/product-postgres-lab/schema.mjs --confirm-local-postgres-schema
```

`prepare.mjs` tạo helper fixture từ entry.ts **ngoài payload đã hash**, xác minh bundle, kiểm tra từ chối035/missing key/wrong key và hai CLI process cạnh tranh. `schema.mjs` chỉ chứng minh backup/transaction/filesystem35↔37, không phải installed-service Root/systemd rollout. Controller mới khởi tạo037; Desktop vẫn036. Controller035 đã tồn tại phải qua Root upgrade tường minh, opener không tự migrate. Không chạy fixture này trên data directory thật.

Pipeline đầy đủ nằm ở `product-runtime-lab/run.mjs`:

```sh
node app/scripts/product-runtime-lab/build.mjs
node app/scripts/product-runtime-lab/run.mjs --postgres --environment --trace
node app/scripts/product-runtime-lab/run.mjs --postgres --environment --env-before-database --trace
node app/scripts/product-runtime-lab/run.mjs --postgres --environment --nextjs --trace
```

Cần `OPSPILOT_R1_MODULES`, `OPSPILOT_R1_ARTIFACT` và môi trường Linux Root/Node22/SSHD/Docker như README của lab đó. SPA từ chối PostgreSQL. Thử nghiệm dùng source Git local xác minh, không chứng minh Git push/webhook hoặc external Internet probe.

## R7h-4b: CLI chọn database qua SSH thật

```sh
node app/scripts/product-postgres-lab/selection.mjs --confirm-local-postgres-selection
python3 -m unittest discover -s app/scripts/product-postgres-lab -p test_io.py -v
```

`selection.mjs` yêu cầu Root/Linux Node22 + artifact/modules như trên. Tạo SSHD/key/SQLite/target có nonce riêng; gọi production CLI prepare/review/select/selection-state. Kiểm actual helper bytes/key/HMAC, helper tamper, pin sai, no-op replay khi SSHD đã tắt, không job/enable policy và cleanup. Không chạy Docker hay tạo database đang phục vụ; metadata chỉ `prepared`, không giả `ready`. IO tests chạy process Linux thật và inject lỗi stream read/close để xác nhận kết quả không bị nhận nhầm là thành công.
