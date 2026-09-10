# Review C00 — APPROVED

- Reviewer: Leader (Codex/root), 11/09/2026, review 01.
- Code baseline: `683bfc6`; plan kế thừa: `bf951f9`; Worker code/artifact HEAD: `d4ec3be`.
- Worker docs HEAD được review: `23cd248` (sau `adfd3f8`). Hai commit sau code HEAD chỉ
  sửa handoff, không sửa helper hoặc source sản phẩm.
- Verdict: **APPROVED cho C00**. Không có BLOCKER/MAJOR. Hai lỗi hồ sơ MINOR đã sửa
  trong commit review; một giới hạn helper được chấp nhận theo phạm vi C00 bên dưới.
- Chặng được mở để A giao Worker: **duy nhất C01** theo [file C01](c01-collector-deploy.md).
  Reviewer chưa thực hiện C01; C02–C09 tiếp tục đóng theo chuỗi review. Chưa DEMO_READY.

## 1. Scope và kiểm tra độc lập

`git merge-base --is-ancestor bf951f9 d4ec3be` exit 0. Diff `bf951f9..23cd248` chỉ gồm
helper C00, evidence và task docs. Diff `683bfc6..23cd248 -- app collector ml-service templates`
rỗng; không có tính năng downstream được đưa lẫn vào C00. Stash và ba mục untracked của A
còn nguyên. Ref B6 `dfc0ed7` không phải ancestor của HEAD (exit 1); không merge báo cáo B.

Reviewer đọc toàn bộ ba helper, baseline/manifest, raw logs và hai ảnh. Kiểm chứng mới
lưu **riêng** tại [review-01](../../evidence/tk-a17/c00/review-01/); không ghi đè evidence Worker.
Mỗi JSON command có cwd, UTC, exit, stdout/stderr; SSH có cả script stdin LF để tái hiện.

| Case | Reviewer tự chạy/kiểm tra | Kết quả và bằng chứng |
| --- | --- | --- |
| C00-T1 | Node path/version, Python venv; query DB memory trong Node, Electron CLI và GUI | Tất cả exit 0; Node 22.23.2/ABI 127, Python 3.12.10, Electron 39.8.10/ABI 140, SQLite 3.53.4. `review-01/{node,python,native-node,native-electron-cli,native-electron-gui}.json` |
| C00-T2 | Vitest `--maxWorkers=1 src/main/deploy src/main/monitor`; collector pytest; node/web tsc | 12 files 64/64; 26/26; cả hai typecheck exit 0. `review-01/{focused,collector,typecheck-node,typecheck-web}.json` |
| C00-T3 | SSH VM02 strict host-key + key A; Docker/Compose/RAM/disk/health | Exit 0, Docker 29.7.2/Compose 5.5.0; available RAM 3283 MiB, disk 31716 MiB; HTTP 200. `review-01/ssh-vm02.json` |
| C00-T4 | SQLite read-only, target path/container/network; app B start time/restart count; experiment process count | Apps và running experiments rỗng; TARGET_FREE; process count 0; hai container B giữ ID/start time, restart 0. `review-01/local-inventory.json`, `ssh-vm02.json` |
| C00-T5 | Đọc source boot, Worker `boot.json`/stdout, mở ảnh app và website để kiểm tra trực tiếp | Renderer thật, IPC và ML running; 28 screencast frames, exit 0. Website ảnh qua tunnel là app B. Chấp nhận bằng chứng Worker, không gọi đây là reviewer chạy lại boot/browser |

Reviewer **không chạy lại** build, full suite, VM01 timeout, public timeout hoặc tunnel/browser.
Đã đọc Worker build log 3045 modules + exit 0, public curl exit 28, SSH VM01 exit 255 và
Chrome screenshot exit 0. Source sản phẩm không đổi nên focused + typecheck + native probes
đủ kiểm chứng độc lập cho C00; full regression/build cuối vẫn theo C09.

## 2. Findings và xử lý

| ID | Severity | Vị trí tại docs HEAD được nộp | Trigger / actual / expected | Xử lý |
| --- | --- | --- | --- | --- |
| C00-R1-01 | MINOR | `docs/tasks/tk-a17-worker-handoff.md:4,16`; board phần điểm vào | Sổ vẫn ghi chưa handoff; link `handoff-c00.md` trỏ sai thư mục; reviewed SHA là placeholder. Người sau không mở được handoff từ sổ | Leader sửa link `tk-a17/handoff-c00.md`, ghi exact reviewed SHA/verdict và đồng bộ trạng thái. CLOSED trong commit review; kiểm tra link sau sửa |
| C00-R1-02 | MINOR | `docs/tasks/tk-a17/handoff-c00.md:7,14` | Docs HEAD ghi `adfd3f8`, thiếu commit `23cd248` trong danh sách dù đó là bản nộp cuối | Leader ghi provenance tại lúc nộp là `23cd248`, thêm commit và link review. CLOSED trong commit review; đối chiếu `git log`/diff |
| C00-R1-03 | MINOR | `tools/a17-c00-inventory.py:17`; `tools/a17-c00-boot.cjs:32` | Inventory lưu exit từng command nhưng không tổng hợp failure thành process exit; boot ghi ML status nhưng không fail riêng khi ML chưa running. Chỉ dùng exit tổng sẽ dễ diễn giải sai | ACCEPTED LIMITATION của helper C00: verdict dựa JSON từng case và ảnh đã kiểm tra, tất cả case bắt buộc thực tế đạt. Không dùng exit tổng làm gate C01/ML; helper downstream phải kiểm tra outcome từng bước |

Không đổi implementation để đóng các điểm hồ sơ. Worker collector lần đầu `EXIT=4`
được giữ tại `collector-tests-worker-exit.txt`; lượt đúng cwd có `26 passed` và `EXIT=0`
ngay trong `collector-tests-worker-corrected.txt`. File exit cũ không phải exit lượt sửa.
Reviewer tự chạy collector đạt 26/26, không gán PASS cho lần thất bại.

## 3. Giới hạn được chấp nhận và điều kiện kế thừa C01

1. Duyệt target **VM02 id=2 / deploy / a17-notes-0911**, workspace
   `/opt/opspilot/a17-notes-0911`, prefix container/network cùng slug. Không có app ID,
   deployment ID hoặc port dành sẵn. C01 phải lấy từ allocator/DeployService, kiểm tra lại
   target/experiment ngay trước deploy; inventory chỉ chứng minh tại thời điểm ghi log.
2. App B `express-demo-app` healthy, collector `express-demo-collector` running; collector
   không có bằng chứng Docker healthcheck riêng. Hai container giữ start time 08/09 và restart 0.
   C01 không được thay compose/container/DB/metrics của B.
3. VM01 timeout không chặn target VM02. Public port 30001 là app B và còn timeout;
   tunnel localhost là phương án trình chiếu có công bố. C01 phải ghi URL/port thật của app A17;
   C04/C09 kiểm chứng lại browser access, không sao chép URL B làm URL A17.
4. 28 screencast frames chứng minh khả năng lấy frame, chưa phải video rehearsal.
   Ảnh app chụp lúc danh sách VPS còn Checking; chỉ xác nhận boot, không chứng minh refresh
   đã hoàn tất. Viewport runtime 1367×769 dù tên ảnh ghi 1366×768; UI acceptance C05/C08C
   phải đo đúng viewport và có ảnh riêng. Chưa xác nhận website PostgreSQL A17 từ ảnh app B.
5. Native probes cùng dependency hiện tại chạy trên hai ABI thành công; không suy native
   build luôn tương thích mọi Node/Electron. Không rebuild song song tests.
6. Helper C00 mở profile A và khởi động lifecycle thật. Khi profile đã có app ở các chặng
   sau, scheduler có thể ingest/train; không chạy lại helper boot này như một probe read-only.
   C01 cần kiểm tra/scope helper phù hợp và lưu evidence mới riêng, không ghi đè hồ sơ C00.
7. C01 giới hạn deploy/collector/DB và các case C01-T1…T7; ML train, Monitor UI, fault và
   auto-recovery vẫn theo đúng chặng. C01 xong dừng review; chưa push/PR/merge.

## 4. Bàn giao tiếp

A có thể gửi Worker:

```text
Thực hiện duy nhất TK-A17/C01 theo docs/tasks/tk-a17/c01-collector-deploy.md.
Đọc docs/tasks/tk-a17/review-c00.md (APPROVED code d4ec3be, docs 23cd248),
task điều phối, board, plan, playbook và các contract được C01 yêu cầu.
Tiếp tục HEAD hiện tại chứa commit review C00; không checkout lùi về reviewed SHA.
Kế thừa manifest VM02/a17-notes-0911, kiểm tra lại target và experiment trước deploy.
Làm đủ C01-T1…T7, evidence/handoff-c01.md, cập nhật board/task/sổ và commit local.
Không dùng exit tổng của helper C00 thay kiểm tra outcome. Không sửa app B.
Không làm C02, không push/PR/merge/subagent; bàn giao rồi dừng review.
```
