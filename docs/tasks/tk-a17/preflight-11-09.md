# Khảo sát đầu vào 11/09 — chưa nghiệm thu C00

A yêu cầu Leader lập kế hoạch chi tiết để giao Worker. Trước khi nhận chỉnh hướng này,
phiên đã khảo sát môi trường C00; không có implementation C01 trở đi. File này giữ ngữ cảnh
cho Worker, không thay `handoff-c00.md` hoặc verdict của Leader.

## Git và phạm vi

- Code baseline `683bfc6`; plan HEAD ban đầu `ac6d8cd74204d66ba9122ca615876480808572e4`.
- Đã tạo nhánh `feat/a17-demo-checkpoint` từ plan HEAD; Worker kiểm tra HEAD hiện tại,
  không tạo lại hoặc checkout lùi làm mất cập nhật kế hoạch 11/09.
- Source `app/` và `collector/` không đổi trong khảo sát; không sửa contract, pipeline,
  renderer, ML hoặc deploy app lên VPS.
- Untracked của A: `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png`; stash hiện có giữ nguyên.
- Có helper `tools/a17-c00-{native,boot}.cjs`, `tools/a17-c00-inventory.py` và raw evidence
  `docs/evidence/tk-a17/c00/` local chưa commit/review. Worker cần kiểm tra chúng trước sử dụng;
  nếu checkout khác không có thì tái hiện theo C00, không mặc định các artifact được phát hành.

## Quan sát đã chạy trên máy A

Ngày địa phương 11/09/2026 (Asia/Bangkok); log UTC thuộc tối 10/09.

| Kiểm tra | Command/cwd hoặc nguồn | Quan sát |
| --- | --- | --- |
| Node 22 | root: `. ./tools/enter-node22.ps1`; `node --version` | v22.23.2; executable `%LOCALAPPDATA%/pnpm/bin/node.exe`; ABI 127 |
| pnpm | `pnpm --version` | 11.1.0 |
| Python venv | `ml-service/.venv/Scripts/python.exe` | 3.12.10; pytest 9.1.1 |
| Native DB | helper native, DB `:memory:` | Node 22, Electron-as-Node và Electron GUI đều query SQLite exit 0; SQLite 3.53.4 |
| Electron | binary trong dependency đang cài | 39.8.10; Node nhúng 22.22.1; ABI 140; không cần rebuild trong lượt khảo sát |
| Focused | cwd app: `pnpm exec vitest run --maxWorkers=1 src/main/deploy src/main/monitor` | 12 files, 64/64, exit 0 |
| Collector | cwd collector: `../ml-service/.venv/Scripts/python.exe -m pytest tests -q` | 26/26, exit 0 |
| Typecheck | cwd app: `pnpm typecheck` | node + web exit 0 |
| Build | cwd app: `pnpm exec electron-vite build` | exit 0; 3045 renderer modules; chưa phải installer smoke |
| Boot | helper load `app/out/main/index.js`, dùng profile A | Renderer OpsPilot và IPC chạy; ML status running, version 0.1.0; kết thúc bình thường |
| Chụp/quay | Electron capturePage + CDP screencast | Có PNG và 1 screencast frame; **chưa có video demo**. Viewport đo thực 1367×769 do scale; tên ảnh có 1366×768 không phải proof đúng pixel |
| Local DB | SQLite `mode=ro`, chỉ allowlist cột không secret | VM02 id=2, user deploy/key; app count=0; experiment running=0 |

## VPS và đường trình chiếu

- VM02 `221.121.1.80:22`, user `deploy`, khóa dự án A `~/.ssh/opspilot_ed25519`:
  SSH thành công với `BatchMode=yes`, `StrictHostKeyChecking=yes`, `IdentitiesOnly=yes`.
  Không thay trust/known_hosts hoặc in credential.
- Docker 29.7.2, Compose v5.5.0; RAM khả dụng khoảng 3,2 GB, disk khả dụng 31.725 MiB.
- App B `express-demo-app` và `express-demo-collector` chạy từ 08/09, restart count 0;
  workspace `/opt/opspilot/express-demo`, network `express-demo_default`, port 30001.
  GET `/health` từ VPS trả 200, JSONL đang tăng. Không sửa/restart/stop các container này.
- Ref B6 `origin/feat/m05-collector-docker@dfc0ed7` có báo cáo; `git merge-base --is-ancestor
  dfc0ed7 HEAD` trả 1. Không merge/cherry-pick report.
- Manifest **đề xuất, chưa duyệt**: VM02 id=2, slug `a17-notes-0911`, workspace
  `/opt/opspilot/a17-notes-0911`, prefix container/network cùng slug. Chưa có path/container/
  network trùng lúc kiểm tra. `app_id`, deployment IDs và host port chưa được cấp;
  C01 lấy từ allocator/service sau khi C00 được duyệt, không hardcode 30000.
- Không thấy process `run_experiment.py` trên VM02; đây cùng DB read-only là kiểm tra
  tại thời điểm khảo sát, phải xác minh lại trước live mutation.
- VM01 TCP/22 timeout; chưa thử được auth/host-key vì chưa kết nối TCP, không kết luận
  credential VM01 sai. VM02 là target dự kiến theo plan, không yêu cầu sửa VM01 để làm demo.
- Public `http://221.121.1.80:30001/` timeout (curl exit 28). Tunnel loopback
  `127.0.0.1:39011 → VM02:127.0.0.1:30001` cho health 200 và Chrome headless chụp website
  thành công. Đó là website hiện hữu của B, **chưa phải website ghi chú A17**.
- Tunnel khảo sát đã đóng trong `finally`; process Electron khảo sát đã thoát. Không chạy
  fault/deploy/rollback hoặc thay cấu hình VPS. ML được app cleanup khi thoát.

## Worker cần hoàn thiện ở C00

1. Kiểm tra HEAD, artifact local và commands; raw logs là evidence khảo sát của phiên trước,
   không gán thành test do Worker tự chạy. Tái chạy phần thiếu hoặc trạng thái đã thay đổi.
2. Đối chiếu script/log: đã có lỗi quoting PowerShell và CRLF khi gửi shell qua stdin,
   lần chạy sau dùng Python byte stdin LF thành công. Giữ failure/correction trung thực.
3. Hoàn thiện `baseline.md`, `manifest.md`, mapping C00-T1…T5, executable paths, exact exits,
   commands/cwd, raw logs đã kiểm tra secret và trạng thái môi trường sau test.
4. Xác nhận khả năng mở website/browser để A trình chiếu và ghi giới hạn public access;
   ảnh hoặc một screencast frame chưa hoàn thành yêu cầu video C09.
5. Chỉ stage/commit artifact C00 cần thiết sau rà soát; cập nhật board/task/sổ bàn giao,
   tạo `handoff-c00.md` rồi bàn giao review. C00 hiện **PENDING**, C01 chưa được mở.
