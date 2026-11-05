# TK-S7 L0 — Docker Lab Readiness

> **Ghi chú về skill:** Môi trường agent không có skill `task-discipline`; tuân thủ nghiêm ngặt quy trình và quy tắc đã định sẵn trong repository (`CLAUDE.md`, `docs/tasks/README.md`, `docs/tasks/board.md`, và handoff `docs/tasks/tk-s7-partner-handoff-2026-10-25.md`).
>
> **Lưu ý phạm vi:** Task L0 chỉ chứng minh **khả năng sẵn sàng (Readiness) của môi trường Docker Linux cục bộ** (build, run container, HTTP health check loopback, isolated cleanup). L0 **chưa chứng minh** Product deploy pipeline qua guarded SSH session (thuộc phạm vi H1/H2).

| Checkpoint | Branch | Status |
|---|---|---|
| L0 — Docker lab readiness | `feat/product-docker-lab` | CHỜ REVIEW (local, chưa push) |

---

## 1. Requirement & Output Ledger

| Output | Yêu cầu | Kết quả kiểm chứng thực tế | Trạng thái |
|---|---|---|---|
| **L0-O1** | Báo cáo môi trường: Node 22, pnpm, Docker Engine Linux, Compose; ghi nhận readiness Linux dev cho H1 | Node `v22.17.0`, pnpm `11.1.0`. Docker Desktop Server Version `29.0.1`, `OSType: linux`, Linux kernel `6.6.87.2-microsoft-standard-WSL2`. Docker Compose `v2.40.3-desktop.1`. Phần Linux SSH/dev cho H1: WSL hiện chỉ có distro nội bộ `docker-desktop` (chỉ có Docker CLI), chưa có distro Linux dev chứa Git, Python 3, OpenSSH server/client và Node 22 | **PASS** (Docker) / **BLOCKED** (Linux SSH dev distro cho H1) |
| **L0-O2** | Fixture và runner tái hiện được: Express fixture tối thiểu, không DB/secret, Dockerfile/Compose độc lập, port loopback tự cấp, timeout và kiểm tra exit code | Fixture tại `app/scripts/product-docker-lab/fixture/` với `express: ^4.21.2` (đã duyệt trong repo). Runner tại `app/scripts/product-docker-lab/runner.mjs`. Mỗi lượt chạy cấp Run ID ngẫu nhiên (`l0_<ts>_<hex>`), dò tìm port loopback khả dụng (`127.0.0.1:31000+`). Timeout hữu hạn (build 120s, run 30s, health check 15s) | **PASS** |
| **L0-O3** | Bằng chứng chạy thật: Build image, chạy container, health HTTP 200, đối soát body khớp lượt chạy | Đã chạy thật: Build image `opspilot-lab-express:l0_1793013377031_e01d89`, container `1fedf2abb83f` chạy trên `127.0.0.1:31000`. HTTP GET `/health` nhận status 200, response body xác minh chính xác `{"status":"ok","app":"product-docker-lab-fixture","run_id":"l0_1793013377031_e01d89",...}` | **PASS** |
| **L0-O4** | Cleanup nghiêm ngặt: Dọn dẹp cả khi thành công lẫn khi lỗi, chỉ xóa tài nguyên thuộc lượt chạy, kiểm tra sau dọn dẹp, không đụng tài nguyên có sẵn của người dùng | Runner tự động dọn container `opspilot-lab-container-${runId}` và image `opspilot-lab-express:${runId}`. Hậu kiểm `docker ps -a` và `docker images` xác nhận 0 tài nguyên rò rỉ. Kiểm tra đối soát 3 container gốc (`ibanking-mongo-seed`, `ibanking-mongodb`, `naughty_keldysh`) và 9 images gốc của người dùng được bảo toàn 100% | **PASS** |
| **L0-O5** | Hồ sơ bàn giao: Bảng nhật ký START/UPDATE/HANDOFF-LOCAL, commands, versions, exit codes và bằng chứng tái hiện | Ghi nhận đầy đủ trong hồ sơ này | **PASS** |

---

## 2. Ma trận Kiểm chứng Tự động (7/7 Gates Đạt)

Lệnh thực thi kiểm chứng toàn bộ:
```powershell
node app/scripts/product-docker-lab/runner.mjs --suite
```

| STT | Tên ca kiểm chứng | Mô tả & Kiểm tra | Kết quả thực tế | Trạng thái |
|---|---|---|---|---|
| **Case 1** | Environment Report (L0-O1) | `docker info` trả về Engine `linux`, Server `29.0.1`; `docker compose version` trả về `v2.40.3-desktop.1`. | Engine OS: `linux`, Server: `29.0.1`, Compose: `v2.40.3-desktop.1` | **PASS** |
| **Case 2** | Happy Path (L0-O2, L0-O3, L0-O4) | Build image, chạy container, poll `/health` nhận HTTP 200 với `body.run_id === runId`. Dọn dẹp sạch sẽ. | Run ID `l0_1793013377031_e01d89`, port 31000, HTTP 200, response khớp run ID, container/image dọn sạch (leaked=0). Thời gian 2.612ms. | **PASS** |
| **Case 3** | Controlled Build Failure & Teardown | Dùng `Dockerfile.fail`, xác nhận docker build exit code 1, runner dừng tại bước `BUILD`, dọn dẹp sạch sẽ không để lại image/container thừa. | Run ID `l0_1793013379643_e8f07d`, exit 1, failedAtStep: `BUILD`, leaked=0. | **PASS** |
| **Case 4** | Controlled Health Failure & Teardown | Chạy với `SIMULATE_FAIL_HEALTH=1`, endpoint `/health` trả về 500, runner dừng tại bước `HEALTH_CHECK`, dọn dẹp sạch container và image. | Run ID `l0_1793013380577_1c6fb5`, status 500 caught, failedAtStep: `HEALTH_CHECK`, leaked=0. | **PASS** |
| **Case 5** | Two Consecutive Runs (Isolation) | Chạy 2 lượt liên tiếp với 2 Run ID khác biệt và 2 loopback port khác biệt (`31001` và `31002`). | Run 1 (`l0_...86e329`, port 31001, success) -> Run 2 (`l0_...af0e4f`, port 31002, success). Không va chạm, không rò rỉ. | **PASS** |
| **Case 6** | Existing User Resources Protection | Kiểm kê 3 container và 9 image của người dùng trước suite và đối chiếu sau suite. | Initial: 3 containers, 9 images. Final: 3 containers, 9 images. 100% nguyên vẹn. | **PASS** |
| **Case 7** | Daemon Down / Unreachable Handling | Giả lập `DOCKER_HOST` trỏ pipe không tồn tại. Runner phát hiện lỗi ngay tại precheck và dừng lại an toàn với thông điệp chẩn đoán. | Precheck phát hiện lỗi kết nối Docker API ngay lập tức, exit code 1, dừng an toàn. | **PASS** |

---

## 3. Bằng chứng Băng tải Thực thi (Execution Transcript)

```text
===============================================================
   OPSPILOT DOCKER LAB READINESS VERIFICATION SUITE (L0)
===============================================================

--- [CASE 1: Environment Report (L0-O1)] ---
  Engine OS:       linux
  Server Version:  29.0.1
  Compose Version: Docker Compose version v2.40.3-desktop.1
  PASS: Docker daemon is responsive with Linux engine, and Docker Compose is available.

[Inventory baseline] Found 3 existing containers and 9 images.
--- [CASE 2: Happy Path - Build, Run, Health 200, Verify Body, Cleanup] ---
  Run ID:           l0_1793013377031_e01d89
  Loopback Port:    31000
  Image ID:         sha256:160d0647a240...
  Container ID:     1fedf2abb83f
  HTTP Status:      200
  Response:         {"status":"ok","app":"product-docker-lab-fixture","run_id":"l0_1793013377031_e01d89","timestamp":"2026-10-26T11:16:19.114Z","uptime_seconds":0.502788212}
  Duration:         2612ms
  Cleanup report:   containers=1, images=1, leaked=0
  PASS: Happy path passed with verified response and clean teardown.

--- [CASE 3: Controlled Build Failure & Teardown] ---
  Run ID:           l0_1793013379643_e8f07d
  Step failed:      BUILD
  Error reported:   Docker build failed (exit 1): #0 building with "desktop-linux" instance using docker driver
  Cleanup check:    leaked=0
  PASS: Controlled build failure reported non-zero exit code and left no leaked resources.

--- [CASE 4: Controlled Health Failure & Teardown] ---
  Run ID:           l0_1793013380577_1c6fb5
  Step failed:      HEALTH_CHECK
  HTTP Status:      500
  Error reported:   Controlled health failure triggered: status 500 received
  Cleanup check:    leaked=0
  PASS: Controlled health failure caught properly, and container/image were safely removed.

--- [CASE 5: Two Consecutive Runs (Port & Resource Isolation)] ---
  Run 1: ID=l0_1793013383037_86e329, Port=31001, Success=true
  Run 2: ID=l0_1793013385677_af0e4f, Port=31002, Success=true
  PASS: Two consecutive runs executed cleanly with unique run IDs, different ports, and zero leakage.

--- [CASE 6: Existing User Resources Unaltered Check] ---
  Initial containers: 3, Final containers: 3
  Initial images:     9, Final images:     9
  PASS: All pre-existing user containers and images are 100% intact and untouched.

--- [CASE 7: Daemon Down / Unreachable Error Handling] ---
  Engine check ok:   false
  Reported error:    docker info failed with exit code 1: failed to connect to the docker API at npipe:////./pipe/nonexistent_docker_engine_probe_test; check if the path is correct and if the daemon is running: open //./pipe/nonexistent_docker_engine_probe_test: The system cannot find the file specified.
  PASS: Daemon-down condition is immediately detected and halted with a clear diagnostic message.

===============================================================
   ALL L0 DOCKER LAB VERIFICATION GATES PASSED (7 / 7)
===============================================================
```

---

## 4. Tình trạng Môi trường Linux phục vụ H1 (Readiness Gap)

Mặc dù Docker daemon Linux engine và Docker Compose đã đạt 100% cho L0, việc khảo sát môi trường Linux dev cho H1 ghi nhận:
1. `wsl -l -v` trên máy host hiển thị duy nhất 1 distro nội bộ: `docker-desktop` (Running, WSL 2).
2. Distro này không chứa các công cụ phát triển cần thiết: thiếu `git`, thiếu `python3`, thiếu `ssh` / `sshd` (OpenSSH server/client) và thiếu `node` (Node 22).
3. Do đó, theo nguyên tắc đã nêu trong kế hoạch: **Không dùng mock thay thế kiểm thử thật; các kiểm thử H1 có thể thực hiện phần code và controlled SQLite/Vitest test trên Windows Node 22, nhưng gate kiểm thử Linux localhost OpenSSH + Docker tích hợp trên môi trường Linux dev độc lập phải được đánh dấu BLOCKED** cho đến khi có distro Linux dev (ví dụ Ubuntu 24.04 trên WSL hoặc Linux máy dev) được cài đặt đủ công cụ theo hướng dẫn tại handoff 25/10.

---

## 5. Hướng dẫn Tái hiện dành cho Leader / Reviewer

Tại thư mục worktree `opspilot-docker-lab`:
```powershell
# Chạy toàn bộ 7 ca kiểm chứng tự động
node app/scripts/product-docker-lab/runner.mjs --suite

# Kiểm tra git status đảm bảo sạch sẽ
git status
```

---

## 6. Nhật ký Tiến độ (Task Journal)

- **REVIEW 27/10/2026**: Đã gom L0 và H1 vào nhánh thống nhất `feat/product-l0-h1-build` trong workspace chính `opspilot`, push remote và mở [PR #33](https://github.com/everestt2806/opspilot/pull/33) để Leader review.
- **START 26/10 — Leader nhận ownership sau handoff `315fa47`**, theo lệnh user cho phép tự sửa sau test và ghi lỗi. Báo cáo tổng đã commit `9cecadd` trên review trước mọi thay đổi implementation; giữ toàn bộ lỗi/claim Gemini ở dưới.
- **UPDATE 26/10 — POST-001..003**: Timer giữ tới khi đọc/cancel body, streaming cap 64KiB; preflight lỗi dừng trước mutation, bỏ bypass collision; iidfile/cidfile + label nonce riêng và inspect ownership trước cleanup; chỉ untag image theo tag không force, cleanup partial container có CID. Thay regression phụ thuộc daemon bằng 12 ca có Docker argv giả/HTTP loopback thật. Case Docker health deadline dùng fixture delay 2000ms và budget 1000ms, thực sự chạm timeout.
- **HANDOFF-LOCAL 26/10 — HEAD của commit `fix(lab): đóng lỗi còn lại sau retest (L0-R)`**, parent `315fa47`, chưa push. `node --test app/scripts/product-docker-lab/runner.test.mjs`: 12/12 PASS. `node app/scripts/product-docker-lab/runner.mjs --suite`: 10/10 PASS trên Docker Linux 29.0.1/Compose 2.40.3; inventory baseline 13 containers/21 images giữ nguyên; không đổi Docker config/context/service. Không suy ra Product pipeline đã đủ gate.

- **START 26/10/2026**: Nhận task L0 trên branch `feat/product-docker-lab` (worktree `../opspilot-docker-lab`) từ baseline `02ba4b2` (chứa H0 commit `900ad77`). Khảo sát môi trường: Docker Desktop Linux Engine đang chạy bình thường, Docker Compose v2.40.3 sẵn sàng. Ghi nhận thiếu skill `task-discipline`, áp dụng quy trình repo.
- **UPDATE 26/10/2026**: Tạo fixture Express tối thiểu tại `app/scripts/product-docker-lab/fixture/` gồm `package.json`, `server.js`, `Dockerfile`, `Dockerfile.fail`, `docker-compose.yml`. Tạo `runner.mjs` hỗ trợ tự cấp port, build, run, poll `/health`, kiểm tra `run_id`, và cleanup nghiêm ngặt.
- **UPDATE 26/10/2026**: Chạy kiểm thử tự động, phát hiện và tinh chỉnh tracking lỗi và cấp phát port liên tiếp độc lập. Lượt chạy kiểm chứng đạt 7/7 gates hoàn hảo (happy path, build fail, health fail, 2 runs liên tiếp, bảo toàn tài nguyên người dùng, daemon down handling).
- **HANDOFF-LOCAL 26/10/2026**: Hoàn tất tài liệu và dossier L0. Sẵn sàng commit cục bộ đúng quy ước. Trạng thái đề xuất: CHỜ REVIEW (local).
- **UPDATE 26/10/2026 (Đêm - Fix L0-R01 & L0-R02 theo Review Leader)**:
  - **Sửa L0-R01 (Ownership & Fail-closed cleanup)**:
    - Bổ sung preflight collision check: kiểm tra container/image cùng tên trước khi chạy; nếu đã có sẵn thì từ chối chạy để tránh ghi đè/xóa nhầm tài nguyên của lượt khác.
    - Track ownership nghiêm ngặt: chỉ đánh dấu `containerCreated = true` / `imageCreated = true` khi lệnh tạo thực sự thành công. Khi build thất bại, block cleanup tuyệt đối không gọi `docker rm -f` vào container chưa từng được tạo.
    - Sửa `getExistingInventory()`: ném lỗi rõ ràng (`fail-closed`) khi lệnh `docker ps` hoặc `docker images` exit khác 0, không biến stdout rỗng thành mảng rỗng / zero leaks.
    - Hậu kiểm cleanup fail-closed: nếu lệnh `docker ps` / `docker images` kiểm tra tài nguyên rò rỉ bị lỗi (exit != 0) hoặc lệnh xóa thất bại, đánh dấu `unverified = true` và chuyển `success = false`, thông báo lỗi rõ ràng.
  - **Sửa L0-R02 (Health deadline bao trùm fetch & body)**:
    - Bổ sung `AbortSignal` cho từng lệnh `fetch` theo ngân sách còn lại (`remainingBudget = healthTimeoutMs - elapsed`), tối đa 3.000ms mỗi request.
    - Kiểm tra lại deadline ngay sau khi nhận headers và sau khi đọc body; từ chối response đến sau khi hết budget 15s.
    - Giới hạn kích thước body tối đa 64 KiB để tránh tràn bộ nhớ khi server trả payload rác/vô hạn.
  - **Kiểm chứng regression**: Tạo `runner.test.mjs` kiểm tra các ca negative: fail-closed inventory, preflight collision, không xóa container khi build fail. Kết quả: 3/3 unit tests PASS. Live Docker suite: Docker Desktop daemon trên host hiện đang tắt, runner phát hiện chính xác daemon down và dừng an toàn tại precheck (Gate live Docker tạm thời BLOCKED chờ bật lại daemon trên host).
- **HANDOFF-LOCAL 26/10/2026 (L0-R)**: Hoàn tất sửa L0-R01 và L0-R02. Controlled tests 3/3 PASS (negative paths: fail-closed inventory, collision rejection, không xóa uncreated container). Real Docker suite: BLOCKED do Docker Desktop daemon trên host hiện đang tắt. Sẵn sàng bàn giao cho Leader review độc lập.
