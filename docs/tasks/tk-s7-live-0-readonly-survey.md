# TK-S7 LIVE-0 — khảo sát HTTPS và pilot ML (đã chốt hồ sơ)

## Phạm vi và ledger kết quả

| Hạng mục | Trạng thái | Bằng chứng/kết luận |
|---|---|---|
| Profile, credential và SSH pin của khảo sát LIVE-0 | PASS (lịch sử) | Clone cô lập từ R1-live; Electron unlock thành công; SshManager xác minh pin DB. Không lưu credential, fingerprint đầy đủ hay raw SSH output. |
| VPS read-only inventory tại lần khảo sát | PASS (snapshot) | Ubuntu 24.04 x86_64; 2 vCPU; MemAvailable khoảng 2.99 GiB; disk tổng 26.3 GB, trống khoảng 18.47 GB; NTP đồng bộ; Docker 29.8.2/Compose 5.6.0; 9 container và 4 app đang chạy. Đây là snapshot, không khẳng định trạng thái hiện tại. |
| Host đủ điều kiện thí nghiệm “không chạy gì khác” | BLOCKED | VPS có 9 container và 4 app running; không đáp ứng điều kiện cô lập/dedicated app của protocol. |
| HTTPS owner, UFW và cloud firewall | BLOCKED | Listener 80/443 không có tại snapshot; ownership/preflight không đủ bằng chứng; UFW IPv4/IPv6 unknown; provider firewall chưa xác minh. External TCP 80/443 timeout trong lần khảo sát và không phân biệt được nguyên nhân. |
| Hostname và DNS thử nghiệm | BLOCKED | DB clone không có domain binding/hostname thử nghiệm; DNS và HTTPS probe không chạy. |
| Local ML dependencies và pipeline | PASS | Virtualenv Python 3.12.10; dependency metadata phù hợp. ML-READY-1 train/inference smoke cục bộ đạt trên dữ liệu lịch sử; artifacts và hash ở `docs/evidence/tk-s7-ml-ready-1/`. |
| ML service runtime | NOT_RUN | Không start service, không gọi API trên service, không thay model state. |
| OpenSSH runner transport | BLOCKED | `known_hosts` entry khác pin DB trong profile. Chênh fingerprint chưa chứng minh sai máy nếu thuật toán/loại khóa khác; chưa đối chiếu đúng key algorithm và fingerprint nên giữ BLOCKED, không kết nối hoặc học khóa mới. |
| Pilot 75 phút | NOT_RUN / BLOCKED | Không chạy pilot. Điều kiện VPS có app khác đang chạy chưa đạt; hostname, firewall evidence và runner host-key reconciliation cũng thiếu. |
| Note/board, tests và diff check của ML-READY-1 | PASS | Note/board cập nhật; 19/19 ML tests, Ruff và `git diff --check` pass; không có thay đổi nguồn dữ liệu hay VPS. |

## START — ML-READY-1, 2026-10-20

- Branch `feat/deploy-reachability`, parent HEAD `1a8fb24`; giữ nguyên các file untracked đã có.
- Commit cục bộ chứa artifact và kiểm chứng ML-READY-1: `4291a0ae7294122c10754f65194a988f8bb3d2bb`.
- Chỉ dùng virtualenv `ml-service/.venv`; không SSH, deploy, fault/loadgen, đổi DNS/firewall hoặc tác động VPS.

## Provenance dữ liệu mẫu vận hành

- `docs/demo-11-10/kich-ban-11h.md` ghi nguồn CSV là truy vấn chỉ đọc từ `metric_sample` trong profile G2, deployment 7 (Express v5); JSONL là raw JSON cùng mẫu từ collector. Hai file chỉ dùng để kiểm tra xử lý historical data, không được đổi hoặc gọi là dữ liệu pilot.
- Reviewer xác nhận 180 dòng, seq 9118–9297, năm metric khớp và `http_error_rate_source=probe`. Kiểm tra độc lập của ML-READY-1 cũng đạt: timestamp từ `2026-10-10T07:42:34Z` đến `2026-10-10T08:12:24Z`, khoảng lấy mẫu luôn 10 giây; không thiếu/null ở năm metric; timestamp/seq/năm metric/`container_up` khớp CSV↔raw từng dòng; cả 180 raw record có source `probe`.
- SHA-256 CSV: `9d2af5f64e64c3371fb988b54fef0770460368ddf935b456a605a1abd7bc425a`.
- SHA-256 JSONL: `4d0a9e29bc395ce34508ef6be100f58e43fbc2ac65b01ca81991cf10a46956ab`.
- Kết quả kiểm tra đầy đủ, metric ranges, training split và scores nằm trong `docs/evidence/tk-s7-ml-ready-1/`; file nguồn được giữ nguyên.

## Phân biệt yêu cầu cấu hình và guard

- Tài liệu TK-S6 nêu máy thí nghiệm tham chiếu có SSD 40 GB. Đây là cấu hình hạ tầng mục tiêu, không phải giá trị guard free-disk mà code thực thi.
- Precheck deploy hiện có trong `app/src/main/deploy/precheck.ts` kiểm tra disk trống `>2 GB`; snapshot khảo sát 18.47 GB trống vượt ngưỡng code đó. Tuy nhiên disk tổng 26.3 GB thấp hơn cấu hình SSD 40 GB tham chiếu. Không dùng guard thấp hơn để hạ yêu cầu cấu hình thí nghiệm; host này vẫn BLOCKED theo target 40 GB và còn có app khác đang chạy.

## Cấu hình cổng ML và known_hosts

- Runner experiments ghi mặc định `127.0.0.1:8000`; ML service/Electron hiện dùng 8765 và Electron có fallback 8766/8767. Đây là khác cấu hình endpoint, chưa đủ kết luận lỗi; cần endpoint được cấu hình/kiểm tra nhất quán khi tích hợp runner. LIVE-0 không thay đổi port hoặc runner.
- OpenSSH `known_hosts` và fingerprint DB được ghi nhận khác nhau. So sánh fingerprint phải xét thuật toán/loại host key tương ứng; khác chuỗi fingerprint giữa các thuật toán không đủ chứng minh sai máy. Chưa có đối chiếu xác minh cho đúng thuật toán nên SSH transport runner vẫn BLOCKED.

## ML-READY-1: local training/inference smoke

- Harness dùng `ml-service.main.replay`, cùng code tạo feature và fit/scoring của pipeline hiện có. Fit đúng 150 mẫu đầu (seq 9118–9267), tạo 131 feature windows với window 20; inference 30 mẫu tiếp (seq 9268–9297) theo thời gian. Không dùng holdout để chọn feature, fit model, fit scaler hay normalization percentiles.
- Sinh 4 score/mẫu: `zscore_ewma`, `iforest`, `ocsvm`, `ensemble`. Metadata ghi feature version/dimension, tham số model, source hashes và split. State directory được chuyển vào temporary directory rỗng; run không ghi model; hash snapshot của `ml-service/state/` trước/sau không đổi.
- Đây là **historical normal-data training smoke**, không phải pilot 75 phút. Không có nhãn lỗi, không tạo nhãn giả, không báo accuracy/precision/recall hoặc khẳng định khả năng phát hiện lỗi. Không reset/ghi đè state hay model ứng dụng hiện có.

## Hồ sơ HTTPS và pilot còn bị chặn

- HTTPS survey: không có hostname thử nghiệm; UFW IPv4/IPv6, owner trạng thái ingress và provider firewall chưa được xác minh. Snapshot 80/443 không có listener; external connect timeout không chứng minh firewall riêng lẻ. Không có bằng chứng để kết luận HTTPS usable.
- Pilot 75 phút chưa chạy. Protocol gồm baseline 30 phút, holdout 15, fault 20, recovery 10; yêu cầu dedicated app, clock/SSH/health/integrity gates và không có app khác trên host. VPS hiện tại không đáp ứng điều kiện “không chạy gì khác”.
- Known-host pin parity của runner chưa được xác minh; ML-READY-1 chỉ kiểm tra local code/data path.
- Backend uncertain recovery và cloud-firewall evidence vẫn là các gap riêng đã ghi nhận; không được coi là đã xử lý bởi khảo sát hoặc local smoke.

## Kế hoạch đã ghi nhận (chưa thực thi)

- **HTTPS staging → production:** dùng hostname staging riêng thuộc quyền quản lý; xác minh cả resolver công khai, toàn bộ A/AAAA/CNAME cuối chuỗi, UFW theo IPv4/IPv6 và provider firewall. Chỉ sau khi ownership/runtime đủ bằng chứng mới áp dụng Caddy; staging dùng ACME staging và trust riêng, kèm external probe/rollback. Production là cửa sổ riêng; chỉ probe với trust production, hostname/SNI, peer IP và health hợp lệ mới cho coordinator/CAS ghi active. Hiện tất cả các bước ghi/probe này NOT_RUN.
- **Pilot 75 phút:** app riêng/dedicated và profile SQLite cô lập; baseline 30 phút, holdout 15, fault 20, recovery 10; mục tiêu 450 mẫu, tối thiểu 405, gap tối đa 120 giây và 5 score/mẫu. Abort nếu pin/SSH, clock skew, app health, resource, sample/gap/score hoặc cleanup không đạt. Chưa chọn host đủ điều kiện; toàn bộ pilot NOT_RUN.
## Gate kết thúc checkpoint

| Gate | Kết quả |
|---|---|
| CSV/raw provenance, hash, timestamp/seq/cadence, five metrics, null/parity | PASS — `training-metadata.json`, `validation-results.json` |
| Train 150 / inference 30, chronological, four scores, no holdout fit | PASS — `inference-scores.csv` và metadata |
| State/profile isolation; existing state unchanged | PASS — temporary state path; before/after hash comparison |
| ML tests | PASS — `.venv/Scripts/python.exe -m pytest -q`: 19 passed in 17.76s |
| Ruff | PASS — `.venv/Scripts/python.exe -m ruff check .`: All checks passed; harness scoped check/format check passed |
| `git diff --check` | PASS — kiểm tra thay đổi scoped trước commit |
| Pilot/VPS/HTTPS action | NOT_RUN — blocked bởi các điều kiện nêu trên; không tác động VPS |