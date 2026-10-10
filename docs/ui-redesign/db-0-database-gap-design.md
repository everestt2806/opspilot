# Thiết Kế Kiến Trúc & Kế Hoạch Xử Lý GAP AC-3.2: Quản Trị PostgreSQL Trên VPS (Checkpoint DB-0)

> **Mục tiêu tài liệu**: Báo cáo audit chuyên sâu và đề xuất giải pháp thiết kế kiến trúc toàn diện cho khiếm khuyết duy nhất còn lại sau đợt tái thiết kế UI (**GAP AC-3.2**: Tab Cơ sở dữ liệu trên trang Chi tiết VPS chưa hỗ trợ kết nối IPC backend).
> **Phạm vi Checkpoint DB-0**: Thuần túy audit mã nguồn và đề xuất thiết kế kiến trúc. **Chưa viết mã runtime, chưa thay đổi IPC contract và không tự ý đánh dấu AC-3.2 PASS**.

---

## 1. Hiện Trạng Audit & Phân Tích Nguyên Nhân Gốc Rễ

### 1.1. Đối chiếu các thành phần mã nguồn hiện hữu

Qua quá trình đối chiếu chéo giữa các tầng của ứng dụng:

1. **Giao diện người dùng (`app/src/renderer/src/components/VpsDatabaseTab.tsx`)**:
   - Đã được xây dựng giao diện hoàn chỉnh với 2 bảng dữ liệu chính (*Database Users* và *Databases*), modal tạo người dùng, modal tạo database, trình thiết kế schema đồ họa (`DbSchemaDesigner`), tính năng import/export file CSV/JSON và xem trước câu lệnh SQL DDL.
   - Nhận thuộc tính `supported?: boolean` với giá trị mặc định là `false` (`supported = false`).
   - Khi `!supported`, component hiển thị màn hình trống (`Empty`) với thông báo: *"Chưa hỗ trợ cơ sở dữ liệu - Tính năng quản lý cơ sở dữ liệu trên máy chủ hiện chưa khả dụng trong OpsPilot"*.
   - Khối gọi IPC nội bộ `callDb()` đã được bọc an toàn; nếu backend chưa xử lý kênh, UI sẽ nhận lỗi `UNKNOWN` trung thực thay vì giả lập thành công.

2. **Khung vỏ Chi tiết VPS (`app/src/renderer/src/components/VpsDetail.tsx`)**:
   - Tại Tab 3 (`key: 'database'`), component render `<VpsDatabaseTab vpsId={vps.id} />` nhưng **không truyền thuộc tính `supported`**, khiến `supported` luôn nhận giá trị mặc định là `false`.

3. **Hợp đồng IPC (`app/src/shared/ipc.ts`)**:
   - Đã khai báo các kiểu dữ liệu DTO (`DbDatabase`, `DbUser`, `DbUserInput`, `DbSchemaTable`, `DbSchemaColumn`, `DbSchemaForeignKey`, `DbImportInput`, `DbExportFile`, `DbQueryResult`).
   - Đã định nghĩa 9 kênh invoke trong `IpcInvokeMap`:
     - `db:list-databases`: `(vpsId: number) => IpcResult<DbDatabase[]>`
     - `db:create-database`: `(vpsId: number, name: string) => IpcResult<DbDatabase>`
     - `db:list-users`: `(vpsId: number) => IpcResult<DbUser[]>`
     - `db:create-user`: `(vpsId: number, input: DbUserInput) => IpcResult<DbUser>`
     - `db:list-tables`: `(vpsId: number, database: string) => IpcResult<DbSchemaTable[]>`
     - `db:save-schema`: `(vpsId: number, database: string, ddl: string) => IpcResult<void>`
     - `db:import-data`: `(vpsId: number, database: string, input: DbImportInput) => IpcResult<{ imported_tables: number; imported_rows: number }>`
     - `db:export-data`: `(vpsId: number, database: string, format: 'json' | 'csv' | 'sql') => IpcResult<DbExportFile>`
     - `db:query`: `(vpsId: number, database: string, sql: string) => IpcResult<DbQueryResult>`
   - *Ghi chú trong mã nguồn*: Kênh được phác thảo từ giai đoạn TK-B9 với giả định chạy lệnh dạng: `docker compose exec -T db psql -U opspilot -At -c "<sql>"`.

4. **Đối chiếu mã lỗi `IpcError.code` hiện hành**:
   - Tập hợp mã lỗi hiện hành trong `app/src/shared/ipc.ts` bao gồm:
     `'SSH_AUTH_FAILED' | 'SSH_TIMEOUT' | 'SSH_HOST_UNREACHABLE' | 'DOCKER_MISSING' | 'DOCKER_BUILD_FAILED' | 'PRECHECK_FAILED' | 'HEALTHCHECK_FAILED' | 'DETECT_FAILED' | 'PORT_EXHAUSTED' | 'ML_SERVICE_DOWN' | 'DB_ERROR' | 'DB_ADMIN_FAILED' | 'VALIDATION' | 'UNKNOWN'`
   - Bất kỳ mã lỗi mới nào nằm ngoài tập hợp này (ví dụ: `DB_NOT_READY`, `CONTAINER_STOPPED`, `SSH_CONNECTION_FAILED`) đều là **thay đổi IPC contract cần được phê duyệt** trước khi áp dụng.

5. **Tiến trình chính Main (`app/src/main/ipc.ts`)**:
   - Trong hàm `registerIpcHandlers()`, **chưa đăng ký bất kỳ handler nào** cho các kênh có tiền tố `db:*`.

---

## 2. Kiến Trúc Thực Tế: PostgreSQL Trên VPS Trong OpsPilot

### 2.1. Cấu trúc triển khai: Isolated Per-App Container

Khác với giả định ban đầu về một container PostgreSQL dùng chung toàn VPS (`docker compose exec -T db`), kiến trúc triển khai thực tế của OpsPilot (được hiện thực hóa trong [`templates.ts`](../../app/src/main/deploy/templates.ts) và [`pipeline.ts`](../../app/src/main/deploy/pipeline.ts)) hoạt động theo nguyên lý **cô lập hoàn toàn theo từng ứng dụng (Per-App Container)**:

- Khi một ứng dụng được triển khai với `needs_db === 1`:
  - Mã nguồn và cấu hình được đặt tại thư mục riêng biệt trên VPS: `/opt/opspilot/${APP_NAME}/`.
  - Tệp `docker-compose.yml` định nghĩa một service `postgres` riêng biệt:
    - **Tên container**: `${APP_NAME}-db` (ví dụ: `express-api-db`, `next-blog-db`).
    - **Image**: `postgres:16-alpine`.
    - **Lưu trữ dữ liệu**: Volume cục bộ `./data/pg:/var/lib/postgresql/data` (nằm trong thư mục của chính app đó).
    - **Giới hạn tài nguyên**: `mem_limit: 256m`.
    - **Mạng nội bộ**: Port 5432 **không mở ra ngoài host** (không có `ports:` host mapping), chỉ giao tiếp nội bộ trong mạng Docker của ứng dụng.
    - **Thông tin đăng nhập mặc định**: User `opspilot`, Database `opspilot`, mật khẩu sinh ngẫu nhiên lưu trong `/opt/opspilot/${APP_NAME}/.env` (`POSTGRES_PASSWORD`).

### 2.2. Vấn đề cốt lõi khi một VPS có nhiều ứng dụng (Multi-app VPS)

Khi trên cùng một máy chủ VPS có nhiều ứng dụng cùng sử dụng cơ sở dữ liệu (ví dụ: cả `express-api` và `next-blog` đều có `needs_db = 1`):
1. **Xung đột định danh (Name Collision)**: Cả 2 container độc lập đều mặc định khởi tạo một database có tên là `opspilot`. Nếu chỉ trả về danh sách database phẳng dạng `[{ name: 'opspilot' }, { name: 'opspilot' }]`, người dùng không thể phân biệt được database nào thuộc về ứng dụng nào.
2. **Nguy cơ sai mục tiêu khi tự suy đoán app**: Nếu hệ thống tự động chọn app đầu tiên hoặc đoán app khi thiếu thông tin, lệnh DDL hoặc truy vấn sẽ bị gửi nhầm sang container của ứng dụng khác, dẫn đến nguy cơ sai lệch dữ liệu nghiêm trọng.
3. **Các ứng dụng không cần DB**: Các ứng dụng như `static-spa` hoặc `nextjs` không bật `needs_db` sẽ không có container database nào chạy kèm.

---

## 3. Định Danh Database Gắn Với App & Tách Biệt Trạng Thái Instance

### 3.1. Bắt buộc định danh App tường minh (Không tự suy đoán, không fallback)

- **Quy tắc bất biến**: Mọi thao tác nhắm vào một database cụ thể (như `list-tables`, `save-schema`, `query`, `create-database`, `create-user`) **bắt buộc phải truyền định danh ứng dụng (`app_id`) rõ ràng**.
- **Loại bỏ hoàn toàn cơ chế tự suy đoán**: Tuyệt đối không cho phép `app_id` tùy chọn rồi tự rơi về app đầu tiên trên VPS.
- **Xác thực nghiêm ngặt (Fail-closed Validation)**:
  - Khi nhận yêu cầu thao tác database, backend phải kiểm tra:
    1. Tham số `app_id` có tồn tại và hợp lệ không.
    2. Bản ghi `app` tương ứng có tồn tại trong SQLite không.
    3. Ứng dụng đó có thuộc đúng máy chủ `vps_id` được chỉ định không (`app.vps_id === vpsId`).
  - Nếu thiếu `app_id`, không tìm thấy app, hoặc app không thuộc VPS, backend lập tức trả về lỗi `IpcError` với mã hiện hành `'VALIDATION'`, tuyệt đối không thực thi lệnh SSH.

### 3.2. Tách bạch trạng thái Instance khỏi Metadata Database

Khi container database của một ứng dụng bị dừng (`stopped`) hoặc bị lỗi (`unhealthy`), tiến trình `psql` bên trong container không thể thực thi. Tại thời điểm này, các thông số kỹ thuật như `oid`, danh sách tên database thực tế và `size_bytes` là **hoàn toàn chưa biết (unknown)**.

- **Nguyên tắc dữ liệu trung thực**:
  - **Tuyệt đối không tạo bản ghi `DbDatabase` giả** với OID bằng 0 hay dung lượng 0 cho các container đã dừng. Việc tự bịa đặt bản ghi database khi chưa truy vấn được là không trung thực với trạng thái thực tế của VPS.
  - Tách bạch cấu trúc dữ liệu thành 2 tầng rõ rệt:

```typescript
/** Trạng thái instance/container cơ sở dữ liệu cấp ứng dụng */
export interface AppDbInstance {
  app_id: number;
  app_name: string;
  container_name: string;
  /** Trạng thái thực tế kiểm tra qua Docker daemon */
  container_status: 'running' | 'stopped' | 'missing' | 'unhealthy';
  /** Lỗi đọc hoặc lỗi trạng thái riêng của instance này (nếu có) */
  error_message?: string;
}

/** Metadata cơ sở dữ liệu thực tế — CHỈ tạo khi đã truy vấn thành công từ container running */
export interface DbDatabase {
  oid: number;
  name: string;
  size_bytes: number;
  /** Số lượng bảng: có thể null (chưa xác định ở tầng tổng quan) */
  table_count: number | null;
  /** Gắn chặt với app sở hữu */
  app_id: number;
  app_name: string;
  container_name: string;
}
```

- **Biểu diễn trên giao diện người dùng**:
  - Bảng cơ sở dữ liệu chỉ liệt kê các database hợp lệ đã đọc được từ các container đang chạy.
  - Các ứng dụng có container bị dừng hoặc lỗi sẽ được hiển thị qua danh sách trạng thái instance hoặc khối cảnh báo riêng (`Alert`: *"Ứng dụng `app-name` có container `app-name-db` đang dừng - Chưa thể đọc metadata cơ sở dữ liệu"*).

---

## 4. Luồng Dữ Liệu Đề Xuất & Xử Lý SQL Table Count

### 4.1. Khắc phục lỗi tính `table_count` trong PostgreSQL

- **Bản chất kỹ thuật của PostgreSQL**:
  - Bảng hệ thống `information_schema.tables` và `pg_tables` chỉ chứa metadata của **chính database mà phiên kết nối hiện tại đang kết nối tới** (ví dụ: kết nối vào `-d postgres` thì chỉ đếm bảng của database `postgres`).
  - Câu lệnh truy vấn đơn lẻ:
    ```sql
    -- LỖI LOGIC: Subquery đếm bảng của postgres và gán cùng số đó cho mọi database
    SELECT d.oid, d.datname, pg_database_size(d.datname),
           (SELECT count(*) FROM information_schema.tables WHERE table_schema='public')
    FROM pg_database d;
    ```
    là **hoàn toàn sai**, vì subquery được thực thi trong ngữ cảnh của database kết nối (`postgres`), dẫn đến việc mọi database trong danh sách đều nhận chung số lượng bảng của database `postgres`.

- **Giải pháp xử lý đúng đắn**:
  - **Phương án A (Khuyến nghị cho DB-1)**: Ở cấp độ liệt kê tổng quan `db:list-databases`, để `table_count` là **chưa xác định (`null`)**.
    - Chỉ đọc thông tin tổng quan từ `pg_database` bằng một lệnh truy vấn duy nhất:
      ```sql
      SELECT d.oid, d.datname, pg_database_size(d.datname)
      FROM pg_database d
      WHERE d.datistemplate = false;
      ```
    - Khi người dùng bấm vào một database cụ thể để xem chi tiết ở các bước sau (`db:list-tables`), hệ thống mới kết nối trực tiếp vào database đó (`-d ${database}`) để lấy danh sách bảng và đếm chính xác số lượng bảng.
    - *Ưu điểm*: Tránh mở N kết nối SSH/psql phụ, giảm tối đa độ trễ và tải CPU/RAM trên VPS.
  - **Phương án B (Nếu UI bắt buộc số bảng ngay tại bảng tổng quan)**:
    - Chạy script shell trong container để kết nối vào từng database cụ thể:
      ```bash
      for db in $(psql -U opspilot -d postgres -At -c "SELECT datname FROM pg_database WHERE datistemplate=false"); do
        cnt=$(psql -U opspilot -d "$db" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "null")
        echo "$db|$cnt"
      done
      ```
    - Ghép kết quả số bảng theo từng tên database. Tuy nhiên cách này làm tăng số lần kết nối và thời gian chờ. Do đó, phương án A là phương án ưu tiên.

### 4.2. Sơ đồ tuần tự: Liệt kê Database trên VPS (Thu hẹp cho DB-1)

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng
    participant UI as VpsDatabaseTab (Renderer)
    participant IPC as Main IPC Handler
    participant DB as SQLite DB (opspilot.db)
    participant SSH as SshManager
    participant VPS as VPS / Docker Engine

    User->>UI: Mở Tab Cơ sở dữ liệu (vpsId)
    UI->>IPC: invoke('db:list-databases', vpsId)

    Note over IPC,DB: BƯỚC 1: Kiểm tra vpsId tồn tại
    IPC->>DB: vpsRepository.getById(vpsId)
    alt vpsId không tồn tại trong DB
        DB-->>IPC: null / not found
        IPC-->>UI: ok: false, error: { code: 'VALIDATION', message: 'Không tìm thấy VPS' }
        UI->>User: Hiển thị lỗi không tìm thấy VPS
    else vpsId tồn tại hợp lệ
        DB-->>IPC: vps record
        Note over IPC,DB: BƯỚC 2: Kiểm tra các app cần DB
        IPC->>DB: Query các app trên vpsId có needs_db = 1
        DB-->>IPC: Danh sách apps: [{ id, name, ... }]

        alt Không có app nào có needs_db = 1
            IPC-->>UI: ok: true, data: { instances: [], databases: [] }
            UI->>User: Empty State: "Chưa có ứng dụng nào cấu hình cơ sở dữ liệu"
        else Có các app cấu hình DB
            Note over IPC,SSH: BƯỚC 3: Kết nối SSH tới VPS
            IPC->>SSH: Kết nối SSH tới vpsId
            alt Lỗi SSH (Host unreachable / Timeout / Auth failed)
                SSH-->>IPC: SshError
                IPC-->>UI: ok: false, error: { code: 'SSH_HOST_UNREACHABLE' | 'SSH_TIMEOUT' | 'SSH_AUTH_FAILED', ... }
                UI->>User: Hiển thị Alert lỗi kết nối SSH + Nút Thử lại
            else SSH thành công
                IPC->>SSH: docker ps -a --filter "name=-db"
                SSH->>VPS: Lấy danh sách và trạng thái container
                VPS-->>SSH: Container status list

                loop Với từng app cấu hình DB
                    alt Container của app đang stopped / missing
                        IPC->>IPC: Ghi nhận instance status: 'stopped', error: 'Container chưa chạy'
                    else Container đang running
                        IPC->>SSH: docker compose exec -T postgres psql -U opspilot -d postgres -At -c "SELECT d.oid, d.datname, pg_database_size(d.datname) FROM pg_database d WHERE d.datistemplate=false;"
                        VPS-->>SSH: TSV output (oid, name, size)
                        IPC->>IPC: Parse TSV -> DbDatabase[] (gắn app_id, app_name, table_count = null)
                    end
                end

                Note over IPC,UI: BƯỚC 4: Báo cáo kết quả kèm lỗi từng app nếu có
                IPC-->>UI: ok: true, data: { instances, databases }
                UI->>User: Hiển thị bảng Database và trạng thái các instance
            end
        end
    end
```

---

## 5. Thay Đổi IPC Contract Cần Thiết & Đối Chiếu Mã Lỗi

### 5.1. Thu hẹp hợp đồng cho Checkpoint DB-1

Trong Checkpoint DB-1, hợp đồng IPC chỉ tập trung giải quyết thao tác **liệt kê danh sách database**:

```typescript
/** Dữ liệu trả về tổng quan cho Tab Database trên VPS */
export interface VpsDatabaseOverviewDto {
  /** Danh sách trạng thái instance PostgreSQL của các app có needs_db = 1 */
  instances: AppDbInstance[];
  /** Danh sách database thực tế đọc được từ các container đang chạy */
  databases: DbDatabase[];
}
```

Kênh `db:list-databases` được điều chỉnh:
- `db:list-databases: (vpsId: number) => IpcResult<VpsDatabaseOverviewDto>` (hoặc nếu giữ `DbDatabase[]` để tương thích UI hiện hành thì các trường `app_id`, `app_name`, `container_name` là bắt buộc, và `table_count: number | null`).
- Các kênh `db:list-users`, `db:list-tables`, `db:create-database`, `db:create-user`, `db:save-schema`:
  - **Tạm hoãn triển khai sang các checkpoint sau**.
  - Khi triển khai, chữ ký bắt buộc phải nhận `appId: number` rõ ràng, không tùy chọn.

### 5.2. Đối chiếu mã lỗi với `IpcError.code` hiện hành

| Tình huống phát sinh lỗi | Mã lỗi `IpcError.code` hiện hành | Ghi chú & Đề xuất nếu cần mã mới |
| :--- | :--- | :--- |
| `vpsId` không tồn tại trong SQLite DB | `'VALIDATION'` | Mã hiện hành. Thông báo: *"Không tìm thấy máy chủ VPS id=${vpsId} trong cơ sở dữ liệu."* |
| Thiếu `appId` hoặc `app.vps_id !== vpsId` | `'VALIDATION'` | Mã hiện hành. Thông báo: *"Ứng dụng không tồn tại hoặc không thuộc máy chủ này."* |
| SSH không kết nối được tới VPS (mạng đứt, sai host/port) | `'SSH_HOST_UNREACHABLE'` | Mã hiện hành. Không dùng mã tự tạo `SSH_CONNECTION_FAILED`. |
| SSH hết thời gian chờ kết nối hoặc thực thi lệnh | `'SSH_TIMEOUT'` | Mã hiện hành. |
| Sai thông tin xác thực SSH (khóa sai, mật khẩu sai) | `'SSH_AUTH_FAILED'` | Mã hiện hành. |
| Docker daemon trên VPS bị tắt hoặc chưa cài đặt | `'DOCKER_MISSING'` | Mã hiện hành. |
| Lệnh `psql` bị lỗi cú pháp, database hỏng hoặc lỗi quyền | `'DB_ADMIN_FAILED'` hoặc `'DB_ERROR'` | Mã hiện hành. Chi tiết kỹ thuật ghi vào `technical`. |
| *Container DB bị dừng khi gọi thao tác cụ thể* | `'DB_ADMIN_FAILED'` | Mã hiện hành. Nếu muốn mã riêng `CONTAINER_STOPPED`: **Đề xuất mở rộng IpcError contract (Cần duyệt)**. |
| *Dịch vụ Postgres đang khởi động lại (chưa sẵn sàng)* | `'DB_ERROR'` | Mã hiện hành. Nếu muốn mã riêng `DB_NOT_READY`: **Đề xuất mở rộng IpcError contract (Cần duyệt)**. |

---

## 6. Xử Lý Ngoại Lệ & Cơ Chế Báo Lỗi Từng App

### 6.1. Nguyên tắc chống biến lỗi thành danh sách rỗng (Anti-Silent Swallowing)

- **Vấn đề cần tránh**: Nếu một VPS có 2 ứng dụng cần DB (`appA` và `appB`), trong đó `appA` chạy bình thường nhưng `appB` bị lỗi container hoặc lỗi SSH cục bộ:
  - Nếu nuốt lỗi của `appB` và chỉ trả về `[]`, hoặc gặp lỗi ở `appB` rồi trả về danh sách rỗng cho toàn bộ VPS, người dùng sẽ hiểu nhầm là VPS không có database nào.
  - Tương tự, nếu lệnh SSH lỗi toàn cục mà nuốt ngoại lệ để trả về `[]`, lỗi hạ tầng sẽ bị che giấu thành trạng thái "không có database".
- **Cơ chế báo lỗi từng app (Per-app Error Isolation)**:
  1. **Lỗi toàn cục cấp VPS** (không tìm thấy VPS, SSH timeout, SSH auth error): Trả về `ok: false, error: IpcError` ngay lập tức. UI bắt buộc hiển thị `Alert` lỗi cấp trang.
  2. **Lỗi cục bộ cấp App** (container của app bị dừng, container crash, `psql` bên trong container lỗi):
     - Không làm hỏng kết quả của các app khác trên cùng VPS.
     - Dữ liệu trả về chứa đầy đủ database của các app chạy tốt.
     - App bị lỗi được ghi nhận trạng thái trong mảng `instances`: `container_status: 'stopped' | 'unhealthy'`, kèm `error_message` chi tiết.
     - UI hiển thị danh sách database của app thành công, đồng thời hiển thị cảnh báo riêng cho app gặp sự cố.

### 6.2. Bảng tổng hợp hành vi xử lý sự cố

| Tình huống sự cố | Xử lý tại Backend Main | Hiển thị tại UI Renderer |
| :--- | :--- | :--- |
| `vpsId` không có trong DB | Trả về `ok: false, error: { code: 'VALIDATION' }`. | Hiển thị lỗi tham số không hợp lệ. |
| VPS hợp lệ, 0 app có `needs_db = 1` | Trả về `ok: true, data: { instances: [], databases: [] }` (không gọi SSH). | Hiển thị Empty state trung thực: *"Máy chủ chưa có ứng dụng nào cấu hình cơ sở dữ liệu."* |
| VPS có app DB, mất kết nối SSH | Trả về `ok: false, error: { code: 'SSH_HOST_UNREACHABLE' }`. | Hiển thị Alert đỏ báo lỗi kết nối SSH kèm nút Thử lại. |
| 1 app running, 1 app container stopped | Trả về `ok: true`, chứa database của app running; app stopped có `container_status: 'stopped'`. | Hiển thị bảng DB của app running; hiển thị Alert vàng thông báo container của app kia đang dừng. |

---

## 7. Phân Kỳ Kích Hoạt & Đánh Giá Rủi Ro Thực Tế

### 7.1. Bác bỏ quan niệm "Rủi ro 0" đối với thao tác chỉ đọc trên Remote VPS

- **Không có thao tác nào trên máy chủ từ xa là "rủi ro 0"**:
  - Dù chỉ chạy các câu lệnh đọc (`SELECT`, `docker ps`), việc thực thi qua SSH vẫn tiềm ẩn các rủi ro vận hành thực tế:
    1. **Tải tài nguyên trên VPS yếu**: Việc gọi liên tục `docker compose exec` và khởi tạo tiến trình `psql` tiêu tốn bộ nhớ và CPU, có thể gây quá tải cho các VPS nhỏ (1 vCPU / 1GB RAM) đang chạy ứng dụng thật.
    2. **Rủi ro treo tiến trình (Process Hang / Leak)**: Nếu tiến trình `psql` hoặc kênh SSH bị treo mà không có cơ chế timeout và AbortSignal chặt chẽ, các tiến trình con sẽ tích lũy và làm cạn kiệt tài nguyên hệ điều hành.
    3. **Tải trên Connection Pool**: Mở kết nối vào PostgreSQL có thể gây cạnh tranh tài nguyên với chính ứng dụng đang chạy nếu `max_connections` bị giới hạn thấp.
  - Do đó, thao tác chỉ đọc phải được thiết kế với timeout nghiêm ngặt (3–5 giây), giải phóng kênh SSH ngay sau khi thực thi và có cơ chế debounce trên UI để chống người dùng spam nút refresh.

### 7.2. Lộ trình phân kỳ tính năng (Thu hẹp Checkpoint DB-1)

Nhằm đảm bảo an toàn tuyệt đối và tập trung giải quyết dứt điểm từng phần việc:

- **Checkpoint DB-1 (Thu hẹp: Chỉ đọc danh sách Database)**:
  - Chỉ triển khai duy nhất kênh `db:list-databases` có phân biệt ứng dụng và báo cáo trạng thái instance.
  - Bật `supported={true}` cho danh sách database trong `VpsDetail.tsx`.
  - Giữ nguyên trạng thái chưa hỗ trợ hoặc ẩn các nút: `+ Tạo người dùng`, `+ Tạo database`, `Lưu schema`, `Import/Export`.
- **Checkpoint DB-2 (Đọc chi tiết Bảng & Người dùng)**:
  - Triển khai `db:list-tables` và `db:list-users` có tham số `app_id` bắt buộc.
  - Cho phép người dùng bấm vào từng database để xem danh sách bảng và cấu trúc schema.
- **Checkpoint DB-3 (Thao tác Ghi có bảo vệ & Transaction Guard)**:
  - Triển khai `db:create-database`, `db:create-user`, `db:save-schema`.
  - Bổ sung transaction (`BEGIN ... COMMIT`), modal xác nhận rủi ro thay đổi schema và kiểm tra xung đột di chuyển dữ liệu.

### 7.3. Tiêu chuẩn nghiệm thu minh bạch: Phân biệt Gate Offline vs VPS thật

- **Quy tắc nghiệm thu trung thực**:
  - Việc hoàn thành bộ test giả lập (Mock SSH Test Harness) chỉ được ghi nhận là **`LOCAL_MOCK_PASS` / `GATE_OFFLINE_PASS`** (chứng minh logic mã nguồn, kiểm soát lỗi và hợp đồng dữ liệu đạt chuẩn).
  - **Tuyệt đối không tự ý chuyển AC-3.2 thành `PASS` toàn diện** khi chưa có môi trường VPS thật để xác minh thực địa.
  - Trong tài liệu nghiệm thu tổng thể (`ui-1k-acceptance.md`), AC-3.2 phải được ghi nhận rõ ràng:
    - *Kiểm thử cục bộ / Mock Harness*: `PASS`.
    - *Xác minh trên máy chủ VPS thật*: Duy trì trạng thái **`NOT_RUN` (Chưa kiểm chứng trên VPS thật)**.

---

## 8. Kế Hoạch Triển Khai Từng Bước & Kiểm Thử Offline

### 8.1. Các bước triển khai kỹ thuật

1. **Bước 1 (Checkpoint DB-0 - Hiện tại)**: Hoàn thiện hồ sơ thiết kế kiến trúc, làm rõ định danh database gắn với app, khắc phục lỗi tính `table_count`, chuẩn hóa mã lỗi và xác lập quy tắc fail-closed.
2. **Bước 2 (Checkpoint DB-1 - Backend DatabaseService & List Databases)**:
   - Xây dựng `app/src/main/db/databaseService.ts` với hàm `listDatabases(vpsId: number)`.
   - Kiểm tra `vpsId` tồn tại trong SQLite trước tiên -> ném lỗi `VALIDATION` nếu không thấy.
   - Truy vấn các app có `needs_db = 1`. Nếu 0 app -> trả về danh sách rỗng.
   - Kết nối SSH và chạy lệnh Docker/psql lấy metadata từ `pg_database` với `table_count = null`.
   - Cô lập lỗi từng app: app lỗi ghi vào `instance.error_message`, không làm hỏng app khác.
   - Đăng ký handler `db:list-databases` trong `app/src/main/ipc.ts`.
3. **Bước 3 (Kiểm thử Offline Backend Unit Tests)**:
   - Viết `app/src/main/db/databaseService.test.ts` dùng mock SSH với các ca kiểm thử:
     - *Ca 1*: `vpsId` không tồn tại trong SQLite -> Ném lỗi `VALIDATION`.
     - *Ca 2*: VPS tồn tại nhưng không có app nào có `needs_db = 1` -> Trả về `{ instances: [], databases: [] }`, không gọi SSH.
     - *Ca 3*: VPS có 1 app DB running -> Trả về database đúng `app_id`, `app_name`, `table_count: null`.
     - *Ca 4*: VPS có 2 app DB (`appA` running, `appB` container stopped) -> Trả về database của `appA`, `appB` có trạng thái `stopped` và thông báo lỗi rõ ràng; không biến thành danh sách rỗng.
     - *Ca 5*: Lỗi SSH timeout / host unreachable -> Trả về `IpcError` đúng mã `'SSH_TIMEOUT'` / `'SSH_HOST_UNREACHABLE'`.
4. **Bước 4 (Cập nhật UI VpsDatabaseTab & VpsDetail)**:
   - Cập nhật `VpsDatabaseTab.tsx` để render danh sách database có cột Ứng dụng, bộ lọc app, và hiển thị cảnh báo cho các instance bị dừng.
   - Truyền `supported={true}` từ `VpsDetail.tsx`.
   - Viết test Renderer Vitest kiểm chứng giao diện hiển thị đúng cả khi có DB lẫn khi instance bị lỗi.

---

## 9. Kết Luận Checkpoint DB-0

- Bản sửa đổi tài liệu thiết kế đã khắc phục toàn diện các vấn đề kiến trúc:
  1. Loại bỏ hoàn toàn cơ chế tự suy đoán app; bắt buộc định danh app tường minh và kiểm tra `app.vps_id === vpsId`.
  2. Sửa lỗi logic SQL của `table_count`, đề xuất để `null` ở tầng danh sách tổng quan để tránh kết nối sai database.
  3. Tách biệt hoàn toàn trạng thái instance khỏi metadata database; không tạo bản ghi database giả khi container bị dừng.
  4. Bác bỏ luận điểm "rủi ro 0"; phân biệt minh bạch giữa kết quả đạt gate offline (`LOCAL_MOCK_PASS`) và trạng thái chưa xác minh trên VPS thật (`NOT_RUN`).
  5. Thu hẹp phạm vi DB-1 về duy nhất bài toán liệt kê database; thiết lập cơ chế cô lập lỗi từng app để không biến lỗi thành danh sách rỗng.
  6. Đối chiếu chuẩn xác với tập mã lỗi `IpcError.code` hiện hành; bổ sung kiểm tra `vpsId` tồn tại trong DB trước khi xử lý.
- Tài liệu hoàn thiện sẵn sàng làm căn cứ cho việc triển khai mã nguồn tại Checkpoint DB-1 khi có yêu cầu.
