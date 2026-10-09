# TK-S7 C3a — giữ và kiểm tra environment khi redeploy app hiện có

**Trạng thái:** `CHỜ REVIEW` · **Branch:** `feat/deploy-reachability` · **Ngày bắt đầu:** 10/10/2026.

## Mục tiêu

Cho phép redeploy app đã chạy mà không tải secret về renderer hoặc buộc người dùng nhập lại giá trị đang được giữ trên VPS. Precheck phải xác minh tên các khóa bắt buộc bằng giá trị explicit hoặc `.env` hiện tại; pipeline giữ toàn bộ env hiện hữu, chỉ áp dụng override nonblank đã nhập rõ, không tự xoay credential PostgreSQL. App mới tiếp tục tạo cặp PostgreSQL ngẫu nhiên an toàn như hiện tại.

## Phạm vi

- DeployService, DeployPipeline, helper env/template và test liên quan; wizard `DeployPage`, test và strings EN/VI/ZH/JA; task/board.
- Không đổi IPC/schema/DB, không thêm dependency. Không dùng VPS thật, không chạy lệnh SSH thật, không deploy. Secret trong test chỉ là fixture giả.
- Precheck remote `.env` qua `SshManager` pinned, không gửi/ghi giá trị vào IPC/event/DB/log; lỗi đọc phải fail closed và chỉ nêu key names/trạng thái an toàn.
- Với app đã có current deployment: ô env để trống nghĩa là thử reuse từ `.env` sau khi precheck xác nhận; checkbox review là bắt buộc. Giá trị nonblank của khóa không thuộc cặp DB là override tường minh.
- Với app cần PostgreSQL: giữ `DATABASE_URL` và `POSTGRES_PASSWORD` hiện hữu; không tạo cặp mới hoặc ghi `.env` nếu không xác minh đủ cặp. Không cho override một phần hoặc xoay cặp credential trong redeploy thông thường.
- Pipeline tự kiểm tra lại trước upload/render để direct start hoặc thay đổi `.env` sau precheck không làm ghi cấu hình thiếu/không xác minh.

## Nghiệm thu

- Test existing local/Git: retained secret, explicit non-DB override, missing key/file, remote read failure, DB pair protection, direct-start/midflight fail-closed.
- Test secret giả không lọt IPC result, deploy event, DB/action log hoặc app log; test new-app DB generation regression và precheck stale.
- Wizard existing deployed app cho phép required env blank; app mới vẫn yêu cầu input ngoài `DATABASE_URL` tự sinh; notice và xác nhận rõ ở 4 locale.
- Node 22 focused/full relevant Vitest, Node/Web/Scripts typecheck, lint, build và `git diff --check`.

## Nhật ký

- START 2026-10-10: đọc CLAUDE, DECISIONS, IPC/deploy event contract, roadmap, M04 prompt và task-discipline. Không thấy cần đổi contract; Leader xác nhận giữ task tập trung vào hiện diện key và preservation đầy đủ, DB pair không override. Worktree có sẵn untracked `.agents/`, `SKILL.md`, `run.ps1`, `start-opspilot.bat`; giữ nguyên.

- GATE 2026-10-10 (Node v22.23.3; pnpm script Node v22.23.3): focused deploy + DeployPage Vitest PASS, 11 files / 185 tests; Node/Web typecheck PASS (also run by build); scripts TypeScript PASS; lint PASS with 0 errors and 18 Prettier warnings; Electron Vite build PASS; `git diff --check` PASS. An initial typecheck found C3a fixture/narrowing issues; fixed and all final gates above rerun successfully. No VPS access/deploy; all secrets are mock fixtures.

- IMPLEMENTATION COMMIT: `b035bae` (local only).
