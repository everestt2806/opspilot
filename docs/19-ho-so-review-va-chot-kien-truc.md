# OPSPILOT — HỒ SƠ TÓM TẮT VÀ CHỐT KIẾN TRÚC ĐỂ REVIEW

| Thuộc tính | Giá trị |
|---|---|
| Tài liệu | Bản tóm tắt một file dành cho engineer và giảng viên |
| Phiên bản | `RC-1` — Review Candidate 1 |
| Ngày lập | 11/08/2026 |
| Trạng thái | **Chờ review ngoài nhóm trước khi khóa contract** |
| Nhóm | 2 người: A — Core/Algorithms; B — UI/Delivery (hiệu lực từ 12/08/2026) |
| Thời gian | 10/08/2026–20/11/2026 |
| Repo | <https://github.com/everestt2806/opspilot> |

> **Lưu ý:** bảy quyết định ở mục 9 là phương án nhóm đề xuất chốt. Chúng chưa thay thế
> `docs/contracts/`. Sau khi A, B và reviewer thống nhất, nhóm sẽ cập nhật contract và
> `DECISIONS.md` trong một PR riêng rồi mới cho hai phía code theo.

## 0. Cách review nhanh

- **Engineer:** ưu tiên mục 4–9 và 12; kiểm tra boundary, state machine, security, failure mode.
- **Giảng viên:** ưu tiên mục 1–3, 7–11 và 13; kiểm tra phạm vi, tính nghiên cứu, cách đánh giá
  và khả năng hoàn thành.
- Nếu chỉ có 10 phút: đọc mục 1, sơ đồ mục 4, bảng mục 9 và phiếu review mục 13.

Mục tiêu không phải kiến trúc hoàn hảo, mà là kiến trúc **đủ đúng, đủ an toàn, hai người có thể
hoàn thành và tạo được dữ liệu thí nghiệm đáng tin cậy**.

---

## 1. Đề tài dự án

### Tên đề tài chính thức

**Ứng dụng desktop hỗ trợ deploy và migrate ứng dụng Web đa nền tảng trên VPS, tích hợp
module phát hiện suy giảm vận hành (degraded state) bằng Machine Learning.**

Tên sản phẩm: **OpsPilot**.

### Bài toán

Người dùng có source code web app và một hoặc hai VPS Linux. Việc kiểm tra môi trường, tạo
Dockerfile/Compose, deploy, theo dõi lỗi, rollback và migrate hiện phải làm bằng nhiều lệnh thủ
công. Sau deploy, suy giảm thường xuất hiện từ từ qua CPU, RAM, latency, tỷ lệ HTTP 5xx hoặc
database response time; healthcheck nhị phân có thể phát hiện quá muộn.

OpsPilot cung cấp một desktop app để:

1. Quản lý VPS và credential cục bộ.
2. Phân tích source code, deploy/redeploy/rollback web app qua SSH.
3. Thu thập metric từ container trên VPS mà không cài host agent.
4. Chạy rule và các phương pháp ML song song để phát hiện degraded state.
5. Migrate app do chính OpsPilot deploy sang VPS khác.
6. Đo và so sánh các phương pháp bằng thí nghiệm fault injection có lặp lại.

### Câu hỏi kỹ thuật/nghiên cứu chính

> Với cùng một đường dữ liệu và cùng ground truth, rule-based, Z-score/EWMA, Isolation Forest,
> One-Class SVM và ensemble khác nhau thế nào về Precision, Recall, F1 và detection delay trong
> các kịch bản suy giảm có kiểm soát?

Đóng góp chính nằm ở **đường ống dữ liệu đúng, giao thức thí nghiệm có thể tái lập và phân tích
so sánh trung thực**, không nằm ở số lượng màn hình hay độ phức tạp hạ tầng.

### Trạng thái thực tế tại ngày 11/08/2026

- M00 scaffold Electron/React/TypeScript, ML service skeleton và cấu trúc repo đã merge vào `main`.
- Bộ contract, kế hoạch, timeline, test strategy và protocol thí nghiệm đã có bản nháp chi tiết.
- Trello/GitHub workflow cho hai người đã được dựng; task W1 đã phân owner và deadline.
- Các feature module M1–M12 chưa được xem là hoàn thành nếu chưa có PR, test và smoke evidence.
- D1–D7 trong tài liệu này đang chờ review; code phụ thuộc chúng không nên đi sâu trước khi khóa.

---

## 2. Mục tiêu và tiêu chí thành công

| Nhóm mục tiêu | Tiêu chí kiểm chứng |
|---|---|
| Quản lý VPS | CRUD VPS; SSH/Docker/resource check; credential không lưu bản rõ |
| Deploy đa framework | Next.js, Express API và Vite SPA deploy được; log real-time |
| Rollback | Healthcheck fail tự về release trước; rollback thủ công đúng version |
| Monitoring | Metric thật vào SQLite/dashboard; mất SSH rồi nạp bù không trùng/mất dòng |
| Phát hiện degraded state | Rule + 3 model + ensemble có score trên cùng sample/ground truth |
| Migrate | App do tool deploy chuyển VPS; đo downtime và verify toàn vẹn |
| Thí nghiệm | 5 scenario × 10 lần; P/R/F1, CI 95%, detection delay, số run bị huỷ |
| Sản phẩm | Electron chạy trên Windows; demo thật có fallback local/video |

Đề tài có **24 functional requirement**. Mục tiêu đến 06/09/2026 là kiểm chứng **16/24
(66,7%)** trên luồng thật; đây là MVP lõi, không phải 66,7% tổng giờ công.

---

## 3. Phạm vi

### Bắt buộc

- Desktop một người dùng trên Windows.
- Hai VPS Ubuntu 24.04 cùng provider/gói/region cho thí nghiệm.
- Ba stack Tier 1: Next.js, Node/Express, static SPA qua Vite.
- SSH-only; Docker build và chạy trên VPS.
- SQLite cục bộ cho dữ liệu của OpsPilot.
- Collector Python nhỏ chạy trong container, ghi JSONL append-only.
- Rule, Z-score/EWMA, Isolation Forest, One-Class SVM và ensemble.
- Deploy, redeploy, rollback, migrate app do tool quản lý.
- Fault injection, load generator, kết quả định lượng và khả năng tái lập.

### Không làm trong v1

- Multi-user, authentication, cloud sync, auto-update.
- Kubernetes, Prometheus, Grafana, cAdvisor, Redis hoặc message queue.
- Host agent chạy thường trực ngoài Docker.
- Nginx/HTTPS/domain tự động.
- Migrate ứng dụng không do OpsPilot deploy; zero-downtime/blue-green.
- Deep learning.
- Tier 2 Flask/Django nếu các cổng MVP/dữ liệu chưa xanh.
- UI polish vượt hai màn hình demo chính.

---

## 4. Kiến trúc tổng thể

```text
MÁY NGƯỜI DÙNG — WINDOWS
┌────────────────────────────────────────────────────────────────────┐
│ Electron Desktop App                                               │
│ ┌────────────────────┐     typed IPC      ┌─────────────────────┐ │
│ │ Renderer           │ ◀────────────────▶ │ Main process        │ │
│ │ React + Ant Design │                     │ SSH · DB · pipeline │ │
│ └────────────────────┘                     │ detector · poller   │ │
│                                            └───┬──────────┬──────┘ │
│                                                │          │        │
│                                      SQLite WAL│          │REST    │
│                                                ▼          ▼        │
│                                           opspilot.db  ML service   │
│                                                        FastAPI      │
│                                                        sklearn     │
└───────────────────────────────────────────────┬────────────────────┘
                                                │ SSH only
                                                ▼
VPS — UBUNTU 24.04
┌────────────────────────────────────────────────────────────────────┐
│ Docker                                                             │
│ ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│ │ app container│  │ DB container │  │ collector container       │ │
│ │ :30000–30999 │  │ nếu cần      │  │ docker stats + HTTP probe │ │
│ └──────────────┘  └──────────────┘  └─────────────┬─────────────┘ │
│                                                   │ append           │
│ /opt/opspilot/<app>/metrics/metrics.jsonl ◀──────┘                  │
│ experiments: thêm load generator/fault container khi chạy run      │
└────────────────────────────────────────────────────────────────────┘
```

### Boundary bắt buộc

- Renderer không gọi SSH, SQLite hoặc đọc credential trực tiếp; mọi việc qua typed IPC.
- ML service chỉ bind `127.0.0.1:8765`.
- Mọi thao tác VPS đi qua SSH; không mở cổng quản trị mới.
- Collector chỉ ghi file metric; Electron poll qua SSH mỗi 30 giây.
- Dữ liệu qua IPC/REST/JSON phải validate ở boundary.
- Secret không vào log, Trello, Git hoặc CSV thí nghiệm.

Hệ thống có hai **thành phần ứng dụng chính**: Electron app và Python ML service. Không mô tả
là “đúng hai OS process” vì Electron có main và renderer process.

---

## 5. Công nghệ và phân công

| Phần | Công nghệ | Owner |
|---|---|---|
| Desktop UI | Electron 33, React, TypeScript strict, Ant Design v5, Vite | A |
| Main process | Node.js, `ssh2`, `better-sqlite3`, `zod` | A |
| Deploy/migrate | SSH exec, Dockerfile/Compose template, state machine | A |
| Collector | Python 3.12 Alpine, Docker stats, HTTP probe, JSONL | B |
| ML service | FastAPI, NumPy, scikit-learn | B |
| Poller/rule/dashboard data | SSH tail, SQLite, score/alert lifecycle | B |
| Thí nghiệm | Python runner, load generator, fault injection, analysis | B, A hỗ trợ VPS |
| Contract chung | Schema, IPC, ML API, metric format, pipeline event | Cả hai duyệt |

Ranh giới file và quy trình handoff: [`03-quy-trinh-team.md`](03-quy-trinh-team.md).

---

## 6. Bốn luồng hệ thống chính

### 6.1 Deploy/redeploy

```text
Detect → PRECHECK → UPLOAD → RENDER → BUILD trên VPS
→ DEPLOY → HEALTHCHECK → RECORD + retention
```

- Precheck: Docker tồn tại, RAM trống >512 MB, disk >2 GB, port chưa dùng.
- Healthcheck thất bại thì rollback về release trước nếu có.
- Không bao giờ xoá volume/data trong nhánh lỗi deploy.

### 6.2 Metric → score → alert

```text
collector 10s/sample → metrics.jsonl append-only
→ Electron SSH tail mỗi 30s → metric_sample SQLite
→ rule + POST /ingest ML → 5 score_sample/sample
→ threshold/consecutive → alert → optional auto-rollback
```

- `seq` liên tục và `UNIQUE(deployment_id, seq)` chống insert trùng.
- Mất SSH không tạo sample giả; reconnect rồi nạp bù từ byte offset.
- `null` nghĩa là không đo được, không thay bằng `0` hoặc `-1`.

### 6.3 Migrate

```text
PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE
→ VERIFY → AWAITING_CONFIRM → completed
```

- Chỉ migrate app do OpsPilot deploy.
- Nguồn luôn có thể khởi động lại trước khi người dùng xác nhận.
- Đo downtime/bytes; verify checksum, table count và health.
- Không xoá dữ liệu nguồn trước xác nhận.

### 6.4 Thí nghiệm

```text
deploy sạch → baseline/train → holdout → bật fault
→ tắt fault/hồi phục → integrity check → export → phân tích offline
```

Mỗi run độc lập; run lỗi giữ trạng thái `aborted`, lý do và retry tối đa hai lần.

---

## 7. Dữ liệu, ML và phương pháp đánh giá

| Metric | Đơn vị/miền | Nguồn |
|---|---|---|
| `cpu_pct` | 0–100+, % | Docker stats |
| `mem_mb` | MB | Docker stats |
| `latency_ms` | ms | HTTP probe |
| `http_error_rate` | 0–1 | Cửa sổ 60 giây |
| `db_response_ms` | ms | `SELECT 1`, `null` nếu không DB |

Feature vector dùng cửa sổ 20 mẫu. Mỗi metric có giá trị hiện tại, mean, std và slope, tổng
**5 × 4 = 20 chiều**. Baseline khuyến nghị 180 mẫu/30 phút, tối thiểu 150.

Phương pháp chạy song song: rule-based, Z-score/EWMA, Isolation Forest, One-Class SVM sau
`StandardScaler`, ensemble 2/3 model. Ngưỡng mặc định ML là score >0,7 trong hai mẫu liên tiếp.
Auto-rollback mặc định tắt; khi bật, trusted method trigger ba lần liên tiếp, cooldown 10 phút.

### Protocol

- 5 scenario: `memory_leak`, `cpu_spike`, `error_burst`, `slow_db`, `latency_creep`.
- 10 lần/scenario = 50 run; load cố định 5 request/giây trên VPS.
- Một run khoảng 78–83 phút: baseline 30', holdout 15', fault 20', hồi phục 10' + setup.
- Timestamp phân tích dùng đồng hồ VPS; lệch >2 giây thì huỷ run.
- P/R/F1 tính theo từng run rồi báo mean, std, CI 95%; không coi sample cùng run là độc lập.
- Threshold/feature khóa sau pilot W8, không chỉnh sau khi nhìn dữ liệu chính thức.
- ML không thắng rule vẫn là kết quả hợp lệ nếu protocol và phân tích đúng.

---

## 8. Bất biến an toàn

1. Không commit `.db`, `.env`, password, token hoặc private key.
2. Không log credential; renderer không nhận secret đã giải mã.
3. Không chạy lệnh phá huỷ rộng như `docker system prune -a`.
4. Không xoá volume/data trong rollback deploy.
5. Migrate không xoá nguồn trước xác nhận.
6. Contract thay đổi qua PR chung và hai người duyệt.
7. Input vào shell phải quote; lệnh có timeout và `AbortSignal`.
8. Host key thay đổi phải chặn SSH, không tự chấp nhận/retry.
9. CSV kết quả backup sau mỗi run; SQLite sống không đưa lên Git.

---

## 9. Bảy quyết định đề xuất chốt

### D1 — Tạo `deployment` trước khi pipeline chạy

**Chọn:** `deploy:start` tạo `app/deployment` và cấp version trong transaction trước `PRECHECK`;
`RECORD` chỉ hoàn tất bản ghi, cập nhật current deployment và cleanup.

**Ưu điểm:** có ID cho event/log từ đầu; lưu cả lần fail; đo duration; tránh hai deploy nhận
cùng version.

**Không chọn:** insert ở `RECORD`, vì lần fail biến mất, log không có ID và mâu thuẫn IPC
`deploy:start → deployment_id`.

**Đánh đổi:** version có thể khuyết do attempt fail; đây là lịch sử trung thực.

### D2 — Rollback bằng release bundle theo version

**Chọn:** giữ ba `releases/vN/` gồm Compose, `.env` chmod 600, metadata và image tag; volume/data
dùng chung không version hóa.

**Ưu điểm:** rollback đồng bộ image + manifest + env + healthcheck, tái hiện được release cũ.

**Không chọn:** chỉ giữ image tag vì image cũ có thể chạy với compose/env mới và vẫn lỗi.

**Đánh đổi:** thêm dung lượng và ba bản `.env`; retention chặt, không tải ngược/log.

### D3 — `http_error_rate` từ file thống kê nguyên tử

**Chọn:** load generator ghi tổng request/5xx cửa sổ 60 giây bằng temp file + atomic rename;
collector đọc file. Trong thí nghiệm không fallback âm thầm; ngoài thí nghiệm có thể dùng probe.
Luôn lưu `error_rate_source`.

**Ưu điểm:** khoảng 300 request/phút thay vì sáu probe; đúng traffic fault; không mở port mới.

**Không chọn:** probe-only vì ít quan sát và không phản ánh load; endpoint riêng tăng coupling.

**Đánh đổi:** load generator/collector cần một shared file contract.

### D4 — Fail-closed khi migrate `VERIFY` thất bại

**Chọn:** dừng đích, khởi động nguồn, giữ data/artifact đích, ghi `status='failed'` và
`failed_step='VERIFY'`; chỉ cho Retry Verify hoặc Abort & Cleanup, không Confirm success.

**Ưu điểm:** phục hồi dịch vụ, không phục vụ dữ liệu nghi hỏng, giữ bằng chứng và retry nhanh.

**Không chọn:** `awaiting_confirm` khi verify fail vì dễ xác nhận dữ liệu sai; không tự xóa đích
ngay vì mất bằng chứng và phải transfer lại.

**Đánh đổi:** tạm giữ tài nguyên hai VPS tới khi retry/abort.

### D5 — Lưu riêng từng attempt thí nghiệm

**Chọn:** `attempt_index` 1–3, unique `(scenario, repeat_index, attempt_index)`; export có attempt.
Phân tích chính chỉ lấy `completed` nhưng báo cáo mọi abort.

**Ưu điểm:** không mất lịch sử, chứng minh không cherry-pick, đo reliability của runner.

**Không chọn:** ghi đè/xóa attempt vì mất audit trail và không biết thành công ở lần nào.

**Đánh đổi:** thêm một cột và logic lọc nhỏ.

### D6 — Xác minh SSH fingerprint bằng TOFU

**Chọn:** lần đầu hiển thị SHA-256 fingerprint, người dùng xác nhận và lưu; mismatch về sau bị
chặn bằng `SSH_HOST_KEY_CHANGED`. Đổi fingerprint là thao tác thủ công có cảnh báo.

**Ưu điểm:** phát hiện nhầm host/MITM sau lần đầu, không bắt quản lý `known_hosts`, dễ test.

**Không chọn:** chấp nhận mọi host key vì khi đó không xác minh máy nhận credential.

**Đánh đổi:** lần đầu cần đối chiếu qua provider/console để chống MITM tuyệt đối.

### D7 — AES-256-GCM với master key được `safeStorage` bảo vệ

**Chọn:** sinh master key 32 byte, bảo vệ bằng Electron `safeStorage` trong `userData`; mỗi
credential mã hóa bằng `node:crypto` AES-256-GCM, IV 12 byte và auth tag 16 byte lưu SQLite.

**Ưu điểm:** khớp NFR-2, key do OS bảo vệ, không cần passphrase, phát hiện tamper, test được bằng
Node, DB copy sang máy khác không giải mã được.

**Không chọn:** direct `safeStorage.encryptString()` vì không khẳng định AES-GCM và test phụ thuộc
Electron; passphrase+scrypt mặc định có UX kém và nguy cơ passphrase yếu/quên.

**Đánh đổi:** quản lý thêm master-key file đã mã hóa; mất Windows profile/key thì nhập lại secret.

### Ma trận ảnh hưởng contract

| Quyết định | Schema | IPC | Pipeline event | Metric | Experiment | ADR/log |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| D1 deployment sớm |  | ✓ | ✓ |  |  | ✓ |
| D2 release bundle |  |  | ✓ |  |  | ✓ |
| D3 error-rate source |  |  |  | ✓ | ✓ | ✓ |
| D4 verify fail | ✓ | ✓ | ✓ |  |  | ✓ |
| D5 attempt index | ✓ |  |  |  | ✓ | ✓ |
| D6 SSH fingerprint | ✓ | ✓ |  |  |  | ✓ |
| D7 AES-GCM + OS key | ✓ |  |  |  |  | ✓ |

---

## 10. Tiến độ và cổng kiểm soát

| Cổng | Hạn | Điều kiện đạt |
|---|---|---|
| G0 — Nền chạy được | 16/08 | App, DB, SSH, ML skeleton trên hai máy; hai VPS dùng được |
| G1 — Lát cắt Express | 23/08 | Detect → deploy Express → collector ghi đúng contract |
| G2 — MVP 66,7% | 06/09 | 16/24 FR có smoke evidence; rollback/dashboard/alert hoạt động |
| G3 — Freeze thí nghiệm | 04/10 | Pilot 10 run; runner tự động; threshold/feature khóa |
| G4 — Dữ liệu chính thức | 11/10 | 50 run hoặc phạm vi cắt có lý do; CSV backup |
| Nộp | 20/11 | App, báo cáo, slide, video và demo fallback sẵn sàng |

Giả định G2: mỗi người 28–32 giờ tập trung/tuần, review PR trong 24 giờ. Dưới 20 giờ/tuần thì
giảm mục tiêu xuống 50–55% thay vì bỏ test.

Thứ tự cắt: Tier 2 → `slow_db/latency_creep` → migrate PostgreSQL → đóng gói Python hoàn toàn
→ UI nâng cao. Không cắt deploy end-to-end, metric pipeline đúng, ba model + rule + ensemble,
lặp của scenario được giữ và auto-rollback mức demo an toàn.

---

## 11. Rủi ro lớn

| Rủi ro | Tác động | Biện pháp |
|---|---|---|
| Metric pipeline trễ | ML không có dữ liệu thật | Dữ liệu giả W1; G2 buộc dừng UI để tích hợp |
| SSH chập chờn | Hỏng run 80 phút | Append + offset; attempt riêng; retry cuối hàng đợi |
| Đồng hồ lệch | Sai detection delay | NTP; đo offset; lệch >2s thì abort |
| ML không hơn rule | Kết quả kém hấp dẫn | Kết quả hợp lệ; phân tích theo scenario/trade-off |
| Credential/host giả | Mất VPS/secret | AES-GCM, OS key, TOFU, log masking |
| Migrate sai dữ liệu | Data loss/downtime | Verify fail-closed, giữ nguồn |
| Một thành viên bận | Trễ tích hợp | Boundary, contract, review chéo, W12 buffer |
| Không hiểu code AI | Không bảo vệ được | Không hiểu không merge; brief; giải thích chéo |

---

## 12. Tính khả thi và điểm cần phản biện

### Thuận lợi

- Hai VPS, một desktop user, không cloud control plane.
- SSH/file/SQLite giảm dependency vận hành.
- A/B có boundary rõ và giao nhau qua contract.
- ML cổ điển phù hợp lượng dữ liệu, không cần GPU.
- Làm Express end-to-end trước khi nhân framework.
- Có cổng cắt phạm vi và buffer.

### Đề nghị reviewer phản biện mạnh

1. Release bundle ba version đã đủ để rollback tin cậy chưa?
2. File thống kê load generator có sai/coupling cửa sổ 60 giây không?
3. AES-GCM + `safeStorage` bảo vệ master key có đúng kỳ vọng NFR-2 không?
4. TOFU đủ cho phạm vi hay phải nhập fingerprint từ provider ngay lần đầu?
5. Migrate có DB có quá rộng; nên mặc định cắt sớm hay giữ tới G2?
6. 180 baseline sample cho vector 20 chiều có đủ để pilot ba model không?
7. Cách tính CI theo run và ground truth có bias đáng kể nào?
8. Với D1, version bị khuyết do attempt fail sớm có gây khó audit/debug hoặc hiển thị lịch sử
   không; có cần tách `attempt_id` khỏi release version liên tục?
9. Với D5, giữ toàn bộ attempt kể cả `aborted` có làm phình dữ liệu hoặc vô tình gây nhiễu
   phân tích không; cơ chế lọc chỉ lấy `completed` đã đủ an toàn chưa?

---

## 13. Phiếu review

### Kết luận chung

- [ ] Có thể triển khai theo kiến trúc này.
- [ ] Có thể triển khai sau khi sửa các điều kiện bắt buộc.
- [ ] Cần thiết kế lại một phần trước khi code tiếp.
- [ ] Phạm vi không khả thi với hai người/thời gian hiện tại.

### Duyệt từng quyết định

| ID | Quyết định | Đồng ý | Có điều kiện | Không đồng ý |
|---|---|:---:|:---:|:---:|
| D1 | Tạo deployment trước pipeline | [ ] | [ ] | [ ] |
| D2 | Release bundle theo version | [ ] | [ ] | [ ] |
| D3 | Error rate từ atomic stats file | [ ] | [ ] | [ ] |
| D4 | Verify fail-closed, giữ đích | [ ] | [ ] | [ ] |
| D5 | Attempt index 1–3 | [ ] | [ ] | [ ] |
| D6 | SSH fingerprint TOFU | [ ] | [ ] | [ ] |
| D7 | AES-GCM + OS-protected key | [ ] | [ ] | [ ] |

### Mẫu feedback

```text
Reviewer:
Vai trò/kinh nghiệm liên quan:
Ngày review:

Kết luận chung:

Điều bắt buộc sửa trước khi code:
1.

Điều nên sửa nhưng có thể hoãn:
1.

Decision không đồng ý và phương án thay thế:
1.

Rủi ro nhóm đang đánh giá thấp:
1.

Câu hỏi cần nhóm trả lời thêm:
1.
```

Có thể comment trực tiếp trên PR/file; đề nghị ghi ID `D1`…`D7` để nhóm tổng hợp đúng.

---

## 14. Việc nhóm làm sau review

1. A/B tách feedback “bắt buộc” và “có thể hoãn”.
2. Chốt D1–D7 và ghi lý do vào `DECISIONS.md`.
3. Cập nhật đồng bộ contract theo ma trận mục 9.
4. Cập nhật ADR, brief module và risk register.
5. Hai người review PR contract; chỉ merge khi đều giải thích được.
6. Rebase branch code lên contract mới rồi mới tiếp tục.

Nếu reviewer chưa đồng ý, code chỉ tiếp tục ở vùng không phụ thuộc quyết định đang mở.

---

## 15. Tài liệu nguồn

| Nội dung | File |
|---|---|
| Đề tài đã nộp, không sửa | [`00-de-tai-goc.md`](00-de-tai-goc.md) |
| Kế hoạch kỹ thuật/module | [`01-ke-hoach.md`](01-ke-hoach.md) |
| Timeline/cổng kiểm soát | [`04-timeline.md`](04-timeline.md) |
| Truy vết 24 FR, 8 NFR | [`05-truy-vet-yeu-cau.md`](05-truy-vet-yeu-cau.md) |
| Protocol thí nghiệm | [`07-giao-thuc-thi-nghiem.md`](07-giao-thuc-thi-nghiem.md) |
| ADR hiện tại | [`14-quyet-dinh-kien-truc.md`](14-quyet-dinh-kien-truc.md) |
| Phân tích điểm còn mở | [`17-luu-y-kien-truc-va-kha-thi.md`](17-luu-y-kien-truc-va-kha-thi.md) |
| Schema/API/IPC/event/metric | [`contracts/`](contracts/) |
| Nhật ký quyết định | [`../DECISIONS.md`](../DECISIONS.md) |
| Sổ rủi ro | [`13-so-rui-ro.md`](13-so-rui-ro.md) |

Tài liệu này dùng để review; khi triển khai, contract trong `docs/contracts/` vẫn là nguồn sự
thật sau khi PR chốt quyết định được merge.
