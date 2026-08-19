# TK-A10 — M1: chẩn đoán lỗi kết nối VPS (5 lớp lỗi + gợi ý sửa tiếng Việt)

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 21/08/2026 | feat/m01-connect-diagnostics | `docs/prompts/m01-ssh-manager.md`, UX lỗi `docs/02` quy tắc 3 | P0 |

## Mục tiêu

Trả về **nguyên nhân + cách sửa bằng tiếng Việt** khi `vps:test-connection` không kết nối
được, để người mới không phải đoán. Case mẫu 19/08: firewall WiService mặc định chặn toàn bộ
inbound — máy báo Running, TCP timeout toàn bộ cổng, mất cả tiếng mới tìm ra. App phải phân
loại được trường hợp này và in hướng dẫn ngay.

5 lớp lỗi (thứ tự xét từ nhẹ đến nặng):

1. `HOST_NOT_FOUND` — DNS/địa chỉ sai (ENOTFOUND, EHOSTUNREACH): "Kiểm tra lại IP/domain".
2. `PORT_TIMEOUT` — TCP connect timeout mọi cổng thử: nghi **tường lửa chặn inbound** hoặc
   máy tắt. Gợi ý: mở rule firewall cho cổng 22 (case WiService), kiểm tra máy đang Running.
3. `PORT_CLOSED` — ECONNREFUSED: máy lên nhưng cổng SSH không nghe → sai cổng / sshd tắt.
4. `SSH_AUTH_FAILED` — cổng mở, handshake xong nhưng bị từ chối → sai mật khẩu/key.
5. `SSH_HANDSHAKE_TIMEOUT` — cổng mở nhưng không phản hồi bản tin SSH → không phải SSH /
   mạng chậm.

Mỗi lớp kèm `diagnosis: { code, title, cause, fixes[] }`. Sửa đúng **một field tùy chọn**
thêm vào `VpsConnectionCheck` (thêm, không đổi field cũ; khi OK thì `diagnosis = null`).

## Được sửa

- `app/src/main/ssh/**` — file `diagnose.ts` mới (TCP probe + phân lớp) nối vào handler
  `vps:test-connection`.
- `docs/contracts/ipc-contract.ts` + bản copy `app/src/shared/ipc.ts` (khai báo `diagnosis` —
  theo quy trình đổi contract: báo rõ + sửa contract + 1 dòng DECISIONS).
- `app/scripts/try-ssh.ts` — bước 0 mới: in chẩn đoán cho các kịch bản lỗi; test của các file trên.

## Không được sửa

- `app/src/renderer/**` (TK-B7 hiển thị diagnosis), `ml-service/**`, `collector/**`.

## Definition of Done

- [x] Probe TCP phụ trước SSH phân loại đúng 5 lớp (15 test mới `diagnose.test.ts`, kể cả case "timeout mọi cổng")
- [x] Handler `vps:test-connection` kèm `diagnosis`; lỗi có title/cause/fixes tiếng Việt rõ
- [x] Không log secret; khi kết nối OK thì không có `diagnosis` (trường tùy chọn — không đổi hành vi cũ)
- [x] Case mẫu firewall WiService tái hiện được BẰNG MOCK (unit test) VÀ THẬT trên VM01 (cổng 30005 bị chặn bởi firewall WiService → app kết luận `PORT_TIMEOUT` trong ~8 giây)
- [x] `pnpm try:ssh` bước 0 chạy; các bước 1–6 vẫn xanh (7/7 trên VM01 221.121.1.79)
- [x] `docs/contracts/ipc-contract.ts` + `app/src/shared/ipc.ts` giống hệt nhau; 1 dòng DECISIONS

## Nhật ký

- START 19/08 — task hệ quả quyết định demo 24/08 (người dùng chốt: A làm hết tuần này;
  bài toán "detect lỗi kết nối VPS" đứng đầu demo — case mẫu firewall WiService).
- UPDATE 19/08 — hoàn thành toàn bộ DoD; PR #14. `diagnose.ts` mới: probe TCP trước SSH
  (chính 3s + phụ 80/443 khi chính timeout để phân biệt "firewall chặn hết" với "chỉ chặn SSH"),
  phân lớp → `VpsDiagnosis` 5 mã + gợi ý sửa tiếng Việt. `testConnectionWithCredentials` trả
  kèm `diagnosis` khi lỗi; lỗi lạ vẫn throw như cũ. `try:ssh` thêm bước 0; khi không tới được
  máy thì SKIP 6 bước sau (trước đây mỗi bước retry SSH ~1 phút — thử case này chết vì hết 5 phút).
  Bằng chứng VPS thật: healthy 7/7; chặn firewall (port 30005) → kết luận "Mọi cổng đều im lặng —
  nghi firewall chặn toàn bộ inbound" + gợi ý mở rule SSH trong ~8 giây. Test 45/45 · lint ·
  typecheck xanh (kèm `.out-scripts` vào eslint ignores/.gitignore).
  PR #14 merge main. → HOÀN THÀNH.

## Lệnh tái hiện

```bash
# VPS sẵn sàng — bước 0 PASS, 1–6 xanh:
OPSPILOT_SSH_HOST=221.121.1.79 OPSPILOT_SSH_PORT=22 OPSPILOT_SSH_USER=deploy \
OPSPILOT_SSH_AUTH_TYPE=key OPSPILOT_SSH_SECRET="$(cat "$HOME/.ssh/opspilot_ed25519")" pnpm try:ssh

# Case firewall (cổng không mở rule): app tự kết luận nguyên nhân ~8s
OPSPILOT_SSH_HOST=221.121.1.79 OPSPILOT_SSH_PORT=30005 OPSPILOT_SSH_USER=deploy \
OPSPILOT_SSH_AUTH_TYPE=key OPSPILOT_SSH_SECRET="$(cat "$HOME/.ssh/opspilot_ed25519")" pnpm try:ssh

cd app && pnpm test   # 45/45 (15 test chẩn đoán)
```

## PR

- #14 — feat/m01-connect-diagnostics