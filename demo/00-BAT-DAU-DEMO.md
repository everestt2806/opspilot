# KỊCH BẢN DEMO OPSPILOT CHI TIẾT — DEPLOY VÀ MIGRATE

**Ngày demo:** 14/09/2026  
**Phạm vi:** deploy ba loại source Express, Next.js, Vite lên VM02; migrate Vite và Express/PostgreSQL từ VM02 sang VM01.  
**Không demo:** ML, train/score, fault injection, auto rollback.

---

## 0. Bảng điền nhanh — có thể copy nguyên giá trị

### Deploy Express

| Ô trên OpsPilot | Giá trị cần chọn/nhập |
|---|---|
| Target VPS | `VM02 — 221.121.1.80:22` |
| Source folder | `demo\sources\express-api` |
| Application on VPS | `Create a new application` |
| Application name | `demo1409-express` |
| `DATABASE_URL` | **Để trống** |
| `PORT` | `3000` |
| `ENABLE_FAULT_ENDPOINTS` | `false` |

### Deploy Next.js

| Ô trên OpsPilot | Giá trị cần chọn/nhập |
|---|---|
| Target VPS | `VM02 — 221.121.1.80:22` |
| Source folder | `demo\sources\next-blog` |
| Application on VPS | `Create a new application` |
| Application name | `demo1409-next` |
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_SITE_NAME` | `OpsPilot Demo 14-09` |

### Deploy Vite

| Ô trên OpsPilot | Giá trị cần chọn/nhập |
|---|---|
| Target VPS | `VM02 — 221.121.1.80:22` |
| Source folder | `demo\sources\vite-spa` |
| Application on VPS | `Create a new application` |
| Application name | `demo1409-vite` |
| `VITE_API_URL` | Dán URL Express vừa deploy, ví dụ `http://221.121.1.80:30000` |

**Không thêm dấu ngoặc kép** quanh giá trị. Ví dụ nhập `production`, không nhập `"production"`.

---

## 1. Hiểu rõ từng biến môi trường

### `NODE_ENV=production`

Biến này cho ứng dụng Node/Next.js biết nó đang chạy ở môi trường production. Giá trị cần nhập trong buổi demo là đúng chữ thường:

```text
production
```

Không nhập `prod`, `Production`, `development` hoặc `localhost`. Detector Next.js của OpsPilot đưa `NODE_ENV` vào hợp đồng cấu hình bắt buộc. Dockerfile runtime cũng đặt chế độ production để Next chạy bằng `next start`, không chạy development server.

### `NEXT_PUBLIC_SITE_NAME=OpsPilot Demo 14-09`

Đây là tên website xuất hiện ở header và title của source Next.js. Nhập:

```text
OpsPilot Demo 14-09
```

Tiền tố `NEXT_PUBLIC_` có nghĩa biến được đưa vào bundle khi chạy `next build`. Đây là **biến build time**: nếu đổi giá trị sau khi image đã build mà không build lại, giao diện cũ vẫn giữ tên cũ.

Không cần dấu ngoặc kép dù giá trị có khoảng trắng. OpsPilot tự escape giá trị khi truyền cho Docker build.

### `PORT=3000`

Đây là cổng **bên trong container Express**, không phải cổng public bên ngoài VPS. Nhập:

```text
3000
```

OpsPilot sẽ tự chọn cổng public còn trống, thường có dạng `300xx`, rồi ánh xạ:

```text
cổng public trên VPS → cổng 3000 trong container
```

Không lấy số `300xx` ở màn Review điền ngược vào `PORT`.

### `DATABASE_URL` của Express — để trống

Trong demo này phải để ô `DATABASE_URL` trống. Source có driver `pg`, nên OpsPilot nhận ra ứng dụng cần PostgreSQL và tự:

1. Sinh mật khẩu ngẫu nhiên.
2. Tạo service PostgreSQL 16.
3. Tạo URL nội bộ dạng `postgresql://opspilot:<mật-khẩu>@postgres:5432/opspilot`.
4. Chờ PostgreSQL healthy.
5. Khởi động Express sau database.

Không nhập `localhost`, vì trong Docker Compose, `localhost` của container Express không phải container PostgreSQL. Không nhập chuỗi mẫu `postgres://user:pass@localhost:5432/items`; chuỗi đó chỉ minh họa chạy local.

### `ENABLE_FAULT_ENDPOINTS=false`

Nhập đúng:

```text
false
```

Biến này giữ các endpoint `/debug/*` ở trạng thái tắt. Chúng phục vụ thí nghiệm ML/fault và không thuộc demo 14/09. Không nhập `true`.

### `VITE_API_URL`

Biến này cho frontend Vite biết Express API nằm ở đâu. Sau khi deploy Express, OpsPilot hiển thị URL public ở màn Review/kết quả, ví dụ:

```text
http://221.121.1.80:30000
```

Hãy copy nguyên URL đó vào `VITE_API_URL`. Quy tắc:

- Phải bắt đầu bằng `http://` hoặc `https://`.
- Phải gồm đúng IP/domain và cổng public của Express.
- Không thêm `/health`, `/items` hoặc dấu `/` cuối URL.
- Không dùng `localhost:3000`. Trình duyệt sẽ hiểu `localhost` là máy laptop đang trình chiếu, không phải VPS.
- Không dùng URL của Next.js hay URL của chính Vite.

`VITE_API_URL` cũng là **biến build time**. Vite đóng giá trị này vào JavaScript trong bước `npm run build`; muốn đổi API phải deploy/build phiên bản mới.

Source Express trong thư mục demo đã bật CORS cho các request demo từ Vite và expose header `X-Total-Count`, vì hai app chạy ở hai public port khác nhau.

---

## 2. Nguyên lý OpsPilot deploy từng loại source

OpsPilot không chỉ copy source rồi chạy lệnh tùy ý. Nó đọc dấu hiệu trong source và tạo một `BuildPlan` gồm template Dockerfile, lệnh build, lệnh start, container port, healthcheck, biến môi trường và yêu cầu database.

### Express

Dấu hiệu nhận diện:

- Có `package.json`.
- Có dependency `express`.
- Không có `next`.
- Không phải dự án Vite.

Kế hoạch deploy:

```text
npm ci --omit=dev
node server.js
container port 3000
healthcheck /health
PostgreSQL: có, vì source dùng package pg
```

Express là ứng dụng Node chạy động. `PORT`, `DATABASE_URL` và `ENABLE_FAULT_ENDPOINTS` là biến runtime, được ghi vào file `.env` trên VPS với quyền hạn chế.

### Next.js

Dấu hiệu nhận diện:

- Có dependency `next` trong `package.json`.
- Detector Next.js có ưu tiên cao hơn Vite và Express để tránh nhận nhầm.

Kế hoạch deploy:

```text
npm ci && npm run build
npm start
container port 3000
healthcheck /
PostgreSQL: không
```

OpsPilot dùng multi-stage build. Stage builder cài dependency và chạy `next build`; stage runtime chạy `next start`. `NEXT_PUBLIC_SITE_NAME` được truyền thành Docker build arg và đóng vào bundle. `NODE_ENV=production` dùng cho runtime production.

### Vite SPA

Dấu hiệu nhận diện:

- `vite` nằm trong `devDependencies`.
- Không có Next.js.

Kế hoạch deploy:

```text
npm ci && npm run build
output dist/
Nginx phục vụ file tĩnh
container port 80
healthcheck /
PostgreSQL: không
```

`VITE_API_URL` được đưa vào bundle khi build. Image cuối chỉ chứa Nginx và thư mục `dist`, không cần Node chạy ở runtime.

---

## 3. Chuẩn bị trước demo 15–20 phút

1. Không reset hai VPS về trạng thái mới mua.
2. Đóng các cửa sổ OpsPilot/profile thử nghiệm cũ.
3. Mở `demo\01-MO-OPSPILOT-DEMO.cmd`.
4. Vào **VPS**, thêm kết nối cho cả hai máy (DB local đã được reset về trống, demo bắt đầu đúng từ bước kết nối):
   - `VM01 — 221.121.1.79:22`
   - `VM02 — 221.121.1.80:22`
5. Xác nhận VM01 và VM02 đều `Online`.
6. Vào **Triển khai**, mở dropdown Target VPS và xác nhận nhìn thấy cả VM01 lẫn VM02.
7. Chọn VM02 làm VPS deploy nguồn.
8. Kiểm tra RAM bằng **precheck của OpsPilot**, không kết luận từ cột RAM 90% trên portal nhà cung cấp.
9. Chỉ cần hơn 512 MB available, Docker hoạt động, disk đủ và có cổng public trống.
10. Không chạy hai build đồng thời. Deploy lần lượt Express → Next.js → Vite.
11. Mở sẵn trình duyệt và một file ghi chú để lưu URL Express.

Câu mở đầu:

> OpsPilot nhận source code từ máy phát triển, tự nhận diện framework, tạo BuildPlan và triển khai qua một pipeline thống nhất. Hôm nay nhóm trình diễn Express có PostgreSQL, Next.js và Vite; sau đó di chuyển một app stateless và một app có dữ liệu giữa hai VPS.

---

## 4. Deploy Express lên VM02 — thao tác từng màn hình

### Màn 1 — Source

1. Vào **Triển khai**.
2. Tại **Target VPS**, chọn `VM02 — 221.121.1.80:22`.
3. Bấm **Choose folder**.
4. Chọn đúng thư mục `demo\sources\express-api`.
5. Chờ dòng Detecting kết thúc rồi bấm **Next**.

### Màn 2 — Detect

Phải thấy:

```text
Framework: Express
Build command: npm ci --omit=dev
Container port: 3000
Healthcheck path: /health
Database: Postgres runs alongside the app
```

Nếu framework khác Express hoặc detector báo đỏ, dừng và chọn lại đúng thư mục chứa `package.json`.

### Màn 3 — Configuration

1. **Application on VPS:** chọn `Create a new application`.
2. **Application name:** nhập `demo1409-express`.
3. Nhập các biến:

```text
DATABASE_URL              [để trống]
PORT                      3000
ENABLE_FAULT_ENDPOINTS    false
```

4. Không tạo file `.env` trong source và không bấm thêm optional variable.
5. Bấm **Next**.

### Màn 4 — Review & Deploy

1. Đợi precheck chạy xong.
2. Kiểm tra RAM, disk, Docker và port đều PASS.
3. Ghi lại **URL to use**, ví dụ `http://221.121.1.80:30000`.
4. Chỉ khi toàn bộ precheck xanh mới bấm **Deploy**.
5. Theo dõi đủ bảy bước:

```text
PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → RECORD
```

Ý nghĩa:

- `PRECHECK`: kiểm tra SSH, Docker, RAM, disk và cổng.
- `UPLOAD`: đóng gói và tải source lên VPS.
- `RENDER`: sinh Dockerfile, Compose và `.env`.
- `BUILD`: build image version mới.
- `DEPLOY`: tạo app container, PostgreSQL và collector.
- `HEALTHCHECK`: đợi `/health` trả kết quả đạt yêu cầu.
- `RECORD`: ghi deployment ID, image tag, port và trạng thái vào lịch sử.

### Nghiệm thu Express

1. Bấm **Open app**.
2. Giao diện phải báo storage là PostgreSQL và có 1000 bản ghi seed.
3. Tạo item tên `MARKER-DEMO-1409`.
4. Reload trang; marker phải còn.
5. Mở `<URL-EXPRESS>/meta` nếu cần chứng minh runtime/storage.
6. Copy URL Express vào ghi chú để deploy Vite.

Câu thuyết minh:

> OpsPilot tự tạo PostgreSQL và mật khẩu vì source có driver pg và tôi để DATABASE_URL trống. App chỉ được ghi nhận thành công sau khi database và endpoint health đều healthy.

---

## 5. Deploy Next.js lên VM02 — thao tác từng màn hình

### Source và Detect

1. Quay về **Triển khai**.
2. Chọn VM02.
3. Chọn `demo\sources\next-blog`.
4. Detector phải báo **Next.js**.
5. Xác nhận container port `3000`, healthcheck `/`, database không cần.

### Configuration

Nhập:

```text
Application on VPS        Create a new application
Application name          demo1409-next
NODE_ENV                   production
NEXT_PUBLIC_SITE_NAME     OpsPilot Demo 14-09
```

`NEXT_PUBLIC_SITE_NAME` có khoảng trắng nhưng không cần ngoặc kép.

### Review, deploy và nghiệm thu

1. Chờ precheck xanh rồi bấm Deploy.
2. Next build thường lâu hơn Express/Vite; không bấm Deploy lần hai khi log vẫn đang chạy.
3. Chờ đủ bảy bước PASS.
4. Mở URL.
5. Header phải hiển thị `OpsPilot Demo 14-09`.
6. Mở trang chủ và ít nhất một bài viết.
7. Trong Apps/Versions, kiểm tra container healthy, HTTP 2xx và image `vN`.

Câu thuyết minh:

> Next.js được build thành image qua multi-stage Docker build. NEXT_PUBLIC_SITE_NAME được đóng vào bundle lúc build, còn NODE_ENV=production xác định chế độ chạy production.

---

## 6. Deploy Vite lên VM02 — thao tác từng màn hình

### Source và Detect

1. Quay về **Triển khai**.
2. Chọn VM02.
3. Chọn `demo\sources\vite-spa`.
4. Detector phải báo **Vite SPA**.
5. Xác nhận container port `80`, healthcheck `/`, database không cần.

### Configuration

Nhập:

```text
Application on VPS        Create a new application
Application name          demo1409-vite
VITE_API_URL              <URL Express đã copy>
```

Ví dụ nếu Express được OpsPilot cấp URL `http://221.121.1.80:30000`, nhập nguyên văn:

```text
http://221.121.1.80:30000
```

Không dùng URL ví dụ nếu port thực tế khác.

### Review, deploy và nghiệm thu

1. Chờ precheck xanh rồi bấm Deploy.
2. Chờ đủ bảy bước PASS.
3. Mở URL Vite.
4. Trang phải báo `API health: OK`.
5. Trang phải đọc được danh sách item và tổng số bản ghi từ Express.
6. Nếu thấy lỗi mạng, kiểm tra lại `VITE_API_URL`; vì là build time variable, phải deploy version mới sau khi sửa.
7. Trong Apps/Versions, kiểm tra Nginx/container healthy, HTTP 2xx và image `vN`.

Câu thuyết minh:

> Vite build thành file tĩnh trong dist rồi Nginx phục vụ ở runtime. Frontend gọi Express bằng URL public đã được đóng vào bundle ngay trong bước build.

---

## 7. Chốt phần deploy

Mở **Ứng dụng** hoặc **Lịch sử** và chỉ ra:

- `demo1409-express`: healthy, dùng PostgreSQL, marker tồn tại.
- `demo1409-next`: healthy, đúng tên site, trang bài viết mở được.
- `demo1409-vite`: healthy, frontend gọi Express thành công.

Chỉ tuyên bố deploy thành công khi có đủ detector đúng, deployment ID, image `vN`, container healthy và HTTP 2xx.

---

## 8. Nguyên lý migrate

### Trường hợp stateless — Vite

Vite chỉ có image và cấu hình, không có database/volume nghiệp vụ. OpsPilot đóng gói artifact nguồn, relay qua desktop, khôi phục ở VM01 rồi kiểm tra checksum, runtime và HTTP.

### Trường hợp stateful — Express/PostgreSQL

Express có PostgreSQL nên ngoài image/cấu hình còn phải chuyển dữ liệu. OpsPilot dùng `pg_dump -Fc`, truyền file backup, chờ PostgreSQL đích healthy rồi chạy `pg_restore`. Không sao chép thẳng thư mục data của PostgreSQL đang chạy.

### Vì sao hai VPS không cần SSH trực tiếp với nhau

Desktop OpsPilot mở hai SSH session:

```text
VM02 nguồn → OpsPilot desktop → VM01 đích
```

Payload được relay theo luồng có backpressure; checksum SHA-256 và số byte xác nhận dữ liệu nhận ở đích giống nguồn.

### Ý nghĩa các bước

```text
PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE → VERIFY → AWAITING_CONFIRM
```

- `PREPARE`: kiểm tra source deployment và VPS đích.
- `FREEZE`: tạo điểm nhất quán trước backup.
- `BACKUP`: tạo artifact; với PostgreSQL dùng `pg_dump -Fc`.
- `TRANSFER`: relay artifact qua desktop.
- `RESTORE`: tạo runtime, volume/database và restore trên VM01.
- `VERIFY`: so checksum, byte count, runtime, HTTP và dữ liệu.
- `AWAITING_CONFIRM`: mọi verify đã xong, chờ người dùng quyết định giữ hay dọn nguồn.

Trong demo luôn chọn **Xác nhận, giữ nguồn**. Nguồn VM02 tiếp tục là fallback và evidence phải có `source_kept=true`.

---

## 9. Migrate Vite từ VM02 sang VM01

1. Vào **Di chuyển**.
2. Ở **Chọn app nguồn**, chọn đúng `demo1409-vite` đang thuộc VM02.
3. Ở **Chọn VPS đích**, chọn `VM01 — 221.121.1.79`.
4. Bấm **Bắt đầu migrate** đúng một lần.
5. Theo dõi PREPARE đến VERIFY.
6. Ở bảng verify, kiểm tra mọi hàng PASS, đặc biệt checksum, byte count, image/state và HTTP.
7. Chỉ khi trạng thái là **Đang chờ xác nhận** mới bấm **Xác nhận, giữ nguồn**.
8. Chờ trạng thái `completed`.
9. Mở URL mới trên VM01; nội dung và API health phải giống trước migrate.
10. Không chọn **Xác nhận, dọn nguồn** trong buổi demo.

Câu thuyết minh:

> Đây là migrate stateless. Artifact đi từ VM02 qua desktop sang VM01; checksum và byte count chứng minh payload nguyên vẹn. Tôi giữ nguồn để có phương án quay lại ngay.

---

## 10. Migrate Express/PostgreSQL từ VM02 sang VM01

1. Trước migrate, mở Express trên VM02.
2. Cho thấy `MARKER-DEMO-1409` và tổng số bản ghi.
3. Vào **Di chuyển**.
4. Chọn app nguồn `demo1409-express` thuộc VM02.
5. Chọn đích `VM01 — 221.121.1.79`.
6. Bấm **Bắt đầu migrate** đúng một lần.
7. Theo dõi đủ bảy bước.
8. Ở VERIFY, kiểm tra:
   - SHA-256 nguồn và đích khớp.
   - Số byte transfer khớp.
   - PostgreSQL đích healthy.
   - Row count nguồn và đích khớp.
   - `MARKER-DEMO-1409` tồn tại ở đích.
   - App đích healthy và HTTP/business endpoint hoạt động.
9. Chỉ khi mọi hàng PASS và trạng thái **Đang chờ xác nhận**, bấm **Xác nhận, giữ nguồn**.
10. Chờ `completed`.
11. Mở URL Express trên VM01, reload và chứng minh marker vẫn còn.

Câu thuyết minh:

> HTTP 200 chỉ chứng minh process sống. Row count và marker mới chứng minh dữ liệu PostgreSQL đã được chuyển đúng. Nguồn vẫn được giữ để giảm rủi ro trong demo.

---

## 11. Cách xử lý khi có sự cố

### Không thấy VM01 trong dropdown Deploy

- Đóng và mở lại OpsPilot bằng `01-MO-OPSPILOT-DEMO.cmd`.
- Vào VPS kiểm tra VM01 Online.
- Bản hiện tại dùng control native và phải hiển thị cả VM02 lẫn VM01.

### PRECHECK đỏ

- Không bấm Deploy.
- Đọc chính xác hàng lỗi: SSH, Docker, RAM available, disk hoặc port.
- Sửa nguyên nhân rồi bấm **Check again**.
- Không retry build liên tục và không reset VPS.

### Next.js build lâu

- Chờ log BUILD tiếp tục chạy.
- Không mở thêm một deploy song song.
- Chỉ coi là lỗi khi pipeline trả step-failed/failed rõ ràng.

### Vite mở được nhưng API lỗi

- Đối chiếu `VITE_API_URL` với URL Express thực tế.
- Không dùng `localhost`.
- Đảm bảo Express vẫn running và `<URL-EXPRESS>/health` trả 200.
- Nếu nhập sai, deploy lại Vite để tạo image mới vì biến được đóng lúc build.

### Public port timeout nhưng loopback trên VPS trả 200

- Đối chiếu lại URL: đúng IP, đúng port OpsPilot cấp ở màn Review.
- Thử reload sau vài giây; nếu vẫn timeout, ghi lại hiện tượng và chuyển sang demo phần khác, không dừng cả buổi vì một endpoint.
- Không tuyên bố public access PASS khi chưa thấy HTTP 2xx từ trình duyệt.

### Migration chưa tới AWAITING_CONFIRM

- Không bấm xác nhận.
- Nếu verify fail, chọn hủy/rollback và giữ nguồn.
- Không sửa SQLite hoặc status bằng tay.

### Checksum, row count hoặc marker lệch

- Không tuyên bố migrate thành công.
- Giữ VM02 chạy.
- Ghi lại job ID và hàng verify lỗi để xử lý sau demo.

---

## 12. Kịch bản nói nếu chỉ có 8 phút

1. Mở detector của cả ba source để chứng minh nhận diện đúng.
2. Live deploy Vite vì build nhanh nhất.
3. Dùng Apps/History để cho thấy Express và Next.js đã PASS từ rehearsal; nói rõ đây là lịch sử, không nói vừa chạy live.
4. Live migrate Vite.
5. Live migrate Express/PostgreSQL với marker đã tạo trước.
6. Chốt phần ML bằng câu:

> Phần ML vẫn đang phát triển và cần thêm dữ liệu vận hành đủ sạch để huấn luyện và kiểm chứng. Nhóm dời phần train, score và đánh giá thêm ít nhất hai tuần, dự kiến xem lại từ ngày 28/09/2026.

---

## 13. Checklist cuối trước khi trình chiếu

- [ ] OpsPilot mở được bằng file CMD.
- [ ] VM01 và VM02 đều Online.
- [ ] Dropdown Deploy có cả hai VPS.
- [ ] Không có build/migration cũ đang chạy.
- [ ] Express dùng đúng `PORT=3000`, `ENABLE_FAULT_ENDPOINTS=false`, để trống `DATABASE_URL`.
- [ ] Đã lưu URL Express thật.
- [ ] Next dùng `NODE_ENV=production`.
- [ ] Next dùng `NEXT_PUBLIC_SITE_NAME=OpsPilot Demo 14-09`.
- [ ] Vite dùng đúng URL Express thật, không dùng localhost.
- [ ] Express có `MARKER-DEMO-1409` trước migrate.
- [ ] Vite migrate tới VM01 PASS và giữ nguồn.
- [ ] Express/PostgreSQL migrate tới VM01 PASS, row/marker PASS và giữ nguồn.
- [ ] Không reset VPS, không chạy `docker system prune`, không xóa volume.
- [ ] Đóng các cửa sổ terminal/helper thừa sau demo.
- [ ] Không mở ML và không đưa số accuracy giả.