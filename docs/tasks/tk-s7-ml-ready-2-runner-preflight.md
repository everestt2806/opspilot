# TK-S7 ML-READY-2 — runner preflight không side effect

## Phạm vi

Preflight-only trong CLI Python hiện có, kiểm tra profile/app/deployment, endpoint ML tường minh, health app, SSH pin/credential và snapshot tài nguyên/protocol. Profile SQLite được mở `mode=ro` + `query_only=ON`. Known-hosts riêng trong thư mục tạm chỉ chứa key đã khớp SHA-256 pin; SSH child không nhận biến môi trường chứa secret. Report chỉ ghi gate/status/reason và số liệu giới hạn, không ghi credential hay raw SSH output.

Không chạy thí nghiệm, start/deploy/reset/train/ingest/loadgen/fault hoặc remote cleanup. Không sửa DB nguồn hay trạng thái VPS.

## Ledger

| Yêu cầu | Trạng thái | Bằng chứng |
|---|---|---|
| CLI `--preflight-only`, DB/profile chỉ đọc, không dispatch runner/write adapters | PASS | `test_cli_preflight_dispatch_does_not_call_experiment_or_cleanup`; report side-effects đều false |
| Profile/VPS/app/deployment và health | PASS | CLI trên clone LIVE-0: VPS 1, app 1, deployment 7; app health HTTP 200; profile query-only |
| SSH endpoint/type/fingerprint pin và known_hosts tạm | PASS offline / BLOCKED live | Offline test key loại đúng và pin khớp/mismatch. Live có pin trong hồ sơ, nhưng không có credential handoff nên không keyscan/SSH |
| Endpoint ML tường minh, GET health/status bounded | PASS offline / BLOCKED live | Test endpoint loopback, health/status đúng/sai/thiếu; CLI không nhận `--ml-url` nên báo `ML_URL_EXPLICIT_REQUIRED`, không tự chọn 8765/8766/8767 |
| Gate protocol; không hạ yêu cầu dedicated/40 GB | PASS offline / BLOCKED theo snapshot | Test resource đủ/thiếu. Snapshot LIVE-0 trước đó: 4 app/9 container, 26.3 GB disk tổng, không đạt dedicated host và target 40 GB |
| Live SSH resource preflight | BLOCKED | Các biến handoff SSH (`OPSPILOT_SSH_SECRET`, `OPSPILOT_DEPLOY_SECRET`, `OPSPILOT_SSH_KEY_FILE`) không được cấp trong phiên. Credential vẫn nằm trong safeStorage; không trích xuất/giải mã hoặc ghi vào argv/log/report. Không keyscan/SSH; VPS resource và protocol live NOT_RUN |
| Report, test/Ruff/diff, board | PASS | Report đã khử nhạy cảm: `docs/evidence/tk-s7-ml-ready-2/preflight-report.json`; gate tổng thể BLOCKED đúng các thiếu điều kiện trên |

## START — 20/10/2026

- Branch `feat/deploy-reachability`, base `4b51b15`.
- Đọc `CLAUDE.md`, `docs/07-giao-thuc-thi-nghiem.md`, `docs/tasks/tk-s7-live-0-readonly-survey.md`, `docs/demo-11-10/kich-ban-11h.md`, board và task-discipline.
- Chỉ dùng profile clone `%TEMP%\opspilot-live0-20261020\opspilot.db` ở chế độ read-only. Không dùng DB profile để ghi.

## UPDATE — 20/10/2026

- Thêm preflight-only, report JSON cục bộ, key scan được đối chiếu pin trước khi tạo known_hosts riêng, explicit loopback ML GET `/health` + `/status`, app health GET và fixed SSH resource command. Không truyền secret env xuống tiến trình `ssh`.
- Sửa truy vấn tương thích profile cũ chưa có `healthcheck_response_type`, dùng mặc định `status_2xx` đúng hợp đồng/migration; sửa lỗi `status` bị truyền trùng vào `_gate` làm protocol checker ném exception.
- Offline gates: `pytest experiments/tests/test_preflight.py` — 19 passed; `pytest experiments/tests/test_runner_e2e.py` — 37 passed; scoped Ruff — All checks passed; `git diff --check` — PASS. TypeScript không thay đổi, Node22 gate N/A.
- Live read-only CLI lúc `2026-10-20T11:36:46Z`: profile selection PASS (VPS 1/app 1/deployment 7), app health HTTP 200, DB read-only PASS, pin hiện diện; tổng BLOCKED vì ML endpoint chưa được cấu hình tường minh và credential handoff thiếu. SSH host-key scan, SSH resource snapshot, live resource/protocol và second-provider-pair đều NOT_RUN. Không tuyên bố SSH/VPS inventory live PASS.
- Evidence report không chứa host, credential, fingerprint hay SSH output. Implementation/evidence commit: `62069be274501295ba088f002f52ad3f435990cd`. Report SHA-256: `38a9e3086e9df07bcfa1f56dd328ff9ea61a420ac9f7249f4b44b56eced23d77`.

## BLOCKED — live SSH

Cần một credential handoff hiện có mà runner có thể nhận an toàn trong bộ nhớ (hoặc key file được chỉ định, ngoài argv/log và không commit), cùng endpoint ML loopback được cấu hình rõ ràng. Khi có, chạy lại preflight-only qua profile clone read-only; không đổi pin DB. Host hiện có các app khác và cấu hình disk cũ dưới target 40 GB nên vẫn không thể thành `ready` kể cả SSH thành công.

## START — review fix, 20/10/2026

- Branch `feat/deploy-reachability`, code base `62069be`, hồ sơ trước `f89aca8`.
- Chỉ sửa `experiments/preflight.py`, `experiments/tests/test_preflight.py` và task/evidence docs. Không bridge credential, không chạy CLI/live SSH, không chạy pilot, không thay profile/pin/VPS.

## UPDATE — review fix, 20/10/2026

- Dedicated-host giờ cần Compose labels khớp project, service, working directory và config file; tập service phải là `app` + `collector` và thêm `postgres` khi DB bật. Container ngoài stack, service thiếu, label/path không khớp, ID trùng, output sai hoặc command lỗi đều fail closed. Lệnh chỉ đọc `docker ps --format` labels, không inspect environment.
- Health policy `status_2xx` chỉ kiểm status; policy `json` cần JSON object, từ chối JSON hỏng/null/array và explicit `ok=false`, `healthy=false`, `status=error|unhealthy`.
- Snapshot đọc `MemAvailable`; giữ riêng gate capacity 4 GB và gate available-memory >512 MiB. `NTPSynchronized` và clock offset tách riêng; offset dùng `measure_clock_offset_ms` hiện có, giới hạn `|offset| <= 2000 ms`, không đo được thì `NOT_RUN`.
- Gate: `pytest experiments/tests/test_preflight.py` — 38 passed; `pytest experiments/tests/test_runner_e2e.py` — 37 passed; scoped Ruff — PASS; `git diff --check` — PASS. Full `ruff check .` FAIL với 4 lỗi không sửa trong `tools/a17-c00-inventory.py` (I001, PLW1510, 2×C408); file ngoài phạm vi không đổi. Node22 không áp dụng vì không sửa TypeScript.
- Giữ nguyên `docs/evidence/tk-s7-ml-ready-2/preflight-report.json` và timestamp/hash khảo sát thật; không tạo report mock. Test fixture chỉ là offline regression evidence, không phải live VPS/resource evidence.
- Code/test commit: `7da5dfb32387f7db8ccf2f223f0ef2b4c115d155`. Gate RAM capacity được đặt tên riêng `PROTOCOL_RAM_CAPACITY` để không diễn đạt tổng RAM như RAM khả dụng. Live vẫn BLOCKED như hồ sơ trước: thiếu credential handoff và ML endpoint URL tường minh; SSH/resource/pilot không chạy. VPS dedicated/40 GB vẫn không đạt theo LIVE-0 snapshot.
