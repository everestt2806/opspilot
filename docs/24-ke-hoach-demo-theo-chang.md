# Demo theo chặng — nhìn thấy sự cố, hiểu cách khôi phục

> Cập nhật 10/09/2026: A làm solo, Worker thực hiện, Leader review từng chặng.
> Kế hoạch thay bản chia 3 ngày. Không có hạn ngày/giờ công cho từng chặng;
> tiến độ tính bằng đầu ra được nghiệm thu. Ưu tiên giảng viên không chuyên DevOps.
> Chốt mới: A thao tác và trình chiếu; thầy quan sát. C08 tự khôi phục là bắt buộc.
> Worker đọc [playbook cầm tay chỉ việc](prompts/tk-a17-worker-playbook.md) trước nhận chặng.
> [Task điều phối](tasks/tk-a17-demo-checkpoint.md) · [Prompt](prompts/tk-a17-worker.md)
> · [Sổ bàn giao/review](tasks/tk-a17-worker-handoff.md).

## 1. Câu chuyện demo mới

“Đây là một website có người sử dụng. Khi website chậm, hệ thống biết chuyện gì đang xảy ra,
báo cho người quản lý và tự đưa website về phiên bản tốt, giữ nguyên dữ liệu.”

Màn trình diễn cần cho thấy đồng thời **trải nghiệm người dùng** và **khả năng của OpsPilot**.
Giảng viên không cần biết Docker/SSH là gì mới hiểu thành quả.

| Cảnh              | Trên website demo                                             | Trên OpsPilot                                                    | Điều thầy nhận ra                               |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Bình thường       | Mở danh sách, tạo ghi chú demo, phản hồi nhanh                | “Hoạt động bình thường”, thời gian phản hồi và cập nhật mới nhất | Đây là app có dữ liệu thật                      |
| Sự cố có chủ đích | Bấm tải lại, thấy chờ khoảng 2,4 giây hoặc thông báo lỗi thật | “Phản hồi chậm”, biểu đồ tăng, giải thích ngưỡng và cảnh báo     | Website chưa sập nhưng người dùng đã gặp vấn đề |
| Xử lý             | Giữ nguyên trang để thấy thay đổi                             | “Khôi phục phiên bản…” → tiến trình → xác minh                   | Tool thực sự thao tác trên hệ thống             |
| Phục hồi          | Bấm lại thấy nhanh, ghi chú vừa tạo vẫn còn                   | “Đã phục hồi”, đối chiếu trước/sự cố/sau và nhật ký              | Khôi phục được và giữ dữ liệu                   |

Các con số trong bảng trên là mục tiêu diễn tập, không phải kết quả đã đạt.
Gây lỗi là hoạt động trình diễn có công bố; không dựng cảnh báo/số liệu giả.

## 2. Bốn phần nhìn là hiểu

### A. Website demo có thao tác nghiệp vụ thật

Tận dụng Express + PostgreSQL và `/items` hiện có để làm trang “Sổ ghi chú nhóm”.
Có danh sách, thêm ghi chú, tải lại, số bản ghi lấy từ nguồn thật và thời gian request vừa đo.
Ví dụ A nhập “Buổi review với thầy” trên màn hình trình chiếu, rồi cho thấy ghi chú đó vẫn tồn tại sau rollback.
Tên gọi và copy được đổi cho thân thiện; không mở rộng schema/nghiệp vụ thành sản phẩm khác.

Khi chậm: nút có loading thật, thông báo “Đang tải dữ liệu…”, thời gian phản hồi sau request.
Khi lỗi: hiển thị lỗi thật và nút thử lại. Không dùng setTimeout giả để làm chậm giao diện.
Fault endpoint chạy qua helper SSH riêng; trên màn trình diễn ghi rõ “Đang mô phỏng sự cố”.

### B. Màn tổng quan tình trạng của OpsPilot

Một app được chọn, một màn có thông điệp lớn bằng tiếng Việt và ít con số có ý nghĩa:

```text
Website ghi chú nhóm                         Dữ liệu cập nhật lúc …
PHẢN HỒI CHẬM — người dùng phải chờ lâu hơn bình thường

Phản hồi: … ms       Lỗi kiểm tra HTTP: … % / 60s       Phiên bản: …

[Đường thời gian phản hồi + ngưỡng + marker cảnh báo/khôi phục]

Sự cố: đo được … ms, vượt ngưỡng … ms qua … mẫu liên tiếp
[Mở website] [Xem cảnh báo] [Tự khôi phục: BẬT · phương pháp đang chọn]

Trước sự cố          Trong sự cố          Sau khôi phục
… ms / … mẫu         … ms / … mẫu         … ms / … mẫu

[Chi tiết kỹ thuật: CPU/RAM, Rule, 3 model ML + Ensemble, trạng thái train]
```

Tái dùng AntD, Recharts, token hiện có. Màu đi cùng chữ/icon, không bắt người xem đoán màu.
Không cần thiết kế lại shell/title bar. Màn phải đọc được ở 1366×768.
“Không có dữ liệu mới” phải khác “Bình thường”; timestamp cũ không được làm xanh hệ thống.

### C. Giải thích sự cố và lịch sử bằng lời dễ hiểu

Ví dụ từ dữ liệu rule thật: “Thời gian phản hồi vượt 2.000 ms qua 3 mẫu liên tiếp”.
Ví dụ từ ML: “Mô hình phát hiện mẫu vận hành khác dữ liệu nền”; chỉ nêu metric nguyên nhân
khi detail thực sự hỗ trợ. Không dùng AI sinh văn bản/LLM hay bịa kết luận nguyên nhân gốc.

Timeline: cảnh báo mở → hệ thống tự rollback → kiểm tra kết quả → phục hồi được quan sát.
Ghi chính xác thời điểm phát hiện; nếu ghi thời điểm bắt đầu fault thì phải lấy từ helper log
thật hoặc đánh dấu thao tác thủ công, không suy ngược từ chart.

### D. Kết quả trước/sau có bằng chứng

Ba cửa sổ mẫu được ghi rõ phạm vi thời gian và số lượng: baseline trước cảnh báo, trong
sự cố, sau phục hồi. Hiển thị trung vị latency từ mẫu hợp lệ; thiếu mẫu hiển thị “Chưa đủ
dữ liệu”, không điền 0. Nếu thêm tỷ lệ giảm thì tính từ hai trung vị có mẫu, xử lý mẫu số 0.
Thời gian từ cảnh báo đến phục hồi là số quan sát của lượt đó, không phải SLA.

Không gọi tỷ lệ lỗi của probe là tỷ lệ toàn bộ khách hàng. Không biến anomaly score thành
độ chính xác hay phần trăm tin cậy. Không hứa mọi model đều báo trước rule.

## 3. Những gì đã có và còn thiếu

Baseline kiểm tra source/merge ngày 10/09: `origin/main@683bfc6`.

| Phần                     | Bằng chứng                                                 | Khoảng thiếu                                            |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------- |
| Deploy/rollback backend  | A15 PR #25; smoke VM02 01/09, suite tuần tự 220/220 lúc đó | Nối collector cả deploy lẫn restore, UI phiên bản thật  |
| Collector/JSONL          | B4/B5 PR #26, test/smoke local theo tk-file B              | Nối deploy và kiểm tra SSH → SQLite                     |
| Demo apps/fault          | B2 PR #28                                                  | Trang Express cần câu chuyện và phản hồi trực quan      |
| B6 VPS                   | Report `dfc0ed7` trên `origin/feat/m05-collector-docker`   | Report chưa ở main; cần tái xác minh runtime            |
| Monitor/ML backend       | A16 PR #24                                                 | CLI fixture không chứng minh ML thật đã train từ VPS    |
| Monitor UI               | Chưa có trong main                                         | Làm màn tình trạng, metric, score, cảnh báo             |
| Apps/Versions UI         | Còn mockProjects/mockVersions                              | Thay luồng demo bằng IPC thật                           |
| Auto-rollback theo score | Có spec M8, chưa có implementation                         | C08 bắt buộc; khác rollback khi deploy healthcheck fail |

B6 báo app `express-demo` trên VM02, port 30001, probe `/health`, không DB. App dựng tay
không mặc nhiên có record trong SQLite A. A tạo app demo riêng qua OpsPilot, giữ app của B.
GitNexus context đã xác nhận renderCompose dùng ở stepRender và restoreComposeTo; source
pollAll nối SSH/poller/repository/tick. Index FTS thiếu, đã đối chiếu source trực tiếp.
Phiên lập/revise plan chưa chạy lại app, test code hoặc VPS; không ghi thêm runtime PASS.

## 4. Thứ tự chặng và review

| Chặng | Hồ sơ giao Worker                                                        | Kết quả nghiệm thu                                           |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| C00   | [Môi trường/baseline](tasks/tk-a17/c00-baseline.md)                      | Chạy được môi trường, biết đúng target và baseline           |
| C01   | [Deploy kèm collector](tasks/tk-a17/c01-collector-deploy.md)             | App/DB/collector thật, JSONL đúng                            |
| C02   | [Dữ liệu SSH → SQLite](tasks/tk-a17/c02-ingestion.md)                    | Không trùng/mất/trộn dữ liệu giữa deployment                 |
| C03   | [ML thật](tasks/tk-a17/c03-ml-runtime.md)                                | Train/score thật, down/recover đúng                          |
| C04   | [Website demo nhìn thấy chậm/nhanh](tasks/tk-a17/c04-demo-experience.md) | Thao tác ghi chú thật, loading/lỗi/latency thấy được         |
| C05   | [Màn tình trạng dễ hiểu](tasks/tk-a17/c05-monitor-ui.md)                 | Trạng thái lớn, chart thật, chi tiết ML thu gọn              |
| C06   | [Sự cố/cảnh báo/so sánh](tasks/tk-a17/c06-incident-flow.md)              | Fault → alert → label → reset → before/after                 |
| C07   | [Khôi phục từ giao diện](tasks/tk-a17/c07-recovery.md)                   | Rollback thật, tiến trình, xác minh dữ liệu và history       |
| C08   | [Tự khôi phục bắt buộc](tasks/tk-a17/c08-auto-rollback.md)               | C08A policy → C08B coordinator → C08C live, từng phần review |
| C09   | [Nghiệm thu demo](tasks/tk-a17/c09-demo-acceptance.md)                   | Hai rehearsal + video/screenshot/runbook + DEMO_READY        |

Một lượt Worker chỉ nhận một chặng. Chặng trước APPROVED mới code chặng tiếp.
Mỗi chặng có base SHA/code HEAD, test, evidence, handoff và review riêng; không cần PR/merge
giữa chặng. Chặng được approve không đồng nghĩa toàn bộ demo đã sẵn sàng.

P0: C00–C09, bao gồm C08. Điểm nhấn là **phát hiện → tự quyết định → tự rollback → xác minh
website tốt lại**, A không bấm rollback/reset trong cửa sổ đo. C07 kiểm tra nền rollback thủ công;
C08 chia C08A (quyết định), C08B (thực thi bền vững), C08C (UI + live), từng phần review riêng.
Không tự hạ xuống manual rồi gọi DEMO_READY; chưa đạt phải báo blocker để A quyết định phạm vi.

Màn chính bắt buộc: tự khôi phục theo rule thật, nhãn rõ. ML thật train/score song song;
chỉ demo thêm trusted ML sau khi có evidence trigger thật. Không gọi rule-triggered là ML-triggered.
Không hứa ML phát hiện sớm hơn rule; các gate nghiên cứu M08 memory-leak/early-detection và
50 run vẫn riêng, không đánh hoàn thành từ checkpoint functional này.

Migrate, thêm detector/framework, bộ 50 run và installer máy sạch giữ backlog. Mục tiêu
trực quan tăng bằng câu chuyện/trải nghiệm thật, không cần thêm nhiều module mới.

## 5. Trình diễn và phương án dự phòng

1. A mở website + OpsPilot ở chế độ trình chiếu, tạo ghi chú và đọc phản hồi vừa đo.
2. Cho xem dữ liệu mới nhất, phiên bản và bật tự khôi phục có xác nhận trước sự cố.
3. A công bố bật mô phỏng chậm rồi tải lại website cho thấy tác động.
4. OpsPilot hiện cảnh báo/đường latency; giải thích bằng câu tiếng Việt, chỉ chi tiết ML nếu hỏi.
5. A ngừng can thiệp, theo dõi OpsPilot tự rollback; không bấm khôi phục hoặc reset fault.
6. Bấm website lại, kiểm tra ghi chú còn nguyên. OpsPilot thể hiện mẫu mới và kết quả trước/sau.
7. Mở nhật ký, giải thích “phát hiện, hành động, xác minh” và phần thí nghiệm sẽ làm tiếp.

Baseline sạch ≥180 mẫu ở chu kỳ 10s trước fault; model thật sẵn sàng trên deployment đang xem.
Không train lại sau khi fault đã bật. Collector 10s, poller 30s, rule đủ mẫu mới cảnh báo;
thời gian chờ được đo khi rehearsal, không hứa tức thì. Hai phép đo browser và collector nằm
ở hai vị trí khác nhau, phải có nhãn; không đặt cạnh nhau rồi tính như cùng một chuỗi.

Chuẩn bị hai version hợp lệ trước demo. Fault runtime mất khi container restart không chứng
minh rollback image; luôn kiểm tra runtime image/current deployment và marker DB. Tránh fault
error-rate/latency ảnh hưởng `/health`; đo business endpoint `/items?limit=1` cho collector.

Nếu mạng lỗi: video lượt thật có ghi thời điểm/SHA là dự phòng, không giả là live. Kiểm tra
public URL riêng; nếu dùng tunnel thì nói rõ. Giữ app B và mọi dữ liệu experiment. Không reset
toàn VPS/SQLite; helper fault có timeout/status/reset, không lộ secret trong evidence.

## 6. Vai trò

- A: owner solo, giao đúng file chặng cho Worker, gửi handoff cho Leader và tập demo.
- Worker: thực hiện/test/commit local, bàn giao đúng chặng rồi dừng chờ review.
- Leader: review đúng SHA + evidence, yêu cầu sửa finding, approve chặng và ba phần C08A/B/C.
- B: không có task chặn; A đã nhận phần tích hợp/UI còn thiếu theo yêu cầu solo.
