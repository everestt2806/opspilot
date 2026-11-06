# R3c-2 — GitHub HTTPS and installed systemd execution

START 06/11/2026 — Base `9dc3525` đã push, R3c-1 local gates PASS. User tiếp tục cho phép checkpoint pushes; không PR/merge, không production VPS/DB write. Dùng task-discipline.

| Yêu cầu | Gate | State |
|---|---|---|
| Public GitHub không adapter/mock | Actual public HTTPS ls-remote/fetch/detached root `demo-apps/san-nha-booking`, first SHA `9dc35252bd51cf79f181ed546ce3f67748d5dcdd` | PASS |
| Installed systemd thật | Unit `opspilot-lab-6fb8a645ce26.service`, copied Node22/native deps/private bundle/data, actual PID157547→158246 | PASS |
| Git push → deployment → settled record | First public deploy T1/T2 PASS; chờ checkpoint harness được push để quan sát SHA thứ hai | IMPLEMENTED |
| Restart không duplicate/runtime replay | Actual systemctl restart, public poll thêm35s, giữ app/collector ID/image/StartedAt/restarts, đúng1job | PASS |
| Cleanup và checkpoint push | Harness syntax/ESLint/diff clean; resource cleanup chờ run hoàn tất, staged explicit files; first harness checkpoint push | IMPLEMENTED |

## Giới hạn

- Linux WSL systemd + Docker lab, không VPS production hoặc remote network firewall/HTTPS acceptance.
- Unit chạy root trong scratch lab vì target SSH fixture root; chưa nhận non-root installer/distribution gate. Hardening PrivateTmp/ProtectSystem/ProtectHome/NoNewPrivileges thực; bundle Node22/deps private được copy ra `/opt` nonce để không dựa cache path khi runtime chạy.
- Public repo/branch đã user cho phép push. Không tạo repo/branch ngoài phạm vi hoặc dùng credential trong remote URL. Không thay protocol Git production.
- Đăng ký control/source trong scratch fixture, không suy đây là UI enrollment đã hoàn tất. Không disable enrollment/pin/admission để qua gate.

No accepted exception.

## Checkpoint R3c-2a — harness và evidence bước đầu

- UPDATE/HANDOFF-LOCAL 06/11: harness `public-git-systemd.mjs` + preload dùng real installed `run-product`, không `execution-service-git-fixture`. Repo HTTPS lấy branch đang phát triển đã được user cho phép push. Controller/private data tại `/var/lib` và bundle/Node22/native deps tại `/opt` chỉ nonce; hardening không phụ thuộc `/var/tmp` hoặc home của dev.
- Progress `app/.out-scripts/public-git-systemd/da0b2dd098e8/service.json`: `first_deployment_settled=true`, `restart_no_duplicate=true`, `health=ready`; firstpublicSHA nêu trên, 1job; `/health`200 + trang HTML tải được. Không gọi đây là toàn bộ gate PASS khi SHA thứ hai và cleanup chưa có.
- Chốt harness checkpoint CHỜ REVIEW, cho phép push để tạo lần thay đổi Git thực có nội dung; run tiếp tục quan sát và ghi second SHA/settlement/cleanup. Không dummy commit hoặc thay response Git.
- `Node22 node --check` cả2MJS và scoped ESLint `--max-warnings=0` PASS. Không đổi runtime production sau R3c-1; full1537 PASS/2SKIP/types/build và R1/R3b7/7 ở checkpoint9dc3525 là evidence nền, không thay final systemd gate.
