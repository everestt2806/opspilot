# C06 — Sự cố thấy được, cảnh báo hiểu được, trước/sau có số đo

## Đầu vào

C05 APPROVED, current deployment có baseline/model sạch theo C03. Đọc M06/M07/M12,
IPC alert/settings, rule/AlertTracker và demo fault endpoints. Chưa thực hiện rollback.

## Các bước Worker làm

1. Helper `status/fault/reset` dùng SSH + manifest app demo, không UI fault IPC mới. Opt-in
   `ENABLE_FAULT_ENDPOINTS`, giới hạn timeout và finally reset; log UTC start/reset/outcome.
   Ghi thông báo mô phỏng sự cố rõ trong runbook/trang demo khi áp dụng.
2. Kịch bản chính latency 2400ms với business probe `/items?limit=1`, `/health` vẫn 200.
   Website C04 cũng gọi business endpoint để người xem thấy chậm; phân biệt browser vs probe.
3. Baseline sạch → fault sau train → metric mới → alert mở → reset → alert resolved. Không
   ép tất cả model trigger; chỉ report method thực sự phát hiện và score thời điểm đó.
4. Incident card diễn giải từ dữ liệu: threshold, giá trị, số mẫu/thời gian. Nếu detail thiếu
   thì câu trung tính, không bịa root cause hoặc chẩn đoán “DB hỏng” từ latency chung.
5. Alert label Đúng/Sai qua IPC, optimistic update rollback khi save fail, reload đọc nhãn DB.
   Re-fetch có giới hạn để peak/resolved mới hiển thị; alert rows khác score rows.
6. Drawer chỉnh rule threshold/consecutive, train-now <150 có lỗi rõ. Nếu poll_interval cho
   sửa phải scheduler thực thi và test; nếu chưa thì read-only. Collector interval read-only
   khi chưa cập nhật VPS. M8 chưa có thì auto-rollback disabled có giải thích.
7. Timeline từ alert và sự kiện thật. Thời điểm fault lấy helper log có nguồn; nếu chưa nối
   được vào UI thì dùng annotation thủ công có nhãn, không bịa timestamp tự phát hiện fault.
8. Khối so sánh baseline/sự cố/recovered: chọn cửa sổ sample theo timestamp/alert, trung vị
   latency hợp lệ và n; ghi window boundaries. Null/ít mẫu → chưa đủ dữ liệu. Làm helper thuần
   dễ test; trước/sau phải cùng loại phép đo, không trộn browser với collector.

## File được sửa

Renderer Monitor/alerts/settings/summary helpers; monitor service chỉ sửa lỗi API/lifecycle
thật; demo helper tools/scripts. Không thêm incident table/contract nếu có thể trình bày từ
alert/sample/log sẵn có. Nếu thiếu dữ liệu cần contract mới thì proposal Leader trước.

## Case và DoD

- [ ] C06-T1: live health 200 + business chậm; ảnh browser và Monitor cùng lượt.
- [ ] C06-T2: alert mở đúng consecutive, label lưu DB, reset → resolved theo sample thật.
- [ ] C06-T3: settings validation/save failure/reload, label failure, stale alert refresh có tests.
- [ ] C06-T4: summary window/median/null/zero denominator/multiple incidents có unit tests.
- [ ] C06-T5: timeline/summary chứng minh bằng sample IDs/time window; số trên UI truy lại được.
- [ ] C06-T6: helper chỉ app manifest, fault đã reset; focused tests/typecheck/lint/format/build.

## Evidence và review

`c06/incident.md`: fault_start/reset, threshold, alert ID/method/label/resolve, sample windows,
SQL + median đối chiếu, screenshot normal/degraded/alert/recovered và helper log; handoff-c06.md.
Leader review một case đầu-cuối, phép tính/nguồn dữ liệu và lời diễn giải. Chặng này chứng minh
phục hồi bằng reset fault, chưa được gọi là rollback. C06 APPROVED mới mở C07.
