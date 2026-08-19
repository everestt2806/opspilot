# TK-B6 — M5: chạy collector bằng Docker trên VPS

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 28/08/2026 | feat/m05-collector-docker | `docs/prompts/m05-collector.md`, `docs/08-vps-setup.md` | P1 |

## Mục tiêu

Đóng gói collector vào container Alpine (script ~150 dòng, theo quy tắc bất biến 8) và chạy
thật trên ít nhất 1 VPS, ghi vào `/opt/opspilot/<app>/metrics/`. Đây là một nửa cột "hai VPS
dùng được" của gate G0.

## Được sửa

- `collector/Dockerfile`, `collector/**` (của B).

## Không được sửa

- `docs/08-vps-setup.md` (của nhóm — sửa thì báo); không chạy lệnh phá hủy trên VPS.

## Definition of Done

- [ ] Image build được trên VPS, kích thước hợp lý (Alpine)
- [ ] Container chạy ≥10 phút trên VPS thật, sinh đúng JSONL trong `/opt/opspilot/<app>/metrics/`
- [ ] Restart policy hợp lý; không mở thêm port trên VPS
- [ ] Báo A để A nghiệm thu readFileTail trên file thật (khép TK-A5)

## Nhật ký

- START 20/08 — VPS đã mua từ 19/08 (TK-S2), điều kiện cần đã có.
- UPDATE 19/08 — **Lùi W2** cùng chuỗi collector (quyết định dồn lực demo 24/08). Hạn dời
  28/08; VPS vẫn sẵn sàng (2 máy nghiệm thu 6/6) nên không mất điều kiện gì.

## Lệnh tái hiện

```bash
ssh deploy@<ip> 'cd /opt/opspilot/<app> && docker compose up -d collector && sleep 5 && docker compose ps'
ssh deploy@<ip> 'wc -l /opt/opspilot/<app>/metrics/metrics.jsonl'
```

## PR

— (chưa có)