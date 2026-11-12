# R7a — SPA deep-link và template deploy thật

START 12/11/2026 — Base `b7163d9`, task-discipline. User yêu cầu tiếp tục hoàn thiện sản phẩm và checkpoint push. R7 còn local/Git ×3Tier1/Product parity/DB/env/custom Dockerfile; phiên này chọn lỗi concrete trong template static SPA: nginx mặc định không fallback client-side routes. Không mở Product template support khi backend còn Express-only, không dùng gate này đóng toàn R7.

| Yêu cầu | Gate / evidence | State |
|---|---|---|
| Tái hiện lỗi template hiện tại | Baseline recordeeda589b738b PASS2reproductions: root/JSasset200 nhưng client-route404; build thiếu dist/index.html vẫn thành công và nginx trả welcome200. Docker resources đã dọn đúng labels | PASS |
| Sửa SPA routing không che lỗi asset | Template self-contained/nginx-t: root/deep/query/HEAD đúng index, assetJS thật đúng MIME, missing asset404, index/fallback no-cache. Artifact thiếu index bị build từ chối với chính marker lỗi, không chấp nhận timeout/npm fail thay thế | PASS |
| Hai nguồn có proof thực thi | Final recorda29e9ec09854 PASS5checks: production source-tree/detect/render + folder/localGit fullSHA, actual Docker images/HTTP và actual sandboxed Chromium direct+reload. HTML/JS hashes hai nguồn bằng nhau; owned source/profile/snapshot/container/image dọn xong, no VPS/productionDB | PASS |
| Regression và handoff |135focused/3files, typesNode-Web-Scripts/lab, ESLint3/Prettier4/syntax2/build/negativeCLI/artifact hashes/diff/staged review đạt. Board/FR/master/HANDOFF/proof cùng checkpoint, Kim coauthor/normal push được phép; R7 tổng vẫn OPEN | PASS |

Giả định: phạm vi SPA chuẩn Vite dist và client routes cùng origin. Không thêm API proxy, env secret/build output tùy ý hoặc customDockerfile vào Product. Template nginx gói ngay trong Dockerfile để không tạo file transfer/IPC/schema mới hoặc bắt người dùng chép config thủ công.

UPDATE 12/11 — Docker Desktop ban đầu stopped, WSL chưa thấy daemon; đã start bằng supported Docker CLI, Linux daemon29.4.3/x86_64 sẵn dùng. Không sửa WSL integration hoặc Docker system config/prune. DECISIONS trước fix. Static Dockerfile đã thêm dist/index guard và generated nginx try_files/fallback, asset404/indexno-cache/nginx-t trong image build; native hai nguồn đang chạy. Không tự đổi registry detector hoặc mở Product khỏi Express-only.

UPDATE 12/11 — Native fixed-template run3d489af9ebf0 đã đạt2HTTP/source checks nhưng browserdriver timeout; minimal actual Electron probe xác minh top-level await-whenReady readyfalse/exit2 trong5s, thenbranch readytrue/exit0. Chuyển driver sang then, không sửa template/loại browser assertions để né lỗi; finala29e9ec09854 đạt5checks và exact missing-index failure marker. Baseline eeda trước fix và fd2d754683a2 từ readonly Git extraction đều tái hiện2lỗi, hash old template khớp exact predecessor. Không gọi failed driver run PASS hoặc suy mọi top-level await đều không được Electron hỗ trợ.

## Thay đổi và lệnh kiểm chứng

- `templates/static-spa.Dockerfile`: build phải tạo `/app/dist/index.html`; nginx config ngay trong image bằng single-quoted printf giữ `$uri`, client routing fallback/indexno-cache, missing `/assets/` hoặc declared static extensions404; `nginx -t` trong build. Không thêm file upload hoặc đổi API/schema/IPC/detector/renderer. Production caller source hashes giữ nguyên.
- `app/scripts/spa-template-lab.mjs` và `spa-template-lab/{subject.ts,browser.mjs,tsconfig.json,README.md}`: CLI production subject + actual folder/localGit→Docker/HTTP/browser; ownership labels/nonce/loopback/cleanup và bounded commands. Local fixture Git snapshot dùng same production acquisition export cho localfixture, không phải public GitHub live check.
- DECISIONS/task/board/FR/master/HANDOFF, sanitized proof và screenshot của private browser fixture; không commit source scratch/DB/model/key/images/binaries hoặc raw logs.

Từ repo root sau `. ./tools/enter-node22.ps1`:

1. `docker.exe desktop start --detach` → Linux daemon29.4.3/amd64 hoạt động. Trước đó daemon stopped/WSL Docker link không hoạt động; không giả lập Docker hoặc đòi VPS để né gate local.
2. `node app/scripts/spa-template-lab.mjs --baseline` → PASS2reproductions, original beforefix recordeeda589b738b; reproducible finalCLI recordfd2d754683a2 đọc exact `b7163d9:templates/static-spa.Dockerfile` qua Git readonly, không checkout/reset. Old template SHA `a3c5cf2585ddca71d7e316c71e733c46c104ed929e12b0c88ab07f24d8d0e4af`.
3. `node app/scripts/spa-template-lab.mjs --run` → finala29e9ec09854 PASS5checks/cleanuptrue. Hai actual images từ local/Git, query/deep/HEAD/indexno-cache/assetMIME/missingassets404; browser thực tải direct route và reload rồi chạy bundle đúng pathname/query. Missing-index build phải có exitcode dương và đúng dòng stdout/stderr của guard, không pass vì network/npm lỗi khác. New template SHA `bfb5c3e77b5af306f10ec46797b5777396a92be15bbee8aeea44ea999d7e9ba3`.
4. `pnpm.cmd --prefix app exec vitest run src/main/detectors/detectors.test.ts src/main/deploy/templates.test.ts src/main/deploy/pipeline.test.ts --maxWorkers=3` →135PASS/3files. Không thêm test chỉ so string lặp lại implementation; native images/browser kiểm trực tiếp hành vi đã fail ở baseline. Không rerun toàn Vitest vì application runtime unchanged và scope template có focused+native gates.
5. `pnpm.cmd --prefix app build` → PASS Node/Web types và production output. `pnpm.cmd --prefix app exec tsc -p tsconfig.scripts.json --noEmit` và `pnpm.cmd --prefix app exec tsc -p scripts/spa-template-lab/tsconfig.json` → PASS. ESLint3files/0errors/0warnings, Prettier4files và Node syntax2files → PASS. CLI thiếu explicit mode →REJECTED/exit2 trước scratch/Docker mutation.
6. `git diff --check`/staged source+raw hash/secret patterns/relative links → PASS trước commit. Docker ps/image ls theo r7a labels xác nhận0container/image còn lại; không prune shared base images/cache hoặc dừng daemon gây ảnh hưởng workload khác.

[Sanitized proof/source/raw hashes](../ui-redesign/r7a-verification.json); [ảnh browser sau direct-route reload](../ui-redesign/screenshots/r7a/r7a-spa-deep-route-reload.png); [runbook](../../app/scripts/spa-template-lab/README.md). Raw ignored logs `app/.out-scripts/r7a-*` và `spa-template-lab/{eeda589b738b,fd2d754683a2,3d489af9ebf0,a29e9ec09854}/`; .owner/result/build logs giữ, nguồn/context/snapshot/profile đã dọn.

## Giới hạn và tiếp theo

Đây là LOCAL_PASS source/template Docker+HTTP+browser, không full deploy wizard/Main/SSH/history/rollback, không Product registration/controller rollout hoặc VPS live. Git dùng local fixture/fullSHA, không claim public repository authentication hay branch-poll auto deployment. Scope Vite dist/root serving; custom output/basepath/API proxy/secret env, Next/Express/DB/customDockerfile và Product SPA parity có task/gate riêng. Asset404 áp dụng `/assets/` và các extension khai báo; client route khác fallback index. Không signed installer/Windows-clean/ML pilot claim. Installer0.2.0 và installed VPS controller trước đó chưa được build/upgrade với fix mới; evidence cũ không tự kéo sang source mới.

HANDOFF-LOCAL 12/11/2026 — DONE scoped R7a/CHỜ REVIEW;4ledger rows PASS, không accepted exceptions hoặc gate failing tự miễn. Implementation SHA tra `git log -1 -- templates/static-spa.Dockerfile`; Kim coauthor/normal checkpoint push theo quyền user, verify exact remote SHA, không PR/merge/reset/clean/stash/rebase. R7 tổng OPEN; tiếp Product template parity và remaining matrix theo master. Windows độc lập cho R11b vẫn chờ môi trường, không đổi trạng thái từ template gate này.
