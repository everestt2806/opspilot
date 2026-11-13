# R7h-1 — Product environment vault CLI

Linux/WSL, Node22 và approved Linux modules riêng; không dùng Windows SQLite ABI.
Không SSH/Docker/VPS hoặc production profile. Key và SQLite được tạo private
trong scratch riêng; kết thúc dọn đúng thư mục sở hữu. Secret chỉ là random
synthetic marker, không credential thật và không ghi value vào report.

```sh
export OPSPILOT_R1_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules
export OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r7h1-env.cjs
node app/scripts/product-environment-lab/run.mjs --confirm-local-environment-store
```

Gate build current entry bằng approved esbuild, SQL raw loader, external Linux
dependencies. Kiểm missing key không tạo ngầm; explicit init một lần, unsafe
mode từ chối/khôi phục bytes; real AES-GCM→SQLite032→reopen, metadata không value,
plaintext marker không nằm trong DB, staging không đổi source/policy/job; wrong
key/actual SQL auth-tag tamper/changed target từ chối. Đây là kho staged revision,
không source activation hoặc deploy env/DB proof. Report ignored tại
`app/.out-scripts/product-environment-lab/<nonce>/result.json`.

Windows kiểm Node/Web types và:
`pnpm --prefix app exec tsc --noEmit -p scripts/product-environment-lab/tsconfig.json`.
Desktop hiện tại sau migration032 có max32; controller role bỏ030/031 nhưng áp dụng032.
Installed VPS vẫnschema029/releaseb680 vì chưa rollout. Upgrader hiện giữ schema
guard; cần protocol/backup/migration native gate riêng trước rollout schema mới,
không ghi trực tiếp DB trên VPS hoặc thay pin để né guard.
