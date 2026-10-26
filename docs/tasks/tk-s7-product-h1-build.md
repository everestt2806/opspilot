# Hồ sơ Task H1 — Product Build Trong Cùng Guarded Session

## Thông tin chung

- **Task**: H1 — Product Build trong cùng guarded SSH session
- **Branch**: `feat/product-h1-build`
- **Worktree**: `D:\Dự án CNTT\Tool Deploy\opspilot-h1-build`
- **Base commit**: `02ba4b2` (chứa H0 commit `900ad77` trên `origin/feat/deploy-reachability`)
- **Worker**: AI Worker (triển khai)
- **Leader / Reviewer**: ChatGPT (review & kiểm chứng độc lập)
- **Co-author**: `Võ Thị Thiên Kim <Thienkim.dev@gmail.com>`
- **Ghi chú về skill**: Môi trường làm việc thiếu skill `task-discipline`; áp dụng nghiêm ngặt quy trình kỷ luật task, quy ước code và ADR-011 đã có sẵn trong repository.

---

## 1. Phạm vi thay đổi (Scope)

Danh sách file thay đổi và tạo mới:
1. `docs/contracts/product-guarded-ssh-session.ts`: Thêm `GuardedSshStartBuildRequest`, `GuardedSshPollBuildRequest`, `GuardedSshBuildState`, mở rộng `GuardedSshResponse` (với `build_state`, `exit_code`, `image_id`, `image_tag`, `labels`, `error_tail`), thêm error codes `SSH_BUILD_REJECTED`, `SSH_BUILD_FAILED`, `SSH_BUILD_TIMEOUT`, `SSH_BUILD_NOT_ACTIVE`.
2. `DECISIONS.md`: Ghi nhận quyết định kiến trúc H1 về cơ chế build polling-based trong cùng session và canonical image tag.
3. `app/src/main/controlPlane/guardedSshProtocol.ts`: Cập nhật `STABLE_ERROR_CODES`, schema `isResponse()` nhận diện các trường build response an toàn và giới hạn.
4. `app/src/main/controlPlane/guardedSshSession.ts`: Thêm các phương thức `startBuild(imageTag)`, `pollBuild()`, `pollBuildUntilSettled(options)` và `exchangeWithResponse()`.
5. `app/src/main/controlPlane/target_guarded_ssh_helper.py`: Thêm xử lý `start_build` và `poll_build` subprocess Docker argv kiểm soát, non-blocking output draining qua thread, inspect image_id/labels, an toàn cleanup trong `finally`.
6. `app/src/main/controlPlane/productPipelineSourceRender.ts`: Sử dụng `deployment.image_tag` thay vì placeholder; tách `stageProductSourceAndRenderWithSession` nhận session từ caller; thêm `executeProductBuildWithSession` và `stageAndBuildProduct`.
7. `app/src/main/controlPlane/productPipelineBuild.test.ts`: Controlled unit & integration tests kiểm chứng đầy đủ lifecycle, identity, definite failure, unknown outcome và single session reuse.
8. `docs/tasks/tk-s7-product-h1-build.md`: Dossier báo cáo nhiệm vụ H1 này.

---

## 2. Bảng đối chiếu Output (H1-O1 -> H1-O8)

| Output | Tiêu chí | Trạng thái | Bằng chứng kiểm chứng |
|---|---|---|---|
| **H1-O1** | Contract build: request/result, validation, preconditions, output budget | **PASS** | `docs/contracts/product-guarded-ssh-session.ts`, `DECISIONS.md`, typed operations `start_build` & `poll_build` |
| **H1-O2** | Session lifecycle: source → render → build trong 1 guarded SSH session duy nhất | **PASS** | Tách `stageProductSourceAndRenderWithSession`, `executeProductBuildWithSession`; 1 open, 1 channel, monotonic sequence |
| **H1-O3** | Identity chuẩn: dùng `deployment.image_tag` từ `beginGitDispatch`, không sinh deployment thứ hai | **PASS** | `deployment.image_tag` được nạp từ DB; không gọi `createNextVersion`; kiểm tra đúng 1 deployment |
| **H1-O4** | Build target-side: checksum hợp lệ, argv an toàn, staging context chuẩn, inspect image_id | **PASS** | Context `staging/source`, dockerfile `staging/render/Dockerfile`, `--label opspilot.app_id` và `deployment_id` |
| **H1-O5** | Build dài & xử lý lỗi: polling protocol, output tail <= 4096 bytes, phân biệt definite vs unknown | **PASS** | Asynchronous `Popen` + `poll_build` chu kỳ 1s; log bounded 4 KiB; disconnect/timeout giữ `reconciliation_required` |
| **H1-O6** | Giữ ranh giới H2: không activate, không promote, không terminal finalize | **PASS** | `executeProductBuildWithSession` trả về status kết quả build; không đổi `current_deployment`, executor vẫn polling-only |
| **H1-O7** | Controlled tests & Real lab gate | **PARTIAL** | Controlled tests 7/7 PASS (100%), full suite 254/254 PASS (100%). Gate Linux localhost SSH lab thật là **BLOCKED** do thiếu Linux dev distro riêng trên host |
| **H1-O8** | Hồ sơ bàn giao đầy đủ chi tiết | **PASS** | Hồ sơ tại file này, ghi rõ lệnh, kết quả, SHA và gap còn lại cho H2 |

---

## 3. Chi tiết thiết kế và triển khai

### H1-O1 & H1-O5: Cơ chế Build Asynchronous Polling
- **Thách thức**: SSH protocol quy định frame timeout 15 giây, một request outstanding, frame tối đa 40 KiB / response 64 KiB, tổng output session 4 MiB. Lệnh `docker build` có thể kéo dài vài phút và sinh hàng chục MiB logs, gây timeout hoặc tràn buffer nếu chờ đồng bộ.
- **Giải pháp**:
  - Tách thành 2 thao tác có kiểu dữ liệu chặt chẽ:
    1. `start_build`: Helper khởi chạy `subprocess.Popen(["docker", "build", ...])`, trả về `build_state: "started"`.
    2. `poll_build`: Controller gửi request chu kỳ 1 giây. Helper kiểm tra `proc.poll()`, nếu đang chạy trả `build_state: "running"`.
  - **Draining output**: Một thread daemon target-side đọc liên tục `proc.stdout` vào ring buffer `deque(maxlen=200)` để ngăn ngừa deadlock do đầy pipe buffer của OS.
  - **Output Budget**: Khi build lỗi, helper chỉ trích xuất tối đa 4096 ký tự cuối cùng (`error_tail`), hoàn toàn nằm trong giới hạn frame và không làm phình session output.
  - **Phân loại lỗi**:
    - Exit code 0 + docker inspect ra Image ID & Labels -> `build_state: "succeeded"`.
    - Exit code non-zero + receipt có exit_code/error_tail -> `build_state: "failed"` (definite failure).
    - Timeout, SSH disconnect hoặc mất frame -> `SSH_SESSION_TIMEOUT` / `reconciliation_required` (unknown outcome, không tự động replay hoặc xóa trạng thái).

### H1-O2 & H1-O3: Đơn nhất Session, Lock và Identity
- Caller mở session một lần qua `openProductGuardedSshSession` (sở hữu channel và lock target).
- `stageProductSourceAndRenderWithSession` tải file source và render vào staging của `deployment_id`.
- `executeProductBuildWithSession` tiếp tục trên cùng session đó, gọi `authorizeWritePhase('build')`, thực hiện `start_build` và `poll_build`.
- Sử dụng chính xác `deployment.image_tag` do `beginGitDispatch` đã cấp, loại bỏ hoàn toàn placeholder cũ `<app>:product-source-render`.
- Không gọi `setup` hay `createNextVersion`, đảm bảo cơ sở dữ liệu chỉ có duy nhất 1 deployment record cho đợt build này.

### H1-O6: Giữ nguyên ranh giới với H2
- H1 chỉ chịu trách nhiệm build Docker image từ source/render đã staging và xác minh image ID / tags.
- Toàn bộ các thao tác sau build: kích hoạt container, kiểm tra healthcheck HTTP, cutover routing, cập nhật deployment thành `current`, rollback hoặc cập nhật trạng thái terminal của job/deployment trong database đều thuộc phạm vi của task **H2**.
- Worker Controller vẫn giữ nguyên cờ `polling_only`, không kích hoạt production executor.

---

## 4. Kết quả Quality Gates

### Gate 1: Controlled Tests cho H1
- **Lệnh**: `pnpm --prefix app exec vitest run src/main/controlPlane/productPipelineBuild.test.ts`
- **Kết quả**: **PASS 7/7 tests (100%)**
  1. `startBuild and pollBuild settle cleanly when docker build succeeds` (PASS)
  2. `pollBuild settles with definite failure and bounded error_tail on build error` (PASS)
  3. `rejects startBuild when server returns SSH_BUILD_REJECTED` (PASS)
  4. `marks session reconciliation_required when channel disconnects during build poll` (PASS)
  5. `executes build with canonical deployment image tag and returns build_succeeded` (PASS)
  6. `returns build_failed_definite when build returns non-zero returncode without promoting deployment` (PASS)
  7. `rejects execution when deployment status is not building or commit sha mismatches` (PASS)

### Gate 2: Full Regression Vitest Suite
- **Lệnh**: `pnpm --prefix app exec vitest run src/main/db src/main/controlPlane src/main/git src/main/ssh src/main/deploy/pipeline.test.ts src/main/deploy/precheck.test.ts`
- **Kết quả**: **PASS 254/254 tests (20 test files, 100%)**
  - Không có hồi quy trên database, control plane, git poller, ssh manager, hay pipeline.

### Gate 3: TypeScript Typecheck
- **Lệnh**: `pnpm --prefix app typecheck`
- **Kết quả**: **PASS (Exit code 0)** cho cả `tsconfig.node.json` và `tsconfig.web.json`.

### Gate 4: Git Diff Check
- **Lệnh**: `git diff --check`
- **Kết quả**: **Clean (Exit code 0)**, không có whitespace lỗi hay trailing characters.

### Gate 5: Linux Localhost SSH Lab & Python Filesystem Regression
- **Hiện trạng kiểm tra**:
  - `python app/scripts/test_guarded_ssh_transfer.py` trên Windows báo `ModuleNotFoundError: No module named 'fcntl'` (do `fcntl` là Linux-only module để test locking).
  - Kiểm tra `wsl -l -v`: Host chỉ có duy nhất distro nội bộ `docker-desktop` (chỉ chứa binary `docker`, không có Python, OpenSSH server, Git, Node).
  - Quy ước của repo: "Không mặc định dùng distro nội bộ docker-desktop làm distro dev. Chỉ ghi PASS sau khi thực sự chạy; ghi rõ baseline failures."
- **Trạng thái Gate**: **BLOCKED**
  - **Lý do**: Máy host chưa cài đặt distro Linux dev riêng biệt có sẵn OpenSSH/Python/Git.
  - **Hướng gỡ chặn**: Cài đặt một WSL Linux dev distro (e.g. `Ubuntu-24.04`) có `openssh-server`, `python3`, `git` để chạy lab SSH localhost đầy đủ, hoặc chạy trong môi trường CI Linux riêng biệt.

---

## 5. Rủi ro và Gap bàn giao cho H2

1. **Thực thi trên môi trường Linux SSH thật**:
   - Mã nguồn helper `target_guarded_ssh_helper.py` đã hoàn thiện và kiểm tra cú pháp, thread draining, và subprocess handling.
   - Khi chạy trên Linux target thật, cần đảm bảo user SSH thuộc nhóm `docker` hoặc có quyền gọi socket `/var/run/docker.sock`.
2. **Xử lý Image Collector**:
   - Nếu `docker-compose.yml` tham chiếu đến image collector nội bộ, bước H1 build chỉ build service application; image collector được cấu hình từ trước hoặc pull từ local cache.
3. **Chuyển giao sang H2**:
   - H2 sẽ nhận Image ID từ kết quả `build_succeeded` của H1 để tiến hành phase `activate` (khởi chạy compose up, health probe, switch traffic, và terminal finalize).
