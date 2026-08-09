# KẾ HOẠCH THI HÀNH — KIẾN TRÚC & SPEC MODULE

> Bản thi hành đã đơn giản hoá và sửa lỗi so với [`00-de-tai-goc.md`](00-de-tai-goc.md).
> Mọi khác biệt so với đề tài gốc đã ghi trong [`../DECISIONS.md`](../DECISIONS.md).
>
> **File này KHÔNG chứa schema SQL, không chứa định nghĩa API.** Những thứ đó nằm trong
> [`contracts/`](contracts/) để chỉ có đúng một nguồn sự thật. File này mô tả *hành vi*.

---

## PHẦN 0 — NGUYÊN TẮC CHỐNG OVERENGINEERING

Đọc trước khi code bất kỳ dòng nào. Bản đầy đủ 12 điều: [`../CLAUDE.md`](../CLAUDE.md) mục 2.

Ba điều quan trọng nhất, nhắc lại ở đây vì hay bị vi phạm nhất:

1. **Điểm số nằm ở phần ML + đánh giá thống kê**, không nằm ở app đẹp. App chỉ cần chạy
   đúng, ổn định, đủ để sinh dữ liệu thí nghiệm.
2. **Monolith trước, tách sau.** Đúng 2 tiến trình: Electron app và Python ML service.
3. **Không tự "cải tiến" interface.** Interface là hợp đồng giữa 2 người và giữa các phiên AI.

---

## PHẦN 1 — KIẾN TRÚC CHỐT

```
┌──────────────── Máy người dùng (Windows) ─────────────────┐      ┌────────── VPS (Ubuntu 24.04) ──────────┐
│  Electron App                                             │      │  Docker                                 │
│  ├─ Renderer: React + TS + Ant Design v5                  │      │  ├─ app container   :30xxx → cổng app   │
│  ├─ Main: Node.js                                         │ SSH  │  ├─ postgres (chỉ khi app cần)          │
│  │   ├─ ssh/manager.ts     (ssh2, pool 1 conn/VPS)        │─────▶│  ├─ collector       (python:3.12-alpine)│
│  │   ├─ detectors/         (mảng object cùng interface)   │      │  │     ghi /opt/opspilot/<app>/metrics/│
│  │   ├─ deploy/pipeline.ts (state machine 7 bước)         │      │  │        metrics.jsonl + latest.json   │
│  │   ├─ migrate/pipeline.ts                               │      │  └─ loadgen (chỉ khi chạy thí nghiệm)   │
│  │   ├─ monitor/poller.ts  (30s: đọc dòng mới, rule, ML)  │      └─────────────────────────────────────────┘
│  │   └─ db/  better-sqlite3 (WAL)                         │
│  │                                                        │        KHÔNG có agent, KHÔNG mở thêm port,
│  └─ spawn ──▶ Python ML service  http://127.0.0.1:8765    │        KHÔNG cài gì ngoài Docker.
│               (FastAPI + scikit-learn)                    │
└───────────────────────────────────────────────────────────┘
```

### Các quyết định chốt

| Quyết định | Vì sao | ADR |
|---|---|---|
| Collector **append** vào `metrics.jsonl` (10s/dòng), poller kéo 30s/lần và nạp **toàn bộ dòng mới** | Không mất mẫu; giảm một nửa số lời gọi SSH so với poll 15s | [ADR-007](14-quyet-dinh-kien-truc.md#adr-007) |
| Không mở port cho metric — đọc file qua `ssh cat`/`tail -c +N` | Giữ NFR-1, không cần firewall rule | ADR-001 |
| ML service do Electron `spawn` lúc khởi động, REST localhost | Không cần IPC phức tạp, dễ test bằng `curl` | ADR-010 |
| Build image **trên VPS** (`docker build` qua SSH), không build local rồi push | Tránh phụ thuộc registry; tránh lệch kiến trúc CPU | ADR-004 |
| Rollback = giữ **3 image cũ** trên VPS theo tag version, `docker compose up` với tag cũ | Rollback trong ~10 giây, không build lại | ADR-004 |
| **Không nginx ở v1.** App expose thẳng `http://<vps-ip>:<host_port>`, port cấp trong dải 30000–30999 | Nginx không phục vụ câu hỏi nghiên cứu; collector probe qua docker network | [ADR-006](14-quyet-dinh-kien-truc.md#adr-006) |
| Credential dùng `safeStorage` của Electron (keychain OS); có sẵn đường lùi sang AES-256-GCM tự viết | Ít code hơn, vẫn thoả NFR-2. Chờ GVHD chốt ở tuần 0 | [ADR-002](14-quyet-dinh-kien-truc.md#adr-002) |

---

## PHẦN 2 — CẤU TRÚC REPO ĐÍCH

```
app/
├─ src/main/
│  ├─ ssh/manager.ts            M1
│  ├─ crypto/credentials.ts     M2
│  ├─ db/index.ts  db/migrations/001_init.sql   (copy từ docs/contracts/schema.sql)
│  ├─ detectors/{types.ts,nextjs.ts,express.ts,static-spa.ts,index.ts}   M3
│  ├─ deploy/pipeline.ts        M4
│  ├─ migrate/pipeline.ts       M9
│  ├─ monitor/{poller.ts,rules.ts,autoRollback.ts}   M6 + M8
│  ├─ mlClient.ts               gọi ML service, quản lý vòng đời tiến trình
│  └─ ipc.ts                    toàn bộ IPC handler, typed theo ipc-contract.ts
├─ src/renderer/pages/          M10 — 7 màn hình
├─ src/shared/                  type dùng chung (nguồn: docs/contracts/*.ts)
├─ scripts/try-*.ts             script CLI test từng module không cần UI
└─ electron-builder.yml
ml-service/
├─ main.py  features.py  config.py
├─ models/{base.py,zscore_ewma.py,iforest.py,ocsvm.py,ensemble.py}
├─ state/<deployment_id>/       (gitignore)
├─ scripts/gen_fake_series.py   sinh chuỗi metric giả để test không cần VPS
└─ requirements.txt
collector/{collect.py,Dockerfile}
templates/{nextjs.Dockerfile,express.Dockerfile,static-spa.Dockerfile,docker-compose.template.yml}
experiments/
├─ faults/{memory_leak.py,cpu_spike.py,error_burst.py,slow_db.py,latency_creep.py}
├─ load_gen/{loadgen.py,Dockerfile}
├─ run_experiment.py  analyze.py  export_results.py
└─ results/run_<scenario>_<n>/*.csv
demo-apps/{next-blog,express-api,vite-spa}
docs/
```

---

## PHẦN 3 — DỮ LIỆU

Schema đầy đủ: **[`contracts/schema.sql`](contracts/schema.sql)** — đó là nguồn sự thật duy nhất.

Tóm tắt quan hệ để nắm nhanh:

```
vps 1──n app 1──n deployment 1──n metric_sample 1──n score_sample
                       │                │
                       │                └──n alert (chỉ khi triggered) ──n label (UC-08)
                       ├──1 monitor_setting
                       └──n migration_job
experiment_run n──1 deployment      action_log (bảng phẳng, mọi hành động)
```

Hai điểm dễ hiểu nhầm:

- **`score_sample` ≠ `alert`.** `score_sample` lưu score thô của **cả 5 phương pháp ở mọi
  mẫu**, kể cả khi không vượt ngưỡng — đây là dữ liệu cho threshold sweep và ablation chạy
  offline. `alert` chỉ ghi khi thực sự triggered (đủ số mẫu liên tiếp) và là thứ người dùng
  gắn nhãn ở UC-08.
- **`ts_vps` là mốc thời gian chuẩn.** `ts_local` chỉ để debug. Mọi phép tính detection
  delay dùng `ts_vps`. Lý do: xem [`07-giao-thuc-thi-nghiem.md`](07-giao-thuc-thi-nghiem.md) mục "Đồng hồ".

---

## PHẦN 4 — SPEC MODULE

Mỗi module có một brief đầy đủ để đưa cho AI trong [`prompts/`](prompts/). Phần dưới đây là
mô tả hành vi cấp cao; **chữ ký hàm và kiểu dữ liệu nằm trong `contracts/`**.

### M1 — SSH Manager · `app/src/main/ssh/manager.ts` · Người A · W1

Dùng `ssh2`. Pool 1 connection/VPS, tự reconnect với backoff (1s, 2s, 4s, tối đa 3 lần).

- `connect(vpsId)` — mở/lấy connection từ pool, throw `SshError` phân loại rõ
  (`AUTH_FAILED` | `TIMEOUT` | `HOST_UNREACHABLE` | `UNKNOWN`).
- `exec(vpsId, cmd, { onStdout?, onStderr?, timeoutMs? })` → `{ code, stdout, stderr }`.
  Stream callback phục vụ log real-time (FR-B6).
- `uploadDir(vpsId, localDir, remoteDir, { exclude })` — **tar qua stdin**, không sftp từng
  file: `tar czf - --exclude=... . | ssh 'tar xzf - -C dir'`. Loại trừ mặc định:
  `node_modules`, `.git`, `dist`, `.next`, `__pycache__`, `.venv`.
- `readFileTail(vpsId, remotePath, fromByte)` → `{ content, nextByte }` — dùng
  `tail -c +<fromByte>`, phục vụ đọc `metrics.jsonl` tăng dần (M6).
- `readFile(vpsId, remotePath)` → `string`.

Ràng buộc: mọi đường dẫn phía VPS ghép bằng `path.posix.join`. Mọi tham số do người dùng
nhập đi vào lệnh shell phải qua hàm `shellQuote()`. Test độc lập: `pnpm try:ssh`.

### M2 — Credential · `app/src/main/crypto/credentials.ts` · Người A · W1

Mặc định `safeStorage.encryptString/decryptString` của Electron, ghi vào
`vps.encrypted_secret` với `crypto_scheme='safe_storage'`.

Đường lùi đã chuẩn bị sẵn (bật nếu GVHD yêu cầu đúng nguyên văn NFR-2): AES-256-GCM,
key dẫn xuất bằng `scrypt(passphrase, salt, N=2^15)`, lưu `iv` + `auth_tag` riêng,
`crypto_scheme='aes_256_gcm'`. Cả hai scheme cùng interface `encrypt/decrypt`, chọn bằng
config → đổi không phải sửa chỗ khác.

Bất biến: hàm `decrypt` phải throw khi ciphertext bị sửa 1 byte (có unit test).

### M3 — Detector engine · `app/src/main/detectors/` · Người A · W2

Interface: [`contracts/detector-contract.ts`](contracts/detector-contract.ts) — **không sửa**.

Đăng ký: `index.ts` export `DETECTORS: Detector[]` đã sort theo `priority` giảm dần.
Engine chạy từ priority cao xuống, lấy detector đầu tiên `detect() === true`.

| Detector | priority | Điều kiện nhận diện |
|---|---|---|
| `nextjs` | 30 | `package.json` có `next` trong `dependencies` |
| `static-spa` | 20 | có `vite` trong `devDependencies` **và không có** `next` |
| `express` | 10 | có `express` trong `dependencies`, không có `next`/`vite` |
| `flask` (Tier 2) | 10 | `requirements.txt`/`pyproject.toml` chứa `flask` |

`requiredEnv` = hằng theo framework + biến parse được từ `.env.example` + suy luận đơn giản
(có `pg`/`prisma`/`postgres` trong dependencies → thêm `DATABASE_URL`, đặt `needsDb=true`).

Không khớp detector nào → trả `DetectionResult` với `matched:false` kèm **danh sách dấu hiệu
đã kiểm tra và kết quả từng dấu hiệu**, để UI hiển thị minh bạch (mục 3.2 của UI spec).

### M4 — Deploy pipeline · `app/src/main/deploy/pipeline.ts` · Người A · W2–W4

State machine tuyến tính 7 bước, mỗi bước phát event theo
[`contracts/deploy-events.md`](contracts/deploy-events.md).

| # | Bước | Việc | Fail thì |
|---|---|---|---|
| 1 | `PRECHECK` | `free -m`, `df -h /`, `ss -tlnp` → RAM trống >512MB, disk trống >2GB, `host_port` chưa dùng (FR-B4) | Dừng, chưa đụng gì vào VPS |
| 2 | `UPLOAD` | `uploadDir` → `/opt/opspilot/<app>/src/` | Dừng, xoá thư mục vừa tạo |
| 3 | `RENDER` | Sinh `Dockerfile` + `docker-compose.yml` + `.env` (chmod 600) từ template | Dừng |
| 4 | `BUILD` | `docker build -t <app>:v<N> .` — stream log ra UI | Dừng, `docker image rm` image dở |
| 5 | `DEPLOY` | `docker compose up -d` (app + collector + postgres nếu cần) | Rollback về v(N-1) nếu có |
| 6 | `HEALTHCHECK` | `curl -fsS http://127.0.0.1:<host_port><healthcheckPath>` 10 lần cách 3s | **Tự rollback về v(N-1)** (UC-03), status `failed` |
| 7 | `RECORD` | Ghi `deployment` + `action_log`; xoá image cũ chỉ giữ 3 bản gần nhất | Log warning, không fail cả deploy |

`host_port`: lần deploy đầu của một app, cấp port trống nhỏ nhất trong 30000–30999 và lưu
vào `app.host_port`; các lần sau dùng lại port cũ.

Bất biến: **không bao giờ xoá volume dữ liệu** trong bất kỳ nhánh lỗi nào.

### M5 — Metric collector · `collector/collect.py` · Người B · W1–W2

Container `python:3.12-alpine`, mount `/var/run/docker.sock` **read-only**, chạy vòng lặp
mỗi `COLLECT_INTERVAL_S` (mặc định **10**):

1. `docker stats --no-stream --format '{{json .}}'` cho container app → `cpu_pct`, `mem_mb`,
   `mem_pct`, `mem_limit_mb`.
2. HTTP probe `GET http://app:<container_port><healthcheck_path>`, timeout 5s → `latency_ms`;
   đếm tỷ lệ mã 5xx trong cửa sổ trượt 60 giây → `http_error_rate`. Probe lỗi/timeout →
   `container_up=0`, `latency_ms=null`.
3. DB probe (nếu có postgres): `SELECT 1` → `db_response_ms`.
4. Host: `/proc/loadavg`, `/proc/meminfo` → `host_cpu_pct`, `host_mem_pct`.

Ghi ra 2 file trong `/opt/opspilot/<app>/metrics/` (bind mount):
- **append** 1 dòng JSON vào `metrics.jsonl` (nguồn dữ liệu chính thức, có `seq` tăng dần)
- ghi đè `latest.json` (chỉ để xem nhanh/debug)

Format chính xác: [`contracts/metric-format.md`](contracts/metric-format.md).
Tự xoay vòng file khi `metrics.jsonl` > 50MB (đổi tên `.1`, tạo file mới, `seq` **không** reset).

### M6 — Poller + Rule engine · `app/src/main/monitor/` · Người B · W3–W4

Mỗi `poll_interval_s` (mặc định **30**) cho từng deployment đang `running`:

1. `readFileTail(metrics.jsonl, app.metrics_offset)` → parse **mọi dòng mới** (thường 3 dòng).
2. Insert `metric_sample` (khoá `UNIQUE(deployment_id, seq)` chống trùng khi retry).
3. Chạy rule engine → 1 dòng `score_sample` method `rule` (score = 1 nếu vi phạm, 0 nếu không).
4. `POST /ingest` cho ML service từng mẫu theo đúng thứ tự `seq` → 4 dòng `score_sample`
   (`zscore_ewma`, `iforest`, `ocsvm`, `ensemble`).
5. Phương pháp nào vượt ngưỡng đủ số mẫu liên tiếp → tạo `alert` (một alert cho một chuỗi
   liên tục, không tạo alert mới mỗi mẫu; đóng alert khi score xuống dưới ngưỡng 3 mẫu liền).
6. Đẩy sang renderer qua IPC để dashboard vẽ.

**Rule engine** (FR-D3), ngưỡng lấy từ `monitor_setting`, mặc định: `cpu_pct>90` **hoặc**
`mem_pct>90` **hoặc** `latency_ms>2000` **hoặc** `http_error_rate>0.5` **hoặc**
`container_up=0`, duy trì **3 mẫu liên tiếp**.

VPS mất kết nối → poller không tạo mẫu giả, ghi `action_log` và thử lại; khi kết nối lại,
`tail -c +offset` tự nạp bù toàn bộ khoảng thiếu.

### M7 — ML service · `ml-service/` · Người B · W1–W3

API: [`contracts/ml-api.openapi.yaml`](contracts/ml-api.openapi.yaml) — 6 endpoint, không thêm bớt.

**Feature (`features.py`)** — cửa sổ trượt **20 mẫu**, **5 metric** (`cpu_pct`, `mem_mb`,
`latency_ms`, `http_error_rate`, `db_response_ms`), mỗi metric **4 đặc trưng**:
`[giá trị hiện tại, mean cửa sổ, std cửa sổ, slope]` → **vector 20 chiều**.
`slope` = hệ số góc hồi quy tuyến tính trên cửa sổ, đơn vị *đơn vị metric / phút*.
**Slope là chìa khoá bắt suy giảm dần (memory leak)** — có ablation study chứng minh bằng số
liệu ở chương 5. Giá trị `null` (probe lỗi) → điền bằng giá trị hợp lệ gần nhất, đánh dấu
trong `detail_json`.

**4 phương pháp:**

| Method | Thuật toán | Ghi chú |
|---|---|---|
| `zscore_ewma` | EWMA α=0.3 cho từng metric, z-score so baseline | score = sigmoid(max z / 3), không cần train nặng |
| `iforest` | `IsolationForest(n_estimators=100, random_state=42)` | score = `-decision_function` chuẩn hoá min-max theo tập train |
| `ocsvm` | `OneClassSVM(kernel='rbf', nu=0.05, gamma='scale')` | **bắt buộc `StandardScaler` trước**; scaler fit trên tập train |
| `ensemble` | Vote trên 3 method trên | `score` = trung vị 3 score; `above_threshold` khi **≥2/3** method vượt ngưỡng |

**Train:** cần **≥150 mẫu** (khuyến nghị 180 = 30 phút baseline). Chưa đủ → `/ingest` trả
`ready:false` và score `null`, poller ghi `score_sample` với score `null` (không coi là 0).
`random_state=42` cố định ở mọi nơi để kết quả tái lập được.

**Ngưỡng:** `score > 0.7` trong **≥2 mẫu liên tiếp**. Nằm trong `monitor_setting`, chốt cứng
sau pilot tuần 8.

**State:** model + scaler pickle vào `ml-service/state/<deployment_id>/`, kèm `meta.json`
(số mẫu train, thời điểm, version feature). Restart service không mất.

**`POST /replay`** — nhận mảng samples + `feature_config` (`use_slope`, `window`), chạy
inference thuần **không side-effect**, trả score từng mẫu. Đây là công cụ cho ablation study
và threshold sweep chạy hoàn toàn offline (~40 dòng code, giá trị rất cao).

### M8 — Auto-rollback · `app/src/main/monitor/autoRollback.ts` · Người A · W5

Cấu hình trong `monitor_setting`: `auto_rollback`, `trusted_method`, `rollback_consecutive`
(mặc định 3), `cooldown_minutes` (mặc định 10).

Poller thấy `trusted_method` triggered đủ N mẫu liên tiếp → gọi rollback của M4 về
v(N-1) → ghi `alert.acted='rollback_auto'` + `action_log` + thông báo trên UI.
Trong thời gian cooldown không rollback lần nữa dù có alert. Mặc định
`auto_rollback = false` — người dùng phải chủ động bật (an toàn khi demo).

### M9 — Migrate pipeline · `app/src/main/migrate/pipeline.ts` · Người A · W6–W7

Chỉ áp dụng cho app do tool này deploy (biết trước cấu trúc thư mục/volume).

1. `PREPARE` — precheck VPS đích (như M4 bước 1) + kiểm tra phiên bản Docker.
2. `FREEZE` — `docker compose stop app` trên nguồn (postgres vẫn chạy để dump). **Bắt đầu
   đếm downtime.**
3. `BACKUP` — `pg_dump -Fc` (nếu có DB) + `tar` volume persistent + thư mục app + `.env`;
   tính `sha256sum` từng file.
4. `TRANSFER` — stream trực tiếp qua máy người dùng:
   `ssh nguồn 'cat f' | ssh đích 'cat > f'` — không yêu cầu 2 VPS thấy nhau.
5. `RESTORE` — chạy RENDER→BUILD→DEPLOY của M4 trên đích, restore dump, mount lại volume.
6. `VERIFY` (FR-C4) — đối chiếu: `sha256` từng file 2 phía · `SELECT count(*)` từng bảng ·
   healthcheck app đích. Kết quả lưu `migration_job.verify_json`, UI hiện bảng 2 cột.
7. `AWAITING_CONFIRM` — **người dùng bấm xác nhận** mới stop hẳn nguồn; có tuỳ chọn
   "giữ nguồn" / "dọn nguồn". **Dừng đếm downtime** khi app đích healthcheck OK.

Lỗi ở bất kỳ bước nào → dọn sạch bên đích, `docker compose start app` bên nguồn, ghi
`status='rolled_back'` (FR-C5). Nguồn **không bao giờ** bị xoá trước khi người dùng xác nhận.

> **Ghi chú rà soát 28/07/2026 — chưa sửa hành vi gốc:** câu trên đang mâu thuẫn với trường
> hợp `VERIFY` fail trong [`contracts/deploy-events.md`](contracts/deploy-events.md), nơi dữ
> liệu đích được giữ lại để điều tra. Đề xuất chi tiết được đặt cạnh contract; phải chốt một
> hành vi duy nhất trước khi code M9.

### M10 — UI · `app/src/renderer/` · Người A · rải W1–W10

7 màn hình, spec chi tiết: [`02-ui-ux-spec.md`](02-ui-ux-spec.md).
Ưu tiên đầu tư: **Dashboard và Deploy Log chiếm 90% công sức UI** (2 màn xuất hiện lúc
bảo vệ), phần còn lại dùng component AntD mặc định.

---

## PHẦN 5 — THÍ NGHIỆM

Toàn bộ nằm ở [`07-giao-thuc-thi-nghiem.md`](07-giao-thuc-thi-nghiem.md) — 5 kịch bản
fault, định nghĩa ground truth, quy trình 1 run, 3 phân tích offline (PR curve, ablation
slope, timeline chart), quy tắc bảo vệ dữ liệu.

## PHẦN 6 — TIMELINE

[`04-timeline.md`](04-timeline.md) — 16 tuần theo ngày thật, 3 cổng kiểm soát, thứ tự cắt phạm vi.

## PHẦN 7 — VPS & CHI PHÍ

- **2 VPS, cùng provider / cùng gói / cùng region**: 2 vCPU · 4 GB RAM · 40 GB SSD,
  Ubuntu 24.04 LTS. Build Next.js cần ≥2 GB RAM.
- Gợi ý: Hetzner CX22 (~€4/tháng), Vultr, DigitalOcean (~6–12 USD/tháng).
  **Tổng ~40–70 USD cho 4 tháng.**
- Snapshot cả 2 VPS ngay sau khi setup sạch; quy trình dựng lại:
  [`08-vps-setup.md`](08-vps-setup.md).
- Vì sao cùng provider: chạy 50 run song song trên 2 cấu hình khác nhau sẽ tạo confound
  trong dữ liệu thí nghiệm.

## PHẦN 8 — DANH SÁCH KHÔNG LÀM (chốt)

- Không cAdvisor / Prometheus / Grafana / Kubernetes / CI-CD cho chính tool.
- Không nginx ở v1, không HTTPS/domain tự động (Let's Encrypt) → "hướng phát triển".
- Không hỗ trợ Windows VPS, không multi-user, không cloud sync, không auto-update.
- Không deep learning (LSTM/autoencoder) → "hướng phát triển", lý do: dữ liệu quá ít.
- Không migrate app không do tool deploy. Không zero-downtime/blue-green.
- Không theme sáng, không i18n runtime, không tuỳ biến dashboard.
- Không tự viết AES nếu `safeStorage` được GVHD chấp nhận.

## PHẦN 9 — DÙNG AI

Xem [`prompts/README.md`](prompts/README.md). Nguyên tắc rút gọn:

1. Mỗi phiên: dán [`prompts/00-context-chung.md`](prompts/00-context-chung.md) + đúng
   **một** file `prompts/mXX-*.md`. Không dán cả repo.
2. AI code theo **đúng** interface trong `contracts/`. Không cho AI "cải tiến" interface.
3. Thứ tự mỗi module: (a) code + test độc lập bằng script CLI, (b) chạy thật với VPS,
   (c) mới nối vào UI. Debug SSH qua UI rất chậm.
4. Không hiểu code AI viết → **không merge**. Mỗi tuần mỗi người giải thích lại 1 đoạn cho
   người kia (chính là luyện trả lời hội đồng).
5. Mọi thay đổi so với kế hoạch → 1 dòng trong [`../DECISIONS.md`](../DECISIONS.md).
