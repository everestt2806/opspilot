# TK-B5 — M5: ghi metrics.jsonl + latest.json chu kỳ 10s

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 02/09/2026 | feat/m05-collector-output | `docs/prompts/m05-collector.md`, `contracts/metric-format.md` | P0 |

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
- UPDATE 19/08 — **Lùi W2** cùng chuỗi collector (quyết định dồn lực demo 24/08). Hạn dời
  27/08. Hệ quả: TK-A5 (A) vẫn BLOCKED chờ file này — khép ngay sau khi B5 có JSONL thật.
- ASSIGNED 30/08 — Rebaseline hạn 02/09; chỉ kéo sau khi TK-B4 vào review. Output là điểm nối
  chính thức với TK-A16/TK-A5, không đổi `metric-format.md`.

## Lệnh tái hiện

```bash
# (điền khi có code) — chạy 10 phút rồi kiểm tra:
tail -3 metrics.jsonl && cat latest.json
```

## PR

— (chưa có)
