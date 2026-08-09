# KẾ HOẠCH THỰC HIỆN ĐỒ ÁN — 12 TUẦN, 2 NGƯỜI
## Ứng dụng desktop deploy/migrate Web app trên VPS + ML phát hiện degraded state

> Tài liệu này là "source of truth" khi làm việc với AI. Mỗi module có spec đủ chi tiết
> (interface, schema, luồng xử lý) để copy vào bất kỳ model AI nào và code được ngay,
> không cần giải thích lại ngữ cảnh.

---

## PHẦN 0 — NGUYÊN TẮC CHỐNG OVERENGINEERING (đọc trước khi code bất kỳ dòng nào)

1. **Điểm số nằm ở phần ML + đánh giá thống kê**, không nằm ở app đẹp. App chỉ cần chạy đúng, ổn định.
2. **Monolith trước, tách sau.** Chỉ có đúng 2 process: Electron app và Python ML service. Không message queue, không Redis, không microservice thật.
3. **SQLite cho mọi thứ** (cấu hình, lịch sử, metric, nhãn). Không PostgreSQL cho bản thân app (PostgreSQL chỉ dùng cho app demo được deploy lên VPS).
4. **Metric collector = 1 script Python ~100 dòng trong container Alpine**, KHÔNG dùng cAdvisor/Prometheus/node-exporter. Lý do: cAdvisor kéo theo hệ sinh thái Prometheus, tốn 1–2 tuần tích hợp mà không cộng điểm.
5. **"Plugin detector" = 1 mảng object cùng interface trong 1 thư mục**, KHÔNG dynamic loading, KHÔNG hệ thống plugin runtime. "Dễ mở rộng" nghĩa là: thêm 1 file mới + đăng ký vào mảng.
6. **Migrate chỉ hỗ trợ app do chính tool này deploy** (cấu trúc thư mục/volume đã biết trước). Không migrate app lạ.
7. **Không authentication/multi-user** — app desktop 1 người dùng.
8. **UI dùng component library có sẵn (shadcn/ui hoặc Ant Design), không tự thiết kế.** Dashboard dùng Recharts.
9. Tier 2 (Flask) chỉ làm ở tuần 11 nếu mọi thứ xong. Nếu tuần 9 mà phần ML chưa chạy thí nghiệm được → cắt Tier 2 vĩnh viễn, không bàn lại.
10. Mọi lệnh chạy trên VPS đều qua SSH exec. Không viết agent, không gRPC, không websocket tới VPS.

---

## PHẦN 1 — KIẾN TRÚC CHỐT (đã đơn giản hoá so với đề xuất)

```
┌────────────────── Máy người dùng ──────────────────┐      ┌───────── VPS ─────────┐
│  Electron App                                      │      │  Docker                │
│  ├─ Renderer: React + TS (UI)                      │ SSH  │  ├─ app container(s)   │
│  ├─ Main: Node.js                                  │─────▶│  ├─ postgres (nếu cần) │
│  │   ├─ ssh-manager (ssh2)                         │      │  ├─ nginx              │
│  │   ├─ detector-engine                            │      │  └─ metric-collector   │
│  │   ├─ deploy-pipeline                            │      │      (script python,   │
│  │   ├─ migrate-pipeline                           │      │       ghi JSON ra file)│
│  │   ├─ metric-poller (đọc file JSON qua SSH)      │      └────────────────────────┘
│  │   └─ sqlite (better-sqlite3)                    │
│  │                                                 │
│  └─ HTTP localhost:8765 ──▶ Python ML service      │
│       (FastAPI + scikit-learn, spawn bởi Electron) │
└────────────────────────────────────────────────────┘
```

**Các quyết định chốt:**
- Metric collector ghi metric mới nhất vào `/var/metrics/latest.json` trong volume; Electron poll bằng `cat` qua SSH mỗi 15–30s. Đơn giản nhất có thể, không mở port thêm trên VPS.
- ML service do Electron main process spawn khi khởi động (child_process), giao tiếp REST localhost. Đóng gói: yêu cầu máy có Python 3.10+ và chạy `pip install -r requirements.txt` lần đầu (ghi rõ trong README — chấp nhận được với đồ án, không cần bundle PyInstaller trừ khi dư thời gian).
- Deploy = rsync/scp source lên VPS → build image TRÊN VPS (`docker build` qua SSH) → `docker compose up -d`. Không build image local rồi push (tránh registry).
- Rollback = giữ N image cũ trên VPS (tag theo version), rollback là `docker compose` với tag cũ. Nhanh, không cần build lại.

---

## PHẦN 2 — CẤU TRÚC REPO

```
repo/
├─ app/                          # Electron
│  ├─ src/main/
│  │  ├─ ssh/manager.ts          # pool kết nối ssh2, exec, sftp
│  │  ├─ crypto/credentials.ts   # AES-256-GCM
│  │  ├─ db/                     # better-sqlite3 + migrations.sql
│  │  ├─ detectors/
│  │  │  ├─ types.ts             # interface Detector
│  │  │  ├─ nextjs.ts  express.ts  static-spa.ts  (flask.ts nếu Tier 2)
│  │  │  └─ index.ts             # export const DETECTORS: Detector[]
│  │  ├─ deploy/pipeline.ts      # state machine deploy
│  │  ├─ migrate/pipeline.ts
│  │  ├─ monitor/poller.ts       # poll metric + gọi ML service + rule engine
│  │  └─ ipc.ts                  # toàn bộ IPC handlers (typed)
│  ├─ src/renderer/              # React: pages theo use case UC-01..UC-09
│  └─ electron-builder.yml
├─ ml-service/
│  ├─ main.py                    # FastAPI
│  ├─ models/{zscore_ewma,iforest,ocsvm}.py
│  ├─ features.py                # sliding window → feature vector
│  └─ requirements.txt
├─ collector/
│  ├─ collect.py                 # ~100 dòng, đọc docker stats + probe HTTP + probe DB
│  └─ Dockerfile                 # python:3.12-alpine
├─ templates/                    # Dockerfile template cho từng framework
│  ├─ nextjs.Dockerfile  express.Dockerfile  static-spa.Dockerfile
│  └─ docker-compose.template.yml
├─ experiments/
│  ├─ faults/                    # script gây lỗi (memory_leak.py, cpu_spike.sh, ...)
│  ├─ run_experiment.py          # chạy lặp kịch bản, thu kết quả
│  └─ analyze.py                 # tính P/R/F1 + CI, xuất bảng LaTeX/Markdown
└─ demo-apps/                    # 3 app mẫu Tier 1 để test/demo
   ├─ next-blog/  express-api/  vite-spa/
```

---

## PHẦN 3 — SCHEMA SQLITE (file: app/src/main/db/migrations.sql)

```sql
CREATE TABLE vps (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL,
  port INTEGER DEFAULT 22, username TEXT NOT NULL,
  auth_type TEXT CHECK(auth_type IN ('key','password')),
  encrypted_secret BLOB NOT NULL,   -- private key hoặc password, AES-256-GCM
  iv BLOB NOT NULL, auth_tag BLOB NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE deployment (
  id INTEGER PRIMARY KEY, vps_id INTEGER REFERENCES vps(id),
  app_name TEXT NOT NULL, framework TEXT NOT NULL,      -- 'nextjs'|'express'|'static-spa'|'flask'
  version INTEGER NOT NULL,                             -- tăng dần theo app_name+vps
  image_tag TEXT NOT NULL,                              -- vd: myapp:v3
  source_path TEXT, env_json TEXT,                      -- env không nhạy cảm
  status TEXT CHECK(status IN ('building','deploying','running','failed','rolled_back','stopped')),
  started_at TEXT, finished_at TEXT
);

CREATE TABLE metric_sample (
  id INTEGER PRIMARY KEY, deployment_id INTEGER REFERENCES deployment(id),
  ts TEXT NOT NULL,
  cpu_pct REAL, mem_mb REAL, mem_pct REAL,
  latency_ms REAL, http_error_rate REAL,      -- tỷ lệ 5xx trong cửa sổ
  db_response_ms REAL, container_up INTEGER,  -- 0/1
  raw_json TEXT
);

CREATE TABLE alert (
  id INTEGER PRIMARY KEY, deployment_id INTEGER,
  ts TEXT NOT NULL,
  method TEXT CHECK(method IN ('rule','zscore_ewma','iforest','ocsvm')),
  score REAL,                -- độ tin cậy/anomaly score đã chuẩn hoá 0..1
  triggered INTEGER,         -- 1 nếu vượt ngưỡng
  detail_json TEXT,          -- metric nào bất thường
  label TEXT CHECK(label IN ('true_positive','false_positive',NULL)),  -- UC-08
  experiment_run_id INTEGER  -- NULL nếu không thuộc thí nghiệm
);

CREATE TABLE action_log (   -- FR-E3
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
  action TEXT,              -- deploy|migrate|rollback_manual|rollback_auto|alert|...
  detail_json TEXT
);

CREATE TABLE experiment_run (  -- NFR-8
  id INTEGER PRIMARY KEY, scenario TEXT NOT NULL,   -- 'memory_leak'|'cpu_spike'|...
  repeat_index INTEGER, fault_start_ts TEXT, fault_end_ts TEXT,
  deployment_id INTEGER, notes TEXT
);
```

---

## PHẦN 4 — SPEC TỪNG MODULE (đưa cho AI code theo thứ tự)

### M1. SSH Manager (`app/src/main/ssh/manager.ts`)
- Dùng thư viện `ssh2`. API cần có:
  - `connect(vpsId): Promise<Connection>` — pool 1 connection/VPS, tự reconnect.
  - `exec(vpsId, cmd, {onData?}): Promise<{code, stdout, stderr}>` — stream stdout cho log real-time.
  - `uploadDir(vpsId, localDir, remoteDir, {exclude: ['node_modules','.git']})` — sftp, nén tar trước khi truyền (`tar czf - . | ssh ... 'tar xzf - -C dir'` nhanh hơn sftp từng file).
  - `readFile(vpsId, remotePath): Promise<string>` — dùng cho poll metric.
- Test được độc lập bằng script nhỏ trước khi gắn vào UI.

### M2. Credential crypto (`crypto/credentials.ts`)
- AES-256-GCM, key dẫn xuất từ passphrase người dùng nhập lúc mở app (scrypt) HOẶC đơn giản hơn: dùng `safeStorage` của Electron (mã hoá bằng keychain OS). **Chọn `safeStorage` — ít code hơn, vẫn thoả NFR-2.** Chỉ tự viết AES-GCM nếu giảng viên yêu cầu đúng nguyên văn.

### M3. Detector engine (`detectors/`)
```ts
interface Detector {
  id: 'nextjs' | 'express' | 'static-spa' | 'flask';
  priority: number;                      // nextjs check trước express (cả 2 đều có package.json)
  detect(files: SourceTree): boolean;    // SourceTree: đọc file trong thư mục source
  buildPlan(files: SourceTree): {
    dockerfileTemplate: string;          // tên file trong templates/
    buildArgs: Record<string,string>;
    requiredEnv: string[];               // biến env bắt buộc, thiếu thì wizard hỏi (FR-B3)
    defaultPort: number;
    healthcheckPath: string;             // vd '/' hoặc '/health'
  };
}
```
- Quy tắc detect: nextjs = có `next` trong dependencies; express = có `express` và không có next/vite; static-spa = có `vite` trong devDependencies; flask = có `requirements.txt` chứa flask.
- `requiredEnv`: parse `.env.example` nếu có + mảng cứng theo framework (vd `DATABASE_URL` nếu source có dùng `pg`/`prisma`).

### M4. Deploy pipeline (`deploy/pipeline.ts`) — state machine tuyến tính
Các bước, mỗi bước emit event cho UI (log real-time, FR-B6):
1. `PRECHECK` — qua SSH: `free -m`, `df -h`, `ss -tlnp` → so RAM/disk/port với yêu cầu (FR-B4). Ngưỡng: RAM trống > 512MB, disk trống > 2GB, port chưa dùng.
2. `UPLOAD` — tar+ssh source lên `/opt/deploytool/<app>/src/`.
3. `RENDER` — sinh Dockerfile từ template + docker-compose.yml (app + nginx + collector + postgres nếu cần) vào thư mục app.
4. `BUILD` — `docker build -t <app>:v<N> .` (stream log).
5. `DEPLOY` — `docker compose up -d`; ghi env vào file `.env` trên VPS (chmod 600).
6. `HEALTHCHECK` — curl healthcheckPath 10 lần cách 3s; fail → tự rollback về v<N-1> (UC-03).
7. `RECORD` — insert bảng deployment + action_log; giữ tối đa 3 image cũ (`docker image prune` có lọc).
- Lỗi ở bước nào → dừng, báo bước đó, không dọn dở dang trừ container vừa tạo.

### M5. Metric collector (`collector/collect.py`) — chạy trong container trên VPS
- Vòng lặp 5s: 
  - `docker stats --no-stream --format json` (mount docker.sock read-only) → cpu_pct, mem.
  - HTTP probe: `GET http://app:<port><healthcheckPath>` đo latency; đếm mã 5xx trong cửa sổ 60s → error_rate. Đọc thêm access log nginx (mount volume) nếu muốn error rate thật của traffic — **phiên bản 1 chỉ cần probe chủ động, đủ cho thí nghiệm.**
  - DB probe (nếu có postgres): `SELECT 1` đo thời gian.
- Ghi đè `/var/metrics/latest.json` (volume). Format:
```json
{"ts":"2026-07-26T10:00:00Z","cpu_pct":12.3,"mem_mb":210.5,"mem_pct":20.1,
 "latency_ms":45.2,"http_error_rate":0.0,"db_response_ms":3.1,"container_up":1}
```
- Electron poller (`monitor/poller.ts`): mỗi 15s `readFile('/opt/deploytool/<app>/metrics/latest.json')` → insert metric_sample → đẩy qua IPC cho dashboard → POST cho ML service → chạy rule engine.

### M6. Rule engine (trong poller, FR-D3)
- Ngưỡng cấu hình được, mặc định: cpu>90% liên tục 3 mẫu, mem>90%, latency>2000ms, error_rate>0.5, container_up=0 → alert method='rule'.

### M7. ML service (`ml-service/`) — FastAPI, cổng 8765
API contract (Electron chỉ cần biết đúng 4 endpoint này):
```
POST /ingest        body: {deployment_id, sample: {...metric fields}}
                    → mỗi model cập nhật; trả {scores: {zscore_ewma: 0..1, iforest: 0..1, ocsvm: 0..1},
                                              triggered: {zscore_ewma: bool, ...}}
POST /train         body: {deployment_id, samples: [...]}   # huấn luyện lại từ dữ liệu "bình thường"
GET  /status        → model đã train chưa, số mẫu
POST /reset         body: {deployment_id}
```
- `features.py`: sliding window 20 mẫu → vector đặc trưng cho mỗi metric: [giá trị hiện tại, mean cửa sổ, std cửa sổ, slope (hồi quy tuyến tính trên cửa sổ)]. Slope là chìa khoá bắt "suy giảm dần" (memory leak) — nhấn mạnh trong báo cáo.
- 3 model:
  - `zscore_ewma.py`: EWMA (α=0.3) cho từng metric, z-score so với baseline; score = max z chuẩn hoá sigmoid.
  - `iforest.py`: sklearn IsolationForest(n_estimators=100), train trên ≥200 mẫu bình thường; score = -decision_function chuẩn hoá min-max theo tập train.
  - `ocsvm.py`: OneClassSVM(kernel='rbf', nu=0.05), cùng pipeline; **bắt buộc StandardScaler trước**.
- **Phương pháp thứ 4 — Ensemble voting (gần như miễn phí):** `ensemble` triggered khi ≥2/3 model triggered. Không train gì thêm, chỉ là phép AND/OR trên kết quả 3 model, nhưng cho thêm 1 dòng trong bảng so sánh — thường là dòng false positive thấp nhất, rất đẹp để bàn luận. Thêm giá trị 'ensemble' vào CHECK constraint của bảng alert.
- Ngưỡng triggered mặc định: score>0.7 trong ≥2 mẫu liên tiếp (giảm false positive do nhiễu). Ngưỡng nằm trong config, sẽ tinh chỉnh ở tuần thí nghiệm.
- Model + scaler pickle vào `ml-service/state/<deployment_id>/` để không mất khi restart.

### M8. Auto-rollback (FR-E2, UC-07)
- Setting per-deployment: `{auto_rollback: bool, trusted_method: 'rule'|'zscore_ewma'|'iforest'|'ocsvm', consecutive_required: 3}`.
- Poller thấy trusted_method triggered đủ N lần liên tiếp → gọi deploy pipeline rollback → alert + action_log. Có cooldown 10 phút để không rollback lặp.

### M9. Migrate pipeline (`migrate/pipeline.ts`) — UC-05, chỉ cho app do tool deploy
1. `docker compose stop app` trên nguồn (DB vẫn chạy để dump).
2. Backup: `docker exec postgres pg_dump -Fc > backup.dump`; tar volume persistent + thư mục app + .env.
3. Truyền: stream trực tiếp nguồn→đích qua máy người dùng (`ssh nguồn 'cat file' | ssh đích 'cat > file'`) — không yêu cầu 2 VPS thấy nhau.
4. Trên đích: chạy lại các bước RENDER→BUILD→DEPLOY của M4, restore dump, mount lại volume.
5. Verify (FR-C4): checksum sha256 các file backup 2 phía; `SELECT count(*)` từng bảng so sánh nguồn/đích; healthcheck app đích.
6. Người dùng bấm xác nhận → mới stop hẳn + (tuỳ chọn) xoá bên nguồn. Lỗi bất kỳ bước nào → đích dọn sạch, nguồn `docker compose start app` lại (FR-C5).

### M10. UI (renderer) — 6 màn hình, map thẳng use case
1. VPS list (UC-01) 2. Deploy wizard 4 bước: chọn source→kết quả detect→điền env thiếu→precheck+confirm (UC-02) 3. App detail: log real-time + lịch sử version + nút rollback (UC-03/04) 4. Dashboard: 6 chart Recharts + panel alert 4 phương pháp cạnh nhau, mỗi alert có 2 nút Đúng/Sai để gắn nhãn (UC-06/08) 5. Migrate wizard (UC-05) 6. History có filter (UC-09).

---

## PHẦN 5 — THÍ NGHIỆM & ĐÁNH GIÁ (phần ăn điểm nhất)

### 5.1 Kịch bản fault-injection (`experiments/faults/`) — inject vào app demo express-api
| Kịch bản | Cách gây lỗi | Kiểu suy giảm |
|---|---|---|
| memory_leak | endpoint `/debug/leak` mỗi request giữ 5MB vào mảng toàn cục; script gọi đều đặn | tăng dần (demo bảo vệ) |
| cpu_spike | endpoint `/debug/cpu?ms=x` busy-loop; tăng dần x | tăng dần |
| error_burst | endpoint `/debug/error-rate?p=x` trả 500 xác suất p | đột ngột / tăng dần |
| slow_db | `SELECT pg_sleep(x)` trước mỗi query, x tăng dần | tăng dần |
| latency_creep | middleware delay tăng 50ms mỗi phút | tăng dần |

### 5.2 Quy trình 1 lần chạy (tự động hoá bằng `run_experiment.py`)
1. Deploy app demo sạch → chờ 15 phút thu dữ liệu bình thường (60 mẫu) → `POST /train`.
2. Ghi `fault_start_ts` vào experiment_run → kích hoạt fault → chạy 20 phút.
3. Tắt fault, chờ hồi phục 10 phút → kết thúc run.
4. Ground truth: mẫu trong [fault_start + độ trễ hợp lý, fault_end] = anomaly. Alert trong khoảng đó = TP, ngoài = FP; không alert trong khoảng = FN (tính theo cửa sổ, ghi rõ định nghĩa trong báo cáo).
- **Mỗi kịch bản × 10 lần lặp** (NFR-8). 5 kịch bản × 10 = 50 run × ~45 phút ≈ 37 giờ máy chạy → chạy qua đêm tuần 10, hoàn toàn tự động, 2 VPS chạy song song để chia đôi thời gian.

### 5.3 `analyze.py`
- Đọc alert + experiment_run từ SQLite → P/R/F1 per method per scenario → mean ± std, 95% CI (t-distribution, n=10) → thêm **detection delay** (giây từ fault_start đến alert đầu tiên, so ML vs rule) → xuất bảng Markdown + biểu đồ matplotlib cho báo cáo.
- **QUAN TRỌNG cho việc này:** poller phải lưu **score thô của mọi phương pháp tại mọi mẫu** (kể cả khi không triggered) vào bảng alert với triggered=0. Nhờ đó 3 phân tích dưới đây chạy hoàn toàn OFFLINE trên dữ liệu đã thu, không tốn thêm giờ máy nào:
  1. **Threshold sweep → đường Precision-Recall:** quét ngưỡng 0.1→0.95, vẽ PR curve cho từng phương pháp thay vì chỉ 1 điểm. Báo cáo thêm AUC-PR. Đây là cách trình bày của paper thật, hiếm đồ án nào có.
  2. **Ablation study — chứng minh slope feature là chìa khoá:** chạy lại inference offline trên metric_sample đã lưu với feature vector BỎ slope → bảng "có slope vs không slope" cho kịch bản memory_leak/latency_creep. Kỳ vọng: detection delay tăng vọt khi bỏ slope → chứng minh bằng số liệu rằng thiết kế feature là có chủ đích, không phải may mắn. (Cần ml-service có endpoint `POST /replay` nhận mảng samples + cờ feature_config, chạy inference thuần không side-effect — ~30 dòng code.)
  3. **Biểu đồ timeline 1 run tiêu biểu:** trục x thời gian, vẽ metric (mem) + vạch fault_start + điểm alert của từng phương pháp → 1 hình nói lên toàn bộ câu chuyện "ML bắt sớm hơn rule bao nhiêu". Đặt hình này ở đầu chương kết quả.

### 5.4 Demo bảo vệ — kịch bản 3 màn (~8 phút)
**Màn 1 — Deploy (2'):** kéo thư mục app demo vào tool → detect framework tự động → deploy lên VPS thật < 3 phút, log real-time chạy trên màn hình. Mở app bằng điện thoại của giảng viên nếu được (URL thật, VPS thật — không phải localhost).
**Màn 2 — Tự cứu chính nó (4', đinh của buổi bảo vệ):** bấm script memory leak → dashboard cho thấy mem tăng dần → lần lượt các method ML bật cảnh báo (chỉ vào score từng method tăng), **trong khi vạch ngưỡng rule 90% chưa chạm** → auto-rollback kích hoạt → app hồi phục, mem về bình thường. Câu chốt: "hệ thống phát hiện và tự khắc phục trước khi threshold truyền thống kịp phản ứng X giây — đúng con số trung bình trong bảng thí nghiệm."
**Màn 3 — Tính mở rộng bằng con số (2'):** mở file `flask.ts` (nếu làm Tier 2): "thêm 1 framework mới = 1 file N dòng, không sửa 1 dòng nào ở lõi, mất Y giờ" — con số Y đo thật khi làm ở tuần 11, ghi vào báo cáo làm bằng chứng cho tiêu chí "tính mở rộng của kiến trúc detector".
- Tập dượt ≥3 lần ở tuần 12, quay video dự phòng từng màn. Chuẩn bị sẵn snapshot VPS để reset nhanh giữa các lần tập.

---

## PHẦN 6 — TIMELINE 12 TUẦN

Phân công: **Người A = App/Infra** (Electron, SSH, deploy, migrate). **Người B = ML/Monitoring** (collector, ML service, thí nghiệm, báo cáo phần ML). Cả hai review chéo cuối tuần.

| Tuần | Người A | Người B | Milestone kiểm chứng được |
|---|---|---|---|
| 1 | Setup repo (electron-vite + TS), M1 SSH manager, M2 credential, mua 2 VPS | Setup ml-service skeleton (FastAPI hello), collector v0 chạy local, viết 3 app demo (dùng AI sinh nhanh) | `exec` được lệnh trên VPS thật từ app; app demo chạy local |
| 2 | UC-01: VPS list UI + check/cài Docker + SQLite | M5 collector hoàn chỉnh, test bằng docker run tay trên VPS | Thêm VPS qua UI, thấy online; latest.json có số liệu đúng |
| 3 | M3 detectors (3 Tier 1) + unit test; M4 bước 1–4 | M7 features.py + zscore_ewma + /ingest, test bằng dữ liệu giả (CSV) | Detect đúng 3 app demo; build image thành công trên VPS qua tool |
| 4 | M4 hoàn chỉnh (deploy + healthcheck + log real-time UI) | iforest + ocsvm + /train + lưu state; script sinh dữ liệu giả có anomaly để test nhanh | **Deploy end-to-end 3 app demo từ UI < 3 phút (NFR-4)** |
| 5 | Redeploy + rollback thủ công (UC-03/04) + history | M6 poller + rule engine + nối /ingest thật; dashboard v1 (chart) | Metric thật từ VPS hiện lên dashboard; rollback tay hoạt động |
| 6 | Deploy wizard hoàn thiện (env thiếu, precheck) | Panel alert 4 phương pháp + gắn nhãn (UC-08); tinh chỉnh ngưỡng sơ bộ | Gây lỗi tay (stress) → thấy alert của ≥1 method |
| 7 | M9 migrate: backup + truyền + restore | Fault endpoints vào express-api demo + 5 script fault | Migrate app không DB thành công giữa 2 VPS |
| 8 | M9: verify checksum/count + rollback migrate (FR-C5) | `run_experiment.py` tự động hoá full 1 run; chạy thử 2 run | Migrate app có PostgreSQL thành công; 1 run thí nghiệm ra alert + ground truth đúng |
| 9 | M8 auto-rollback + cooldown; sửa bug tồn | Chạy pilot mỗi kịch bản 2 lần, tinh chỉnh ngưỡng/feature **chốt cấu hình** | **Code freeze phần ML config**; auto-rollback demo được |
| 10 | Hỗ trợ trực thí nghiệm; đóng gói electron-builder | Chạy 50 run chính thức (2 VPS song song, qua đêm); `analyze.py` bảng chính | Bảng P/R/F1 ± CI hoàn chỉnh (4 phương pháp kể cả ensemble) |
| 11 | **Buffer bug/polish**; Tier 2 Flask CHỈ NẾU mọi thứ xanh (đo giờ công làm bằng chứng mở rộng) | Phân tích offline: PR curve, ablation slope, timeline chart; viết chương ML | Bản build cài được trên máy sạch; đủ hình cho báo cáo |
| 12 | Báo cáo phần kiến trúc/app; slide | Hoàn thiện báo cáo, phần "Hạn chế & hướng phát triển" | Tập demo ≥3 lần + quay video dự phòng; nộp |

**Quy tắc trượt tiến độ:** trễ >1 tuần ở tuần 6 → cắt slow_db + latency_creep (còn 3 kịch bản × 10 run vẫn đủ thống kê); trễ ở tuần 8 → migrate chỉ demo app không DB, ghi hạn chế vào báo cáo. Không bao giờ cắt: 3 phương pháp ML, lặp ≥10 lần, auto-rollback.

---

## PHẦN 7 — VPS & CHI PHÍ

- **2 VPS** (nguồn + đích cho migrate, đồng thời chạy song song thí nghiệm): 2 vCPU / 4GB RAM / 40GB SSD mỗi cái là đủ (build Next.js cần ≥2GB). Gợi ý: DigitalOcean/Vultr/Hetzner ~6–12 USD/tháng/VPS × 3 tháng ≈ 40–70 USD tổng. Ubuntu 22.04/24.04 LTS.
- Snapshot VPS sạch (chỉ có Docker) ngay sau setup → reset nhanh giữa các thí nghiệm.

---

## PHẦN 8 — DANH SÁCH KHÔNG LÀM (chốt, để khỏi sa đà)

- Không cAdvisor/Prometheus/Grafana. Không Kubernetes. Không CI/CD cho chính tool.
- Không hỗ trợ Windows VPS, không multi-user, không cloud sync, không auto-update app.
- Không HTTPS/domain tự động (Let's Encrypt) — ghi vào "hướng phát triển".
- Không train deep learning (LSTM/autoencoder) — ghi vào "hướng phát triển" kèm lý do (dữ liệu ít).
- Không migrate app không do tool deploy.
- Không tự viết AES nếu safeStorage đạt yêu cầu.

---

## PHẦN 9 — CÁCH DÙNG AI ĐỂ CODE HIỆU QUẢ

1. Mỗi phiên làm việc với AI: paste **Phần 1 (kiến trúc) + spec module đang làm + schema liên quan**. Không paste cả file này.
2. Yêu cầu AI code theo đúng interface trong spec — interface là hợp đồng giữa 2 người, không cho AI "cải tiến" interface.
3. Thứ tự cho mỗi module: (a) AI viết code + test độc lập chạy bằng script CLI trước, (b) chạy thật với VPS, (c) mới nối vào UI. SSH/deploy debug qua UI rất chậm.
4. Giữ 1 file `DECISIONS.md` ghi mọi thay đổi so với plan này (1 dòng/thay đổi) — chính là tài liệu trả lời giảng viên phần "AI hỗ trợ nhưng em nắm kiến trúc".
5. Test nhanh ML không cần VPS: script sinh chuỗi metric giả (bình thường + inject anomaly bằng numpy) → gọi /ingest — Người B làm việc độc lập hoàn toàn với Người A trong tuần 3–4.
