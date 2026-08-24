# Kịch bản demo VPS Management + Deploy cơ bản

**Thời lượng mục tiêu:** 6–8 phút

**Phạm vi:** thêm và kiểm tra một VPS thật, quét môi trường/tài nguyên, deploy Express thật bằng
Docker, xác minh healthcheck và phiên bản.

**Không demo:** monitoring/ML anomaly, migrate, database designer, rollback.

> **Lần kiểm thử hiện tại:** lần 2, bắt đầu từ trạng thái sạch được tạo lúc 02:53 ngày
> 25/08/2026. Thực hiện tuần tự từ mục 2 đến mục 8; ghi kết quả vào phiếu ở mục 12.

Tài liệu này là runbook thao tác trực tiếp. Kiến trúc và phạm vi đầy đủ xem
[`19-ho-so-review-va-chot-kien-truc.md`](19-ho-so-review-va-chot-kien-truc.md); bằng chứng kỹ
thuật của lát cắt deploy xem [`tasks/tk-a13-m4-deploy-slice.md`](tasks/tk-a13-m4-deploy-slice.md).

---

## 1. Trạng thái đầu vào bắt buộc

Trước buổi demo, hệ thống phải ở trạng thái:

- OpsPilot chưa lưu VPS, app, deployment hay history của lần tập trước (`0/0/0/0`).
- VM01 không còn container/image `express-api`; port `30000` trống.
- VM01 vẫn giữ SSH, Docker, Docker Compose, Git và quyền ghi `/opt/opspilot`.
- WARP ở trạng thái `Disconnected`.
- Source demo còn nguyên tại `demo-apps/express-api`.
- Branch chạy demo chứa bản sửa [PR #23](https://github.com/everestt2806/opspilot/pull/23).

Reset gần nhất trước lần test 2 đã hoàn tất ngày 25/08/2026. Backup khôi phục nằm tại:

- Local: `tmp/demo-reset-backups/20260825-025303/`
- VM01: `/home/deploy/.opspilot-demo-backups/20260825-025304/express-api`

Backup của lần dọn trước vẫn nằm tại:

- Local: `tmp/demo-reset-backups/20260824-201240/`
- VM01: `/home/deploy/.opspilot-demo-backups/20260824-201240/express-api`

Không xóa các backup này trước khi demo xong.

## 2. Chuẩn bị trước khi chiếu màn hình

### 2.1 Chạy ứng dụng

Mở PowerShell tại repo:

```powershell
cd D:\Developing\DuAnCNTT
git branch --show-current
. .\tools\enter-node22.ps1
warp-cli status
pnpm dev
```

Nếu PR #23 chưa merge, kết quả branch phải là:

```text
fix/redeploy-postgres-password
```

Nếu PR đã merge, có thể chạy từ `main` sau `git pull --ff-only`.

### 2.2 Chuẩn bị credential an toàn

- Chuẩn bị mật khẩu VM01 trong clipboard nhưng **không** ghi vào file hoặc tài liệu.
- Khi chiếu màn hình, chọn xác thực `Password` để ký tự được che.
- Không chọn `SSH key`: form hiện private key trong textarea và có thể làm lộ key trên máy chiếu.
- Không gửi credential vào chat, commit, ảnh chụp hoặc log.

### 2.3 Câu mở đầu

> Hôm nay em demo hai chức năng nền tảng của OpsPilot: quản lý VPS qua SSH và triển khai một
> ứng dụng Express thật lên VPS bằng Docker. Hệ thống đang ở trạng thái chưa có VPS và chưa có
> ứng dụng để thể hiện đầy đủ luồng từ đầu.

---

## 3. Màn 1 — Thêm và kiểm tra VPS

### 3.1 Cho thấy trạng thái ban đầu

1. Mở menu **VPS**.
2. Kiểm tra title bar chỉ có **một logo OpsPilot**, tiêu đề `OpsPilot — VPS`, trạng thái ML,
   nút Light/Dark và ba nút thu nhỏ/phóng to/đóng. Không còn header cũ ở bên dưới.
3. Thử nhanh nút thu nhỏ rồi mở lại app; không cần bấm đóng trong lúc test luồng chính.
4. Chỉ vào các số liệu ban đầu:
   - Total VPS: `0`
   - Total apps: `0`
   - `No VPS yet`
5. Nhấn **Add VPS**.

### 3.2 Điền form

| Trường | Giá trị |
|---|---|
| VPS name | `VM01` |
| Host or IP | `221.121.1.79` |
| SSH port | `22` |
| Username | `root` |
| Auth method | `Password` |
| Password | Mật khẩu VM01 — tự nhập, không đọc thành tiếng |
| Provider | `WiService` |
| Region | Có thể để trống nếu chưa chốt tên datacenter |

### 3.3 Kiểm tra trước khi lưu

1. Nhấn **Check connection**.
2. Chờ banner **Connection successful**.
3. Chỉ vào ba kết quả:
   - `Kết nối SSH — OK`
   - `Docker — 29.7.2`
   - `Ghi được /opt/opspilot — OK`
4. Nhấn **Save**.

Lời nói gợi ý:

> OpsPilot thử kết nối thật trước khi lưu. Credential được mã hóa trong SQLite cục bộ và không
> xuất hiện trong log. VPS không cần cài agent thường trực; luồng điều khiển đi qua SSH.

### 3.4 Kết quả cần thấy ở danh sách

Chờ quá trình đọc tài nguyên hoàn tất:

- Total VPS: `1`
- Online: `1`
- Total apps: `0`
- IP: `221.121.1.79`
- Có số liệu CPU/RAM/disk thật và Docker version

Nếu dòng VPS còn `Checking`, chờ vài giây; chỉ nhấn **Refresh** nếu quá trình không tự hoàn tất.

---

## 4. Màn 2 — VPS Control Panel

1. Bấm vào dòng **VM01**.
2. Trong tab **Overview**, cho xem:
   - host, SSH port và username;
   - provider;
   - Docker version và Last seen;
   - CPU load, RAM, disk ở sidebar.
3. Chờ card **Environment scan** chạy xong.

Kết quả dự kiến:

| Hạng mục | Kết quả |
|---|---|
| SSH connection | Đạt |
| Docker | `29.7.2` |
| Docker Compose | `v5.5.0` |
| Node.js | Not installed |
| Git | `2.43.0` |
| Workspace `/opt/opspilot` | Đạt |

Có thể nhấn **Scan again** một lần để chứng minh dữ liệu được đọc trực tiếp từ VM01.

Nếu giảng viên hỏi vì sao Node.js báo thiếu:

> Node không cần cài trên host vì runtime của ứng dụng nằm trong Docker image. VPS chỉ cần SSH,
> Docker và Docker Compose. Đây là chủ ý cô lập runtime, không phải lỗi deploy.

Sau đó mở tab **Apps & deploy**. Trạng thái đúng trước deploy là:

```text
No apps on this server yet.
```

Nhấn **Deploy new app**. Nút này mở Deploy Wizard và chọn sẵn VM01.

---

## 5. Màn 3 — Deploy Wizard

### 5.1 Source

1. Xác nhận Target VPS là `VM01`.
2. Nhấn **Choose folder**.
3. Chọn:

```text
D:\Developing\DuAnCNTT\demo-apps\express-api
```

4. Chờ `Detecting framework…` biến mất.
5. Nhấn **Next**.

Lời nói gợi ý:

> Đây là ứng dụng Express mẫu có healthcheck, CRUD items và PostgreSQL. OpsPilot đọc source để
> sinh kế hoạch deploy thay vì yêu cầu người dùng tự viết Dockerfile và Compose.

### 5.2 Detect

Chỉ vào các trường được nhận diện:

- Framework: `Express`
- Version: khoảng `4.21.2`
- Build command: `npm ci --omit=dev`
- Container port: `3000`
- Healthcheck path: `/health`
- Dockerfile template: `express.Dockerfile`
- Database: PostgreSQL được tool dựng kèm
- File tree có `package.json`, `server.js`, `public/index.html`, `.env.example`

Lời nói gợi ý:

> Detector đọc package.json, dependency, entrypoint, biến môi trường và route healthcheck để tạo
> BuildPlan. Cấu hình này không hard-code theo VM01.

Nhấn **Next**.

### 5.3 Configuration

Điền đúng:

| Trường | Giá trị |
|---|---|
| Application on VPS | `Create a new application` |
| Application name | `express-api` |
| `DATABASE_URL` | Để trống |
| `PORT` | `3000` |

`PORT` là biến bắt buộc. Nếu để trống, wizard sẽ không cho tiếp tục.

Lời nói gợi ý:

> DATABASE_URL được để trống để OpsPilot tự dựng PostgreSQL, sinh mật khẩu ngẫu nhiên và ghi vào
> `.env` có quyền 600 trên VPS. Secret không được phát qua event hoặc ghi vào log.

Nhấn **Next**.

### 5.4 Review & Deploy

Precheck tự chạy. Cả bốn hàng cần xanh:

- RAM trống
- Disk trống
- Port `30000` chưa dùng
- Docker đã cài

URL dự kiến:

```text
http://221.121.1.79:30000
```

Lời nói gợi ý:

> Trước khi triển khai, OpsPilot kiểm tra tài nguyên, Docker và xung đột port. App mới được cấp
> port đầu tiên còn trống trong dải 30000–30999.

Nhấn **Deploy**.

---

## 6. Màn 4 — Pipeline và log trực tiếp

Trong khoảng 20–60 giây chờ deploy, giải thích từng bước:

1. `PRECHECK` — kiểm tra điều kiện VM01.
2. `UPLOAD` — nén và gửi source qua SSH.
3. `RENDER` — sinh Dockerfile, Compose và `.env`.
4. `BUILD` — build image `express-api:v1`.
5. `DEPLOY` — khởi động app và PostgreSQL bằng Docker Compose.
6. `HEALTHCHECK` — gọi `/health` đến khi ứng dụng sẵn sàng.
7. `RECORD` — lưu version, duration và kết quả vào SQLite.

Kết quả đạt:

- Bảy bước có dấu hoàn thành.
- Banner `Deploy succeeded`.
- URL dùng port `30000`.

Bấm **Open app** để mở landing page vừa được deploy trên trình duyệt.

---

## 7. Màn 5 — Chứng minh ứng dụng và dữ liệu thật

Landing page tại `http://221.121.1.79:30000/` phải hiện:

- `Live on VPS` và `Healthy`.
- Storage engine là `PostgreSQL`.
- Inventory records là `1.000`.
- Runtime Node và container uptime đang tăng.
- Các bước Source → Docker → Container → PostgreSQL → Healthcheck đều xanh.

Tại ô **New inventory item**:

1. Nhập `demo-with-lecturer`.
2. Bấm **Create record**.
3. Chỉ cho giảng viên thấy thông báo tạo bản ghi thành công, tổng tăng từ `1.000` lên `1.001`
   và bản ghi mới xuất hiện đầu bảng.

Lời nói gợi ý:

> Trang này không phải mock tĩnh. Nút vừa bấm gọi `POST /items` vào Express trên VPS, ghi xuống
> PostgreSQL rồi đọc lại bằng API. Như vậy luồng browser → container → database đã được kiểm
> chứng sau deploy.

Nếu cần chứng minh thêm bằng API, bấm **Open healthcheck** và **Inspect JSON API** trên landing
page. Hoặc chạy ở PowerShell:

```powershell
curl.exe -s -D - "http://221.121.1.79:30000/items?limit=5" -o NUL |
    findstr /I "HTTP/ X-Total-Count"
```

Kết quả:

```text
HTTP/1.1 200 OK
X-Total-Count: 1001
```

Lời nói gợi ý:

> Healthcheck trả 200 từ mạng ngoài. Dữ liệu nằm trong PostgreSQL chạy cùng ứng dụng; hệ thống
> seed 1.000 bản ghi và bản ghi thứ 1.001 vừa được tạo trực tiếp trong buổi demo.

---

## 8. Kết thúc demo

Quay lại OpsPilot:

1. Vào **VPS** → chọn **VM01**.
2. Mở **Apps & deploy**.
3. Chỉ vào:
   - Name: `express-api`
   - Framework: `express`
   - Port: `30000`
   - Version: `v1`
   - Status: `Running`
4. Mở tab **Activity** để cho thấy các bước và bản ghi deploy thành công.

Câu kết:

> Luồng vừa chạy hoàn toàn từ giao diện: thêm và kiểm tra VPS, quét môi trường, đọc tài nguyên,
> nhận diện source, deploy bằng Docker, healthcheck và lưu lịch sử phiên bản.

Nếu được hỏi về tiến độ toàn đề tài:

> Nhóm đã hoàn thiện lát cắt nền tảng VPS Management và Deploy chạy thật. Collector metric,
> dashboard giám sát, phát hiện bất thường ML và migrate là các milestone tiếp theo; nhóm không
> tuyên bố các phần đó đã hoàn tất trong buổi demo này.

### 8.1 Nếu được hỏi: một VPS chạy nhiều app thế nào?

OpsPilot đã tách từng app theo bốn lớp:

- Tên app duy nhất trên VPS, ví dụ `express-api`, `admin-web`, `worker-api`.
- Thư mục riêng: `/opt/opspilot/<app-name>`.
- Container/Compose và PostgreSQL volume riêng theo tên app.
- Host port riêng, tự lấy cổng nhỏ nhất còn trống trong dải `30000–30999`.

Ví dụ trên VM01:

| App           | Container port | Public port | URL                         |
| ------------- | -------------: | ----------: | --------------------------- |
| `express-api` |           3000 |       30000 | `http://221.121.1.79:30000` |
| `admin-web`   |           3000 |       30001 | `http://221.121.1.79:30001` |
| `worker-api`  |           8000 |       30002 | `http://221.121.1.79:30002` |

Deploy lại đúng app sẽ tăng version nhưng giữ nguyên public port. Số app thực tế bị giới hạn bởi
RAM/CPU/disk của VPS chứ không phải bởi mô hình dữ liệu; precheck phải đạt trước mỗi lượt deploy.

---

## 9. Những thao tác không làm trong buổi demo

- Không mở Database Designer, Migrate hoặc monitoring/ML anomaly.
- Không xóa/sửa VPS sau khi kết nối thành công.
- Không bấm Install Docker vì Docker đã được cài.
- Không redeploy lần hai nếu thời gian hạn chế.
- Không bật WARP trong khi ứng dụng đang SSH/deploy.

## 10. Xử lý nhanh khi có sự cố

| Hiện tượng | Xử lý |
|---|---|
| SSH timeout | Kiểm tra `warp-cli status`; WARP phải `Disconnected` |
| Authentication failed | Kiểm tra username `root` và nhập lại mật khẩu, không đọc mật khẩu thành tiếng |
| Resource còn `Checking` | Chờ vài giây rồi nhấn `Refresh` một lần |
| Node.js đỏ | Tiếp tục demo; đây là trạng thái dự kiến |
| Precheck báo port 30000 đã dùng | Dừng, không Deploy; cần dọn container cũ trước |
| Build chậm | Chờ tối đa 3 phút; không bấm Deploy lần hai |
| URL `/` trả `Cannot GET /` | Source cũ đang chạy; kiểm tra có `public/index.html`, dọn app cũ rồi deploy lại |
| `/health` chưa lên ngay | Chờ 5–10 giây rồi refresh; đối chiếu bước HEALTHCHECK trên log |

## 11. Sau lần tập và reset cho lượt kế tiếp

1. Đóng hoàn toàn OpsPilot để SQLite checkpoint và ngắt SSH sạch.
2. Không tự xóa container/database thủ công.
3. Chạy kiểm tra read-only; lệnh này chỉ in local DB và trạng thái `express-api` trên VM01:

```powershell
pnpm --filter @opspilot/app demo:reset
```

4. Chỉ khi thật sự muốn tạo backup rồi dọn, chạy:

```powershell
pnpm --filter @opspilot/app demo:reset -- --apply
```

Script có guard khóa đúng `VM01` (`221.121.1.79`) và `express-api`; nó từ chối chạy nếu tên/IP
không khớp. Thứ tự xử lý là: backup SQLite + credential đã mã hóa + UI session → backup file
app và `pg_dumpall` trên VM01 → `docker compose down -v` → xóa image/workspace app → xác minh
port `30000` trống → đưa local DB về `0/0/0/0`. Docker, SSH, Git và VM02 không bị xóa.

## 12. Phiếu kết quả lần kiểm thử 2

Điền ngay trong lúc test để sau đó có thể đối chiếu khi chuẩn bị demo thật:

| Checkpoint | Kết quả mong đợi | Kết quả lần 2 | Ghi chú |
|---|---|---|---|
| Branch và WARP | Đúng branch demo; WARP `Disconnected` | ☐ PASS / ☐ FAIL | |
| Giao diện khởi động | Một title bar, một logo; window controls hoạt động | ☐ PASS / ☐ FAIL | |
| Trạng thái local sạch | VPS/app/deployment/history đều `0` | ☐ PASS / ☐ FAIL | |
| Add VPS + Check connection | SSH, Docker, `/opt/opspilot` đều đạt | ☐ PASS / ☐ FAIL | |
| VPS resource + scan | Online; CPU/RAM/disk và môi trường có dữ liệu thật | ☐ PASS / ☐ FAIL | |
| Apps trước deploy | `No apps on this server yet` | ☐ PASS / ☐ FAIL | |
| Detect source | Express, port `3000`, PostgreSQL, `/health` | ☐ PASS / ☐ FAIL | |
| Precheck | RAM/disk/Docker/port `30000` đều xanh | ☐ PASS / ☐ FAIL | |
| Pipeline | Đủ 7 bước; log dễ đọc; `Deploy succeeded` | ☐ PASS / ☐ FAIL | |
| Landing page | `/` hiện `Live on VPS`, không còn `Cannot GET /` | ☐ PASS / ☐ FAIL | |
| API + PostgreSQL | Tạo record thứ `1.001`; `/items` trả HTTP 200 | ☐ PASS / ☐ FAIL | |
| App record | `express-api`, port `30000`, `v1`, `Running` | ☐ PASS / ☐ FAIL | |

Thông tin lượt chạy:

- Bắt đầu lúc: `____`
- Kết thúc lúc: `____`
- Commit chạy test: `____`
- Thời gian deploy: `____ giây`
- URL kiểm chứng: `http://221.121.1.79:30000`
- Kết luận: `☐ Sẵn sàng demo / ☐ Cần sửa rồi test lại`
