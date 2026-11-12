# R11a — Windows ML runtime độc lập

Resource được tạo từ Python3.12.10 AMD64 đang cài trong môi trường đã duyệt và exact production dependency closure trong `ml-service/runtime-lock.json`. Không tải hoặc cài dependency lúc người dùng mở app. Không copy `.venv` redirector/pyvenv.cfg/pip/pytest/Ruff/dev tools/model/state/secret; wheel files được kiểm SHA256 theo RECORD, license/metadata giữ lại. Uvicorn dùng HTTP h11/asyncio/single worker, không cần standard extras/reloader/websocket. Không thay API, ngưỡng, model hoặc protocol ML.

```powershell
. ./tools/enter-node22.ps1
ml-service/.venv/Scripts/python.exe app/scripts/build-ml-runtime.py
pnpm --prefix app build
node app/scripts/ml-runtime-lab.mjs --run
```

Builder yêu cầu output chưa tồn tại, mặc định `app/resources/ml-runtime` (ignored). Khi source/lock thay đổi, tạo artifact mới với `--output app/.out-scripts/<new-runtime-directory>` và kiểm lại trước khi thay generated resource; không overwrite artifact đang dùng hoặc copy venv để né lỗi. Không dùng record/hash do một runtime từ mạng tự cung cấp làm approval. Đây là trusted local build từ approved environment; manifest SHA được bake vào Main khi `pnpm build`, không chấp nhận pin từ renderer/environment ở runtime.

`manifest.json` ghi exact file inventory/size/SHA256, Python/platform và20 production distribution versions. Main/beforePack dùng cùng passive verifier: missing pin/resource, modified/missing/extra file/directory hoặc symlink/junction đều bị từ chối trước spawn; không fallback global Python/development venv. `python312._pth` chỉ có bundled zip/DLLs/site-packages/service, không `import site`; kết hợp `-I -B -X utf8` và env whitelist, không đọc PYTHONHOME/PYTHONPATH/user-site/registry Python. Cơ chế `_pth` theo [tài liệu Python Windows](https://docs.python.org/3.12/using/windows.html#finding-modules).

Packaged manager tạo writable state ở `app.getPath('userData')/ml-state`, truyền bằng `OPSPILOT_ML_STATE_DIRECTORY`. Development vẫn dùng `.venv` và đường dẫn state cũ khi không có explicit override. ML config từ chối override relative/empty. Không copy hoặc di chuyển model hiện có của người dùng sang thư mục mới; migration từ bản installer cũ cần gate riêng. Runtime resources không được ghi state/pycache trong lab; hash verifier chạy lại sau train/restart.

Native lab tạo private unpacked Electron host từ existing approved Electron distribution, đổi executable thành `OpsPilotMLProbe.exe`, đặt runtime trong resources thật, `app.isPackaged === true` và real `process.resourcesPath`. Host dùng actual production MlServiceManager/verifier, actual Python/native scientific libraries/HTTP/train/inference/persistence; chỉ logger adapter là no-op để không ghi app logs người dùng. Không khởi tạo Desktop DB hoặc dùng VPS. PATH chỉ Windows System32, PYTHONHOME/PYTHONPATH cố ý trỏ nơi không hợp lệ; runtime và userData đều có khoảng trắng/dấu. Đây không phải full OpsPilot App.tsx/NSIS hoặc một máy Windows sạch.

Phép thử: bundled native imports/sys.prefix/sys.path; đồng thời start chỉ tạo một process; train180 mẫu tổng hợp,161 feature vectors và score đủ4method; model ghi ngoài resources; restart có PID mới, PID cũ đã dừng và model hash/metadata giữ nguyên; inference tiếp tục; stop giải phóng listener/process bằng absolute taskkill. Sửa source hoặc giấu manifest trong **fixture riêng** phải từ chối spawn/fallback; restore bytes rồi verify resource còn nguyên. Chỉ dọn đúng private root có marker/scope khi PASS. Lỗi giữ fixture/log riêng để chẩn đoán, không reset/clean repo.

Node22 `fs.cpSync` trên host hiện tại làm sai tên Unicode destination (minimal probe: cp false, copyFile/mkdir true). Lab dùng explicit mkdir/copyFile và reject symlink; không dùng bản copy lỗi làm portable proof. Các fixture fail đầu không dùng làm gate PASS. Bản cuối phải ghi5native checks và private_fixture_removed=true.

Gate đóng gói: `beforePack` hiện kiểm cả protected controller releases và ML resource qua compiled `out/main/mlResourceVerifier.js`. Dev build thiếu resource vẫn build được với pin rỗng, nhưng packaged launch/beforePack phải fail. Không gọi artifact đã chạy trên máy dev với env cô lập là bằng chứng NSIS/máy sạch; R11b còn phải kiểm full application install/first launch/upgrade/uninstall trên môi trường độc lập. Dữ liệu train trong lab là synthetic delivery test, không pilot75phút/50run chính thức hoặc kết quả nghiên cứu ML.
