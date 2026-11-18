# Phân bổ VPS mới — 18/11/2026

User đã cấp4VPS mới. Sơn/assistant chỉ dùng máy1+2; máy3+4 dành Kim.
Đã đọc public host key của cả4. Sau đó chỉ đăng nhập1+2 để kiểm inventory, chưa cài đặt;
máy3+4 vẫn chưa đăng nhập bằng password hoặc quản trị.
Không lưu password trong repo, artifact hoặc log.

| Máy | IP | Owner / phạm vi | SSH ED25519 fingerprint SHA256 |
|---|---|---|---|
| 1 | 157.245.195.121 | Sơn/assistant: development và nghiệm thu E4b | SHA256:d1XH2CiZnh4Dy/AoIbI1n3Uo2N1je86U2Wsy3orvxA4 |
| 2 | 188.166.234.163 | Sơn/assistant: development và nghiệm thu E4b | SHA256:jWmoAjdWENXxC2bmfEtx9g85HvjGt7P6mfaRn83XnZ0 |
| 3 | 159.89.204.206 | Kim; assistant chỉ đọc public host key theo yêu cầu | SHA256:l0oKX3LDlIZu3gsjm281BTL/FoLejuVnhyQayBeNrIA |
| 4 | 168.144.245.131 | Kim; assistant chỉ đọc public host key theo yêu cầu | SHA256:3uX6Okns7irl3wvuGq6sAY0/dFJIvhDk394eufkT+EE |

Username root, SSH port22 theo thông tin user. Fingerprint được lấy qua mạng lần
đầu bằng ssh-keyscan, tính hash và đối chiếu bằng OpenSSH ssh-keygen; provenance
là first-contact do user cho phép, không phải xác minh độc lập qua console.
Ghim trước khi gửi password; key đã ghim thay đổi thì dừng/báo user, không tự thay.

Inventory1+2 qua production auto-pin/create/encrypted profile/strict SshManager đã
PASS: Ubuntu24.04.5/x64/glibc2.39,2CPU/~4GBRAM/~80GBdisk, chưa Docker/controller;
private credential DB/key fixture đã dọn. [Proof UX1](../ui-redesign/ux1-vps-onboarding-verification.json).
E4b vẫn cần fresh install/deploy và actual reconnection/inspector trên máy1+2.
Không tái sử dụng UUID/CID/receipt/data claims của VPS167 đã hết hạn.
Không tự cài đặt hoặc đổi cấu hình máy3+4. Đây không phải bằng chứng đã đủ cặp
VPS/config/provider/dedicated workload cho giao thức ML chính thức.
