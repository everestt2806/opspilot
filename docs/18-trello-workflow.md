# TRELLO WORKFLOW — OPSPILOT

Trello là nguồn sự thật cho **task và trạng thái**. GitHub là nguồn sự thật cho **code, test,
review và merge**. Không tạo lại cùng một task ở GitHub Issues.

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
5. Tạo 6 list, 7 label, milestone W1–W4 và task W1.
6. Assign card A/B nếu cả hai đã tham gia board.

Script không lưu key/token xuống file. API key chỉ xuất hiện trong URL cấp quyền chính thức
của Trello; các request REST sau đó dùng `Authorization` header nên token không nằm trong URL
hay log. Biến xác thực được xoá khỏi bộ nhớ khi script kết thúc. Chạy lại script không tạo
trùng list, label hoặc card có cùng tên. Script không xoá/archive nội dung có sẵn.

## Luồng một task

```text
TUẦN NÀY → ĐANG LÀM → CHỜ REVIEW → HOÀN THÀNH
                    ↘ BLOCKED
```

- Bắt đầu: kéo card sang **ĐANG LÀM**, tạo branch ghi trên card.
- Push commit chưa phải hoàn thành.
- Mở PR: dán link vào card, kéo sang **CHỜ REVIEW**.
- Chỉ kéo sang **HOÀN THÀNH** sau khi PR merge vào `main` và test pass.
- Vướng trên 30 phút: kéo sang **BLOCKED**, comment nguyên nhân và điều kiện gỡ chặn.
- Mỗi người tối đa một card **ĐANG LÀM**.

## Ranh giới A/B

- A sở hữu `app/src/main/{ssh,crypto,db,detectors,deploy,migrate}`, `app/src/renderer` và
  `templates/`.
- B sở hữu `ml-service/`, `collector/`, `experiments/` và `app/src/main/monitor/`.
- `docs/contracts/` là vùng chung. Mọi thay đổi contract phải có card label
  `Contract - ca hai duyet` và cả hai review PR.
