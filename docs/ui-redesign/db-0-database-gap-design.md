# Thiáº¿t Káº¿ Kiáº¿n TrÃºc & Káº¿ Hoáº¡ch Xá»­ LÃ½ GAP AC-3.2: Quáº£n Trá»‹ PostgreSQL TrÃªn VPS (Checkpoint DB-0)

> **Má»¥c tiÃªu tÃ i liá»‡u**: BÃ¡o cÃ¡o audit chuyÃªn sÃ¢u vÃ  Ä‘á» xuáº¥t giáº£i phÃ¡p thiáº¿t káº¿ kiáº¿n trÃºc toÃ n diá»‡n cho khiáº¿m khuyáº¿t duy nháº¥t cÃ²n láº¡i sau Ä‘á»£t tÃ¡i thiáº¿t káº¿ UI (**GAP AC-3.2**: Tab CÆ¡ sá»Ÿ dá»¯ liá»‡u trÃªn trang Chi tiáº¿t VPS chÆ°a há»— trá»£ káº¿t ná»‘i IPC backend).
> **Pháº¡m vi Checkpoint DB-0**: Thuáº§n tÃºy audit mÃ£ nguá»“n vÃ  Ä‘á» xuáº¥t thiáº¿t káº¿ kiáº¿n trÃºc. **KhÃ´ng sá»­a Ä‘á»•i runtime, khÃ´ng thay Ä‘á»•i IPC contract vÃ  khÃ´ng tá»± Ã½ Ä‘Ã¡nh dáº¥u AC-3.2 PASS**.

---

## 1. Hiá»‡n Tráº¡ng Audit & PhÃ¢n TÃ­ch NguyÃªn NhÃ¢n Gá»‘c Rá»…

### 1.1. Äá»‘i chiáº¿u cÃ¡c thÃ nh pháº§n mÃ£ nguá»“n hiá»‡n há»¯u

Qua quÃ¡ trÃ¬nh Ä‘á»‘i chiáº¿u chÃ©o giá»¯a cÃ¡c táº§ng cá»§a á»©ng dá»¥ng:

1. **Giao diá»‡n ngÆ°á»i dÃ¹ng (`app/src/renderer/src/components/VpsDatabaseTab.tsx`)**:
   - ÄÃ£ Ä‘Æ°á»£c xÃ¢y dá»±ng giao diá»‡n hoÃ n chá»‰nh vá»›i 2 báº£ng dá»¯ liá»‡u chÃ­nh (*Database Users* vÃ  *Databases*), modal táº¡o ngÆ°á»i dÃ¹ng, modal táº¡o database, trÃ¬nh thiáº¿t káº¿ schema Ä‘á»“ há»a (`DbSchemaDesigner`), tÃ­nh nÄƒng import/export file CSV/JSON vÃ  xem trÆ°á»›c cÃ¢u lá»‡nh SQL DDL.
   - Nháº­n thuá»™c tÃ­nh `supported?: boolean` vá»›i giÃ¡ trá»‹ máº·c Ä‘á»‹nh lÃ  `false` (`supported = false`).
   - Khi `!supported`, component hiá»ƒn thá»‹ mÃ n hÃ¬nh trá»‘ng (`Empty`) vá»›i thÃ´ng bÃ¡o: *"ChÆ°a há»— trá»£ cÆ¡ sá»Ÿ dá»¯ liá»‡u - TÃ­nh nÄƒng quáº£n lÃ½ cÆ¡ sá»Ÿ dá»¯ liá»‡u trÃªn mÃ¡y chá»§ hiá»‡n chÆ°a kháº£ dá»¥ng trong OpsPilot"*.
   - Khá»‘i gá»i IPC ná»™i bá»™ `callDb()` Ä‘Ã£ Ä‘Æ°á»£c bá»c an toÃ n; náº¿u backend chÆ°a xá»­ lÃ½ kÃªnh, UI sáº½ nháº­n lá»—i `UNKNOWN` trung thá»±c thay vÃ¬ giáº£ láº­p thÃ nh cÃ´ng.

2. **Khung vá» Chi tiáº¿t VPS (`app/src/renderer/src/components/VpsDetail.tsx`)**:
   - Táº¡i Tab 3 (`key: 'database'`), component render `<VpsDatabaseTab vpsId={vps.id} />` nhÆ°ng **khÃ´ng truyá»n thuá»™c tÃ­nh `supported`**, khiáº¿n `supported` luÃ´n nháº­n giÃ¡ trá»‹ máº·c Ä‘á»‹nh lÃ  `false`.

3. **Há»£p Ä‘á»“ng IPC (`app/src/shared/ipc.ts`)**:
   - ÄÃ£ khai bÃ¡o Ä‘áº§y Ä‘á»§ cÃ¡c kiá»ƒu dá»¯ liá»‡u DTO (`DbDatabase`, `DbUser`, `DbUserInput`, `DbSchemaTable`, `DbSchemaColumn`, `DbSchemaForeignKey`, `DbImportInput`, `DbExportFile`, `DbQueryResult`).
   - ÄÃ£ Ä‘á»‹nh nghÄ©a 9 kÃªnh invoke trong `IpcInvokeMap`:
     - `db:list-databases`: `(vpsId: number) => IpcResult<DbDatabase[]>`
     - `db:create-database`: `(vpsId: number, name: string) => IpcResult<DbDatabase>`
     - `db:list-users`: `(vpsId: number) => IpcResult<DbUser[]>`
     - `db:create-user`: `(vpsId: number, input: DbUserInput) => IpcResult<DbUser>`
     - `db:list-tables`: `(vpsId: number, database: string) => IpcResult<DbSchemaTable[]>`
     - `db:save-schema`: `(vpsId: number, database: string, ddl: string) => IpcResult<void>`
     - `db:import-data`: `(vpsId: number, database: string, input: DbImportInput) => IpcResult<{ imported_tables: number; imported_rows: number }>`
     - `db:export-data`: `(vpsId: number, database: string, format: 'json' | 'csv' | 'sql') => IpcResult<DbExportFile>`
     - `db:query`: `(vpsId: number, database: string, sql: string) => IpcResult<DbQueryResult>`
   - *Ghi chÃº trong mÃ£ nguá»“n*: KÃªnh Ä‘Æ°á»£c thiáº¿t káº¿ tá»« giai Ä‘oáº¡n TK-B9 vá»›i giáº£ Ä‘á»‹nh cháº¡y lá»‡nh dáº¡ng: `docker compose exec -T db psql -U opspilot -At -c "<sql>"`.

4. **Tiáº¿n trÃ¬nh chÃ­nh Main (`app/src/main/ipc.ts`)**:
   - Trong hÃ m `registerIpcHandlers()`, **chÆ°a Ä‘Äƒng kÃ½ báº¥t ká»³ handler nÃ o** cho cÃ¡c kÃªnh cÃ³ tiá»n tá»‘ `db:*`.

---

## 2. Kiáº¿n TrÃºc Thá»±c Táº¿: PostgreSQL TrÃªn VPS Trong OpsPilot

### 2.1. Cáº¥u trÃºc triá»ƒn khai: Isolated Per-App Container

KhÃ¡c vá»›i giáº£ Ä‘á»‹nh ban Ä‘áº§u vá» má»™t container PostgreSQL dÃ¹ng chung toÃ n VPS (`docker compose exec -T db`), kiáº¿n trÃºc triá»ƒn khai thá»±c táº¿ cá»§a OpsPilot (Ä‘Æ°á»£c hiá»‡n thá»±c hÃ³a trong [`templates.ts`](../../app/src/main/deploy/templates.ts) vÃ  [`pipeline.ts`](../../app/src/main/deploy/pipeline.ts)) hoáº¡t Ä‘á»™ng theo nguyÃªn lÃ½ **cÃ´ láº­p hoÃ n toÃ n theo tá»«ng á»©ng dá»¥ng (Per-App Container)**:

- Khi má»™t á»©ng dá»¥ng Ä‘Æ°á»£c triá»ƒn khai vá»›i `needs_db === 1`:
  - MÃ£ nguá»“n vÃ  cáº¥u hÃ¬nh Ä‘Æ°á»£c Ä‘áº·t táº¡i thÆ° má»¥c riÃªng biá»‡t trÃªn VPS: `/opt/opspilot/${APP_NAME}/`.
  - Tá»‡p `docker-compose.yml` Ä‘á»‹nh nghÄ©a má»™t service `postgres` riÃªng biá»‡t:
    - **TÃªn container**: `${APP_NAME}-db` (vÃ­ dá»¥: `express-api-db`, `next-blog-db`).
    - **Image**: `postgres:16-alpine`.
    - **LÆ°u trá»¯ dá»¯ liá»‡u**: Volume cá»¥c bá»™ `./data/pg:/var/lib/postgresql/data` (náº±m trong thÆ° má»¥c cá»§a chÃ­nh app Ä‘Ã³).
    - **Giá»›i háº¡n tÃ i nguyÃªn**: `mem_limit: 256m`.
    - **Máº¡ng ná»™i bá»™**: Port 5432 **khÃ´ng má»Ÿ ra ngoÃ i host** (khÃ´ng cÃ³ `ports:` host mapping), chá»‰ giao tiáº¿p ná»™i bá»™ trong máº¡ng Docker cá»§a á»©ng dá»¥ng.
    - **ThÃ´ng tin Ä‘Äƒng nháº­p máº·c Ä‘á»‹nh**: User `opspilot`, Database `opspilot`, máº­t kháº©u sinh ngáº«u nhiÃªn lÆ°u trong `/opt/opspilot/${APP_NAME}/.env` (`POSTGRES_PASSWORD`).

### 2.2. Váº¥n Ä‘á» cá»‘t lÃµi khi má»™t VPS cÃ³ nhiá»u á»©ng dá»¥ng (Multi-app VPS)

Khi trÃªn cÃ¹ng má»™t mÃ¡y chá»§ VPS cÃ³ nhiá»u á»©ng dá»¥ng cÃ¹ng sá»­ dá»¥ng cÆ¡ sá»Ÿ dá»¯ liá»‡u (vÃ­ dá»¥: cáº£ `express-api` vÃ  `next-blog` Ä‘á»u cÃ³ `needs_db = 1`):
1. **Xung Ä‘á»™t Ä‘á»‹nh danh (Name Collision)**: Cáº£ 2 container Ä‘á»™c láº­p Ä‘á»u máº·c Ä‘á»‹nh khá»Ÿi táº¡o má»™t database cÃ³ tÃªn lÃ  `opspilot`. Náº¿u chá»‰ tráº£ vá» danh sÃ¡ch database pháº³ng dáº¡ng `[{ name: 'opspilot' }, { name: 'opspilot' }]`, ngÆ°á»i dÃ¹ng khÃ´ng thá»ƒ phÃ¢n biá»‡t Ä‘Æ°á»£c database nÃ o thuá»™c vá» á»©ng dá»¥ng nÃ o.
2. **Máº¥t Ä‘á»‹nh tuyáº¿n trong thao tÃ¡c chi tiáº¿t**: Khi ngÆ°á»i dÃ¹ng báº¥m vÃ o dÃ²ng database `opspilot` Ä‘á»ƒ xem danh sÃ¡ch báº£ng (`db:list-tables(vpsId, 'opspilot')`) hoáº·c lÆ°u schema (`db:save-schema(vpsId, 'opspilot', ddl)`), backend khÃ´ng thá»ƒ biáº¿t cáº§n thá»±c thi lá»‡nh `psql` vÃ o container nÃ o (`express-api-db` hay `next-blog-db`).
3. **CÃ¡c á»©ng dá»¥ng khÃ´ng cáº§n DB**: CÃ¡c á»©ng dá»¥ng nhÆ° `static-spa` hoáº·c `nextjs` khÃ´ng báº­t `needs_db` sáº½ khÃ´ng cÃ³ container database nÃ o cháº¡y kÃ¨m.

---

## 3. Giáº£i PhÃ¡p Äá»‹nh Danh Database Gáº¯n Vá»›i App & Deployment

Äá»ƒ giáº£i quyáº¿t triá»‡t Ä‘á»ƒ bÃ i toÃ¡n Ä‘a á»©ng dá»¥ng mÃ  váº«n giá»¯ nguyÃªn triáº¿t lÃ½ **App-Centric** cá»§a OpsPilot, thá»±c thá»ƒ cÆ¡ sá»Ÿ dá»¯ liá»‡u hiá»ƒn thá»‹ trÃªn VPS pháº£i Ä‘Æ°á»£c gáº¯n cháº·t vá»›i á»©ng dá»¥ng sá»Ÿ há»¯u:

### 3.1. MÃ´ hÃ¬nh Ä‘á»‹nh danh thá»±c thá»ƒ (Database Entity Identity)

Má»—i cÆ¡ sá»Ÿ dá»¯ liá»‡u trÃªn VPS Ä‘Æ°á»£c Ä‘á»‹nh danh duy nháº¥t bá»Ÿi bá»™ ba:
$$\text{DatabaseIdentity} = (\text{vps\_id}, \text{app\_id}, \text{db\_name})$$

Hoáº·c Ä‘á»‹nh danh tá»•ng há»£p (Composite Key):
$$\text{composite\_id} = \text{"\{app\_name\}:\{db\_name\}"}$$

### 3.2. Má»Ÿ rá»™ng kiá»ƒu dá»¯ liá»‡u DTO `DbDatabase`

Bá»• sung ngá»¯ cáº£nh á»©ng dá»¥ng sá»Ÿ há»¯u vÃ o `DbDatabase` mÃ  khÃ´ng phÃ¡ vá»¡ tÃ­nh tÆ°Æ¡ng thÃ­ch ngÆ°á»£c cá»§a cÃ¡c trÆ°á»ng hiá»‡n há»¯u:

```typescript
export interface DbDatabase {
  /** OID cá»§a database trong PostgreSQL */
  oid: number;
  /** TÃªn database trong PostgreSQL (vÃ­ dá»¥: 'opspilot', 'blog_prod') */
  name: string;
  /** Dung lÆ°á»£ng theo bytes */
  size_bytes: number;
  /** Sá»‘ lÆ°á»£ng báº£ng trong schema public */
  table_count: number;

  /* â”€â”€ CÃ¡c trÆ°á»ng bá»• sung phá»¥c vá»¥ phÃ¢n Ä‘á»‹nh á»©ng dá»¥ng (Checkpoint DB-1) â”€â”€ */
  /** ID cá»§a app sá»Ÿ há»¯u container database nÃ y */
  app_id: number;
  /** TÃªn app sá»Ÿ há»¯u (vÃ­ dá»¥: 'express-api') */
  app_name: string;
  /** TÃªn container Docker Ä‘ang cháº¡y (vÃ­ dá»¥: 'express-api-db') */
  container_name: string;
  /** Tráº¡ng thÃ¡i container: 'running' | 'stopped' | 'unhealthy' */
  status: 'running' | 'stopped' | 'unhealthy';
}
```

### 3.3. Tráº£i nghiá»‡m ngÆ°á»i dÃ¹ng trÃªn `VpsDatabaseTab`

1. **Báº£ng CÆ¡ sá»Ÿ dá»¯ liá»‡u (Databases Table)**:
   - Bá»• sung cá»™t **á»¨ng dá»¥ng liÃªn káº¿t (`app_name`)**: Hiá»ƒn thá»‹ tháº» tag gáº¯n tÃªn á»©ng dá»¥ng (kÃ¨m liÃªn káº¿t nhanh sang chi tiáº¿t á»©ng dá»¥ng náº¿u cáº§n).
   - Bá»• sung cá»™t **Tráº¡ng thÃ¡i container**: Tag mÃ u xanh (`running`) hoáº·c vÃ ng/Ä‘á» (`stopped`).
   - Cung cáº¥p **Dropdown lá»c theo á»¨ng dá»¥ng (App Filter)** phÃ­a trÃªn báº£ng: Cho phÃ©p lá»c xem database cá»§a má»™t á»©ng dá»¥ng cá»¥ thá»ƒ hoáº·c hiá»ƒn thá»‹ toÃ n bá»™ mÃ¡y chá»§ (`Táº¥t cáº£ á»©ng dá»¥ng`).
2. **KhÃ³a Ä‘á»‹nh danh báº£ng Ant Design**:
   - Sá»­ dá»¥ng `rowKey={(row) => `${row.app_id}-${row.name}`}` thay vÃ¬ chá»‰ dÃ¹ng `rowKey="name"` hoáº·c `rowKey="oid"`, triá»‡t tiÃªu hoÃ n toÃ n lá»—i trÃ¹ng key trong React DOM.
3. **Má»Ÿ chi tiáº¿t Database & Schema Designer**:
   - State má»Ÿ database lÆ°u cáº£ `appId`: `openDbFor: { vpsId: number; appId: number; appName: string; name: string }`.

---

## 4. Luá»“ng Dá»¯ Liá»‡u Äá» Xuáº¥t (Proposed Data Flow)

### 4.1. SÆ¡ Ä‘á»“ tuáº§n tá»±: Liá»‡t kÃª Database trÃªn VPS

```mermaid
sequenceDiagram
    autonumber
    actor User as NgÆ°á»i dÃ¹ng
    participant UI as VpsDatabaseTab (Renderer)
    participant IPC as Main IPC Handler
    participant DB as SQLite DB (opspilot.db)
    participant SSH as SshManager
    participant VPS as VPS / Docker Engine

    User->>UI: Má»Ÿ Tab CÆ¡ sá»Ÿ dá»¯ liá»‡u (vpsId)
    UI->>IPC: invoke('db:list-databases', vpsId)

    IPC->>DB: Query cÃ¡c app trÃªn vpsId cÃ³ needs_db = 1
    DB-->>IPC: Tráº£ vá» danh sÃ¡ch apps: [{ id, name, ... }]

    alt KhÃ´ng cÃ³ app nÃ o cÃ³ needs_db = 1
        IPC-->>UI: ok: true, data: [] (KhÃ´ng cáº§n gá»i SSH)
        UI->>User: Hiá»ƒn thá»‹ Empty State: "ChÆ°a cÃ³ á»©ng dá»¥ng nÃ o cáº¥u hÃ¬nh DB"
    else CÃ³ N apps cáº¥u hÃ¬nh DB
        IPC->>SSH: Káº¿t ná»‘i SSH tá»›i vpsId
        alt Káº¿t ná»‘i SSH tháº¥t báº¡i (timeout / auth error)
            SSH-->>IPC: SshConnectionError
            IPC-->>UI: ok: false, error: SSH_CONNECTION_FAILED
            UI->>User: Hiá»ƒn thá»‹ Alert lá»—i SSH + NÃºt "Thá»­ láº¡i"
        else Káº¿t ná»‘i SSH thÃ nh cÃ´ng
            IPC->>SSH: exec("docker ps -a --filter 'name=-db' --format '{{.Names}}\t{{.Status}}'")
            SSH->>VPS: Kiá»ƒm tra tráº¡ng thÃ¡i cÃ¡c container DB
            VPS-->>SSH: Káº¿t quáº£ danh sÃ¡ch container

            loop Vá»›i tá»«ng app cÃ³ container Ä‘ang cháº¡y
                IPC->>SSH: exec("docker compose -f /opt/opspilot/{app}/docker-compose.yml exec -T postgres psql -U opspilot -d postgres -At -c '<query_db_stats>'")
                SSH->>VPS: Thá»±c thi psql láº¥y OID, name, size, table_count
                VPS-->>SSH: TSV output
            end

            IPC->>IPC: Tá»•ng há»£p, gáº¯n app_id, app_name, container_name
            IPC-->>UI: ok: true, data: DbDatabase[]
            UI->>User: Hiá»ƒn thá»‹ báº£ng Databases Ä‘áº§y Ä‘á»§ thÃ´ng tin
        end
    end
```

### 4.2. CÃ¢u lá»‡nh SQL metadata trÃ­ch xuáº¥t tá»« PostgreSQL

Khi gá»i vÃ o container PostgreSQL, lá»‡nh truy váº¥n thÃ´ng tin thá»‘ng kÃª khÃ´ng khÃ³a báº£ng vÃ  thá»±c thi cá»±c nhanh:

```sql
SELECT
  d.oid,
  d.datname,
  pg_database_size(d.datname) AS size_bytes,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS table_count
FROM pg_database d
WHERE d.datistemplate = false;
```

---

## 5. Thay Äá»•i IPC Contract Cáº§n Thiáº¿t

Äá»ƒ há»— trá»£ Ä‘áº§y Ä‘á»§ ngá»¯ cáº£nh á»©ng dá»¥ng mÃ  váº«n Ä‘áº£m báº£o tÃ­nh tÆ°Æ¡ng thÃ­ch, há»£p Ä‘á»“ng IPC trong `app/src/shared/ipc.ts` Ä‘Æ°á»£c Ä‘á» xuáº¥t Ä‘iá»u chá»‰nh nhÆ° sau:

| KÃªnh IPC | Chá»¯ kÃ½ hiá»‡n táº¡i | Chá»¯ kÃ½ Ä‘á» xuáº¥t | Má»¥c Ä‘Ã­ch & Kháº£ nÄƒng tÆ°Æ¡ng thÃ­ch ngÆ°á»£c |
| :--- | :--- | :--- | :--- |
| `db:list-databases` | `(vpsId: number) => IpcResult<DbDatabase[]>` | Giá»¯ nguyÃªn chá»¯ kÃ½, **má»Ÿ rá»™ng dá»¯ liá»‡u tráº£ vá» `DbDatabase`** (bá»• sung `app_id`, `app_name`, `container_name`, `status`). | TÆ°Æ¡ng thÃ­ch ngÆ°á»£c 100%. UI cÅ© chá»‰ Ä‘á»c cÃ¡c trÆ°á»ng cÅ© váº«n cháº¡y bÃ¬nh thÆ°á»ng. |
| `db:list-users` | `(vpsId: number) => IpcResult<DbUser[]>` | `(vpsId: number, appId?: number) => IpcResult<DbUser[]>` | Náº¿u truyá»n `appId`, liá»‡t kÃª user cá»§a container app Ä‘Ã³. Náº¿u khÃ´ng truyá»n, máº·c Ä‘á»‹nh láº¥y app Ä‘áº§u tiÃªn hoáº·c tá»•ng há»£p. |
| `db:list-tables` | `(vpsId: number, database: string) => IpcResult<DbSchemaTable[]>` | `(vpsId: number, database: string, appId?: number) => IpcResult<DbSchemaTable[]>` | Cho phÃ©p chá»‰ Ä‘á»‹nh chÃ­nh xÃ¡c container app chá»©a database cáº§n xem schema. Náº¿u khÃ´ng truyá»n `appId`, tá»± suy diá»…n náº¿u trÃªn VPS chá»‰ cÃ³ 1 app DB. |
| `db:save-schema` | `(vpsId: number, database: string, ddl: string) => IpcResult<void>` | `(vpsId: number, database: string, ddl: string, appId?: number) => IpcResult<void>` | Äá»‹nh tuyáº¿n lá»‡nh DDL vÃ o Ä‘Ãºng container cá»§a app. |
| `db:create-database` | `(vpsId: number, name: string) => IpcResult<DbDatabase>` | `(vpsId: number, name: string, appId?: number) => IpcResult<DbDatabase>` | XÃ¡c Ä‘á»‹nh container app tiáº¿p nháº­n database má»›i. |
| `db:create-user` | `(vpsId: number, input: DbUserInput) => IpcResult<DbUser>` | `(vpsId: number, input: DbUserInput, appId?: number) => IpcResult<DbUser>` | Táº¡o user trong container app Ä‘Æ°á»£c chá»‰ Ä‘á»‹nh. |

---

## 6. Xá»­ LÃ½ CÃ¡c TÃ¬nh Huá»‘ng Ngoáº¡i Lá»‡ & Sá»± Cá»‘ Háº¡ Táº§ng

| TÃ¬nh huá»‘ng ngoáº¡i lá»‡ | Hiá»‡n tÆ°á»£ng ká»¹ thuáº­t | CÆ¡ cháº¿ xá»­ lÃ½ Ä‘á» xuáº¥t | Tráº£i nghiá»‡m ngÆ°á»i dÃ¹ng (UX) |
| :--- | :--- | :--- | :--- |
| **VPS khÃ´ng cÃ³ á»©ng dá»¥ng nÃ o dÃ¹ng PostgreSQL** | Báº£ng SQLite `app` khÃ´ng cÃ³ báº£n ghi nÃ o trÃªn `vps_id` cÃ³ `needs_db = 1`. | Handler phÃ¡t hiá»‡n ngay tá»« bÆ°á»›c kiá»ƒm tra DB ná»™i bá»™, láº­p tá»©c tráº£ vá» `ok: true, data: []` mÃ  khÃ´ng thá»±c hiá»‡n káº¿t ná»‘i SSH. | Hiá»ƒn thá»‹ mÃ n hÃ¬nh `Empty` trung thá»±c: *"MÃ¡y chá»§ chÆ°a cÃ³ á»©ng dá»¥ng nÃ o cáº¥u hÃ¬nh cÆ¡ sá»Ÿ dá»¯ liá»‡u. CÃ¡c á»©ng dá»¥ng cÃ³ tÃ¹y chá»n cÆ¡ sá»Ÿ dá»¯ liá»‡u sáº½ tá»± Ä‘á»™ng khá»Ÿi táº¡o PostgreSQL khi triá»ƒn khai."* (KhÃ´ng bÃ¡o lá»—i). |
| **CÃ³ á»©ng dá»¥ng DB nhÆ°ng container chÆ°a cháº¡y / bá»‹ dá»«ng** | Container `${app.name}-db` cÃ³ tráº¡ng thÃ¡i `Exited` hoáº·c khÃ´ng tá»“n táº¡i trong `docker ps`. | Handler ghi nháº­n tráº¡ng thÃ¡i `status: 'stopped'`, khÃ´ng gá»i lá»‡nh `psql` vÃ o container Ä‘Ã³ Ä‘á»ƒ trÃ¡nh treo tiáº¿n trÃ¬nh. | DÃ²ng database váº«n xuáº¥t hiá»‡n trong báº£ng nhÆ°ng hiá»ƒn thá»‹ tráº¡ng thÃ¡i `ÄÃ£ dá»«ng` (tag mÃ u cam/xÃ¡m), vÃ´ hiá»‡u hÃ³a nÃºt báº¥m xem schema kÃ¨m tooltip hÆ°á»›ng dáº«n khá»Ÿi Ä‘á»™ng láº¡i app. |
| **Máº¥t káº¿t ná»‘i SSH / Sai thÃ´ng tin xÃ¡c thá»±c** | `ssh.exec()` nÃ©m lá»—i `SshConnectionError` hoáº·c `SshAuthError`. | Báº¯t lá»—i táº¡i táº§ng handler, bá»c vÃ o `IpcError` chuáº©n vá»›i mÃ£ `SSH_CONNECTION_FAILED`. | UI hiá»ƒn thá»‹ khá»‘i `Alert` mÃ u Ä‘á» mÃ´ táº£ rÃµ lá»—i máº¡ng/SSH kÃ¨m nÃºt **"Thá»­ láº¡i"** (`Retry`), Ä‘á»“ng nháº¥t vá»›i cÃ¡ch xá»­ lÃ½ lá»—i táº¡i tab TÃ i nguyÃªn. |
| **PostgreSQL tá»« chá»‘i káº¿t ná»‘i / ChÆ°a khá»Ÿi Ä‘á»™ng xong** | Container Ä‘ang cháº¡y nhÆ°ng `pg_isready` tráº£ vá» exit code khÃ¡c 0. | Handler Ä‘áº·t timeout ngáº¯n (3 giÃ¢y) cho lá»‡nh kiá»ƒm tra `pg_isready`; náº¿u chÆ°a sáºµn sÃ ng, tráº£ vá» mÃ£ lá»—i `DB_NOT_READY`. | UI hiá»ƒn thá»‹ thÃ´ng bÃ¡o: *"Dá»‹ch vá»¥ PostgreSQL Ä‘ang khá»Ÿi Ä‘á»™ng, vui lÃ²ng thá»­ láº¡i sau giÃ¢y lÃ¡t."* |

---

## 7. PhÃ¢n Ká»³ KÃ­ch Hoáº¡t Thao TÃ¡c Ghi (Write Operations Phasing)

### 7.1. ÄÃ¡nh giÃ¡ rá»§i ro an toÃ n dá»¯ liá»‡u

- **Thao tÃ¡c chá»‰ Ä‘á»c (Read-only)**: `list-databases`, `list-users`, `list-tables`.
  *Má»©c Ä‘á»™ rá»§i ro: 0 (An toÃ n tuyá»‡t Ä‘á»‘i)*. CÃ¡c lá»‡nh chá»‰ thá»±c thi `SELECT` trÃªn `pg_database` vÃ  `information_schema`, hoÃ n toÃ n idempotent, khÃ´ng thay Ä‘á»•i tráº¡ng thÃ¡i há»‡ thá»‘ng.
- **Thao tÃ¡c ghi (Write operations)**: `create-database`, `create-user`, `save-schema`, `import-data`.
  *Má»©c Ä‘á»™ rá»§i ro: Cao*.
  1. Viá»‡c tá»± Ã½ táº¡o thÃªm database bÃªn ngoÃ i cÃ³ thá»ƒ khÃ´ng Ä‘Æ°á»£c á»©ng dá»¥ng (vá»‘n káº¿t ná»‘i cá»‘ Ä‘á»‹nh vÃ o database `opspilot`) nháº­n diá»‡n.
  2. Lá»‡nh `save-schema` thá»±c thi DDL trá»±c tiáº¿p (`CREATE TABLE`, `DROP TABLE`, `ALTER TABLE`) cÃ³ nguy cÆ¡ gÃ¢y máº¥t dá»¯ liá»‡u nghiÃªm trá»ng hoáº·c xung Ä‘á»™t vá»›i cÆ¡ cháº¿ migration ná»™i bá»™ cá»§a á»©ng dá»¥ng (Prisma, Drizzle, TypeORM, Knex).

### 7.2. Lá»™ trÃ¬nh phÃ¢n ká»³ kÃ­ch hoáº¡t

Nháº±m Ä‘áº£m báº£o nghiá»‡m thu cháº¯c cháº¯n vÃ  fail-closed, cÃ¡c tÃ­nh nÄƒng Ä‘Æ°á»£c phÃ¢n ká»³ nhÆ° sau:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ Giai Ä‘oáº¡n 1 (Checkpoint DB-1): Nghiá»‡m thu Read-Only & ÄÃ³ng GAP AC-3.2      â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ â€¢ Báº­t supported={true} trong VpsDetail.tsx.                                 â”‚
â”‚ â€¢ Triá»ƒn khai backend handlers CHá»ˆ Äá»ŒC:                                      â”‚
â”‚   - db:list-databases (há»— trá»£ phÃ¢n biá»‡t app)                                â”‚
â”‚   - db:list-users                                                           â”‚
â”‚   - db:list-tables                                                          â”‚
â”‚ â€¢ VÃ´ hiá»‡u hÃ³a hoáº·c áº©n táº¡m thá»i cÃ¡c nÃºt ghi (+ Táº¡o user, + Táº¡o DB, LÆ°u DDL). â”‚
â”‚ â€¢ Káº¿t quáº£: AC-3.2 chÃ­nh thá»©c chuyá»ƒn sang PASS vá»›i 0 rá»§i ro dá»¯ liá»‡u.         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                      â”‚
                                      â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ Giai Ä‘oáº¡n 2 (Checkpoint DB-2): KÃ­ch hoáº¡t Thao tÃ¡c Ghi cÃ³ báº£o vá»‡             â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ â€¢ Má»Ÿ láº¡i cÃ¡c nÃºt: + Táº¡o Database, + Táº¡o NgÆ°á»i dÃ¹ng, LÆ°u Schema DDL.         â”‚
â”‚ â€¢ Bá»• sung cÆ¡ cháº¿ báº£o vá»‡ an toÃ n:                                            â”‚
â”‚   - Modal cáº£nh bÃ¡o xÃ¡c nháº­n rá»§i ro trÆ°á»›c khi thá»±c thi DDL.                  â”‚
â”‚   - Transaction bá»c ngoÃ i (BEGIN ... COMMIT) cho save-schema.               â”‚
â”‚   - Kiá»ƒm tra trÃ¹ng tÃªn database / user trÆ°á»›c khi táº¡o.                       â”‚
â”‚   - KhÃ´ng lÆ°u máº­t kháº©u báº£n rÃµ vÃ o log hoáº·c Ä‘Ä©a.                             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 8. Káº¿ Hoáº¡ch Triá»ƒn Khai Tá»«ng BÆ°á»›c & Kiá»ƒm Thá»­ Offline

ToÃ n bá»™ quy trÃ¬nh triá»ƒn khai tuÃ¢n thá»§ tuyá»‡t Ä‘á»‘i quy táº¯c **khÃ´ng phá»¥ thuá»™c VPS tháº­t**, sá»­ dá»¥ng cÆ¡ cháº¿ giáº£ láº­p táº§ng SSH (Mock SSH Harness) tÆ°Æ¡ng tá»± nhÆ° cÃ¡c bá»™ test Ä‘Ã£ hoÃ n thiá»‡n á»Ÿ `headlessPoller.test.ts` vÃ  `service.test.ts`.

### 8.1. CÃ¡c bÆ°á»›c thá»±c hiá»‡n chi tiáº¿t

1. **BÆ°á»›c 1: XÃ¢y dá»±ng Module `DatabaseService` Backend (`app/src/main/db/databaseService.ts`)**
   - Äá»c danh sÃ¡ch app tá»« `AppRepository`.
   - Káº¿t ná»‘i `SshManager.exec()` Ä‘á»ƒ kiá»ƒm tra container vÃ  cháº¡y lá»‡nh `psql`.
   - Xá»­ lÃ½ phÃ¢n tÃ­ch káº¿t quáº£ TSV thÃ nh Ä‘á»‘i tÆ°á»£ng `DbDatabase[]`, `DbUser[]`, `DbSchemaTable[]`.
   - Xá»­ lÃ½ fail-closed khi SSH lá»—i hoáº·c container váº¯ng máº·t.

2. **BÆ°á»›c 2: Viáº¿t Bá»™ Kiá»ƒm Thá»­ Äá»™c Láº­p Offline (`databaseService.test.ts`)**
   - Táº¡o bá»™ mock SSH tráº£ vá» stdout giáº£ láº­p cho cÃ¡c ká»‹ch báº£n:
     - *Ca 1*: VPS khÃ´ng cÃ³ app nÃ o cÃ³ `needs_db = 1` -> Tráº£ vá» máº£ng rá»—ng ngay láº­p tá»©c, khÃ´ng gá»i SSH.
     - *Ca 2*: VPS cÃ³ 1 app `express-api` vá»›i container `express-api-db` Ä‘ang cháº¡y -> Tráº£ vá» database `opspilot` gáº¯n Ä‘Ãºng `app_id` vÃ  `app_name`.
     - *Ca 3*: VPS cÃ³ 2 app `express-api` vÃ  `next-blog` cÃ¹ng cháº¡y DB -> Tráº£ vá» 2 database riÃªng biá»‡t cÃ³ `app_name` khÃ¡c nhau, khÃ´ng xung Ä‘á»™t key.
     - *Ca 4*: Container DB á»Ÿ tráº¡ng thÃ¡i `Exited` -> BÃ¡o `status: 'stopped'`, khÃ´ng nÃ©m lá»—i unhandled.
     - *Ca 5*: Lá»‡nh SSH tháº¥t báº¡i do máº¥t káº¿t ná»‘i -> NÃ©m lá»—i `AppError` chuáº©n cÃ³ mÃ£ lá»—i rÃµ rÃ ng.
     - *Ca 6*: Láº¥y danh sÃ¡ch báº£ng cho má»™t database cá»¥ thá»ƒ -> PhÃ¢n tÃ­ch chÃ­nh xÃ¡c cá»™t, kiá»ƒu dá»¯ liá»‡u, khÃ³a chÃ­nh vÃ  khÃ³a ngoáº¡i.

3. **BÆ°á»›c 3: ÄÄƒng KÃ½ Handler Trong `app/src/main/ipc.ts`**
   - Ná»‘i cÃ¡c kÃªnh `db:list-databases`, `db:list-users`, `db:list-tables` vÃ o `DatabaseService`.

4. **BÆ°á»›c 4: Cáº­p Nháº­t UI `VpsDatabaseTab.tsx` & Báº­t `supported={true}` Trong `VpsDetail.tsx`**
   - Truyá»n `supported={true}` tá»« `VpsDetail.tsx`.
   - Bá»• sung hiá»ƒn thá»‹ `app_name` vÃ  bá»™ lá»c app trong `VpsDatabaseTab.tsx`.
   - Viáº¿t test Vitest Renderer cho `VpsDatabaseTab.test.tsx` xÃ¡c nháº­n báº£ng hiá»ƒn thá»‹ Ä‘Ãºng khi cÃ³ dá»¯ liá»‡u mock tá»« IPC.

5. **BÆ°á»›c 5: Nghiá»‡m Thu AC-3.2 & Cáº­p Nháº­t TÃ i Liá»‡u**
   - Cháº¡y toÃ n bá»™ quality gates: lint sáº¡ch 100%, typecheck sáº¡ch 100%, full app test pass.
   - Cáº­p nháº­t checklist trong `docs/ui-redesign/README.md` vÃ  `docs/ui-redesign/ui-1k-acceptance.md`: chuyá»ƒn AC-3.2 tá»« **GAP** sang **PASS**.

---

## 9. Káº¿t Luáº­n Checkpoint DB-0

- Báº£n thiáº¿t káº¿ trÃªn Ä‘Ã£ xÃ¡c Ä‘á»‹nh chÃ­nh xÃ¡c nguyÃªn nhÃ¢n gá»‘c rá»… vÃ  Ä‘áº·c thÃ¹ kiáº¿n trÃºc per-app container cá»§a OpsPilot.
- ÄÃ£ giáº£i quyáº¿t trá»n váº¹n bÃ i toÃ¡n Ä‘a á»©ng dá»¥ng trÃªn cÃ¹ng má»™t VPS thÃ´ng qua mÃ´ hÃ¬nh Ä‘á»‹nh danh database cÃ³ ngá»¯ cáº£nh app (`app_id`, `app_name`).
- ÄÃ£ thiáº¿t láº­p káº¿ hoáº¡ch kiá»ƒm thá»­ offline hoÃ n chá»‰nh, tÃ¡ch biá»‡t rÃµ rÃ ng giá»¯a thao tÃ¡c Äá»c (an toÃ n) vÃ  thao tÃ¡c Ghi (báº£o vá»‡ dá»¯ liá»‡u).
- Checkpoint DB-0 hoÃ n thÃ nh viá»‡c chuáº©n bá»‹ tÃ i liá»‡u thiáº¿t káº¿; sáºµn sÃ ng bÆ°á»›c vÃ o Checkpoint DB-1 khi cÃ³ chá»‰ thá»‹ triá»ƒn khai mÃ£ nguá»“n.
