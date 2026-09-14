# C08B — Thực thi rollback, completion và bảo vệ restart/failure

C08A APPROVED. Đọc pipeline.rollback/executeRollback/recordManualRollbackSuccess, index.ts,
actionLogRepository, schema, shutdown và M08. Chưa làm UI trình chiếu mới ở đây.

## Thực hiện từng bước

1. Tạo coordinator trong monitor; nhận candidate đã quyết định sau batch commit, đọc lại
   current/setting/experiment/migration/lock trước khi act. Không gọi network bên trong SQLite
   transaction kéo dài. Tái dùng pipeline để thực thi, không shell compose riêng của coordinator.
2. Thêm đường completion nội bộ typed và origin manual/monitor-auto nếu cần. Giữ public
   app:rollback signature. Pipeline hiện trả ID ngay và ghi manual trong cả success/failure;
   sửa attribution tại nguồn, không log auto success thêm vào manual success sẵn có.
3. Tạo durable attempt trước side effect bằng action_log đã có: action rollback_auto,
   status NULL khi started (schema cho phép), detail_json có source_deployment_id, target,
   alert_id, trusted method, sample IDs/seq cuối, phase và attempt/deployment correlation.
   Đây là metadata nội bộ được document, không action/status enum mới. Nếu cần update method
   repository thì thêm typed helper scoped; không sửa migrations cũ.
4. Điểm crash giữa ghi intent và tạo pipeline attempt cần nhận diện: tái khởi động chỉ
   reconcile DB/runtime read-only, không replay lệnh khi chưa rõ trạng thái. Không hứa exactly-once
   SSH. Không xác minh được thì failed/uncertain metadata + báo người dùng, không retry tự động.
5. In-flight map chống trùng trong process + durable suppression chống retry sau restart.
   Failure của incident/attempt không tự retry dù next poll vẫn high; không cập nhật success
   cooldown giả để chặn retry. Define re-arm bằng hành động rõ/new deployment và test.
6. Theo completion: success khi target image running/health đạt và DB current đúng. Cập nhật
   alert.acted và last_rollback_at, attempt log outcome nhất quán; emit system:auto-rollback
   đúng một lần cho runtime đã xác nhận. Nếu crash khi publish chưa chắc event delivered,
   UI reload từ durable log; không tạo thao tác thứ hai để bù event.
7. Failure/cancel: finalize failed/cancelled, không acted success hoặc last_rollback_at mới.
   Notification lỗi từ channels hiện có. Cooldown skip ghi suppression có giới hạn, không
   spam log mỗi sample hoặc nhầm M4 healthcheck auto với M8 monitor auto.
8. Shutdown đợi/cancel có giới hạn theo lifecycle hiện tại, cleanup listeners/maps đúng;
   không kill process ngoài scope. Bảo vệ race manual/deploy/migrate với automatic bằng app lock.

## Test / DoD

- [ ] B-T1: accept ID chưa success; delayed completion, early event, fail/cancel đúng attribution.
- [ ] B-T2: cùng batch/tick lặp/2 caller không tạo 2 attempt; current đổi giữa decision/execution.
- [ ] B-T3: crash intent-before-command, command-before-finalize, failure/restart không replay mù.
- [ ] B-T4: cooldown persistent, failure suppression khác cooldown, re-arm có test.
- [ ] B-T5: missing target/image, v1, busy/experiment active, DB finalize error không giả success.
- [ ] B-T6: manual regression và M4 auto nguyên nghĩa, monitor auto không double-log.
- [ ] B-T7: focused SQLite/pipeline/coordinator/shutdown tests + typecheck/lint/format/build.

Evidence `c08b/` + `handoff-c08b.md`: state transition table, storage fields, completion
integration và fault injection tests. Leader duyệt durable semantics trước C08C/live UI.
