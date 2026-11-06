# R3c-6c — Kho credential Desktop và enrollment qua SSH

START06/11/2026 — Basee195438 đã push. Người dùng yêu cầu tiếp tục và nói rõ phần chưa làm/test cần người dùng; không dùng nhãn tổng PARTIAL thay cho trạng thái cụ thể. Áp dụng task-discipline. Trong checkpoint này tự chạy offline/native lab; chưa cần người dùng test.

| Yêu cầu | Kiểm chứng | State |
|---|---|---|
| Local binding schema/contract mới, upgrade giữ dữ liệu cũ | SQLite024 mới/cumulative parity/v023 populated migration/35tables/latest24;DB26+vault10 tests PASS | PASS |
| Kho mã hóa gắn binding/principal/revision và current VPS | AES-GCM existing cipher/context envelope;swap/tamper/expired/archived/changed pin-security-revision/foreign key tested;metadata no token | PASS |
| Enrollment qua trusted pinned SSH, không chạy bundle chưa xác minh | Current expected principal trước SSH authentication, approved inline Python reader verifies manifest+exact payload+ownership+Node22 before CLI; native tampered-candidate/wrong pin/foreign controller refused | PASS |
| Retry/lost response giữ cùng enrollment request key | Pending persisted first; same UUID/active shortcut/delivery_unknown remoteclientid/CAS/disable-race/latechannel tests PASS; không tự cấp token mới | PASS |
| Cold vault→HTTP client chạy thật | Final native `aa9a2c48875b`11PASS: actual SSH/verifiedCLI/SQLite/cold process/authHTTP/revoke; Windows Electron2process safeStorage create+cold decrypt PASS | PASS |
| Gates/docs/push | Full1633PASS/2Linux-onlySKIP/0FAIL/Python365/native11+13+11/Windows safeStorage2process/fresh024/Node-Web-scripts-lab types/lint15/build/Ruff PASS; exact index/secret/link/diff và remote đối chiếu trước bàn giao | PASS |

Phạm vi: main-only vault/enrollment service và CLI/native acceptance; IPC/UI là bước nối sau khi backend được kiểm. Không ghi là người dùng phải test thay cho code chưa viết. Không chạy VPS/DB production hoặc tự mở public port; không PR/merge. No accepted exceptions.

## Nhật ký

- UPDATE06/11: SQLite024 lưu binding pending/active/delivery_unknown/disabled, remote controller ID không FK tới local controller. Cipher dùng key của Desktop profile hiện hành; envelope gắn toàn intent/principal/VPS security revision/local binding revision/client metadata/token. Resolve đọc current VPS và envelope mỗi lần, không generic settings/plaintext/renderer/cache. Local disable xóa ciphertext và tăng revision; active replay chỉ dùng credential đang có.
- Enrollment trusted main dùng inline Python có hash cố định và approved assets catalog; không gửi token trong argv/URL/script. Kiểm independently pinned SSH principal trước authentication; bootstrap kiểm file sizes/hash/no symlink/hardlink/owner/write permissions/exact catalog/Node22 trước chạy CLI. Dùng fixed command enum/stdin cap16KiB/stdout cap64KiB/timeout/killed process group; không log/buffer arbitrary stderr. CLI status đọc expected controller trước credential issue. Lost secret reply giữ same request UUID/remote client ID nhưng không giả có bearer; người dùng sau này cần explicit revoke/re-enroll từ UI, không tự cấp mới.
- Native first `c2d4140efacc`/`87e00ed199cc` FAIL,cleanup=true: copyFile giữ UID1000 của Node source trong root lab, verifier đúng khi từ chối. Reproduction private copy ownerroot PASS; lab chown duy nhất bản Node copy (assert no symlink/new inode) sang lab uid, không sửa verifier. Lab SSH username root phản ánh đúng shell chạy root, không giả non-root acceptance. Accepted native trước final walk cap `7c995fc03cc5`11PASS; final sẽ rerun.
- Windows native Electron `desktop-cipher-smoke.ts`: actual2Electron processes, safeStorage create + loadExistingCredentialCipher/cold decrypt PASS; raw `.out-scripts/desktop-cipher-native-result.json`. Chỉ cipher fixture, không thử user production profile. Cleanup Windows Temp bị automatic review reject cả computed/literal exact path, không lý do chi tiết; giữ encrypted fixture ngoài repo tại path ghi `.out-scripts/desktop-cipher-profile-path.txt`, không thử shell khác để vượt block. Không chặn chức năng, không coi cleanup này là repo/source failure.
- Final native **aa9a2c48875b 11PASS**, raw `.out-scripts/desktop-controller-enrollment/aa9a2c48875b/result.json`, artifact `/var/tmp/opspilot-p3e3a-runtime/r3c6c-accepted-lab.cjs`, SHA256 **bc08d91f41bada584a4174b513df6b41f8727b8e38ff4bfee3d16b38b4bd0d66**; wrong manifest/tampered candidate không execute, bootstrap kiểm private marker + read-only controller SQL trước CLI để không migrate nhầm DB khi controllerID khác. Replay lost secret giữ1grant/UUID/delivery_unknown; cold new process resolve→actual authenticated HTTP, revoke401/security revisionblocks/FK/cleanup PASS. Lab root, chưa non-root installer hoặc production VPS; electron_safe_storage_ui_exercised=false của Linux lab được bù bằng Windows cipher smoke riêng, chưa UI enrollment acceptance.
- Native auth CLI **f66ec29e0451 13PASS**, HTTP service **aa13e3cc1e0b 11PASS**(default404/auth/revoke/SIGTERM drain/0lateSQL); management CLI `/var/tmp/opspilot-p3e3a-runtime/r3c6c/control-plane.cjs`, manifest **4aa9d99609820fa3944844147d98f75955ef20d0b0d71a098bf73f9b1f747619**. Fresh Linux npmci/Node22.23.4/SQLite3.53.4/Zod4.4.3/schema024/empty local binding+grants+requests/bundle12/init/status PASS.
- Python suite **365PASS** fresh06/11 (`experiments collector/tests ml-service/tests -p no:cacheprovider -q`), Ruff toàn3modules+new bootstrap clean/formatPASS. Node/Web/scripts/lab typechecks, scoped lint15TS/MJS0/0, electron-vite build PASS. Full first1633PASS/2SKIP; rerun accepted sau final readonly-identity bootstrap change, không để checkpoint nhận code chưa gate.

```text
Node22: pnpm --prefix app exec vitest run src/main/controlPlane/desktopControllerEnrollment.test.ts src/main/controlPlane/desktopControllerVault.test.ts src/main/ssh/controllerApiChannel.test.ts src/main/db/index.test.ts src/main/db/productMigration.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c6c-vitest-accepted.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <15 changed TS/MJS files> --max-warnings=0
pnpm --prefix app exec electron-vite build
ml-service/.venv/Scripts/python.exe -m pytest experiments collector/tests ml-service/tests -p no:cacheprovider -q
ml-service/.venv/Scripts/python.exe -m ruff check experiments collector ml-service app/src/main/controlPlane/desktop_controller_admin.py
ml-service/.venv/Scripts/python.exe -m ruff format --check app/src/main/controlPlane/desktop_controller_admin.py
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6c-accepted-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6c/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6c-final-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6c/control-plane.cjs node app/scripts/product-runtime-lab/controller-client-auth.mjs
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6c/control-plane.cjs node app/scripts/product-runtime-lab/controller-read-api.mjs
Linux: node app/scripts/product-runtime-lab/verify-deps.mjs
Windows Electron: bundle desktop-cipher-smoke.ts, electron.exe <bundle> create <isolated temp profile>, rồi independent electron.exe <bundle> cold <same profile>; proof .out-scripts/desktop-cipher-native-result.json
```

Việc user cần làm ở checkpoint này: không có. Việc code tiếp: UI/IPC quản lý binding + đọc app/job/history từ controller, vẫn không public bind/secret IPC. Live rollout/installer/HTTPS/ML là gates khác, không cần user test thay cho các chỗ chưa viết đó.

- HANDOFF-LOCAL06/11: final full **1633PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c6c-vitest-accepted.json` và console cùng tên `.log`; final Python365/Ruff/format/Node-Web-scripts-lab types/scopedlint15/build/fresh migration024 đều PASS. Ledger6requirements đã đối soát, không rawtoken/credential trong metadata/errors/argv/report/commit; explicit stage scope/diff/secret/link và normal checkpoint push theo user authorization. SHA xem git log source vault; đối chiếu remote trước báo. Local gate/backend slice đủ, task board vẫn CHỜ REVIEW vì chưa PR/merge; sản phẩm còn code UI/IPC và live gates riêng. Không accepted exceptions cho required gates. Windows encrypted Temp fixture bị cleanup review block đã công bố, nằm ngoài scope source/required runtime acceptance và không commit.
