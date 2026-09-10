# C02 — Metric từ VPS vào SQLite đúng và không trộn phiên bản

## Đầu vào

C01 APPROVED, collector đang ghi file. Đọc M06, schema/metric-format/IPC, monitor
repository/poller/metricSource/scheduler/service và lifecycle deployment liên quan.
Không làm chart hoặc ML model mới. Scorer có thể unavailable ở chặng này nếu được ghi rõ.

## Các bước Worker làm

1. Dùng profile/app/deployment thật của A; xác nhận target current/running, đúng app name/path.
2. Tạo/mở rộng CLI live chạy SshMetricSource + MonitorService/poller + migrations SQLite thật.
   Không sửa CLI fixture để làm bằng chứng live giả. CLI dùng secret store/env an toàn,
   không in nội dung credential; ghi command/cwd rõ để reviewer chạy lại.
3. Xác minh Electron scheduler gọi cùng service, poll theo mặc định 30s, không overlap.
4. Test byte offset 1-based/UTF-8/partial line, parser invalid line, seq order, dedupe đúng
   deployment. Retry cùng dữ liệu không thêm metric/score/alert hoặc ingest lại sai thứ tự.
5. Mất SSH → giữ offset, không sinh mẫu giả; reconnect → nạp bù. Restart collector/rotation
   fixture phải không reset seq trái contract; sửa collector nếu tái hiện lỗi liên quan.
6. Chốt ranh giới dữ liệu khi redeploy/rollback: không nhập backlog v1 thành mẫu v2. Ghi
   policy cụ thể dựa trên contract hiện có, test failure attempt và rollback chain. Nếu contract
   chưa đủ phân biệt boundary thì gửi proposal Leader, không âm thầm đoán hay vứt mọi backlog.
7. Metric insert, score rows, offset commit phải đồng bộ theo transaction. Ghi rõ giới hạn
   crash-window ML nếu chưa thuộc SQLite transaction; không tuyên bố exactly-once toàn hệ thống.

## File được sửa

`app/src/main/monitor/**`, scheduler wiring `index.ts`, deployment boundary đúng vị trí,
script live và collector bug đã tái hiện. Không sửa UI hoặc threshold/model cho đẹp dữ liệu.

## Case và DoD

- [ ] C02-T1: CLI SSH/SQLite live nhập batch mới; mỗi sample đúng 5 score rows, null ghi riêng.
- [ ] C02-T2: poll lại cùng file inserted=0, offset đúng byte, unique(deployment_id,seq).
- [ ] C02-T3: partial/invalid/UTF-8/rotation/restart/reconnect có regression và live reconnect.
- [ ] C02-T4: live redeploy/rollback + regression không trộn backlog giữa deployment.
- [ ] C02-T5: scheduler thật được quan sát; shutdown không overlap/treo/open handle mới.
- [ ] C02-T6: focused ingestion/deploy-boundary tests + typecheck/lint/format, build nếu wiring đổi.

## Evidence và review

`c02/ingestion.md`: target IDs, sample seq/time range, trước/sau count/offset, SQL invariant,
retry/reconnect kết quả, source-file bytes; handoff-c02.md. Leader so SQL/raw JSON và lifecycle,
không approve chỉ từ “150 metrics/750 scores”. ML score số thật thuộc C03.
C02 APPROVED mới mở C03; đồng thời đủ bằng chứng đề nghị khép readFileTail TK-A5/TK-S4 phần dữ liệu.
