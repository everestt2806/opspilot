# Checkpoint demo 3 ngày — A làm solo, Leader review, Worker thực hiện

> Chốt kế hoạch ngày 10/09/2026. Dự kiến demo 13/09; đây là giả định từ yêu cầu
> “còn khoảng 3 hôm”, chưa phải ngày hẹn đã xác nhận. Thực hiện 10–12/09.
> Điểm vào: [task TK-A17](tasks/tk-a17-demo-checkpoint.md),
> [prompt Worker](prompts/tk-a17-worker.md), [handoff](tasks/tk-a17-worker-handoff.md).
> Kế hoạch này thay ưu tiên ngắn hạn của docs/23; không thay contract hoặc lịch toàn dự án.

## 1. Mục tiêu trình diễn

Một ứng dụng Express + PostgreSQL do OpsPilot deploy trên VPS thật. Giảng viên thấy:

1. App hoạt động, ghi được bản ghi vào PostgreSQL.
2. Monitor hiển thị metric thật, cập nhật qua SSH, trạng thái thu thập/train ML rõ ràng.
3. App vẫn `/health = 200` nhưng endpoint nghiệp vụ chậm; biểu đồ thể hiện suy giảm.
4. Rule và các model có score thật; cảnh báo có thời điểm, phương pháp, nhãn đúng/sai.
5. Khôi phục lỗi, thấy latency trở lại nền và cảnh báo resolved.
6. Rollback thủ công từ giao diện, xác minh version/runtime và bản ghi PostgreSQL vẫn còn.
7. Mở lịch sử giải thích được chuỗi sự kiện vừa xảy ra.

Điểm gây ấn tượng là quan hệ nhân quả có thể kiểm chứng: thao tác gây lỗi → số đo thay đổi →
cảnh báo → khôi phục. ML score là anomaly score, không gọi là “xác suất đúng” hay “độ chính xác”.
Không kết luận ML tốt hơn rule từ một lượt demo; đo detection delay chỉ là quan sát sơ bộ.

## 2. Baseline được kiểm tra ngày 10/09

Đã fetch `origin/main`: `683bfc6`. Chưa chạy lại test hoặc truy cập VPS trong phiên lập plan.

| Thành phần                  | Bằng chứng hiện có                                                             | Ý nghĩa cho kế hoạch                                                   |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Deploy hardening A15        | PR #25 đã merge; smoke VM02 01/09, full suite tuần tự 220/220 tại thời điểm đó | Dùng lại pipeline và readiness retry                                   |
| Collector B4/B5             | PR #26; test và smoke local ghi trong tk-file                                  | Code đã merge; còn nghiệm thu SSH → SQLite                             |
| Ba source demo + fault      | PR #28                                                                         | Có source Next/Vite không có nghĩa detector/deploy cả ba đã hoàn thiện |
| Collector VPS B6            | `origin/feat/m05-collector-docker`, `dfc0ed7`: báo cáo VM02 68 mẫu/11 phút     | Nhánh chỉ thêm docs, chưa thuộc main; cần kiểm tra lại runtime         |
| Monitor backend A16         | PR #24; service/poller/SQLite/ML/IPC hiện có                                   | CLI fixture không chứng minh model thật đã train trên VPS              |
| Monitor Dashboard B8        | Chưa có trong main                                                             | A nhận làm trong A17                                                   |
| Apps / version UI           | `AppsPage.tsx` còn `mockProjects`, `mockVersions`                              | Thay phần đi qua luồng demo bằng dữ liệu IPC thật                      |
| Collector đi kèm deploy     | `renderCompose()` mới sinh app + PostgreSQL                                    | Cần nối upload/build/compose collector, kiểm tra cả rollback           |
| Auto-rollback theo score M8 | Có contract/spec, chưa có implementation M8                                    | Mục tiêu nâng cao; khác rollback khi deploy healthcheck fail           |

B6 báo cáo app `express-demo`, port 30001, trên VM02 `221.121.1.80`, probe `/health`, không DB.
Không giả định credential của B tồn tại trên máy A, hoặc app dựng tay đã có deployment record
trong SQLite A. A17 tạo app riêng qua OpsPilot sau khi kiểm tra tài nguyên/port; không nhập tay
deployment giả để vượt gate. Không sửa/xoá app của B.

GitNexus đã cập nhật index theo baseline. `renderCompose` được gọi từ cả `stepRender` và
`restoreComposeTo`; `pollAll` nối `SshMetricSource → MonitorPoller → repository → tick`.
FTS của GitNexus không khả dụng; đã đối chiếu symbol context và source trực tiếp.

## 3. Phạm vi và mốc cắt

**P0 — bắt buộc:** Express/PostgreSQL + collector deploy bằng tool; metric thật vào SQLite;
Dashboard metric/5 score; train ML thật; fault latency; alert open/resolved/label;
rule setting; version và rollback thủ công thật; history; diễn tập có screenshot/video.

**P1 — mục tiêu nâng cao:** tự rollback theo trusted method (M8), notification + marker chart,
có cooldown, chặn lặp, xử lý failure. Chỉ mở khi G1/G2 đã PASS và còn ít nhất 4 giờ triển khai
cộng 2 giờ test/review trước lúc đóng băng cuối 11/09. Leader xác nhận bằng review log.
Không đủ điều kiện thì ghi DEFERRED trong handoff và bỏ khỏi lời giới thiệu demo.

Không đưa vào 3 ngày này: migrate VPS, detector Next/Vite, thêm framework, bộ 50 run chính thức,
installer máy sạch, thiết kế lại title bar/theme. Những việc đó giữ backlog.
Nếu ngày 1 trượt: ưu tiên chốt dữ liệu thật, cắt P1 ngay. Nếu ngày 2 trượt: ngày 3 chỉ sửa lỗi
và luyện luồng P0. ML chưa sẵn sàng phải hiển thị đúng trạng thái; demo rule-only là fallback
có công bố, không được ghi P0 đã đạt hoàn toàn.

## 4. Lịch thực hiện và review

| Ngày                           | Công việc Worker/A                                                                           | Gate Leader review                                                         | Đầu ra nhìn được                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| 10/09, khoảng 6–8 giờ          | G0 audit môi trường; G1 collector đi kèm deploy; SSH/SQLite; cho chạy baseline sạch ≥30 phút | R1: source/diff + test + bằng chứng VPS/SQLite                             | App thật, metric thật; chưa cần UI đẹp               |
| 11/09, khoảng 7–9 giờ          | G2 Monitor/Versions UI, rule settings/label, fault và recovery; đánh giá điều kiện P1        | R2: walkthrough UI + SQL/log, review null/stale/IPC/race; P1 có gate riêng | Một lượt demo đầu-cuối trên UI                       |
| 12/09, khoảng 4–6 giờ + buffer | G3 regression; sửa lỗi review; diễn tập 2 lần; ghi hình; đóng băng                           | R3: DEMO_READY hoặc blocker cụ thể                                         | Kịch bản thao tác chính xác + evidence + bản chạy ổn |

Ước lượng có buffer, không phải cam kết toàn bộ tính năng mới sẽ xong trong số giờ đó.
Worker bàn giao từng G1/G2/G3 để A gửi Leader review; sửa P0/P1 của reviewer rồi mới đi tiếp
checkpoint phụ thuộc. Lưu checkpoint commit cục bộ để dễ kiểm tra, không gom một commit khổng lồ.
Trong lúc chờ review chỉ chuẩn bị tài liệu/fixture của chặng sau, không mở rộng code chưa được chốt.

## 5. Kịch bản trình diễn khoảng 8–10 phút

Chuẩn bị trước 45–60 phút: kiểm tra mạng/SSH/public URL, đúng app và DB; baseline thật sạch
≥180 mẫu ở chu kỳ 10s; ML train thành công trên deployment đang xem, fault reset.
Giữ cửa sổ Electron/ML hoạt động. Chụp trạng thái mẫu + model sau train, không train lại sau
khi đã bật fault. Model state sau restart phải được kiểm tra, không suy từ số dòng SQLite.

| Thời gian  | Thao tác                                               | Điều giảng viên thấy / bằng chứng                                           |
| ---------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| 0:00–1:00  | Mở VPS, app, tạo marker trong PostgreSQL qua trang web | Host, container, port, version, dữ liệu thật                                |
| 1:00–2:00  | Mở Monitor, chỉ metric + 5 phương pháp                 | Dữ liệu mới đến; timestamp và đơn vị; ML đã sẵn sàng                        |
| 2:00–4:00  | Bật latency 2400ms trên endpoint nghiệp vụ             | `/health` vẫn 200; latency vượt rule 2000ms; alert sau đủ mẫu               |
| 4:00–5:00  | Mở alert, gắn nhãn, chỉ marker thời gian và score      | Nhãn lưu thật; nói rõ fault có chủ đích, không phải ground truth chính thức |
| 5:00–6:30  | Reset fault, quan sát phục hồi                         | Latency về nền, alert resolved sau các mẫu thấp                             |
| 6:30–8:30  | Chọn version cũ hợp lệ, confirm rollback               | Trạng thái running chỉ sau readiness; marker PostgreSQL còn nguyên          |
| 8:30–10:00 | Mở lịch sử, giải thích đường dữ liệu và phần còn lại   | Hành động/phiên bản/thời gian tra lại được; hướng thí nghiệm tiếp theo      |

Collector 10s + poller 30s + rule 3 mẫu: chừa khoảng 60–90s cho cảnh báo, không hứa tức thì.
Không giảm chu kỳ/ngưỡng âm thầm cho vừa demo. Khi chờ, giải thích metric được đo trong VPS
để giảm ảnh hưởng mạng laptop; raw data giữ trong JSONL, SQLite phục vụ UI/phân tích.

Nếu P1 đạt: thay đoạn rollback thủ công bằng trusted-method rollback thật và giải thích
cooldown. Fault runtime mất khi restart container có thể gây phục hồi dù image nào chạy;
vì vậy phải chứng minh image tag/current deployment thay đổi, không chỉ nhìn latency giảm.
Màn “ML phát hiện trước rule” chỉ dùng khi rehearsal đã có bằng chứng; không ép model trigger.

## 6. Chuẩn bị và phương án dự phòng

- Dùng một VPS chính được kiểm tra lại; VM02 là ứng viên từ bằng chứng gần nhất. VM01 từng
  bị chặn SSH, không coi đó là tình trạng hiện tại khi chưa kiểm tra.
- Public port phải được test từ trình duyệt của A. Nếu dùng tunnel hoặc video dự phòng,
  ghi rõ hình thức truy cập và nguồn dữ liệu; không gọi đó là public access đã PASS.
- Giữ app của B và dữ liệu thí nghiệm. Demo riêng có manifest host/app/path/port/container,
  backup DB cục bộ và marker dữ liệu trước mọi reset; không reset toàn VPS hoặc toàn SQLite.
- Fault chỉ bật trong app demo với env opt-in, thao tác qua SSH/internal network, timeout
  và reset rõ. Tránh memory/CPU stress làm đầy VPS trong kịch bản bắt buộc.
- Lưu video một lượt thật và screenshot: normal, degraded, alert-labeled, recovered,
  rollback, history. Không chụp credential, `.env` hoặc private key.
- Ngày 12/09: chạy hai lượt độc lập, ghi thời gian thực tế. Chốt SHA đã test; chỉ sửa blocker.
  Chuẩn bị source/build và dependencies local, image cache trên VPS, không phụ thuộc tải lại
  package ngay lúc trình diễn. Build thường không đồng nghĩa installer máy sạch đã đạt.

## 7. Phân vai từ 10/09 đến demo

- **A:** chủ task TK-A17, nhận scope tích hợp collector/UI còn thiếu của B để làm solo;
  chạy và tập demo, chuyển handoff cho Leader. Không cần chờ B.
- **Worker:** code/test/commit local theo task packet; log từng gate; báo lỗi có lệnh tái hiện.
- **Leader:** review code + bằng chứng đúng SHA, chỉ ra lỗi và yêu cầu sửa; xác nhận gate.
- **B:** không có task chặn checkpoint này; giữ công việc đã bàn giao. Tránh sửa cùng file
  collector/monitor UI trong nhánh khác khi A đang tích hợp. Scope lâu dài không đổi.

Ngày lập plan chỉ xác minh git/docs/source; mọi ô PASS runtime mới phải do Worker/Leader điền
sau khi chạy thật. Không dùng kết quả 01/09 hoặc báo cáo của B làm test mới của A17.
