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

- [x] Mỗi dòng JSONL khớp contract, có `seq` tăng dần liên tục
- [x] Chu kỳ đúng 10 giây (ADR-007) — xác nhận ở lần chạy 10 phút: 63 gap đều đúng 10,0s
- [x] Chạy 10 phút local không mất dòng, không trùng `seq` (64 dòng/10,5 phút — chi tiết nhật ký 01/09)
- [x] `latest.json` phản ánh mẫu mới nhất
- [ ] A chạy readFileTail đọc được file này (bước chung với TK-A5)

## Nhật ký

- START 19/08 — dự kiến trong ngày.
- UPDATE 19/08 — **Lùi W2** cùng chuỗi collector (quyết định dồn lực demo 24/08). Hạn dời
  27/08. Hệ quả: TK-A5 (A) vẫn BLOCKED chờ file này — khép ngay sau khi B5 có JSONL thật.
- ASSIGNED 30/08 — Rebaseline hạn 02/09; chỉ kéo sau khi TK-B4 vào review. Output là điểm nối
  chính thức với TK-A16/TK-A5, không đổi `metric-format.md`.
- START 01/09 — kéo trước khi B4 sang review theo chỉ đạo của B (B4 code+push `fe1da33` đã xong).
  Nhánh `feat/m05-collector-output` đứng trên tip TK-B4. Phần ghi file đã có từ scaffold TK-B1
  → B5 củng cố: `read_last_seq` chỉ đọc đuôi file + test đường ghi + bằng chứng chạy 10 phút.
- UPDATE 01/09 — `read_last_seq` đổi sang đọc đuôi 8KB (không nạp cả file 50MB khi restart; vẫn
  đúng khi dòng cuối viết dở hoặc dòng rác). Thêm 5 test: append tuần tự + `latest.json` =
  dòng cuối, rotation sang `.1` không đứt thứ tự, dòng >4KB bị chặn không làm hỏng file,
  seq hồi phục sau dòng viết dở, chỉ đọc cửa sổ đuôi. pytest 26/26 xanh.
- SMOKE 01/09 — PASS. Chạy thật 10,5 phút local (container testapp nginx, `APP_URL` =
  `http://localhost:8080/`): 64 dòng, ts `14:47:35Z` → `14:58:05Z`, `seq` 1..64 liên tục
  không mất/không trùng, 63 gap đều đúng 10,0s, `latency_ms` có giá trị thật cả 64 mẫu,
  `container_up` = 1 suốt, `http_error_rate` = 0, `latest.json` khớp dòng cuối, dòng to nhất
  292 byte. Đủ bằng chứng DoD "không mất dòng, không trùng seq". Còn DoD cuối: A chạy
  readFileTail nghiệm thu (bước chung TK-A5).

## Lệnh tái hiện

```bash
cd collector
python -m pytest tests -q
# chạy thật ~10 phút (DoD): app giả nginx + APP_URL, xong kiểm tra:
#   số dòng ~60, seq 1..N liên tục, ts cách đúng 10s
#   tail -3 metrics.jsonl; cat latest.json
```

## PR

— (chưa có)
