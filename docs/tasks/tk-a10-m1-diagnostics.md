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

- [ ] Probe TCP phụ trước SSH phân loại đúng 5 lớp (unit test, kể cả case "timeout mọi cổng")
- [ ] Handler `vps:test-connection` kèm `diagnosis`; lỗi có title/cause/fixes tiếng Việt rõ
- [ ] Không log secret; khi kết nối OK thì `diagnosis: null` (không đổi hành vi hiện tại)
- [ ] Case mẫu firewall WiService tái hiện được bằng mock (TCP connect timeout, không RST)
- [ ] `pnpm try:ssh` bước 0 chạy; các bước 1–6 vẫn xanh
- [ ] `docs/contracts/ipc-contract.ts` + `app/src/shared/ipc.ts` giống hệt nhau; 1 dòng DECISIONS

## Nhật ký

- START 19/08 — task hệ quả quyết định demo 24/08 (người dùng chốt: A làm hết tuần này;
  bài toán "detect lỗi kết nối VPS" đứng đầu demo — case mẫu firewall WiService).

## Lệnh tái hiện

```bash
# (điền khi có code) — bước 0 chẩn đoán:
OPSPILOT_SSH_HOST=... pnpm try:ssh
```

## PR

— (chưa có)