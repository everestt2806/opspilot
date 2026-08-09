# M06 — Poller + Rule engine · Người B · Tuần 3–4

`app/src/main/monitor/poller.ts` + `rules.ts` — FR-D2, FR-D3

## Mục tiêu
Cứ 30 giây, kéo các dòng metric mới từ VPS về, lưu vào SQLite, chấm điểm bằng rule engine và
bằng ML service, tạo alert khi cần, và đẩy lên dashboard.

Đây là chỗ **nối hai nửa hệ thống** — cổng kiểm soát 2 (hạn 13/09).

## Đọc trước
- **`docs/contracts/metric-format.md` mục 4** — thuật toán đọc theo offset
- `docs/contracts/schema.sql` — `metric_sample`, `score_sample`, `alert`, `monitor_setting`
- `docs/contracts/ml-api.openapi.yaml` — `POST /ingest`
- `docs/contracts/ipc-contract.ts` — event `monitor:tick`

## Vòng lặp cho mỗi app đang có deployment `running`

```
1. tail -c +<app.metrics_offset> /opt/opspilot/<app>/metrics/metrics.jsonl
2. Cắt theo '\n'. DÒNG CUỐI KHÔNG KẾT THÚC BẰNG '\n' -> BỎ, không cộng offset.
3. Với mỗi dòng hoàn chỉnh (theo đúng thứ tự seq tăng dần):
     a. validate bằng zod -> insert metric_sample (UNIQUE(deployment_id,seq) chống trùng)
     b. rule engine    -> 1 dòng score_sample method='rule'
     c. POST /ingest   -> 4 dòng score_sample (zscore_ewma, iforest, ocsvm, ensemble)
     d. cập nhật trạng thái triggered của từng method -> tạo/đóng alert nếu cần
4. Cộng offset đúng số byte của các dòng đã xử lý trọn vẹn; ghi app.metrics_offset
5. Phát IPC 'monitor:tick' với mẻ mẫu + score + alert mới
```

Toàn bộ bước 3 của **một mẻ** nằm trong **một transaction** SQLite.

## Rule engine (`rules.ts`) — FR-D3

Hàm thuần, dễ test:
```ts
export function evaluateRule(sample: MetricSample, setting: MonitorSetting)
  : { violated: boolean; reasons: string[] };
```
Vi phạm khi **bất kỳ** điều nào đúng (ngưỡng lấy từ `monitor_setting`, mặc định trong ngoặc):
`cpu_pct > rule_cpu_pct` (90) · `mem_pct > rule_mem_pct` (90) ·
`latency_ms > rule_latency_ms` (2000) · `http_error_rate > rule_error_rate` (0.5) ·
`container_up === 0`.

`score_sample` của `rule`: `score = 1` nếu vi phạm, `0` nếu không (rule không có độ tin cậy
liên tục — nói rõ điều này trong báo cáo khi vẽ PR curve: rule chỉ có **một điểm** trên đồ thị).
`above_threshold = violated`.

## Quy tắc triggered & alert — **áp dụng giống hệt cho cả 5 phương pháp**

- `rule` triggered khi vi phạm **`rule_consecutive`** (3) mẫu liên tiếp.
- 4 method ML triggered khi `score > ml_score_threshold` (0.7) **`ml_consecutive`** (2) mẫu liên tiếp.
- **Một chuỗi liên tục = MỘT alert**, không phải mỗi mẫu một alert.
  Đang triggered mà score tiếp tục cao → chỉ cập nhật `peak_score`.
- Đóng alert (`ts_resolved`) khi score xuống dưới ngưỡng **3 mẫu liền**.
- `metric_sample_id` của alert = mẫu **đầu tiên** của chuỗi vượt ngưỡng (không phải mẫu thứ 2
  hay thứ 3) — vì `detection delay` đo từ đó.

## Trường hợp biên bắt buộc xử lý

| Tình huống | Xử lý |
|---|---|
| ML service chết | `score = null` cho 4 method ML, **vẫn ghi** `rule`; phát `system:ml-status {running:false}`; **không** dừng poller |
| ML trả `ready:false` (chưa train) | `score = null`, `above_threshold = 0`. Dashboard hiện "Đang thu thập 132/150 mẫu" |
| Mất kết nối SSH | Không tạo mẫu giả, **không nội suy**. Ghi `action_log`, thử lại lần poll sau. Nối lại → `tail` tự nạp bù toàn bộ khoảng thiếu |
| File `metrics.jsonl` nhỏ hơn offset (đã xoay vòng hoặc bị xoá) | Reset offset về 1, ghi `action_log`. `seq` không reset nên không đếm trùng |
| Dòng JSON hỏng | Bỏ dòng đó, ghi warning, **vẫn cộng offset** (nếu không sẽ kẹt vĩnh viễn ở dòng hỏng) |
| Poll trước chưa xong đã tới lượt poll sau | Bỏ lượt mới (khoá theo `app_id`), không chạy chồng |
| Nhiều app cùng lúc | Poll tuần tự từng app, không mở nhiều connection tới cùng một VPS |

## Auto-train
Deployment chưa train mà đã đủ **150** mẫu → tự gọi `POST /train` với toàn bộ mẫu đã có, ghi
`action_log`. (Trong thí nghiệm, `run_experiment.py` chủ động gọi `/train` đúng thời điểm —
poller không được tự train đè lên.) Cờ tắt auto-train: `monitor_setting` hoặc biến môi trường.

## Test không cần VPS
`ml-service/scripts/gen_fake_series.py` (M07) sinh `metrics.jsonl` giả có anomaly →
đặt vào một thư mục local → chạy poller ở chế độ đọc file local thay vì SSH (một cờ trong
constructor). Nhờ đó Người B làm việc **hoàn toàn độc lập** với Người A từ tuần 3.

## Định nghĩa xong
- [ ] Metric thật từ VPS chảy vào `metric_sample`, `seq` liên tục không thủng
- [ ] Mỗi `metric_sample` có **đúng 5** dòng `score_sample`
- [ ] `stress-ng --cpu 4` trên VPS 2 phút → rule alert xuất hiện sau đúng 3 mẫu
- [ ] Kill ml-service → poller vẫn ghi `metric_sample` + `rule`, ML score `null`, dot topbar đỏ
- [ ] Reboot VPS giữa chừng → nối lại, **không thủng `seq`**
- [ ] Xoá `metrics.jsonl` khi đang chạy → poller reset offset, ghi `action_log`, không crash
- [ ] Chạy 24 giờ (soak test tuần 5): RAM ổn định, số mẫu thiếu < 2%
