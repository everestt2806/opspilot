# Kế hoạch Windows delivery — Kim / Gemini / Codex

START 17/11/2026 — User giao Codex làm leader lập kế hoạch, review và kiểm thử; Gemini triển khai code. Nhánh làm việc `feat/kim-windows-delivery-20261116`, HEAD tiếp nhận `7cec58845eed87057baa4562a410dc403eb6f2a7`, code baseline `f699615`. Deadline dự án hiện hành **04/12/2026** theo CLAUDE.md; mốc 20/11 trong README gốc đã cũ.

## 1. Kết quả cần bàn giao

1. Bộ cài Windows dựng từ source xác định, đủ verified resources; full app chạy bằng SQLite/safeStorage/ML bundled thật và giữ dữ liệu sau cold reopen.
2. Bằng chứng cài mới, repair, supported upgrade và ordinary uninstall trên Windows độc lập, đúng production identity/default profile/shortcuts, không cần developer Node/Python để chạy app.
3. Source CI chạy được và runbook cài đặt, sao lưu, phục hồi, demo 8–10 phút bám feature thực có.

Nguồn yêu cầu là [task Kim](../../tasks/tk-s7-kim-windows-delivery.md) và [phân công song song](../../tasks/tk-s7-parallel-2026-11-16.md). Các kết quả R11 cũ là tài liệu tham khảo, không phải bằng chứng baseline này đã PASS.

## 2. Phân vai và phạm vi

| Người | Trách nhiệm | Quyền chốt |
|---|---|---|
| Gemini | Sửa code delivery được giao; tự chạy checks; lưu evidence; cập nhật task riêng; commit và normal push nhánh Kim theo task/ủy quyền trong ảnh | Đề nghị CHỜ REVIEW từng checkpoint, không tự chốt nghiệm thu của leader |
| Codex | Chia checkpoint; review diff và ownership; chạy lại checks quan trọng; đối chiếu artifact/source; ghi verdict và đầu việc sửa | ACCEPT / REQUEST_CHANGES / BLOCKED theo bằng chứng |
| Kim | Thực hiện thao tác GUI/Windows độc lập khi automation không sẵn; cung cấp observation và log đã redacted | Xác nhận môi trường thực và demo trên máy mình |
| Sơn / coordinator | Core/database/contract/pins, tài nguyên release đã duyệt và tích hợp cuối | Xử lý repro ngoài phạm vi Kim; quyết định candidate ghép |

Codex chỉ sửa tài liệu kế hoạch và hồ sơ review trong đợt này. Gemini code; không chạy hai writer hay hai lab tranh cùng output/profile/registry. Khi Gemini bàn giao SHA để review, khóa candidate đó; code tiếp ở checkpoint sau thì evidence phải chỉ rõ SHA nào đang được nghiệm thu.

**Được sửa:** các Windows lab và `build-ml-runtime.py` liệt kê trong bảng owner; `app/scripts/windows-release-lab/**`; thư mục mới `app/scripts/windows-delivery/**`; workflow mới `.github/workflows/windows-delivery-source.yml`; docs riêng và task Kim. `app/electron-builder.yml`, `app/resources/installer.nsh`, `app/scripts/controller-installer-before-pack.cjs` chỉ sửa khi có repro delivery, giữ identity/verification tương thích.

**Ngoài phạm vi:** `app/src/**`, contracts/migrations, ML source, collector/templates/experiments; package.json/lockfile/Vite config; controller catalog/pins/build-release scripts khác; board/DECISIONS và task của Sơn. Nếu lỗi ở đây: ghi reproduction, expected/actual, file gợi ý và bằng chứng; không sửa chéo. Không dùng production DB/VPS, không PR/merge/publish release, không reset/clean/stash/rebase/force. Không invent coauthor; dùng đúng danh tính và chỉ thị tác giả thực tế.

## 3. Kiểm kê leader đã chạy ngày 17/11

| Kiểm tra | Quan sát | Ý nghĩa |
|---|---|---|
| Git | Remote `https://github.com/everestt2806/opspilot.git`; HEAD bằng origin nhánh Kim; baseline f699615 là ancestor; working tree sạch trước sửa docs | Đúng nhánh, không đưa thay đổi worktree H2 vào đây |
| Môi trường hiện tại | Windows x64 máy dev; Node 22.17.0, pnpm 11.1.0; venv Python 3.12.7 | Không phải clean Windows; Python chưa đạt lock 3.12.10 |
| Dependency ML | 15/20 versions khớp, 5 lệch như bảng dưới | Không dùng environment này để tự nhận runtime hợp lệ |
| Resources | Thiếu `app/resources/ml-runtime/` và `app/resources/controller-releases/` | Packaging NOT_RUN; cần đủ artifact từ nguồn đã duyệt |
| Schema/harness | Source đăng ký Desktop038 / controller037; full-app lab assert schema31 tại `windows-release-lab.mjs` | Sửa harness theo role và baseline; không đổi DB/runtime để khớp lab |
| Source typecheck | `pnpm.cmd --prefix app typecheck` exit 0; Node và Web PASS | Chỉ chứng minh typecheck; không chứng minh full tests/build/package |
| Hành vi pnpm | Lần gọi trên chạy existing postinstall native rebuild trước typecheck; không đổi tracked file | Khi chạy lại phải ghi command và side effect thực tế |
| Windows độc lập | Không thấy WindowsSandbox.exe; chưa có VM/máy độc lập được xác nhận | K2 NOT_RUN, cần chốt môi trường trước khi thực thi |
| task-discipline | Không tìm thấy file cùng tên trong checkout hiện tại | Đã đọc CLAUDE.md, tasks/README và áp dụng ngoại lệ owner/task cụ thể; không tự tạo quy tắc còn thiếu |

| Package | Lock | Local |
|---|---|---|
| idna | 3.18 | 3.19 |
| narwhals | 2.24.0 | 2.25.0 |
| numpy | 2.5.1 | 2.5.2 |
| typing-inspection | 0.4.2 | 0.4.4 |
| uvicorn | 0.52.1 | 0.52.4 |

Raw inventory local: `app/.out-scripts/windows-delivery/leader-preflight-20261117T105313Z/inventory.json`, SHA256 `bf29f7f6f396ce6c610e4c0b432525941b61a031c715c67d758eebc5b2ebf172`. File ignored, không có trong clone mới. Bảng này là bản tóm tắt có thể bàn giao; Gemini phải kiểm kê lại, không tái sử dụng kết quả local như đã chạy trên máy khác.

Chưa chạy full Vitest/Pytest/lint/build/GUI/NSIS/upgrade hoặc GitHub Actions trong phiên lập kế hoạch. Không ghi PASS cho các gate đó.

## 4. Checkpoint thực hiện và tiêu chí nghiệm thu

Thứ tự: **CP0 → CP1 (K3 nguồn) → CP2 (K1) → CP3 (K2) → CP4 (K3 demo và tổng hợp)**. CP1 làm được khi resources/Windows độc lập còn thiếu; phần docs demo có thể soạn trong lúc chờ. K1/K2/K3 là ba phần của một task, không mở nhiều task WIP.

| Checkpoint | Gemini phải giao | Codex kiểm lại và điều kiện ACCEPT | Dự kiến công sức |
|---|---|---|---|
| CP0 — Preflight | CLI inventory trong `app/scripts/windows-delivery/**`, hướng dẫn prerequisite, báo cáo machine/deps/resources/schema/cổng; danh sách blockers và cách gỡ cụ thể | Chạy từ repo có dấu/khoảng trắng; thiếu/mismatch được chỉ rõ; không chạy product/spawn ML/download/đổi pin hoặc overwrite fixture từ inventory | 0,5 ngày |
| CP1 — K3 source CI | Workflow manual dispatch + script source checks dùng chung local/CI; runbook gọi lệnh | Windows runner, Node22, pnpm11.1.0 và frozen lockfile; typechecks Node/Web/scripts, Vitest, lint có phạm vi/lý do; lưu source SHA, versions, commands, exit codes, logs và checksums. Một run thật đạt mới gọi CI PASS | 0,5–1 ngày |
| CP2 — K1 package hiện hành | Audit/sửa harness lỗi thời; package mới; proof full app và fixture NSIS repair; báo cáo verified resources | So source → compiled Main/preload/renderer → ASAR/exe/installer; passive beforePack thật; schema38 + inventory migrations đúng role; SQLite native/DPAPI/ML thật; persistence/child PID-port/cleanup đạt | 1–2 ngày sau đủ resources |
| CP3 — K2 Windows độc lập | Evidence production install/shortcut/Start menu, cold reopen, repair/upgrade/uninstall; negative resource và preservation checks | Đúng production identity/default profile trên máy thử độc lập không Node/Python dev; không debug/profile override trong lượt production; model/key/DB/UI giữ theo policy; ordinary uninstall đúng identity giữ user data | Khoảng 1 ngày khi có Windows thử |
| CP4 — K3 bàn giao | Hướng dẫn cài/backup/log redaction/phục hồi; demo8–10phút; bảng tổng PASS/FAIL/NOT_RUN/BLOCKED và hashes/SHA | Codex đối chiếu runbook với executable đã nghiệm thu, diễn tập demo, review evidence/gaps, gửi coordinator kết quả theo scope | 0,5 ngày |

Đây là ước lượng công sức, không hứa ngày hoàn tất khi binary resources hoặc Windows thử chưa có. Mục tiêu ưu tiên CP0/CP1 từ 17–18/11, CP2 ngay khi đủ prerequisite, CP3/CP4 sau đó; giữ buffer trước 04/12 cho retest candidate ghép và sửa lỗi. Không chờ UI/database mới của Sơn.

### CP0 — Không phụ thuộc tài nguyên còn thiếu

- CLI không mutation theo mặc định: xác định repo từ script, không hardcode đường dẫn máy Sơn/Kim. Ghi installed vs required, phân biệt source-ready và package-ready; thiếu prerequisite cho gate được yêu cầu phải có exit/status phù hợp, không báo chung xanh.
- Không giả sử `tools/enter-node22.ps1` chạy được mọi máy: helper hiện tìm Node ở LOCALAPPDATA/pnpm/bin, máy này dùng Node22 từ vị trí khác. Dùng Node22 đã xác minh hoặc ghi cách cấu hình terminal; không sửa helper thuộc core khi chưa giao quyền.
- Tách environment build ML đúng Python3.12.10/production closure đã pin, giữ venv cũ. Đọc lock để kiểm exact dependencies/closure, không `pip install -U`, không sửa lock. Binary/dependency phải theo nguồn/hash đã duyệt; chưa xác định được thì báo coordinator.
- Liệt kê toàn bộ controller descriptors cần có từ cấu hình/catalog được source tin cậy, kể cả historical entries bắt buộc; cần đúng release và installer hashes. Không bỏ descriptor hoặc tự tạo artifact rỗng để qua gate.
- Khảo sát lab hiện có trước thêm script mới. Sửa lỗi schema31 không chỉ thay một số: xác minh phiên bản, bảng migration và applied inventory theo đúng desktop role, giữ controller-only migrations tách biệt. Không tự lấy max version trong artifact rồi coi đó là expected.

### CP1 — Source CI có kết quả trung thực

- `workflow_dispatch` trước; permissions tối thiểu đủ checkout, không secret/VPS/production DB, không publish installer/release. Không tự yêu cầu tài khoản hoặc secret mới.
- Node22 và packageManager hiện hành 11.1.0; `pnpm install --frozen-lockfile`. Native modules chạy đúng Electron ABI. Ghi phiên bản thực tế; không lấy README cũ “pnpm9+” để đổi package manager.
- Python source checks nếu thêm phải dùng environment riêng/dependencies đã duyệt, không lấy root `pnpm test` làm cross-platform mặc định vì script hiện hardcode `.venv\\Scripts`. Không thay lockfile hay workflow bằng dependency mới chưa duyệt.
- Có typecheck node/web/scripts và full Vitest cho baseline; lint app hoặc phần source được giao phải ghi phạm vi, lý do và baseline failures. Nếu thêm Python lab: Ruff và test meaningful cho đường bị đổi. Không blanket-disable tests/lint, không `continue-on-error` che failing gate.
- Source compilation nếu chạy được khi resources thiếu phải ghi **source build only**. Job packaging không được skip mọi bước rồi nhận package PASS; chưa có verified resources thì không chốt packaging.
- Upload logs/checksums ngay cả fail (`if: always()` cho artifact collection, không cho bước kiểm thử). Exit code failing checks phải lan tới job. Không upload DB/key/pickle/credential.
- Nếu chưa có quyền kích hoạt/quan sát Actions: giao workflow + local equivalent results và ghi Actions NOT_RUN; không bịa run URL/kết quả.

### CP2 — Full app và bộ cài trên baseline đã ghim

- Chỉ build sau preflight package-ready và existing beforePack resource verification thành công. Output nonce mới trong ignored `.out-scripts`; publish never. Không dùng artifact cũ không truy được source.
- Inventory schema38 theo baseline/source và role; `PRAGMA integrity_check` readonly phải ok. Kiểm actual native SQLite ABI, credential-master-key.protected, locale/theme; reopen bằng process mới giữ cùng dữ liệu và model hash/trained_at.
- Full production Main/preload/App.tsx và bundled ML, không surrogate/mock. Train180 synthetic và trả4scores chỉ là runtime smoke, không accuracy/formal ML nghiệm thu.
- Profile/HOME/output riêng, explicit run modes, owned child PID và listener; đóng app hai lượt không orphan ML, bytes resources không đổi. Negative missing/tamper resource phải từ chối, giữ dữ liệu, không fallback Python global.
- Chạy NSIS fixture riêng để kiểm repair, registry/namespace, negative traversal/CLI modes và cleanup. Dọn đúng fixture có marker/phạm vi; fail giữ diagnostics. Không kill theo process name chung hoặc gỡ OpsPilot đang dùng.
- Supported predecessor theo policy/R11c: source d302ee3/0.1.0 dựng riêng; không đổi package version để giả upgrade. Nếu legacy source cần dev Python thì ghi rõ; không chuyển thành clean-machine claim. Kiểm app mới giữ DB/key/model/UI và inference không retrain. App và fixture build giữ cùng payload hashes trừ executable name theo lab.

### CP3 — Windows độc lập là gate riêng

- Chốt VM/máy Windows dùng để thử; ghi OS/build/arch, snapshot/trạng thái trước cài, quyền user, Node/Python absent và đúng installer SHA. Account mới trên máy dev chỉ là account isolation.
- Chỉ chạy production installer/default identity trên môi trường thử không chứa bản đang sử dụng. Mở bằng desktop/Start menu shortcut bình thường; kiểm ML bundled path/PID, locale/theme persistence, app exit và cold reopen.
- Repair cùng version và upgrade khác version là hai case. Chỉ dùng trusted supported predecessor; môi trường cũ phụ thuộc Python phải khai báo rõ, không yêu cầu người dùng cài Python để chạy bản mới. Không hứa mọi installer lịch sử đều được hỗ trợ.
- Ordinary uninstall không dùng `_?=` để thay self-delete gate: process/app folder/shortcut/registry phải đúng policy; default userData giữ theo policy. Xác nhận key/model/DB còn ở nơi expected bằng hash/observation, không đưa bytes vào report.
- Missing/tamper chỉ trên bản copy/fixture trong Windows thử, lưu before/after hashes và data preservation. NotSigned được ghi đúng; không tắt Windows security để gọi PASS.
- Nếu thiếu môi trường: gate NOT_RUN và checkpoint BLOCKED kèm điều kiện gỡ. Vẫn làm CP1/CP4; không đổi NOT_RUN thành PASS hoặc tự nhận R11/release tổng hoàn tất.

### CP4 — Khung demo đề xuất 9 phút

| Thời gian | Nội dung | Đầu ra nhìn thấy |
|---|---|---|
| 0:00–1:00 | Giới thiệu scope Windows, version/source SHA và installer checksum | Đúng artifact đã nghiệm thu, giới hạn rõ |
| 1:00–3:00 | Cài và mở từ shortcut trên Windows thử | Full app mở, không yêu cầu developer Node/Python |
| 3:00–4:00 | Đi qua các trang có sẵn ở baseline | UI không blank/crash; dữ liệu fixture, không dùng credential thật |
| 4:00–5:00 | Đổi ngôn ngữ/theme trong Settings | UI cập nhật theo lựa chọn |
| 5:00–6:00 | Kiểm bundled ML health và đúng process path | Service thật thuộc bản cài, không Python global |
| 6:00–7:00 | Đóng, xác minh ML dừng, mở lại | Không orphan; locale/theme và dữ liệu fixture giữ |
| 7:00–9:00 | Trình bày evidence repair/upgrade/uninstall, nơi backup/log và cách phục hồi | Bảng PASS/NOT_RUN cùng SHA; chỉ trình bày case đã thực chạy |

Không thực hiện đủ mọi lifecycle case trong9phút: chúng phải được kiểm trước và có evidence cùng candidate. Nếu thêm demo live Git/database/VPS thì coordinator xác nhận trước và điều chỉnh thời lượng. Ảnh/video dự phòng là đầu việc phải tạo sau khi chạy thật, hiện chưa có trong đợt tiếp nhận này.

## 5. Quy trình leader kiểm tiến độ và nhận bàn giao

Mỗi phiên Gemini ghi START/UPDATE vào task riêng. Mỗi checkpoint một commit nội dung tương ứng K1/K2/K3; CP0 chuẩn bị cho K1 có thể commit riêng, không trộn core. Các docs kế hoạch chưa commit do Codex tạo phải được giữ và đưa vào commit docs đầu tiên sau khi đọc/review, không coi là thay đổi cần xóa. Normal push đúng nhánh theo ủy quyền hiện có; không push worktree/branch của Sơn.

Gemini báo ngay khi có blocker; quá30phút ghi BLOCKED cụ thể trong task, tiếp phần độc lập. Cuối phiên và khi bàn giao mỗi checkpoint dùng mẫu:

```text
Checkpoint: CPx / Kx — CHỜ REVIEW | BLOCKED
Source SHA / branch / trạng thái working tree:
Files changed / nằm trong owner nào:
Requirement → PASS/FAIL/NOT_RUN/BLOCKED → evidence path + SHA256:
Environment / Node-pnpm-Python / actual vs synthetic:
Commands + exit codes + số tests thực chạy + skips có lý do:
Artifact exe/ASAR/installer/manifests hashes (nếu đã có):
Process/port/registry cleanup và dữ liệu được giữ:
Bug còn mở / repro / owner / điều kiện gỡ:
Next action:
```

Codex review theo thứ tự: diff/ownership → source và phiên bản → command/evidence integrity → chạy lại source gates → affected native/packaged checks khi đủ resource → verdict. Lỗi mất dữ liệu, sai resource/pin/identity, orphan process, test fail hoặc bằng chứng không khớp SHA đều REQUEST_CHANGES; thiếu môi trường là BLOCKED. Không lấy số test cũ để xác nhận HEAD mới.

Không tự hứa theo dõi nền khi chưa có phiên/run. Khi Gemini trả SHA hoặc báo cáo, user đưa vào phiên Codex để leader thực hiện vòng review/retest tiếp theo. Coordinator tổng hợp board/DECISIONS; task Kim chỉ được gọi đạt theo scope sau bằng chứng và review, trạng thái toàn dự án tuân quy trình merge của repo.

## 6. Trạng thái bắt đầu

| Hạng mục | Hiện tại | Bước tiếp theo |
|---|---|---|
| Nhánh + kế hoạch + prompt | Đã chuẩn bị; docs local | Gemini đọc prompt và tiếp nhận |
| CP0 automation | OPEN; đã có inventory thủ công của leader | Gemini làm preflight tái hiện được |
| CP1 source CI | OPEN | Gemini triển khai workflow/script, chạy local |
| CP2/K1 package | BLOCKED ở prerequisite; harness còn lỗi thời | Chuẩn bị approved Python/deps/resources; audit lab ngay |
| CP3/K2 Windows độc lập | NOT_RUN | Xác định máy/VM thử |
| CP4/K3 demo/runbook | OPEN | Soạn bám baseline, bổ sung bằng chứng thực sau gate |

Prompt bàn giao: [gemini-handoff.md](gemini-handoff.md).
