# Nguyên lý deploy source và migrate hai VPS — demo 14/09/2026

Tài liệu này là phần thuyết minh kỹ thuật để A đọc trước khi trình bày. Phạm vi demo ngày
14/09/2026 chỉ gồm hai năng lực: deploy nhiều loại source lên VPS và migrate ứng dụng giữa hai VPS.
ML, monitor sự cố và tự rollback được dời sang đợt sau, không sớm hơn 28/09/2026.

## 1. Hiện trạng phải nói đúng

- Pipeline deploy Express đã chạy thật trên VM02 theo bảy bước và có rollback khi healthcheck lỗi.
- Repo có ba source demo Tier 1: `demo-apps/express-api`, `demo-apps/next-blog` và
  `demo-apps/vite-spa`.
- Tại thời điểm đổi kế hoạch, engine mới đăng ký detector/template Express. Next.js và Vite SPA
  có source + Dockerfile mẫu nhưng chưa đi qua pipeline chung.
- Migrate mới có schema, IPC contract và màn UI mẫu; chưa có `app/src/main/migrate/**`, IPC runtime
  hoặc UI dùng dữ liệu thật. Vì vậy C04 là implementation mới, không được nhận màn hình mẫu hiện tại
  làm bằng chứng.
- Flask là Tier 2 theo quy tắc dự án và không thuộc demo 14/09.

## 2. Nguyên lý chung của deploy

Deploy biến một thư mục source trên máy A thành một release có định danh chạy trên VPS. Luồng bắt
buộc là:

```text
PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → RECORD
```

1. `PRECHECK` chỉ đọc tài nguyên, Docker và port. Không đạt thì dừng trước khi ghi lên VPS.
2. `UPLOAD` nén source, bỏ `.git`, dependency/build output và chuyển qua SSH vào
   `/opt/opspilot/<app>/src`.
3. `RENDER` lấy `BuildPlan` của detector để sinh Dockerfile, compose và `.env` quyền `600`.
4. `BUILD` build image `<app>:v<N>` ngay trên VPS để không cần registry.
5. `DEPLOY` chạy compose. Nếu app cần PostgreSQL, compose đợi DB healthy rồi mới chạy app.
6. `HEALTHCHECK` gọi URL loopback của VPS tối đa theo contract. Bản mới không khỏe thì pipeline
   tự đưa compose về image trước đó; dữ liệu/volume không bị xóa.
7. `RECORD` chỉ ghi release chạy thành công vào SQLite, cập nhật current deployment và giữ tối đa
   ba image dùng cho rollback.

Detector chỉ đọc cây source và trả `BuildPlan`; detector không SSH, không build và không sửa lõi
pipeline. Thứ tự priority `nextjs 30 > static-spa 20 > express 10` tránh source Next/Vite có
`package.json` bị nhận nhầm thành Express.

## 3. Logic deploy theo từng loại source demo

| Loại        | Cách nhận diện                                           | Cách đóng gói/chạy                                                                   | Port và health                                                      | Dữ liệu                                                                                                           |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Express API | `dependencies.express`, đồng thời không có `next`/`vite` | Node 22, `npm ci --omit=dev`, copy source, chạy `scripts.start` hoặc entry module    | container `3000`; dùng `/health` nếu source khai báo, nếu không `/` | Có driver `pg/prisma/typeorm/sequelize` thì sinh PostgreSQL + `DATABASE_URL`; Mongo chỉ cảnh báo                  |
| Next.js     | `dependencies.next`; priority cao nhất                   | Multi-stage Node 22: cài dependency, `npm run build`, image runtime chạy `npm start` | container `3000`, health `/`                                        | Mặc định stateless; biến `NEXT_PUBLIC_*` dùng lúc build phải đi qua build args, biến server runtime đi qua `.env` |
| Vite SPA    | có `vite` và không có `next`                             | Multi-stage: Node 22 build `dist`, Nginx Alpine phục vụ file tĩnh                    | container `80`, health `/`                                          | Stateless; `VITE_*` được đóng vào bundle lúc build, không được giả rằng đổi env runtime sẽ đổi JS đã build        |

Mỗi loại chỉ được tính thành công khi detector hiển thị đúng lý do, build thật, container đúng image
`vN`, health HTTP 2xx từ VPS và đường truy cập dùng cho demo mở được. Việc source đã có Dockerfile
riêng không thay cho kiểm chứng template của OpsPilot vì luồng sản phẩm sinh Dockerfile từ
`BuildPlan`.

## 4. Nguyên lý chung của migrate

Migrate chỉ nhận app do OpsPilot đã deploy, vì khi đó tool biết source, compose, port, volume và
release hiện tại. Luồng là:

```text
PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE → VERIFY → AWAITING_CONFIRM
```

1. `PREPARE`: kiểm tra SSH/Docker/RAM/disk/port đích, dung lượng backup dự kiến và khóa app để
   không deploy/migrate đồng thời.
2. `FREEZE`: dừng riêng app ở nguồn để chặn ghi mới; PostgreSQL vẫn chạy phục vụ `pg_dump`. Đây là
   lúc bắt đầu đo downtime bằng đồng hồ nguồn.
3. `BACKUP`: đóng gói source, compose metadata, `.env` và dữ liệu. PostgreSQL dùng logical dump
   `pg_dump -Fc`; không dùng bản tar thư mục dữ liệu PostgreSQL đang chạy để restore. Mỗi artifact
   có size và SHA-256.
4. `TRANSFER`: stream nguồn → máy A → đích qua hai kết nối SSH, nên hai VPS không cần thấy nhau.
   Ghi byte thực chuyển và xác minh checksum ở đích; không ghi secret vào log hoặc SQLite.
5. `RESTORE`: giải nén source/dữ liệu không phải DB, render/build/deploy ở đích; app có PostgreSQL
   thì chờ DB đích healthy, `pg_restore`, rồi mới mở app.
6. `VERIFY`: so checksum artifact, số row từng bảng PostgreSQL nếu có, image/state đích và HTTP
   health/business probe. Health 2xx một mình không chứng minh dữ liệu đã sang đủ.
7. `AWAITING_CONFIRM`: chỉ khi mọi verify PASS mới cho xác nhận. Demo chọn **giữ nguồn** để có
   fallback; app đích là bản chính sau xác nhận, bản nguồn được ghi rõ là bản dự phòng.

Lỗi trước verify phải dọn tài nguyên mới tạo ở đích và khởi động lại app nguồn. Verify lệch phải dừng
app đích, khởi động nguồn, giữ artifact đủ để điều tra và không cho xác nhận thành công. Không xóa
nguồn hoặc volume khi chưa có thao tác xác nhận riêng.

## 5. Logic theo từng trường hợp migrate

| Trường hợp                      | Backup/restore                                                  | Verify bắt buộc                                                                                    | Dùng trong demo 14/09                                                              |
| ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Stateless — Next.js/Vite        | source + config + `.env`; build image mới ở đích                | SHA-256 artifact, image/state, HTTP 2xx và nội dung nhận diện release                              | Bắt buộc một lượt live, ưu tiên Vite để nhanh                                      |
| Stateful PostgreSQL — Express   | source/config + `pg_dump -Fc` + file persistent ngoài `data/pg` | SHA-256, row count từng bảng, marker nghiệp vụ trước/sau, image/state, health và business endpoint | Bắt buộc một lượt live với marker có trước migrate                                 |
| File-volume không DB            | source/config + archive file volume                             | SHA-256 từng archive/file đại diện, count file/byte, health                                        | Có unit/integration test và giải thích; không cần tạo app giả chỉ để demo          |
| Hybrid PostgreSQL + file-volume | kết hợp logical dump và archive file ngoài PG                   | toàn bộ kiểm tra của hai nhóm, chỉ PASS khi tất cả khớp                                            | Pipeline phải không loại trừ; live chỉ cần nếu Express demo thực sự có file volume |

Hai lượt live dùng app riêng của TK-A17, port riêng và hai VPS thật. Không dùng app B, không dùng cùng
một VPS rồi gọi là migrate. Lượt stateless và stateful có thể chạy cùng một hướng để giảm rủi ro;
chiều ngược lại được kiểm bằng test và chỉ chạy live nếu cần đưa môi trường về trạng thái rehearsal.

## 6. Bằng chứng A cần xem trước khi nói “thành công”

Deploy cần bảng ba hàng Express/Next/Vite gồm detector, build plan, deployment ID, image, port,
container health, URL và ảnh trình duyệt. Migrate cần hai bảng stateless/stateful gồm source/target,
artifact checksum, byte transfer, row/file count, marker, runtime image, HTTP, downtime và lựa chọn
giữ nguồn. Mọi số phải lấy từ raw command/SQLite ở đúng SHA bàn giao.

## 7. Cách trình bày phần ML

> Phần ML vẫn đang phát triển và cần thêm dữ liệu vận hành đủ sạch để huấn luyện, kiểm chứng. Nhóm dời
> phần train/score và đánh giá sang ít nhất hai tuần sau demo này, dự kiến xem lại từ 28/09/2026.

Không train, score, reset model hoặc đưa số accuracy giả trong demo 14/09. Dữ liệu collector/SQLite đã
có vẫn được giữ nguyên để dùng cho giai đoạn ML sau.
