# R3c-6h4 — Product exposure và live Electron

START10/11/2026 — Base `894fcfd`, product-mode/task-discipline. User yêu cầu tiếp tục. Được triển khai/lab/checkpoint commit/normal push; không PR/merge/reset/clean/stash/rebase. Giữ demo VPS167.71.202.116 hiện tại/auto paused; credential chỉ encrypted store hoặc hidden stdin/RAM.

| Yêu cầu tổng | Điều kiện nhận | State |
|---|---|---|
| Product exposure persistence | Canonical controller SQLite lưu current deployment evidence sau terminal settlement, current-authority/CAS/freshness/auth; backend/native đã kiểm chứng ở 6h4a, rollout VPS còn 6h4c | IMPLEMENTED |
| Independent observation | Probe từ Desktop Main ra public URL derived từ controller; renderer không nhập URL/evidence/secret; timeout/redirect/abort/stale rõ ràng, không làm rollback runtime healthy | OPEN |
| Electron flow | Typed IPC/UI4locale/current status và real isolated Electron profile onboarding/reconnect/firstdeploy; không fixtures thay backend live | OPEN |
| Deployment/upgrade | Controller đã pin không thay bytes/tool/key/DB ngầm; phiên bản cũ báo unsupported, upgrade/checkpoint rollback cần proof riêng trước live mutation | OPEN |
| Handoff | Gate phù hợp/ledger/board/FR/HANDOFF/master, Kim co-author/normal push, raw/sanitized evidence và giới hạn rõ | OPEN |

## Phân checkpoint / quyết định

- **6h4a (backend DONE / CHỜ REVIEW):** contract và controller exposure repository/API + native integration proof. Dùng deployment.exposure_status/exposure_evidence_json hiện có, không thêm schema khi không cần. Read-only context + explicit authenticated observation; scope `policy:write` để ghi, `read` chỉ đọc. Current deployment/runtime/generations/target security/config phải khớp trước và sau phép đo; reject khi chưa settled/đang activation. Chưa triển khai lên controller VPS.
- **6h4b:** Desktop Main independent probe + typed IPC/UI; real isolated Electron/native SQLite/profile, không production Desktop DB. Không generic target URL hoặc raw response body trong renderer/journal.
- **6h4c:** trusted installed-controller upgrade/recovery trước live new API; preserve controller identity/key/DB và demo, không thay pin cũ hoặc reinstall để né upgrade. R3 tổng vẫn mở đến khi đủ gates.
- H2v1 đang frozen và ký terminal runtime facts, chỉ cho `not_checked/degraded`. Không đổi receipt/signature/T1/T2 cho một observation xảy ra sau đó. Observation network là metadata hậu kiểm có scope/time; background service trên cùng VPS không chứng minh truy cập từ ngoài. Desktop tắt không được tự ghi reachable hoặc giữ nhãn xanh vô hạn.
- Chọn fixed authenticated controller API cho hậu kiểm; không dùng root Python SQL writer từ Desktop, không duplicated canonical Product history trên local DB. Server cũ chỉ unsupported cho tính năng mới; rollout giữ riêng với implement.

## Ledger6h4a

| Yêu cầu | Gate | State |
|---|---|---|
| Contract-first/DECISIONS | DTO/routes/security parity, latest-observation CAS tách command tombstones; không đổi H2v1/migration/dependencies; 8 TypeScript projects PASS | PASS |
| Repository | Derive canonical URL/current deployment; H2 hash/settlement/source/SSH revision/app name/host+container ports/health path fences; 23 focused repository tests PASS | PASS |
| HTTP composition | Bounded authenticated API, re-auth sau đọc body, scope read/policy:write, stable 409 errors; 6 HTTP tests + Linux authenticated HTTP/SQLite 5 checks PASS | PASS |
| Current-source proof | Focused29/full2076PASS+2Linux-onlySKIP/8types/11file lint/build PASS, native5PASS và private root removed=true | PASS |
| Handoff/checkpoint | Docs/ledger/FR/HANDOFF/master và sanitized proof đồng bộ; rà exact file scope/link/source/secret và diff sạch, checkpoint có Kim co-author/normal push theo quyền hiện hành; không PR/merge, parent 6h4b/6h4c còn OPEN | PASS |

## Nhật ký

- START10/11: tracked tree sạch tạị894fcfd; personal files giữ ngoài index. Đọc task-discipline/CLAUDE/board/H2/controller API/repository/exposure hiện hữu. Không mutate VPS trong discovery/design; đã chọn post-settlement observation để giữ signed receipt nguyên vẹn.
- UPDATE10/11: controller repository/strict schemas/GET+POST exposure đã implement; current H2 context/settlement/target/owner/generation fences và CAS, exact latest client/key replay, age30s/displayTTL60s. Scope `policy:write` re-auth sau async body; invalid/injected URL/secret/observer bị chặn. Client report là trusted-operator telemetry, không phải remote attestation hoặc server tự chứng minh vantage ngoài VPS.
- UPDATE10/11: early focused41, expanded HTTP/repository/client/read regression77 PASS. Native Linux HTTP/SQLite5checks PASS, lost response→GET exact observation, replay/CAS/targetchange và frozen H2/unchanged runtime; synthetic runtime/observer report, chưa probe Internet/VPS thật, temp root removed=true. Raw `app/.out-scripts/controller-exposure/e9500b3f8c74d4dc7889288b6cb5e68a/result.json`.
- UPDATE10/11: full discovery chạy lặp qua isolated demo worktree trong `.out-scripts/`; dừng riêng cây tiến trình test, không lấy số test này làm gate. Thêm exclude generated `.out-scripts/**` vào Vitest (không bỏ src/test nào), chạy lại gate current source. Demo worktree/files giữ nguyên, không reset/clean/stash; VPS không bị tác động.
- UPDATE10/11: bổ sung fence container_port/healthcheck_path ngoài host_port/app_name; cấu hình đổi trong lúc đo trả context unavailable/409, không ghi evidence cũ. Final current-source focused **29PASS**, full **2076PASS/2Linux-onlySKIP/0FAIL** trên155 test files (154PASS/1SKIP),8 TypeScript projects, ESLint11files và production build PASS. Native accepted receipt `app/.out-scripts/controller-exposure/601a98e4aba3ebe13e058407a9db82c4/result.json`:5PASS,root_removed=true. Receipt e950... trước đó giữ lịch sử, không thay accepted source gate cuối.

## Gate tái hiện 6h4a / evidence

Node22 qua `. ./tools/enter-node22.ps1`; chạy từ repo root trừ khi ghi khác.

- `pnpm --prefix app exec vitest run src/main/controlPlane/controllerExposure.test.ts src/main/controlPlane/controllerExposureApi.test.ts`:29PASS; raw `app/.out-scripts/r3c6h4a-focused-accepted.log`.
- `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4a-full-accepted.json`:2076PASS/2SKIP,212.63s; JSON/log trong `app/.out-scripts/`. Hai skips Caddy Linux-only đã có sẵn; không waive failure.
- Trong `app/`, `pnpm exec tsc --noEmit -p <project> --composite false` cho Node/Web/scripts và product-runtime/controller-release/controller-service/controller-bootstrap/controller-exposure lab:8/8 exit0; `app/.out-scripts/r3c6h4a-types-accepted.json`.
- ESLint11files backend/newlab/Vitest config:exit0,0warnings; `app/.out-scripts/r3c6h4a-lint-accepted.json` và `.log`. `node --check app/scripts/controller-exposure-lab/run.mjs` exit0.
- `pnpm --prefix app build`:exit0; `app/.out-scripts/r3c6h4a-build-accepted.log`.
- Linux native: `wsl -d Ubuntu --exec env OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules /home/everestt2806/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node /mnt/d/Developing/DuAnCNTT/app/scripts/controller-exposure-lab/run.mjs`:5/5PASS; accepted receipt ở trên, log `app/.out-scripts/r3c6h4a-native-accepted.log`.
- Native lab dùng **H2 repository finalize/settle thật với fixture synthetic**, authenticated HTTP/SQLite thật; deliberate lost POST reply→GET current exact observation, no retry-write, replay/CAS và changed-target reject. H2/runtime/policy không đổi. **Không có phép đo public network thật, Docker gate hoặc deployment mới** trong checkpoint này.
- `git diff --check`:PASS. Sanitized artifact: [6h4a verification](../ui-redesign/r3c6h4a-verification.json). Source SHA tra `git log -1 -- app/src/main/controlPlane/controllerExposure.ts` sau commit.

## Giới hạn / bước tiếp theo

- Installed controller/VPS/demo/pins/key/DB giữ nguyên; không SSH login hoặc VPS mutation trong 6h4a. Public `/health` kiểm tra chỉ đọc trả200. Push source hoặc build app không tự nâng cấp runtime VPS.
- Observation là báo cáo của Desktop operator được cấp quyền; server xác minh identity/scope/authority/CAS/time, không chứng minh vantage Internet từ chuỗi JSON. Physical independent probe phải thực hiện trong trusted Main ở **6h4b**.
- Generic ControllerHttpClient/typed IPC/UI chưa gọi route mới. **6h4b** cần typed read/observe với unknown→read-current (không command request lookup), Main derived safe public probe,4locale và real isolated Electron profile/native SQLite/reconnect/firstdeploy. Controller cũ phải hiện unsupported, không fallback ghi SQL/root.
- **6h4c** safe installed-controller upgrade/recovery cần checkpoint riêng trước live new-API rollout; preserve identity/key/DB/demo và rollback, không đổi pin của install cũ hoặc reinstall để né.
- Python/ML/Ruff/UI screenshots N/A cho backend6h4a; không có accepted exception. R3 tổng và parent6h4 chưa DONE; task giữ CHỜ REVIEW đến review/merge.
- HANDOFF-LOCAL10/11:6h4a backend scope DONE, các gate bắt buộc PASS/N/A như ledger. Commit theo exact paths và normal push branch hiện hành, xác minh remote SHA; không claim parent6h4/installed VPS rollout hoàn tất. Full test discovery lặp trước đó không được dùng làm evidence.
