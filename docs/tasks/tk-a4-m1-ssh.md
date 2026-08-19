# TK-A4 — M1: SSH connect/exec + timeout + auth fail + TOFU

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 17/08/2026 | feat/m01-ssh-connect-exec | `docs/prompts/m01-ssh-manager.md` | P0 |

## Mục tiêu (FR-A1)

SshManager với pool kết nối, `exec` có timeout phá channel, retry 1s/2s/4s, lỗi credential rõ
ràng (`SSH_AUTH_FAILED`, không log secret), host key TOFU theo D6. Chạy được độc lập bằng
`app/scripts/try-ssh.ts` trước khi nối UI.

## Được sửa

- `app/src/main/ssh/**`, `app/scripts/try-ssh.ts`, test của chúng.

## Không được sửa

- `docs/contracts/**`, `app/src/renderer/**`.

## Definition of Done

- [ ] Unit test: auth fail trả `SSH_AUTH_FAILED`; timeout hủy channel; retry đúng 1s/2s/4s
- [ ] Hàm/tên khớp contract (ipc-contract.ts)
- [ ] `pnpm try:ssh` 6 bước trong script chạy xanh với VPS local mock
- [ ] **Chạy `pnpm try:ssh` với VPS thật: `docker --version` thành công** (bước cuối, chờ TK-S2)
- [ ] Không log secret nào

## Nhật ký

- START 17/08 — dựng SshManager + try-ssh theo brief m01.
- UPDATE 18/08 — code + unit test local xong, 6 bước try-ssh xanh với mock; mở PR #9.
- REVIEW 18/08 — PR: #9 · test xanh · điểm chú ý: TOFU flow hỏi fingerprint lần đầu.
- UPDATE 19/08 — còn đúng 1 mục DoD: chạy `docker --version` trên VPS thật.
  Điều kiện gỡ: TK-S2 xong nghiệm thu → không cần đổi code.

## Lệnh tái hiện

```bash
# mock local:
OPSPILOT_SSH_HOST=127.0.0.1 OPSPILOT_SSH_PORT=2222 OPSPILOT_SSH_USER=deploy \
OPSPILOT_SSH_AUTH_TYPE=password OPSPILOT_SSH_SECRET=*** pnpm try:ssh
# VPS thật (ví dụ):
OPSPILOT_SSH_HOST=<ip> OPSPILOT_SSH_PORT=22 OPSPILOT_SSH_USER=deploy \
OPSPILOT_SSH_AUTH_TYPE=key OPSPILOT_SSH_SECRET="$HOME/.ssh/opspilot_ed25519" pnpm try:ssh
```

## PR

- #9 — feat/m01-ssh-connect-exec (đã mở, chờ merge sau khi nghiệm thu VPS thật)