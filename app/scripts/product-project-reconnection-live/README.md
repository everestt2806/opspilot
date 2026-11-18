# E4 — readonly baseline của development VPS cũ

VPS167.71.202.116 đã hết hạn theo user ngày18/11/2026. Chưa có serving upgrade
hoặc actual GUI acceptance E4. Không tiếp tục thử credential tới IP cũ khi quyền
sử dụng đã hết. User đã cấp VPS mới; cần onboarding và baseline riêng theo
`docs/tasks/tk-s7-vps-allocation-20261118.md`, giữ provenance host key như dưới đây.

Baseline này cố ý ghim controller/revision/PG identities của máy cũ, chỉ dùng nếu
chủ máy khôi phục được đúng instance và cho phép kiểm lại. Không dùng với VPS mới
hoặc sửa UUID/CID để làm xanh gate. Không deploy/provision/mutate trên target.

Kiểm biên dịch current Main bằng Node22/Electron-as-Node, không SSH/credential:

```powershell
. ./tools/enter-node22.ps1
node app/scripts/run-as-node.js app/scripts/product-project-reconnection-live/read-only.mjs --confirm-readonly-reconnection-build
```

Khi có quyền dùng lại đúng máy cũ, `node
app/scripts/product-project-reconnection-live/read-only-launch.mjs` preflightTCP22
trước khi hỏi credential. Chỉ nhập sau PRIVATE_INPUT_READY_NO_ECHO; credential ở
RAM/stdin, không argv/env/file/report. SSH fingerprint đã xác minh độc lập vẫn bắt
buộc; không tự học key từ mạng. Snapshot chỉ gồm metadata/hashes/count, không row
data hoặc password. Timeout không được coi là baseline PASS.

Với VPS mới: đi qua onboarding/controller/target/deploy thật rồi fresh profile
reconnect/consent039 và two-UUID inspector acceptance. Không tạo fake registration
hoặc selection receipts từ metadata để bỏ qua các bước đó. Đây là E4b chưa chạy.

## Ngoại lệ operator do user cho phép18/11

User chỉ gửi IP+password cho VPS development mới và đã cho phép tự xử lý. Lần
đầu được đọc public SSH host key qua mạng không auth, ghim key trước khi gửi
password và dùng strict host verifier cho kết nối. Ghi provenance first-contact
do user cho phép, không ghi là đã đối chiếu console. Nếu key đã ghim thay đổi,
dừng và báo user; không tự học lại. Không áp dụng cho IP/instance cũ hết hạn hoặc
máy khác ngoài phạm vi. Không thay default contract/UI của app thành tự học khóa.
