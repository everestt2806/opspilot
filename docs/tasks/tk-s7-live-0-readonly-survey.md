# TK-S7 LIVE-0 — khảo sát chỉ đọc HTTPS và pilot ML

## Phạm vi và sổ yêu cầu

| Yêu cầu | Trạng thái | Bằng chứng |
|---|---|---|
| Dùng profile/credential hiện có và SSH pin đã xác minh | PASS | Profile R1-live clone, Electron unlock và SshManager handshake khớp pin DB |
| OS, CPU/RAM, disk, giờ, Docker/Compose, app/container và resource | PASS | Một mẫu SSH read-only, mục VPS bên dưới |
| Listener/UFW/Caddy, hostname/DNS; tách firewall OS/provider/external | BLOCKED/PASS | Listener rỗng; UFW/owner unknown; không hostname; provider evidence vắng |
| Protocol/runner/local ML/dependencies/storage/transport/provenance | PARTIAL | Code/metadata đọc; pilot runner transport blocked; lineage model state chưa rõ |
| Kế hoạch HTTPS staging→production và pilot 75 phút | PASS | Kế hoạch bên dưới; không thực thi |
| Ghi riêng uncertain recovery và cloud firewall gaps | PASS | Mục Gaps bên dưới; không sửa runtime |
| Không deploy/ghi VPS, sửa DNS/firewall, start service, fault/loadgen/train | PASS | Chỉ các lệnh đọc cố định, SSH discovery, preflight và TCP connect 80/443 |
| Note/board, diff check và commit local; giữ nguyên untracked | OPEN | Diff check/commit chưa hoàn tất |

## START — 2026-10-20

- Branch `feat/deploy-reachability`, HEAD đầu phiên `d2cbe9d`; P1f-3 giữ CHỜ REVIEW.
- R1-live ghi nhận profile candidate cô lập `%TEMP%\opspilot-r1live-closeout-20261014d`; bằng chứng đó là lịch sử, không thay thế kiểm tra phiên này.
- Không lưu credential, private key, fingerprint đầy đủ, raw SSH output hay nội dung dữ liệu app.

## UPDATE — 2026-10-20, khảo sát read-only

### Profile, credential và SSH

- Mở bản sao R1-live `opspilot-r1live-closeout-20261014d` bằng SQLite readonly + `query_only`; SQLite backup API tạo bản sao mới `%TEMP%\opspilot-live0-20261020`, có WAL nhất quán. Chỉ copy `credential-master-key.protected`, `Local State`, `Preferences`. Electron đặt `userData` vào bản sao trước `whenReady`, AppUserModelID `vn.opspilot.desktop`, tên `OpsPilot`.
- VPS record ID 1 khớp host/SSH port task chỉ định, chưa archive và có pin SHA256 lưu. `createCredentialCipher`/`loadSecret`: **PASS**; secret chỉ ở RAM. `SshManager.getHostIdentity`: **PASS**, handshake khớp pin DB. Không xuất fingerprint đầy đủ hoặc credential.
- Không gọi delete/create; profile nguồn mở readonly. Runner source đã gỡ khỏi workspace; profile clone và compiled runner còn trong `%TEMP%` để giữ snapshot kiểm tra, không stage. Không giữ raw SSH output.
- Pilot runner dùng OpenSSH `StrictHostKeyChecking=yes`, auth chỉ `key`, có thể chỉ định `OPSPILOT_KNOWN_HOSTS`. VPS record có auth type `key`; file `opspilot_dev_known_hosts` có entry host, nhưng fingerprint entry **không khớp pin DB trong profile OpsPilot** khi so sánh offline. Pilot SSH transport **BLOCKED**; không kết nối OpenSSH, không học/ghi host key. Cần đối chiếu pin từ nguồn xác minh đã phê duyệt trước khi dùng runner.

### VPS và Docker

| Hạng mục | Kết quả quan sát | Trạng thái |
|---|---|---|
| OS/architecture | Ubuntu 24.04, x86_64 | PASS |
| CPU/load | 2 vCPU; load average 1/5/15 phút 0.00/0.00/0.00 tại mẫu UTC 07:02 | PASS, một mẫu |
| RAM/swap | MemTotal 4,010,040 KiB; MemAvailable 3,130,920 KiB (~2.99 GiB); swap 0 | PASS, một mẫu |
| Disk `/` | 26,307,022,848 bytes tổng; 6,473,596,928 dùng; 18,474,647,552 trống (~18.5 GB; 26% dùng) | PASS, một mẫu |
| Đồng bộ giờ | `NTP=yes`, `NTPSynchronized=yes` | PASS |
| Docker/Compose | Server 29.8.2; Compose 5.6.0 | PASS |
| Container | 9 đang chạy; 9 mẫu `docker stats`; 4 ứng viên app đều running; discovery: 1 verified, 3 legacy | PASS, chỉ đọc |
| Resource/container | CPU 0–0.01%; memory 9.4–85.5 MiB; mức dùng cao nhất 35.43% giới hạn | PASS, một mẫu; không lưu tên/image |

### HTTPS readiness

| Hạng mục | Kết quả | Trạng thái |
|---|---|---|
| Listener TCP 80/443 | Không có listener; P1c preflight trả `ports_free` | PASS tại thời điểm mẫu |
| OpsPilot Caddy | `opspilot-caddy.service` absent; marker thiếu, Caddyfile không tồn tại; executable/package ownership chưa đủ bằng chứng | BLOCKED cho ghi |
| Preflight ghi ingress | `install_assessment=unknown`, `local_assessment=unknown`; cổng trống không đồng nghĩa được cài/ghi | BLOCKED |
| OS firewall/UFW | State và từng family IPv4/IPv6 đều `unknown`; không suy ra inactive/allowed | BLOCKED |
| Provider firewall | Không có bằng chứng độc lập từ provider panel/API trong phiên | NOT_VERIFIED |
| External TCP 80/443 | Từ desktop, cả hai connect hết hạn sau ~2.5 giây. Listener VPS cũng trống nên không phân biệt firewall, routing hay absence of service | BLOCKED/INCONCLUSIVE |
| Hostname/DNS | DB clone có 0 `domain_binding`; chưa có hostname thử nghiệm, DNS query **NOT_RUN** | BLOCKED — cần hostname thuộc quyền quản lý |
| External HTTPS/certificate | Không có hostname; **NOT_RUN** | NOT_RUN |

### Pilot ML readiness và provenance

- Protocol: tiền trạm; baseline 30 phút (180 mẫu mục tiêu, tối thiểu 162); holdout 15 phút; fault 20 phút; recovery 10 phút. Tổng 450 mẫu lý thuyết, tối thiểu 405; không gap >120 giây; đúng 5 score/mẫu. Clock skew `|offset| > 2,000 ms`, thiếu mẫu, SSH/poller/loadgen lỗi hoặc reset fault không đạt phải abort/cleanup. Không chạy pha nào trong LIVE-0.
- RAM khả dụng 3,130,920 KiB và disk trống 18.47 GB vượt precheck protocol 512 MiB/2 GB. Tổng ổ 26.3 GB dưới mốc 40 GB preflight pilot lịch sử; readiness tổng thể **BLOCKED**. Chỉ có một snapshot, không có trend/OOM series.
- Local ML service không chạy: không có listener `127.0.0.1:8765`; không start hoặc gọi API. `.venv` Python 3.12.10; dependencies FastAPI 0.141.1, Uvicorn 0.52.1, NumPy 2.5.1, scikit-learn 1.9.0, SciPy 1.18.0, Pydantic 2.13.4 phù hợp requirements. Model code có trong repo; 9 thư mục state persisted có `feature_version`, `train_sample_count`, `trained_at`, nhưng không run/source/protocol lineage. Không đọc pickle; provenance các state này **chưa đủ bằng chứng**.
- Bốn file trong `ml-service/state/fake` (`metrics.jsonl`, `ingest_body.json`, `train_body.json`, `replay_body.json`) được `gen_fake_series.py` và README mô tả là dữ liệu mô phỏng/offline; các file bị ignore. `experiments/results` chỉ có `.gitkeep`, không có run CSV/result.
- `run_experiment.py` mặc định ML URL `127.0.0.1:8000`, trong khi service/Electron dùng 8765. Runner cần URL tường minh hoặc xử lý gap ở checkpoint code sau. Credential chưa có handoff safeStorage→runner đã kiểm chứng; known_hosts mismatch ở trên. Adapter chỉ rà soát code/package metadata; **không chạy runner, deploy, train, fault hoặc loadgen**.

### Kế hoạch HTTPS staging → production (chưa chạy)

1. Chọn hostname con riêng cho staging và chứng minh quyền DNS; xác minh provider firewall inbound 80/443 và UFW theo IPv4/IPv6. Chạy lại P1c owner/path/port và SSH pin ngay trước mọi thao tác; unknown thì dừng.
2. Hai resolver công khai phải cùng xác nhận toàn bộ A/AAAA/CNAME cuối chuỗi đúng IP VPS. Với hostname staging riêng, backup config, reconcile Caddy qua transaction/lock, dùng ACME staging và external probe với staging trust. Staging không ghi production-active.
3. Giữ container và direct HTTP URL nguyên trạng; thử rollback config/service nếu staging lỗi. Write uncertain thì dừng, không replay trước khi đối chiếu remote.
4. Production là operator window riêng sau staging/rollback rehearsal: xác minh owner, DNS/firewall/generation; dùng ACME production; external probe kiểm tra system trust, chain, hostname, expiry, peer IP và health policy. Chỉ coordinator/CAS cùng binding+generation ghi active; lỗi giữ HTTP và pending/degraded.

### Kế hoạch một pilot 75 phút (chưa chạy)

- Kịch bản đề xuất: `cpu_spike`, trên app pilot riêng có fault endpoints; không dùng bốn app hiện hữu. Chờ disk guard, pin parity/credential handoff, app health và operator window. Không chọn `memory_leak` cho run đầu.
- Tiền điều kiện: SQLite profile cô lập; dedicated app/port/URL do operator xác nhận; clock offset <2 giây; RAM free >512 MiB; disk free >2 GB và guard lịch sử 40 GB được đáp ứng/giải quyết riêng; SSH pin, Docker, HTTP health ổn định. Runner dùng `--scenario cpu_spike`, `--repeat 1`, `--max-attempts 1`, `--pilot`/`--allow-pilot-4500`, ML URL `127.0.0.1:8765` và known_hosts pin đã đối chiếu.
- Lịch: deploy pilot + reset; baseline 30 phút, holdout 15, CPU fault ramp 20, reset/recovery 10; loadgen 5 req/s xuyên A–D. Gate tối thiểu 162/180 ở A, 405/450 tổng, gap <=120 giây, đúng 5 score/sample, app HTTP health còn đạt.
- Output dự kiến: `experiments/results/run_cpu_spike_<repeat>_att<attempt>/` gồm `metric_sample.csv`, `score_sample.csv`, `alert.csv`, `experiment_run.csv`, `meta.json`. Đối chiếu run/status, integrity, sample counts, protocol/feature/git metadata; kiểm tra không xuất credential/env.
- Dừng nếu clock skew >2s, SSH/pin đổi hoặc disconnect, deploy/health fail, RAM/disk qua ngưỡng, container/poller/loadgen chết, thiếu mẫu/gap/score, fault reset/cleanup lỗi. Reset fault, stop loadgen, drain poller, đối chiếu app/deployment pilot; không chạm app hiện hữu. Với side effect uncertain, không retry/replay; xác minh trước bước bù.

### Gaps và thay đổi cần checkpoint sau

- **Backend uncertain recovery:** SharedIngressService giữ `uncertain` và không replay, nhưng chưa có đường verify/recovery đủ chứng minh write đã kết thúc an toàn. Thiết kế status/reconcile recovery riêng trước staging; không sửa trong LIVE-0.
- **Cloud firewall evidence:** chưa có provider evidence inbound 80/443. Cần gate lưu provider/rule/scope/time và fail-closed; không suy từ UFW hay TCP timeout.
- Thêm credential parity an toàn cho runner; xác minh OpenSSH host keys khớp pin OpsPilot, không đưa key vào argv/log; đặt ML URL 8765 tường minh.
- Chỉ định hostname staging, xác minh DNS/provider firewall, quyết định disk/40GB guard trước mọi ghi/pilot.
- Sau khi gaps đóng: staging + rollback riêng, production probe/CAS, rồi pilot CPU spike trên app riêng bằng profile cô lập và operator window.

### Gate tổng hợp

| Gate | Trạng thái | Bằng chứng |
|---|---|---|
| Profile/credential/pinned SSH | PASS | Clone SQLite backup; credential unlock PASS; SshManager khớp pin DB |
| VPS read-only inventory | PASS | Ubuntu 24.04; resource/Docker ở trên; discovery 4/4 running |
| HTTPS readiness | BLOCKED | UFW/owner unknown; hostname thiếu; provider firewall chưa xác minh |
| External reachability | BLOCKED/INCONCLUSIVE | TCP 80/443 timeout 2.5s; VPS không listener |
| Local ML dependencies | PASS | Python 3.12.10, package metadata phù hợp |
| Local ML service/runtime | BLOCKED/NOT_RUN | Port 8765 không listener; không start service |
| Pilot runner transport | BLOCKED | Strict host check có; known_hosts không khớp pin DB; default URL sai port; credential handoff chưa xác minh |
| Pilot/provenance | NOT_RUN/PARTIAL | Không train/pilot; fixtures mô phỏng; persisted state lineage chưa rõ |
| Code tests/build | N/A | Chỉ tài liệu, không đổi runtime/code |
| `git diff --cached --check` | PASS | Sẽ chạy trên đúng hai tài liệu được stage trước commit |
