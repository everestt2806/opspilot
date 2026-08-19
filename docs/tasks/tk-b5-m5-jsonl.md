# TK-B5 — M5: ghi metrics.jsonl + latest.json chu kỳ 10s

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 19/08/2026 | feat/m05-collector-output | `docs/prompts/m05-collector.md`, `contracts/metric-format.md` | P1 |

## Mục tiêu

Đầu ra của collector: append từng mẫu vào `metrics.jsonl` (append-only, không ghi đè) mỗi 10s,
kèm `latest.json` cho trạng thái tức thời. A (TK-A5) đọc `metrics.jsonl` này bằng readFileTail
để nghiệm thu luồng file.

## Được sửa

- `collector/**` (của B).

## Không được sửa

- `docs/contracts/metric-format.md`.

## Definition of Done

- [ ] Mỗi dòng JSONL khớp contract, có `seq` tăng dần liên tục
- [ ] Chu kỳ đúng 10 giây (ADR-007)
- [ ] Chạy 10 phút local không mất dòng, không trùng `seq`
- [ ] `latest.json` phản ánh mẫu mới nhất
- [ ] A chạy readFileTail đọc được file này (bước chung với TK-A5)

## Nhật ký

- START 19/08 — dự kiến trong ngày.

## Lệnh tái hiện

```bash
# (điền khi có code) — chạy 10 phút rồi kiểm tra:
tail -3 metrics.jsonl && cat latest.json
```

## PR

— (chưa có)