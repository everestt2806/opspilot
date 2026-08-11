# TRELLO WORKFLOW — OPSPILOT

Trello là nguồn sự thật cho **task và trạng thái**. GitHub là nguồn sự thật cho **code, test,
review và merge**. Không tạo lại cùng một task ở GitHub Issues.

Board đang dùng: [OpsPilot — Delivery Board](https://trello.com/b/RrSCc5uu/opspilot-delivery-board).
Board không tự đồng bộ trạng thái với GitHub; owner của card chịu trách nhiệm kéo card và dán link PR.

## Thiết lập tự động

### 1. Tạo board

Trong Trello, tạo một board trống tên `OpsPilot — Delivery Board`:

- Visibility: **Private** hoặc **Workspace**, không dùng Public.
- Mời cả A và B vào board, chờ B accept trước khi chạy script để card được assign đúng.

### 2. Tạo API key một ngày

Trello yêu cầu API key gắn với một Power-Up:

1. Mở <https://trello.com/apps/admin>.
2. Tạo Power-Up nội bộ tên `OpsPilot Board Setup` nếu chưa có.
3. Vào tab **API Key** và chọn **Generate a new API Key**.

Không ghi API key/token vào repo, Trello card, chat hoặc ảnh chụp màn hình.

### 3. Xem trước cấu hình

```powershell
.\tools\setup-trello.ps1 -PlanOnly
```

### 4. Chạy thiết lập

```powershell
.\tools\setup-trello.ps1 `
  -BoardUrl 'https://trello.com/b/XXXXXXXX/opspilot-delivery' `
  -PartnerEmail 'email_cua_B@example.com'
```

Nếu B đã mở board và có username Trello, có thể dùng `-PartnerUsername` thay cho
`-PartnerEmail`. Không ghi email thật vào script hay commit.

Script sẽ:

1. Hỏi API key bằng input ẩn.
2. Mở trang Trello xin token `read,write` hết hạn sau **1 ngày**.
3. Hỏi token bằng input ẩn.
4. Từ chối chạy nếu board đang Public.
5. Tạo 6 list, 7 label, milestone và task chi tiết W1–W4.
6. Assign card A/B nếu cả hai đã tham gia board.

Board đã được tạo theo phân công cũ thì thêm `-SyncExisting`. Script sẽ đổi tên label A/B,
reconcile owner/mô tả/label quản lý của card có trong cấu hình và tạo card còn thiếu. Script giữ
nguyên list hiện tại, custom label, comment, attachment và trạng thái checklist của card đã có;
không archive/xóa card.

Script không lưu key/token xuống file. API key chỉ xuất hiện trong URL cấp quyền chính thức
của Trello; các request REST sau đó dùng `Authorization` header nên token không nằm trong URL
hay log. Biến xác thực được xoá khỏi bộ nhớ khi script kết thúc. Chạy lại script không tạo
trùng list, label hoặc card có cùng tên. Script không xoá/archive nội dung có sẵn.

## 1. Board dùng để quản lý gì?

| Nội dung | Nguồn sự thật | Cách liên kết |
|---|---|---|
| Task nào cần làm, ai làm, hạn và trạng thái | Trello | Một card cho một kết quả có thể kiểm tra |
| Code, lịch sử commit và branch | GitHub | Tên branch được ghi sẵn trong card |
| Review, thảo luận kỹ thuật và kết quả test | GitHub Pull Request | Dán URL PR vào card |
| Quyết định kiến trúc | `DECISIONS.md` và `docs/` | Comment card chỉ trỏ đến commit/PR, không thay tài liệu |
| Secret, token, password và private key | Không lưu trên cả hai | Chỉ giữ trong secret store hoặc máy cá nhân |

Trello trả lời **“việc đang ở đâu?”**; GitHub trả lời **“đã thay đổi gì và đã kiểm tra ra sao?”**.
Push một commit không đồng nghĩa task đã hoàn thành.

Ba list mặc định `Cần làm`, `Đang làm`, `Đã xong` do Trello tạo ban đầu không thuộc workflow này.
Archive chúng bằng menu `…` → **Archive this list** để tránh kéo nhầm card.

## 2. Luồng chuẩn của một task

```text
BACKLOG → TUẦN NÀY → ĐANG LÀM → CHỜ REVIEW → HOÀN THÀNH
                            │           │
                            └→ BLOCKED  └→ ĐANG LÀM (nếu reviewer yêu cầu sửa)
                                  │
                                  └→ ĐANG LÀM (sau khi được gỡ chặn)
```

| List | Ý nghĩa | Điều kiện vào | Việc cần làm trước khi rời list |
|---|---|---|---|
| **BACKLOG** | Việc có thể làm nhưng chưa cam kết trong tuần | Có mục tiêu sơ bộ | Khi chọn vào tuần phải bổ sung owner, deadline, scope và DoD |
| **TUẦN NÀY** | Việc đã cam kết trong tuần nhưng chưa bắt đầu | Có owner, deadline, branch, label, phạm vi và DoD | Owner kiểm tra dependency rồi mới nhận làm |
| **ĐANG LÀM** | Owner đang thực sự làm | Đã kéo card, comment bắt đầu và tạo đúng branch | Code/test cục bộ xong, push branch và mở PR |
| **CHỜ REVIEW** | Có PR sẵn sàng để người kia đọc | Card có URL PR và kết quả test | Review xong; nếu cần sửa thì quay lại **ĐANG LÀM** |
| **BLOCKED** | Không thể tiến tiếp quá 30 phút | Có comment blocker theo mẫu ở mục 6 | Ghi cách gỡ chặn; khi gỡ xong quay lại **ĐANG LÀM** |
| **HOÀN THÀNH** | Kết quả đã tích hợp vào hệ thống | PR đã merge vào `main`, test pass và DoD được tick đủ | Không còn việc; phát sinh mới thì tạo card mới |

Quy tắc WIP: **mỗi người tối đa một card trong `ĐANG LÀM`**. Card `Shared` đang chờ quyết định
không phải lý do để nhận thêm nhiều card; hãy giải quyết hoặc chuyển nó sang `BLOCKED`.

## 3. Cấu trúc bắt buộc của một card

Mỗi card phải đủ thông tin để người còn lại hoặc một phiên AI mới có thể tiếp quản mà không cần đoán:

- **Title:** `[A|B|Shared][Mxx hoặc vùng] Kết quả cần đạt`.
- **Member/Owner:** người chịu trách nhiệm cập nhật card đến khi Done.
- **Due date:** hạn hoàn thành, không phải ngày bắt đầu.
- **Branch:** một branch riêng, ví dụ `feat/m05-collector-scaffold`.
- **Mục tiêu:** kết quả quan sát/kiểm tra được, không ghi chung chung “làm collector”.
- **Được sửa / không sửa:** ranh giới file để hai người làm song song.
- **Labels:** vùng sở hữu, mức ưu tiên và `Contract` nếu đụng hợp đồng chung.
- **Definition of Done:** checklist điều kiện kỹ thuật, test và PR.
- **Attachments/comments:** URL PR, bằng chứng smoke test, quyết định hoặc blocker.

Không ghi API key, access token, `.env`, IP kèm password, private SSH key hoặc dữ liệu đăng nhập
vào title, description, checklist, comment hay ảnh đính kèm.

## 4. Ý nghĩa label

| Label | Dùng khi |
|---|---|
| `A - Core/Algorithms` | Backend Electron, infra, pipeline, monitoring và ML do A sở hữu |
| `B - UI/Delivery` | Renderer, collector, demo, thí nghiệm và bằng chứng do B sở hữu |
| `Shared` | Cần phối hợp, handoff hoặc cùng chịu trách nhiệm |
| `Contract - ca hai duyet` | Thay đổi `docs/contracts/` hoặc interface giữa phần A/B; bắt buộc cả hai duyệt |
| `P0 - chan tien do` | Không xong thì milestone hoặc người kia bị chặn |
| `P1 - quan trong` | Cần hoàn thành trong tuần nhưng chưa chặn ngay |
| `P2 - co the lui` | Có thể cắt/lùi nếu tuần bị trễ |

Một card có ít nhất một label vùng sở hữu và đúng một mức ưu tiên. Làm `P0` trước `P1`, làm `P1`
trước `P2`; không tự thêm việc mới chỉ vì card dễ hơn.

## 5. Thao tác mỗi ngày

### Đầu phiên — nhận một card

1. Mở board, đọc card `P0/P1` của mình trong **TUẦN NÀY**.
2. Kiểm tra card đủ mục 3 và không bị dependency chưa xong.
3. Kéo đúng một card sang **ĐANG LÀM** và comment:

   ```text
   START 11/08 — Branch: feat/m05-collector-scaffold
   Kế hoạch: scaffold → contract test → pytest → PR
   Phụ thuộc/rủi ro: không có
   ```

4. Đồng bộ code và tạo branch đã ghi trong card:

   ```bash
   git switch main
   git pull --ff-only
   git switch -c feat/m05-collector-scaffold
   ```

Nếu branch đã tồn tại trên máy, dùng `git switch <branch>`. Không tạo một tên branch khác mà không
cập nhật card.

### Trong lúc làm

- Chỉ sửa vùng file được phép; cần vượt ranh giới thì comment card và báo người kia trước.
- Commit nhỏ, có thể test và dùng đúng prefix trong [`03-quy-trinh-team.md`](03-quy-trinh-team.md).
- Tick checklist ngay sau khi có bằng chứng, không tick theo cảm giác.
- Cuối phiên nhưng chưa xong, để card ở **ĐANG LÀM** và comment ngắn:

  ```text
  UPDATE 11/08 22:00
  Đã xong: scaffold, schema validation; commit abc1234
  Tiếp theo: test trường hợp metric null
  Test hiện tại: 8 passed
  Rủi ro/blocker: không có
  ```

### Mở PR — bàn giao cho reviewer

1. Chạy các test/kiểm tra ghi trong DoD và lưu chính xác command + kết quả.
2. Tự review bằng [`prompts/99-review.md`](prompts/99-review.md).
3. Push branch và mở PR; trong PR ghi mục tiêu, thay đổi chính, cách test và rủi ro.
4. Dán URL PR vào card, comment bàn giao rồi kéo card sang **CHỜ REVIEW**:

   ```text
   REVIEW — PR: <url>
   Test: pnpm typecheck; pnpm test (đều pass)
   Cần reviewer chú ý: xử lý reconnect và timeout
   Chưa làm: ngoài scope của card
   ```

### Review và hoàn thành

- Người còn lại review trong 24 giờ, đọc cả code lẫn test; không hiểu code AI viết thì không approve.
- Nếu yêu cầu sửa, owner kéo card về **ĐANG LÀM**, sửa trên cùng branch/PR rồi bàn giao lại.
- Sau khi approve, merge PR vào `main`, cập nhật local `main` và chạy kiểm tra cần thiết.
- Tick đủ DoD, comment `DONE — PR <url>, test <kết quả>` rồi mới kéo sang **HOÀN THÀNH**.
- Owner là người chịu trách nhiệm cập nhật card; reviewer có thể hoàn tất hộ sau merge nếu hai bên đã thống nhất.

## 6. Khi bị chặn

Sau 30 phút không thể tiến tiếp vì dependency, môi trường hoặc quyết định chưa có, chuyển card sang
**BLOCKED** và dùng mẫu:

```text
BLOCKED 11/08 15:30
Đang bị chặn ở: <bước cụ thể>
Nguyên nhân/bằng chứng: <error, log đã che secret hoặc link>
Đã thử: <các cách đã thử>
Cần từ ai: <A/B/provider>
Điều kiện gỡ chặn: <kết quả cụ thể>
Trong lúc chờ: <việc độc lập có thể tiếp tục hoặc “không có”>
```

Mention người có thể gỡ chặn. Không dùng comment chỉ có “bị lỗi”. Khi đã gỡ, thêm comment nêu cách
giải quyết và chuyển lại **ĐANG LÀM**; không chuyển thẳng từ **BLOCKED** sang **HOÀN THÀNH**.

## 7. Nhịp quản lý board

| Khi nào | Việc trên Trello |
|---|---|
| Đầu tuần, 15 phút | Đối chiếu `docs/04-timeline.md`; kéo card đủ năng lực từ **BACKLOG** sang **TUẦN NÀY**; chốt owner/deadline/P0–P2 |
| Đầu mỗi phiên, 3 phút | Đọc comment mới, kiểm tra blocker, nhận đúng một card |
| Cuối mỗi phiên, 2 phút | Tick DoD và để lại `UPDATE`; trạng thái card phải phản ánh đúng thực tế |
| Có PR | Dán URL và kết quả test, chuyển **CHỜ REVIEW** ngay |
| Thứ Sáu | Review card trễ, chạy smoke test, cập nhật milestone và cột “Thực tế” trong timeline |
| Cuối tuần | Giữ card chưa xong ở tuần kế tiếp có chủ ý; đưa việc chưa cam kết về **BACKLOG** |

Không đo tiến độ bằng số commit hay số giờ. Đo bằng **DoD đã có bằng chứng** và card đã merge vào
`main`. Các card milestone W1–W4 chỉ được tick khi toàn bộ gate trong checklist thật sự đạt.

## 8. Làm việc với AI từ một Trello card

Trello card là yêu cầu công việc; tài liệu trong repo mới là đặc tả kỹ thuật. AI không được tự suy ra
contract chỉ từ title card. Mỗi phiên AI cần nhận:

1. Nội dung/URL card: title, owner, branch, mục tiêu, scope, vùng cấm và DoD.
2. `CLAUDE.md`, `docs/README.md` và file brief `docs/prompts/mXX-*.md` tương ứng.
3. Các file trong `docs/contracts/` được brief yêu cầu.
4. Code hiện tại trên đúng branch.

Dùng mẫu copy-paste tại [`prompts/01-task-from-trello.md`](prompts/01-task-from-trello.md). Nếu AI không
truy cập được board private, dán **nội dung card**, không đưa Trello token cho AI. AI phải báo file đã sửa,
test đã chạy, phần chưa xong và rủi ro; con người xác nhận rồi mới cập nhật Trello/merge PR.

## 9. Ranh giới A/B và trường hợp làm thay

- A sở hữu `app/src/main/**`, `ml-service/**` và `templates/**`.
- B sở hữu `app/src/renderer/**`, `collector/**`, `demo-apps/**` và `experiments/**`.
- `app/src/shared/**`, `docs/contracts/**`, migration và giao thức thí nghiệm là vùng chung.
  Mọi thay đổi contract phải có card label
  `Contract - ca hai duyet` và cả hai review PR.
- B dựng UI bằng fixture/mock đúng typed IPC, không thêm handler tạm trong main. A cung cấp handler;
  PR tích hợp chỉ thay mock bằng `window.api.invoke` sau khi dependency merge.
- Nếu A làm thay task của B: giữ label vùng `B - UI/Delivery`, đổi member/owner thực tế sang A và
  comment `A thực hiện thay B từ <ngày>`. A commit bằng danh tính Git của A, tuyệt đối không dùng
  credential của B. Chiều ngược lại áp dụng tương tự với label `A - Core/Algorithms`.
- Handoff giữa hai phía phải ghi rõ file/artifact đầu ra và cách kiểm tra; không chỉ comment “xong rồi”.
