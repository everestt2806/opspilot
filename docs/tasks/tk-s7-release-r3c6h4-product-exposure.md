# R3c-6h4 — Product exposure và live Electron

START10/11/2026 — Base `894fcfd`, product-mode/task-discipline. User yêu cầu tiếp tục. Được triển khai/lab/checkpoint commit/normal push; không PR/merge/reset/clean/stash/rebase. Giữ demo VPS167.71.202.116 hiện tại/auto paused; credential chỉ encrypted store hoặc hidden stdin/RAM.

| Yêu cầu tổng | Điều kiện nhận | State |
|---|---|---|
| Product exposure persistence | Canonical controller SQLite lưu current deployment evidence sau terminal settlement, current-authority/CAS/freshness/auth; backend/native đã kiểm chứng ở 6h4a, rollout VPS còn 6h4c | IMPLEMENTED |
| Independent observation | Main probe public IP/DNS pinned socket + typed API/IPC/UI; Linux và Electron đo thật tới demo public, final6h4b gates PASS; installed-controller persistence còn6h4c | PASS |
| Electron flow | Typed IPC/UI4locale/exposure và cold isolated Electron native SQLite đã kiểm chứng; onboarding/reconnect/firstdeploy end-to-end với installed runtime mới chuyển sang live gate6h4c sau trusted upgrade | IMPLEMENTED |
| Deployment/upgrade | c-1/c-2a/c-2b1 backend PASS; c-2b2 Settings upgrade/runtime binding và c-2b3 same-machine SSH authority epochs/readded VPS/native16/Electron6+19ảnh PASS. C-3 live upgrade/exposure/onboarding/reconnect/firstdeploy còn mở, VPS vẫn bản cũ | IMPLEMENTED |
| Handoff | Gate phù hợp/ledger/board/FR/HANDOFF/master, Kim co-author/normal push, raw/sanitized evidence và giới hạn rõ | OPEN |

## Phân checkpoint / quyết định

- **6h4a (backend DONE / CHỜ REVIEW):** contract và controller exposure repository/API + native integration proof. Dùng deployment.exposure_status/exposure_evidence_json hiện có, không thêm schema khi không cần. Read-only context + explicit authenticated observation; scope `policy:write` để ghi, `read` chỉ đọc. Current deployment/runtime/generations/target security/config phải khớp trước và sau phép đo; reject khi chưa settled/đang activation. Chưa triển khai lên controller VPS.
- **6h4b (Desktop feature DONE / CHỜ REVIEW):** Main independent probe + typed IPC/UI4locale, real isolated Electron/native SQLite cold profile và actual public HTTP; synthetic runtime/private controller API với SSH transport adapter. Không production Desktop DB/live controller mutation. Actual full onboarding/reconnect/firstdeploy chuyển sang live gate6h4c sau trusted upgrade.
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

## Ledger6h4b

START10/11 — Base `48103cc`, tiếp trusted Desktop probe/client/IPC/UI. Không rollout runtime VPS trước gate upgrade6h4c; Electron live end-to-end phụ thuộc phiên bản controller hỗ trợ exposure.

| Yêu cầu | Điều kiện nhận | State |
|---|---|---|
| Typed client/contract | Strict fixed routes/DTO/body hash/correlation và separate unknown next-step; client/Main tests +8types và2canonical/shared AST parity checks PASS, unsupported không fallback | PASS |
| Main independent probe | Public-unicast/pinned numeric socket/no redirect/secret/body/max8s; native Linux8checks và Electron5checks đo public HTTP thật, local binding fences PASS | PASS |
| IPC/UI | IDs-only typed channels/metadata generations/TTL60s/unknown/4locale/late responses; UI11focused và actual Electron5checks/12ảnh PASS, không còn nhãn loading làm đổi accessible name | PASS |
| Verification | Final full2136PASS/2Linux-onlySKIP/0FAIL,8types/lint21/build/2AST checks; native8/public HTTP và Electron5/12ảnh PASS,0renderer errors/private DB cleanup | PASS |
| Handoff | Ledger/board/FR/HANDOFF/master/sanitized proof đồng bộ, source/diff/secret scope rà soát; checkpoint có Kim coauthor và normal push theo quyền hiện hành, không PR/merge | PASS |

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
- START6h4b10/11: `48103cc` đã push/remote khớp. Nối typed client read/observe, strict response cross-field/hash correlation và separate unknown next-step, Main stable binding/cipher scope check; shared DTO chỉ IDs vào, không generic URL/body/secret.
- UPDATE6h4b: focused179PASS/10files (trước thêm initial-read guard test). Main numeric public-unicast connect sau resolve/validate all answers, không DNS lần hai/redirect/credential/body; max8s (tối đa10s), max8KB headers và hủy socket. UI không probe định kỳ, chỉ TTL ticker; metadata/source generation mismatch không xanh. Saved observation có thể từ Desktop khác nên scope copy không khẳng định máy hiện tại là observer của mọi kết quả đã lưu.
- UPDATE6h4b: native Linux8checks PASS (`98978608b7a60040139435fb5017ed13`), cold profile/encrypted vault, real public HTTP tới VPS167.71.202.116:30000, real client/auth API/SQLite và deliberate lostreply→GETexact, no second POST/H2 mutation; transport SSH được thay bằng loopback adapter trong lab, runtime evidence synthetic. Temp root removed=true, không ghi live VPS/controller DB.
- UPDATE6h4b: real Electron39.8.10/private native SQLite cold reopen/Main service/production preload/typed IPC/production renderer feature đã qua5checks/12ảnh tại `app/.out-scripts/controller-exposure-electron/8863f52e5affdb90/result.json`; public probe thật, lostreply/read-only recovery và old-server response,0renderer errors/private DB removed. Có thay SSH transport bằng TCP adapter tới private loopback API; không dùng mocked IPC thay Main/backend. UI chỉnh scope copy sau proof này, cần capture accepted source cuối trước handoff.
- UPDATE6h4b: sửa harness initialize WAL trước migration theo production initialization; lần development-renderer capture báo AntD/React compatibility warning, đổi harness sang `NODE_ENV=production` như app build, không lọc/waive error. Guard nút check đến khi initial read xong được kiểm thử riêng. Early scripts gate TS6059 do shared import canonical type ngoài rootDir; chuyển sang shared copy theo pattern repo, scripts gate sau sửa PASS.
- UPDATE6h4b: full run đầu vừa chạy cùng type/build/Electron có4UI failures; chưa lấy làm gate cuối hoặc kết luận root cause. Dừng đúng cây Vitest PID33004 đã xác minh command/path (không filesystem cleanup/không đụng service), vì source UI có sửa trong quá trình chạy. Gate cuối chạy fresh current source riêng với maxWorkers2, không tăng timeout hoặc skip test.
- UPDATE6h4b: accepted Electron current-source `app/.out-scripts/controller-exposure-electron/ce83a2a4638a922e/result.json`:5checks/12ảnh PASS,0renderer errors,actual_network_probe_performed=true/private_db_removed=true; screenshot đã xem trực tiếp. Bốn locale vi/en/cn/jp, dark/light,1280×800 và1366×768; unknown vàunsupported có ảnh riêng. SSH bridge vẫn adapter/private synthetic runtime, không phải live installed-controller/firstdeploy proof.
- UPDATE6h4b: full maxWorkers2 đạt2135PASS/2SKIP nhưng1test mới FAIL: accessible name của nút tải kết quả có prefix `loading` trong animation leave của AntD. Không phải lỗi quyền đọc/IPC; DOM evidence chỉ rõ nút enabled và kết quả đọc đúng. Thêm `aria-label` cố định theo locale cho nút (không nới expectation/timeout/skip); focused UI11PASS. Full này giữ làm diagnostic, không gate accepted.
- UPDATE6h4b:8type projects final (`r3c6h4b-types-final.json`)/lint21files/build accepted PASS. Final Electron trên source có aria-label `app/.out-scripts/controller-exposure-electron/2f6d20b9b60e41a5/result.json`:5PASS/12ảnh/0renderer errors/private DB removed. Final native Linux `app/.out-scripts/controller-exposure/f4d44274cc4ce59d000de9fc04ea63cb/result.json`:8PASS/public HTTP thật/root removed; transport adapter và synthetic runtime vẫn ghi riêng. Đang chạy full final với maxWorkers4 sau khi build/Electron kết thúc, giữ timeout/test set gốc.
- HANDOFF-LOCAL6h4b10/11: full final **2136PASS/2Linux-onlySKIP/0FAIL**,157filesPASS/1SKIP,227.26s. Các lỗi UI lượt đầu không tái hiện; lỗi accessible name mới đã sửa và gate toàn bộ đạt. Không có accepted exception hoặc bỏ test. 6h4b DONE đúng phạm vi Desktop feature, task CHỜ REVIEW; parent6h4/R3/live upgrade tiếp tục mở. Source SHA tra `git log -1 -- app/src/main/controlPlane/desktopExposure.ts`; normal push branch hiện hành được phép, không PR/merge.

## Gate tái hiện6h4b / evidence cuối

- `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4b-full-final.json`:2136PASS/2SKIP/0FAIL. Log `app/.out-scripts/r3c6h4b-full-final.log`;10focused files đều nằm trong full accepted này. UI focused11PASS trong `app/.out-scripts/r3c6h4b-ui-accepted.log`.
- `pnpm --prefix app exec tsc --noEmit -p <project> --composite false`:8projects như6h4a, tất cả exit0; `app/.out-scripts/r3c6h4b-types-final.json` và các log cùng prefix. Shared canonical copies đã qua2AST parity checks, `r3c6h4b-contract-parity.json`.
- ESLint21files hiện hành exit0/0warnings, `app/.out-scripts/r3c6h4b-lint-accepted.json/.log`; `pnpm --prefix app build` exit0, `r3c6h4b-build-accepted.json/.log`. `node --check app/scripts/controller-exposure-lab/run.mjs` và `electron.mjs`:PASS.
- Linux command như6h4a thêm `--desktop-public-probe`:8/8PASS; raw accepted `controller-exposure/f4d44274cc4ce59d000de9fc04ea63cb/result.json`, log `r3c6h4b-native-accepted.log`. Private Linux DB/cipher cold reopen, actual Main/client/auth API và Internet HTTP, không H2/runtime mutation, root_removed=true.
- `pnpm --prefix app exec electron scripts/controller-exposure-lab/electron.mjs`:5/5PASS,12ảnh,0renderer errors; raw accepted `controller-exposure-electron/2f6d20b9b60e41a5/result.json`, log `r3c6h4b-electron-final-accepted.log`. Actual production preload/typed IPC/Main service/native SQLite cold profile/production renderer component và public HTTP; private_db_removed=true. Ảnh đã xem dark/light/unknown, không cuộn ngang ở2kích thước.
- [Sanitized proof/source và screenshot hashes](../ui-redesign/r3c6h4b-verification.json); [12ảnh Electron](../ui-redesign/screenshots/r3c6h4b). Không commit raw DB/token/profile/build output. Python/ML/Ruff/Docker deployment N/A vì scope không thay các module này. Không có schema/dependency/H2 change.
- VPS demo/controller service/pins/key/DB không bị sửa. Public GET không phải live installed API/write hoặc whole-product proof. Tiếp6h4c trusted upgrade + actual live onboarding/reconnect/firstdeploy/exposure persistence.

## Sử dụng tính năng6h4b

1. Mở **Settings → Controller**, chọn kết nối Product đang hoạt động và chọn app trong phần thao tác triển khai.
2. Tải trạng thái app hiện tại. Phần **Kiểm tra truy cập ngoài** tự đọc kết quả đã lưu; nút **Kiểm tra truy cập** mới thực hiện phép đo từ Desktop đang mở. Không đo nền hoặc theo timer.
3. Kết nối cần scope `policy:write` để đo/ghi; scope `read` chỉ tải kết quả. Renderer chỉ gửi `binding_id/app_id`, không nhận SSH/API token, không tự nhập URL/evidence.
4. Kết quả ghi rõ bản triển khai/URL/thời điểm/HTTP status. Nhãn xanh hết hiệu lực khi quá60s, metadata không còn current hoặc selection/binding/deployment/generation đổi. Kết quả có thể do Desktop khác ghi; không khẳng định đường mạng của mọi người dùng giống nhau.
5. Khi outcome unknown, Main chỉ GETcurrent một lần để khớp ID/body/authority/client. Không khớp/không đọc được thì hiển thị chưa xác nhận; người dùng có thể tải kết quả hiện tại. Không tự POST lại hoặc dùng command lookup.
6. Controller phiên bản cũ báo **chưa hỗ trợ/cần nâng cấp**, không sửa SQLite qua root hoặc fallback executor. Bản đã cài trên VPS vẫn cũ; cần6h4c trusted upgrade/live gate trước khi gọi tính năng mới trên controller thật.

## Tiêu chí bàn giao sang6h4c

- Upgrade là intent mới có parent installation UUID/authority revision và old/new release pins riêng. Giữ journal/pin cũ để inspect/recover; không ghi đè catalog/install receipt cũ hoặc reinstall cùng UUID với bytes mới.
- Preserve controller identity, service UID, private SQLite/key, enrolled target/HMAC/profile và demo container. Current profile/cipher/SSH/principal/release phải được kiểm tra trước mutation; không tự cấp token hoặc rebind khi authority đã đổi.
- Drain/stop riêng controller service, bảo toàn app traffic, verified staging/unit switch/start/status và rollback/recovery theo phase. Không rollback schema hoặc replay unknown deployment mù. Target helper/profile compatibility và signed H2v1 phải được kiểm chứng với release mới.
- Cần Linux systemd/native crash/lostreply/cold recovery proof trước development VPS rollout. Sau rollout mới chạy actual installed API persistence và Electron isolated-profile reconnect/readiness/firstdeploy/live exposure gate. Source push/app build không thay các gate này.
