# TK-A17/C04 — Migrate ứng dụng thành công giữa hai VPS

> **REVIEW_FIX_REQUIRED — Leader review 01 ngày 13/09/2026.** Thực hiện
> [review-c04.md](review-c04.md) để đóng `C04-R1-01…08`; C05 tiếp tục đóng. VM01 đã được bật SSH và
> Leader xác nhận TCP/22 + actual credential resolver PASS; sau khi local fix đạt phải chạy đủ hai live case.

## Mục tiêu

Thay màn Migrate mock bằng luồng thật theo contract, rồi chứng minh hai trường hợp trên **hai VPS thật**:

1. migrate stateless, ưu tiên Vite SPA để build/restore nhanh;
2. migrate Express + PostgreSQL, giữ đúng marker nghiệp vụ đã tạo trước migrate.

Cả hai lượt phải đạt `PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE → VERIFY →
AWAITING_CONFIRM → completed`. Demo chọn `keepSource=true`; không xóa nguồn.

## Điều kiện mở và preflight đầu tiên

- C03 APPROVED tại code `c060c75`, docs `53aa07e`. Input thật trong OpsPilot userData:
  - stateless: VM02 ID 2, Vite app 18, deployment 41, port 30017;
  - PostgreSQL: VM02 ID 2, Express app 16, current deployment 39, port 30015, marker
    `c03-marker-1789234314659`;
  - Next app 17/deployment 40/port 30016 chỉ giữ làm deploy proof, không bắt buộc migrate.
- Hai VPS có profile riêng trong SQLite, SSH/Docker hoạt động và không có experiment `running`.
- VM01 profile ID 1 từng TCP timeout tại Leader review-03, nhưng đã được bật SSH và xác nhận resolver PASS
  sau review C04-01. Worker vẫn phải kiểm lại VM01 và VM02 read-only ngay trước code live helper.
  C04 không thể PASS nếu chỉ một VPS truy cập được hoặc dùng hai container trên cùng VPS.
- Chọn app/port đích riêng, không đè app B hoặc app A17 hiện hữu. Ghi dung lượng backup dự kiến,
  disk đích, port đích và clock offset.

Nếu một VPS chưa truy cập được, Worker vẫn hoàn thiện production code/test/evidence local độc lập;
handoff cuối là `BLOCKED` với đúng lỗi SSH và điều kiện gỡ, không đổi target âm thầm.

## Ranh giới code

Được tạo/sửa:

- `app/src/main/migrate/**`, repository migration job và test;
- wiring constructor/IPC trong main, dùng đúng `MigrateInput`/`MigrateEvent` hiện có;
- `app/src/renderer/src/pages/MigratePage.tsx` + test để bỏ toàn bộ số/tên/tiến độ hard-code;
- CLI `app/scripts/a17-c04-live.ts`, scripts tsconfig nếu cần;
- helper dùng lại deploy precheck/render/build/health nhưng không copy hoặc sửa contract.

Không đổi schema 001/002, IPC contract, dependency, detector, ML, monitor/fault/auto rollback. Nếu
repository cần API mới nhưng schema đủ, thêm typed repository. Nếu contract thực sự thiếu field làm
luồng không thể đúng, ghi proposal và dừng phần phụ thuộc thay vì sửa contract âm thầm.

Không push/PR/merge/spawn subagent; giữ untracked của A và không log/download `.env` thành evidence.

## Thiết kế bắt buộc

### C04-1 — state machine và khóa

1. `MigrateService` xác thực app thuộc source VPS, source khác target, deployment current `running`.
2. Một app chỉ có một deploy/migrate active; dùng cùng app lock hoặc cơ chế tương đương có test race.
3. Tạo `migration_job`, phát event đúng thứ tự; mỗi step có timeout/cancel và luôn có terminal event.
4. Restart/crash không được tự đoán thành công. Job dở được hiển thị `failed/rolled_back` hoặc có
   recovery rõ; không replay lệnh destructive tự động.

### C04-2 — PREPARE, FREEZE, BACKUP

1. PREPARE chỉ đọc target trước khi tạo workspace: SSH/Docker, RAM/disk, port, source artifact size.
2. FREEZE dừng riêng container app nguồn, giữ PostgreSQL nguồn chạy; đo downtime bằng timestamp nguồn.
3. Archive source, compose metadata, dữ liệu file ngoài PostgreSQL và `.env` theo đường stream kín.
4. App `needs_db=1` dùng `pg_dump -Fc`. Không lấy tar của `data/pg` đang chạy làm bản restore.
5. Tính SHA-256 + byte size từng artifact; log chỉ metadata, không có secret/value `.env`.

### C04-3 — TRANSFER và RESTORE

1. Transfer nguồn → desktop → đích qua hai session SSH; không yêu cầu VPS kết nối trực tiếp.
2. Stream có backpressure, bounded memory, progress byte thực, temp name và atomic rename khi đủ.
3. Checksum đích phải khớp trước restore; partial file/reconnect không được nhận là hoàn chỉnh.
4. Restore source/non-DB files, render/build/deploy release đích bằng logic M4. Với PostgreSQL: khởi
   động DB đích healthy, restore dump, sau đó mới mở app.
5. Port đích do allocator cấp; URL/record chỉ cutover sau verify. Source app record vẫn là authoritative
   cho tới lúc confirm.

### C04-4 — VERIFY, confirm và abort

VERIFY phải lưu `verify_json` và hiển thị bảng Nguồn/Đích:

- SHA-256 và byte của artifact;
- file count/byte với volume file nếu có;
- row count từng bảng PostgreSQL khi có DB;
- marker nghiệp vụ trước migrate đọc được ở đích;
- runtime image/state/health và HTTP business probe;
- downtime tính từ nguồn.

Chỉ khi toàn bộ PASS mới bật nút xác nhận. `confirm(jobId, true)` cập nhật app sang target trong
transaction local, ghi completed/source_kept và giữ bản nguồn. `confirm(..., false)` là đường dọn nguồn
destructive nên không chạy trong demo nếu chưa có lệnh riêng của A. `abort` hoặc lỗi trước verify dọn
đích và start nguồn; verify lệch dừng đích, start nguồn, giữ artifact điều tra và không cho confirm.

### C04-5 — UI thật

1. Chọn app nguồn từ `app:list` và target từ `vps:list`; không cho chọn cùng VPS.
2. Precheck hiển thị số thật. Stepper/progress/log lấy từ migrate event, không timer giả.
3. Bảng verify render `verify_json`; không còn IP, app, row, checksum, downtime hard-code.
4. Nút back/cancel/confirm phản ánh state; accepted khác completed. Lỗi hiển thị step và cách phục hồi.
5. Sau confirm, Apps/History refresh và mở được URL đích.

## Ma trận test

| Case   | Kỳ vọng                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| C04-T1 | Stateless success: checksum/image/HTTP khớp, complete với source kept                       |
| C04-T2 | PostgreSQL success: checksum + row counts + marker + HTTP khớp                              |
| C04-T3 | Source=target, target port bận, thiếu disk/Docker bị chặn ở PREPARE, nguồn chưa đổi         |
| C04-T4 | SSH ngắt/partial transfer/checksum mismatch không restore partial; nguồn chạy lại           |
| C04-T5 | Build/restore/health fail dọn target vừa tạo, không xóa source/volume                       |
| C04-T6 | Verify mismatch không cho success/confirm; target dừng, source chạy, evidence giữ           |
| C04-T7 | Cancel/race deploy-migrate/double confirm/restart có kết quả idempotent, không lặp mutation |
| C04-T8 | UI dùng IPC/event thật; không còn mock data/progress/downtime                               |
| C04-T9 | Hai lượt live trên hai VPS thật đều success; app B không đổi                                |

## Gate

```text
app> pnpm exec vitest run --maxWorkers=1 <migrate/deploy/repository/ipc/UI focused files>
app> pnpm typecheck
app> pnpm exec tsc -p tsconfig.scripts.json --noEmit
app> pnpm exec eslint <changed-ts-tsx-files>
app> pnpm exec prettier --check <changed-code-doc-files>
app> pnpm build
```

Chạy regression deploy/detector của C03 vì RESTORE tái dùng M4. Collector tests chỉ chạy nếu compose/
collector contract bị chạm. ML pytest không chạy.

## Live run và evidence

Tạo `docs/evidence/tk-a17/c04/` gồm raw log scrubbed và hai báo cáo `stateless.md`,
`postgresql.md`; tạo `docs/tasks/tk-a17/handoff-c04.md`.

Mỗi lượt live ghi source/target profile ID, app/deployment/image/port, artifact name/size/checksum,
step duration, bytes transferred, source/target row/file counts, marker, HTTP, downtime, job status,
source-kept proof và final Docker/SQLite state. Ghi riêng failure attempt/retry. C04 chỉ
`READY_FOR_LOCAL_REVIEW` khi C04-T1…T9 đạt; Worker không mở C05.
