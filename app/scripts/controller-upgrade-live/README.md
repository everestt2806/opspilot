# Live development controller upgrade — c-3a

Chỉ dành cho VPS phát triển167.71.202.116 và known controller/install UUID đã ghi trong script. Đây là operational Node22/Main gate; không dùng production Desktop profile và không thay GUI c-3b. Không nhận host/pin/path/UID từ renderer hoặc tự thay protected catalog.

Yêu cầu: Windows, Node22, Python virtualenv đã duyệt, built Main resource verifier và đủ hai approved release resources. Original receipt/release/tool pins giữ nguyên. Chạy typecheck/lint/syntax/negative-args và private journal key gate trước live. Không chạy khi có thí nghiệm ML, job chưa terminal hoặc auto policy chưa pause; tool kiểm lại bằng pinned SSH/readonly SQLite và public HTTP200 trước mutation.

```powershell
. ./tools/enter-node22.ps1
ml-service/.venv/Scripts/python.exe app/scripts/controller-upgrade-live/hidden-input.py --upgrade
```

Nhập credential trong prompt ẩn. Không truyền password/private key/token bằng argv, env, log, source hoặc Git. Python chuyển JSON qua anonymous stdin pipe cho Node. Private Desktop031 DB nằm dưới `app/.out-scripts/controller-upgrade-live/<nonce>/private-profile/`; AES-GCM dùng module hiện có, master key32bytes được Windows user-scoped DPAPI niêm phong qua anonymous subprocess pipes. Python DPAPI dùng UI_FORBIDDEN, không machine scope; raw key không ghi file/argv/env/log. File `journal-master-key.dpapi` chỉ thuộc operational proof, không dùng format production safeStorage hoặc thay khóa profile thật.

Luồng: fresh snapshot→inspect original installed authority→explicit temporary scoped binding→prepare durable upgrade UUID→protected transfer→root upgrade. Nếu write mất phản hồi, chỉ inspect cùng UUID một lần; không tự gửi upgrade lần nữa. Khi active/current/running, fresh API binding review/confirm giữ token/client/scopes. Tool đối chiếu original receipt/controller identity/UID/key/database inode/target credential digest/demo; Main public probe ghi exposure qua authenticated API, readonly SQLite chỉ dùng kiểm chứng. Thêm lại local VPS rồi xác nhận SSH authority và API binding riêng để kiểm token/client/PID/observation persistence. Không sửa remote SQLite bằng SQL, không bật auto policy, không redeploy demo trong gate này.

Thành công: revoke temporary client, kiểm active clients0 và public HTTP200, giữ controller + demo, dọn private local DB/key. Thất bại: giữ encrypted DB + DPAPI key + public result/UUID để operator kiểm tra và phục hồi cùng giao dịch, không tạo UUID/cài lại controller để né unknown.

```powershell
ml-service/.venv/Scripts/python.exe app/scripts/controller-upgrade-live/hidden-input.py --inspect <nonce16hex>
# Chỉ khi inspect vẫn outcome_unknown và đã quyết định tiếp tục cùng root transaction:
ml-service/.venv/Scripts/python.exe app/scripts/controller-upgrade-live/hidden-input.py --recover <nonce16hex>
```

Recovery helper không cần nhập lại secret: chỉ mở đúng existing private DPAPI key/profile, verify known VPS/pin và catalog rồi dùng Main inspect/explicit recover. Không tự replay/rotate/rebind/cài lại. `recovery.json` chỉ ghi metadata/root state; kết quả active không thay các gate API refresh/exposure/demo/revoke/cleanup còn lại. Không gọi checkpoint PASS nếu những gate đó chưa chạy.

`result.json` và phase progress chứa metadata, snapshot hashes và code lỗi ổn định; không stderr thô, credential hoặc key. Native real root/Linux lab và Electron synthetic-SSH proofs trước đó là bằng chứng riêng. Actual live UI/onboarding/firstdeploy, reboot/soak, remote SSH key/password rotation và HTTPS không được suy ra từ c-3a.
