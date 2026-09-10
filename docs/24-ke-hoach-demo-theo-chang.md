# Demo theo chặng — nhìn thấy sự cố, hiểu cách khôi phục

> Cập nhật 10/09/2026: A làm solo, Worker thực hiện, Leader review từng chặng.
> Kế hoạch thay bản chia 3 ngày. Không có hạn ngày/giờ công cho từng chặng;
> tiến độ tính bằng đầu ra được nghiệm thu. Ưu tiên giảng viên không chuyên DevOps.
> Chốt mới: A thao tác và trình chiếu; thầy quan sát. C08 tự khôi phục là bắt buộc.
> Worker đọc [playbook cầm tay chỉ việc](prompts/tk-a17-worker-playbook.md) trước nhận chặng.
> [Task điều phối](tasks/tk-a17-demo-checkpoint.md) · [Prompt](prompts/tk-a17-worker.md)
> · [Sổ bàn giao/review](tasks/tk-a17-worker-handoff.md).
>
> **Bản giao Worker cập nhật 11/09:** theo yêu cầu của A, phiên hiện tại lập kế hoạch;
> Worker nhận triển khai riêng. Mục 7–10 ánh xạ yêu cầu → chặng → bằng chứng và quy trình
> giao việc. Khảo sát C00 đã chạy một phần, chưa có handoff/verdict APPROVED; xem
> [ghi nhận khảo sát](tasks/tk-a17/preflight-11-09.md). Không tự mở C01.
>
> **Sau review 11/09:** [C00 APPROVED](tasks/tk-a17/review-c00.md), code `d4ec3be`,
> docs `23cd248`. Đã mở duy nhất C01 để A giao Worker; các ghi chú khảo sát phía trên
> là lịch sử trước review. Prompt C01 đã điền ở cuối hồ sơ review.

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
Phiên lập/revise plan **10/09** chưa chạy lại app, test code hoặc VPS; không ghi thêm runtime PASS.
Khảo sát **11/09** được ghi riêng trong [preflight](tasks/tk-a17/preflight-11-09.md), chưa APPROVED.

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

## 7. Ma trận đầy đủ yêu cầu giao Worker

Các mã A17-R bên dưới dùng để rà phạm vi của checkpoint này, không thay FR/NFR trong
`docs/05` hoặc tạo thêm yêu cầu đề tài. Đây là tổng hợp các yêu cầu đã ghi ở plan/task/playbook,
bao gồm chỉnh hướng 11/09: Leader chuẩn bị kế hoạch, A giao Worker triển khai.

| Mã | Yêu cầu phải giữ | Nơi thực hiện/nghiệm thu | Bằng chứng bắt buộc |
| --- | --- | --- | --- |
| R01 | A làm solo, nhận phần tích hợp B6/B8; A thao tác, thầy quan sát | Task điều phối; C09 | Runbook ghi rõ vai trò, không chờ B hoặc yêu cầu thầy điều khiển |
| R02 | Có bước tiến chức năng từ website tới tự khôi phục | C01–C09 | Hai lượt toàn luồng; C07 thủ công không thay C08 |
| R03 | Website “Sổ ghi chú nhóm” có thêm/xem/tải lại dữ liệu PostgreSQL thật | C04-T1/T3; C09 | Marker tạo từ UI, refetch/reload còn; lỗi lưu không báo thành công |
| R04 | Người xem thấy nhanh → chậm/lỗi → tốt lại | C04-T2/T4; C06-T1; C09-T3 | Ảnh cùng thao tác, loading thật, latency đo request thật |
| R05 | Màn Monitor dễ hiểu, tiếng Việt, có chế độ trình chiếu | C05; C08C; C09 | Hero text/icon, đồ thị chính, chi tiết thu gọn; các viewport trong file chặng |
| R06 | Tình trạng, metric, chart, alert, version dùng nguồn thật | C02/C05/C07 | IPC/SQLite/runtime đối chiếu đúng app/current deployment; không mock trên luồng demo |
| R07 | Collector đi cùng deploy và còn sau redeploy/rollback | C01-T1…T7; C07-T3 | Compose hai đường forward/restore, live JSONL ≥10 phút, stats/HTTP/DB |
| R08 | SSH → SQLite không trùng/mất/trộn dữ liệu phiên bản | C02-T1…T6 | Seq/byte offset/transaction, reconnect, redeploy và rollback boundary |
| R09 | ML thật train và score song song với rule | C03; C08C-T5 | ≥180 mẫu sạch; readiness, train provenance; 3 model + ensemble có score mới |
| R10 | Null/stale/mất SSH/ML chưa sẵn sàng thể hiện đúng | C02/C03/C05; C08C-T2 | Test trạng thái và ảnh; không biến null thành 0 hay dữ liệu cũ thành bình thường |
| R11 | Cảnh báo giải thích được, có nhãn Đúng/Sai và settings thật | C06-T2/T3 | Alert IDs/threshold/consecutive, nhãn đọc lại từ DB, validation/save failure |
| R12 | Timeline và trước/trong/sau sự cố truy lại được | C06-T4/T5; C07-T5; C09-T5 | Timestamp có nguồn, median/n/window/deployment; thiếu mẫu có thông báo |
| R13 | Apps/Versions/History nối backend thật | C07 | Accepted/finished/failure/race được xử lý; current và runtime image khớp |
| R14 | Tự động rollback là bắt buộc, có opt-in và method tin cậy | C08A/B/C | Mặc định OFF, confirm trước bật; fault → decision → pipeline tự thực thi |
| R15 | Chống rollback sai/lặp sau retry, stale backlog hoặc restart | C08A-T2…T4; C08B | Batch policy, app lock, durable intent, cooldown/suppression/re-arm regression |
| R16 | Không can thiệp thủ công để tạo kết quả tự khôi phục | C08C-T3; C09-T2 | Helper/action logs: không manual rollback/reset/restart trước business verification |
| R17 | Phục hồi phải đổi đúng image và giữ nguyên dữ liệu | C07-T3; C08C-T4; C09-T4 | R1/R2 identity khác, current pointer, ≥3 mẫu khỏe mới và marker PostgreSQL |
| R18 | Diễn giải đúng rule và ML, không tuyên bố kết quả nghiên cứu chưa có | C03/C08C/C09 | Demo bắt buộc ghi “Tự khôi phục theo ngưỡng”; ML-trigger outcome riêng, không bịa accuracy/early detection |
| R19 | Giữ app B, dữ liệu thật và thí nghiệm; chỉ dùng target riêng | C00/C01 và mọi live gate | Manifest, inventory/experiment check, command log; không reset VPS/SQLite |
| R20 | Chia việc theo chặng, mỗi chặng review riêng | Task điều phối; C00–C09, C08A/B/C | Base/code/docs SHA, handoff/review riêng, không gom nhiều chặng |
| R21 | Worker sửa/test/commit local, không push/PR/merge/subagent | Prompt Worker và sổ bàn giao | Git status/commit list; quyền remote chỉ sau lệnh riêng của A |
| R22 | Bám contract, tái dùng code/UI/dependency đã duyệt | Mỗi file chặng | Diff đúng scope; proposal cụ thể nếu contract thiếu, không sửa ngầm |
| R23 | Có đủ kiểm thử, ảnh/video và hướng dẫn A chạy lại | C00–C09 | Log exit/count/cwd/runtime; hai rehearsal và ít nhất một video thật ở C09 |
| R24 | Tách giới hạn mạng khỏi trạng thái ứng dụng | C00-T5; C09-T6 | Public URL kiểm tra riêng; nếu tunnel/video thì ghi đúng hình thức |
| R25 | Kế hoạch bao trùm mục tiêu, Worker chỉ thực hiện chặng được giao | Prompt khởi động/sửa/tiếp theo | Lượt đầu hoàn thiện C00; A chuyển handoff cho Leader trước mở C01 |

R03–R18 phải còn đúng trên **cùng bản code cuối** và lượt demo C09. Kết quả từng chặng
độc lập không đủ nếu tích hợp sau cùng làm hồi quy. FR-B2 detector 3 stack, migrate, installer
máy sạch, memory-leak/early detection và 50 run nghiên cứu vẫn được theo dõi ở docs/05/07;
không tự đánh hoàn thành hoặc xóa khỏi kế hoạch dài hạn vì nằm ngoài checkpoint này.

## 8. Gói công việc, đầu ra và thứ tự bàn giao

File chặng là nơi duy nhất ghi đầy đủ bước thi công, file được sửa và test case. Bảng này
là mục lục giao việc để A không phải tự ghép các prompt module hoặc giao quá scope.

| Lượt | Gói giao | Đầu ra hữu hình để A/Leader review | Trọng tâm kỹ thuật cần chốt |
| --- | --- | --- | --- |
| 1 | [C00](tasks/tk-a17/c00-baseline.md) | Baseline, manifest, lệnh mở app/website, giới hạn mạng | Interpreter/ABI, trust SSH, quyền target, experiment, kiểm chứng khảo sát 11/09 |
| 2 | [C01](tasks/tk-a17/c01-collector-deploy.md) | App + PostgreSQL + collector từ pipeline thật, marker sau redeploy | Source packaging, compose/restore, persistent volume, secret/port |
| 3 | [C02](tasks/tk-a17/c02-ingestion.md) | CLI live và Electron scheduler lấy metric thật vào SQLite | Byte offset, dedupe, transaction, lifecycle deployment và reconnect |
| 4 | [C03](tasks/tk-a17/c03-ml-runtime.md) | Baseline sạch, API train/readiness, batch ML mới có số thật | Lifecycle process, 20D features hiện có, identity, down/up/null |
| 5 | [C04](tasks/tk-a17/c04-demo-experience.md) | Website ghi chú trực quan, hai release phân biệt trong image | Request/error UX, PostgreSQL proof, version provenance |
| 6 | [C05](tasks/tk-a17/c05-monitor-ui.md) | Monitor chỉ đọc và projection mode | State precedence, IPC race, chart window/units, stale |
| 7 | [C06](tasks/tk-a17/c06-incident-flow.md) | Fault helper, alert/label/settings, incident timeline và summary | Fault thật, ngưỡng, re-fetch resolved, window/median |
| 8 | [C07](tasks/tk-a17/c07-recovery.md) | Apps/Versions/History thật, rollback thủ công kiểm chứng nền | Accepted ≠ finished, target/image, dữ liệu qua phiên bản |
| 9 | [C08A](tasks/tk-a17/c08a-decision.md) | Decision table và tests policy/candidate | Suffix cuối batch, freshness, method, target hợp lệ |
| 10 | [C08B](tasks/tk-a17/c08b-coordinator.md) | Coordinator, durable attempt và completion integration | Crash windows, failure suppression, attribution, lock/cooldown |
| 11 | [C08C](tasks/tk-a17/c08c-live-presentation.md) | Opt-in/timeline UI và live tự rollback có business verification | R1/R2, no manual intervention, marker, 3 mẫu khỏe mới |
| 12 | [C09](tasks/tk-a17/c09-demo-acceptance.md) | Hai rehearsal, video/ảnh, runbook, bảng kết quả và hồ sơ review cuối | Full regression, cùng SHA, không blocker, đúng mục tiêu trình chiếu |

Chuỗi phụ thuộc bắt buộc: C00 → C01 → C02 → C03 → C04 → C05 → C06 → C07 → C08A → C08B →
C08C → C09. Không ước lượng bằng ngày/giờ công. Thời gian đo kỹ thuật vẫn phải giữ:
collector 10s, poll 30s, baseline sạch ≥180 mẫu, cooldown 10 phút, soak collector ≥10 phút.

Các helper đề xuất, flags và lệnh trong [playbook](prompts/tk-a17-worker-playbook.md) là đầu
ra phải xây ở đúng chặng; không coi chúng đã tồn tại. C04 cho phép thêm phần chuẩn bị release
của helper theo playbook; C02 status/verify, C06 fault/reset, C08C verification automation.
Không tạo một helper thực hiện sẵn toàn bộ các chặng ngay từ C00.

## 9. Các điểm quyết định và cách xử lý vướng mắc

| Tình huống | Worker cần làm | Điều kiện tiếp tục |
| --- | --- | --- |
| Có code/bằng chứng cũ | Kiểm tra ancestry, SHA, command và trạng thái live; tái dùng phần đúng | Ghi rõ phần đã tự xác minh, phần chỉ tham khảo; không tick từ báo cáo cũ |
| Target/IP/user/port khác khảo sát | Đọc cấu hình hiện tại, inventory read-only, cập nhật manifest | Target riêng không chiếm app B, tài nguyên và experiment gate đạt |
| Không vào SSH hoặc thiếu credential | Ghi bước lỗi/exit; hoàn thiện local evidence và test plan còn độc lập | Credential được cấu hình qua cơ chế của A hoặc SSH hoạt động; không xin paste secret |
| Public port bị chặn | Kiểm tra local health qua SSH; ghi tunnel loopback hoặc yêu cầu mở port cụ thể | C00 ghi giới hạn; C09 chứng minh đường trình chiếu thực tế và công bố fallback |
| Boundary deployment/freshness/metadata chưa đủ contract | Nêu input, actual/expected, field/API bị ảnh hưởng và proposal tối thiểu | Leader giải quyết mismatch trước phần code phụ thuộc; việc khác trong chặng vẫn làm |
| Full/focused test lỗi | Lưu log hiện tại, tái hiện và phân biệt baseline với regression | Sửa trong scope hoặc finding/proposal rõ; không skip/tăng timeout hàng loạt cho xanh |
| ML chưa ready/không trigger trong lượt fault | Giữ metric/rule, hiển thị null/readiness, ghi outcome thật | C03 score thật là bắt buộc; ML-trigger bổ sung không được thay bằng trigger giả |
| Rollback failed/uncertain sau restart | Durable log và thông báo; không tự replay/retry command | Re-arm theo policy được review, có target hợp lệ; không sửa DB để ép |
| Helper hết timeout trước xác minh phục hồi | Ghi FAIL/INCONCLUSIVE và thời điểm cleanup | Chuẩn bị lại trạng thái sạch cho lượt mới; không lấy recovery do cleanup làm PASS |
| Review yêu cầu sửa | Map từng finding → fix commit → regression → evidence | Leader đóng BLOCKER/MAJOR trên SHA mới; Worker không tự approve |

Default kỹ thuật và UI phải bám contract/spec. Những policy nội bộ chưa có ngưỡng chốt
(ví dụ freshness/stale và cửa sổ summary) phải được Worker ghi thành bảng input/output cùng
lý do trong handoff của chặng; reviewer duyệt trước mở downstream. Không dùng câu “tự xử lý
hợp lý” thay thiết kế có thể kiểm tra. Số mặc định đã chốt không được đổi để ép demo trigger.

## 10. Cách A giao Worker và nhận kết quả

1. Gửi [prompt khởi động](prompts/tk-a17-worker.md) cho Worker, cùng quyền truy cập repo.
   Prompt giao **duy nhất C00**; toàn plan cung cấp bối cảnh, không cấp quyền chạy hết chuỗi.
2. Worker đọc đúng tài liệu đầu vào, ghi branch/base/status và START, hoàn thiện C00 kể cả
   phần handoff còn thiếu sau khảo sát. Khi có evidence hiện hữu, kiểm tra trước khi chạy lại.
3. Cuối lượt Worker nộp `docs/tasks/tk-a17/handoff-c00.md`, evidence và commit local; cập nhật
   board/task/sổ bàn giao. A nhận một kết quả cụ thể `READY_FOR_LOCAL_REVIEW` hoặc `BLOCKED`.
4. A gửi handoff cho Leader. Leader đọc diff/code và bằng chứng theo đúng SHA, tạo
   `review-c00.md` với findings/verdict. Kết quả test reviewer chạy riêng phải phân biệt
   với kết quả Worker. Không tự tạo verdict APPROVED trong phiên chỉ lập kế hoạch.
5. Nếu cần sửa, A dùng prompt sửa sau review. Khi APPROVED, A dùng prompt chặng tiếp theo,
   chỉ rõ ID và review được kế thừa; lặp tới C09, riêng C08 phải qua A/B/C.
6. Handoff mỗi chặng kèm các mã R liên quan ở mục 7 và link case/evidence, thêm `NOT_RUN`
   cho yêu cầu chưa đến chặng. Không gọi toàn bộ yêu cầu “PASS” khi mới hoàn thành một phần.
7. C09 trả runbook `docs/25-kich-ban-demo-monitor-recovery.md`, 2 biên bản rehearsal,
   video thật, bảng before/after, command/test summary và reviewed SHA. Leader chỉ ghi
   `DEMO_READY` khi đủ DoD C09; trạng thái hoàn thành task theo quy tắc merge của board.

Mẫu kết quả Worker gửi A: **chặng/outcome; branch/base/code/docs SHA; commits/files;
case PASS/FAIL/NOT_RUN và log; yêu cầu R đã phủ; handoff; blocker/việc tiếp theo;
tình trạng app/ML/SSH/fault sau test; CHƯA PUSH — CHƯA PR — CHƯA MERGE.**
