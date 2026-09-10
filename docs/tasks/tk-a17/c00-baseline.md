# C00 — Môi trường chạy được và target rõ ràng

## Đầu vào và giới hạn

Đọc [task chung](../tk-a17-demo-checkpoint.md), A15/A16 handoff, B4/B5/B6 task và
`docs/09-moi-truong-dev.md`. Chưa cần triển khai tính năng; VPS chỉ kiểm tra read-only.
Baseline source đã kiểm tra `683bfc6`; plan commit được kế thừa riêng, không coi là code mới.
Khảo sát 11/09 đã có một số kết quả local tại [preflight](preflight-11-09.md).
Worker kiểm tra artifact/HEAD rồi hoàn thiện hồ sơ chặng; khảo sát chưa thay review C00.

## Các bước Worker làm

1. Ghi git branch/base/HEAD/status/stash list, tạo/tiếp tục nhánh Worker đúng task chung.
2. Tìm Node 22, pnpm và Python venv hiện có; ghi executable path và version. Xác minh
   better-sqlite3 chạy được trong test/CLI và Electron; phân biệt ABI của từng runtime.
3. Chạy focused suite deploy/monitor, collector pytest, typecheck bằng lệnh thực tế;
   ghi stdout/stderr/exit code. Lỗi baseline phải có cách tái hiện, không chỉ lấy log cũ.
4. Đọc report B6 trên ref `origin/feat/m05-collector-docker` nếu còn; kiểm tra ancestry.
   Không tự merge/cherry-pick nhánh B chỉ để đưa report về.
5. Kiểm tra SSH/host key bằng cấu hình của A, Docker/Compose, RAM/disk, port, containers,
   workspace đã tồn tại và experiment running. Không in private key/DSN/.env.
6. Chọn target/app slug riêng chưa bị chiếm, ghi manifest dự kiến: VPS, user, đường dẫn,
   app/container/network prefix; port sẽ do allocator/service xác định ở C01.
7. Xác nhận luồng chạy Electron, mở website và khả năng chụp ảnh/video; chưa cần UI mới.

## File được sửa

Docs/evidence, script kiểm tra read-only nếu cần, sửa môi trường local trong scope setup.
Không sửa pipeline/collector/ML/renderer để “tiện chuẩn bị” ở chặng này.
Sửa code baseline nếu buộc phải làm thì tách finding/proposal cho Leader; không mở rộng im lặng.

## Case và DoD

- [ ] C00-T1: Node 22 + Python venv + native DB xác minh được bằng command, exit 0.
- [ ] C00-T2: focused deploy/monitor + collector pytest + typecheck có log/count/exit.
- [ ] C00-T3: SSH read-only thành công, Docker/Compose và tài nguyên đủ kế hoạch.
- [ ] C00-T4: manifest không trùng app B; experiment không bị tác động.
- [ ] C00-T5: app boot được; link/entry hiện tại và giới hạn public access ghi rõ.

## Evidence và review

Tạo `docs/evidence/tk-a17/c00/baseline.md`, `manifest.md`, log đã bỏ secret;
`docs/tasks/tk-a17/handoff-c00.md`. Ghi trạng thái VPS giữ nguyên sau kiểm tra.
Leader review interpreter/ABI, target ownership, baseline failures và quyền thực thi C01.
Thiếu SSH hoặc môi trường chưa chạy: BLOCKED, không đánh live PASS. Có thể chuẩn bị test plan
nhưng không code C01. Xong C00 dừng; chỉ C00 APPROVED mới mở C01.
