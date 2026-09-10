# Bàn giao và review — TK-A17

> Mẫu đang chờ Worker. Không có test/runtime PASS mới trong phiên lập plan 10/09.
> Giữ các mục R1/R2/R3 riêng và append lịch sử; không ghi đè kết quả cũ mất dấu.

## Trạng thái hiện tại

- Owner: A solo; Worker: chưa bắt đầu; Leader: đã lập plan.
- Baseline code: `683bfc6` (main sau PR #25/#26/#28).
- Branch plan: `plan/a17-demo-checkpoint`; branch implementation dự kiến: `feat/a17-demo-checkpoint`.
- Outcome: PLANNED; demo dự kiến 13/09, đóng băng 12/09.
- B6 có report ngoài main: `dfc0ed7`; chưa có xác minh VPS mới từ A17.

## Mẫu bàn giao mỗi chặng (Worker sao chép)

### Rn — GATE / ngày giờ

- Outcome: READY_FOR_LOCAL_REVIEW / BLOCKED.
- Branch / baseline / code HEAD / docs HEAD:
- Commit và mô tả thay đổi tiếng Anh dạng bullet:
- File đã đổi và lý do:
- GitNexus flow/impact hoặc fallback bằng chứng source:

| Check                  | Command + cwd + runtime | Exit / count | Evidence | PASS/FAIL/NOT_RUN |
| ---------------------- | ----------------------- | ------------ | -------- | ----------------- |
| Focused                | Chưa chạy               | —            | —        | NOT_RUN           |
| Typecheck/lint/format  | Chưa chạy               | —            | —        | NOT_RUN           |
| Full suite / build     | Chưa chạy               | —            | —        | NOT_RUN           |
| Collector / ML pytest  | Chưa chạy               | —            | —        | NOT_RUN           |
| Live SSH + SQLite + ML | Chưa chạy               | —            | —        | NOT_RUN           |
| UI / rehearsal         | Chưa chạy               | —            | —        | NOT_RUN           |

- Manifest: VPS/app/path/port/container/deployment IDs; không secret.
- Dữ liệu: range seq/time, số mẫu, duplicates, offset, score null/non-null, trạng thái train.
- Fault: endpoint/setting/thời điểm bật-tắt; latency/status thật, alert mở/đóng/label.
- Rollback: attempt/current/runtime image, kết quả health và marker DB trước/sau.
- Ảnh/video và kịch bản tái hiện:
- Máy/VPS đang để ở trạng thái nào; fault còn bật không; app/collector/ML process nào còn chạy:
- Việc đã dọn, phạm vi và cách phục hồi (nếu có):
- Vấn đề chưa giải quyết, tác động demo, cách tái hiện:
- Checkpoint kế tiếp / cần reviewer quyết định:
- Untracked/stash của A được giữ nguyên:
- CHƯA PUSH — CHƯA MỞ PR — CHƯA MERGE.

### Review của Leader (Worker không tự điền kết luận)

- Reviewed code SHA:
- Verdict: APPROVED_GATE / CHANGES_REQUESTED / BLOCKED.
- Findings: ID, mức P0/P1/P2, file/line, trigger, expected/actual, cách kiểm chứng sửa.
- Điều kiện mở checkpoint tiếp theo hoặc P1:

### REVIEW-FIX của Worker

| Finding | Fix commit | Regression / lệnh | Kết quả | Reviewer xác nhận |
| ------- | ---------- | ----------------- | ------- | ----------------- |
| Chưa có | —          | —                 | —       | Chờ review        |

## Gate cuối cùng

- [ ] G1 APPROVED: collector deploy + live SQLite + ML thật.
- [ ] G2 APPROVED: Monitor/alert/label/settings/versions/rollback thật.
- [ ] G3 APPROVED: test gate + hai rehearsal + evidence + runbook.
- [ ] P1: APPROVED hoặc DEFERRED có lý do, UI/lời demo khớp khả năng thật.
- [ ] Leader xác nhận DEMO_READY đúng SHA; không đồng nghĩa toàn bộ dự án hoàn thành.
- [ ] Merge + DoD đủ bằng chứng thì mới đổi board HOÀN THÀNH.
