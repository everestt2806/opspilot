# Kiểm kê Git-first cho OpsPilot — 08/10/2026

**Kết luận:** đường deploy sản phẩm hiện tại chỉ nhận thư mục trên máy chạy Electron. Dòng chú thích `app.source_path` nói “local hoặc git URL” là ý định thiết kế, không phải tính năng đã triển khai. Sản phẩm phải cho người dùng chọn **Deploy trực tiếp từ thư mục** hoặc **Deploy từ Git** như hai nguồn ngang hàng. Git là khoảng trống cần ưu tiên bổ sung và kiểm chứng trước demo 14/10; deploy trực tiếp là tính năng hiện có cần được bảo toàn.

## 1. Chuẩn sản phẩm cần đạt

| Sản phẩm | Luồng Git thực tế | Bài học cho OpsPilot |
|---|---|---|
| [Vercel](https://vercel.com/docs/git) | Liên kết repo và production branch; push/PR tạo production hoặc preview deployment; có thể tạo deployment thủ công từ branch/SHA | Repo, ref và SHA phải là danh tính của bản triển khai; preview và push trigger là mốc sau |
| [Dokploy](https://docs.dokploy.com/docs/core/providers), [GitHub](https://docs.dokploy.com/docs/core/github) | Chọn Git provider/repo/branch; deploy theo push trên nhánh đã chọn; thư mục ZIP chỉ là một nguồn khác | Cho chọn nguồn Git ngay ở màn tạo app; nhánh gắn với app |
| [Coolify](https://coolify.io/docs/applications/sources/overview), [Deployments](https://coolify.io/docs/applications/deployments/overview) | Repo công khai HTTPS hoặc repo riêng bằng deploy key/GitHub App; deploy thủ công hoặc theo webhook; deployment log ghi revision | Làm public Git + manual deploy trước, sau đó private credentials và trigger |

Các tài liệu trên mô tả tính năng của sản phẩm tham chiếu tại ngày kiểm kê; đây không phải bằng chứng OpsPilot đã có tính năng tương ứng.

## 2. Đường đi hiện tại trong mã

| Chặng | Bằng chứng | Kết luận |
|---|---|---|
| Chọn nguồn | `DeployPage.tsx` gọi `system:pick-folder`; `ipc.ts` mở `openDirectory` | UI chỉ cho chọn thư mục cục bộ |
| Detect | `deploy:detect(sourcePath: string)` → `buildSourceTree(sourcePath)` | Không nhận repo URL/ref; detector chỉ đọc cây file cục bộ |
| Start | `DeployInput.source_path` bắt buộc; `pipeline.setup()` gọi `existsSync` và detect đồng bộ trước khi cấp deployment ID | Không thể truyền URL Git vào trường hiện tại |
| Upload | `stepUpload()` gọi `ssh.uploadDir(localPath, remote/src)`; `.git` bị loại | Transport là tar-over-SSH; chưa có acquisition từ Git |
| Lưu danh tính | `app.source_path` lưu đường dẫn; `deployment` không có repo/branch/SHA | Không chứng minh được một bản chạy lấy từ commit nào |
| Redeploy | Input hiện tại lại yêu cầu chọn `source_path`; app hiện có không cập nhật nguồn Git | Không có “deploy latest của nhánh đã liên kết” |
| Migrate | `MigrateService.sourcePath()` đọc `app.source_path`; `DeployPipeline.setup()` vẫn đòi source cục bộ dù payload đã relay từ VPS | Clone tạm vào đường dẫn cũ sẽ làm migrate/restart phụ thuộc cache đã mất |
| Rollback | Dùng image tag cũ và deployment lineage | Cơ chế khôi phục runtime có sẵn, nhưng chưa hiển thị SHA của image gốc |

**Các tính năng liên quan đã có:** kết nối VPS qua SSH với pin host key, detector Next/Express/Vite, build Docker trên VPS, healthcheck, exposure, lịch sử deployment, rollback, Doctor, monitor. VPS phát triển đã qua preflight SSH/Docker/port; **chưa có deployment qua OpsPilot được xác nhận**. VPS 25 GB chưa đạt điều kiện 40 GB của pilot ML.

## 3. Các khoảng trống theo mức ưu tiên

| Ưu tiên | Năng lực | Tình trạng 08/10 | Tiêu chí hoàn thành |
|---|---|---|---|
| P0 demo | Import repo Git công khai, chọn branch, lấy SHA, root directory, detect và deploy thủ công | Chưa có | Tạo app từ URL Git trong UI, chạy `/health` trên VPS thật; deployment lưu và hiển thị full SHA |
| P0 demo | Redeploy cùng app từ commit mới và rollback | Runtime rollback có, Git redeploy chưa có | Hai SHA khác nhau trong lịch sử; rollback trả đúng image/URL cũ, SHA nguồn gốc rõ |
| P0 demo | Kiểm soát source snapshot và lỗi | Chưa có | Precheck/start dùng cùng SHA đã khóa; nhánh đổi giữa chừng không đổi payload; clone lỗi không tạo app/deployment mồ côi |
| P1 sản phẩm | Repo riêng với quyền đọc tối thiểu | Chưa có | Deploy key hoặc GitHub App; secret không đi vào DB plaintext, IPC log hay URL |
| P1 sản phẩm | URL HTTPS/domain, runtime logs, env lifecycle | Một phần | URL HTTPS thực qua ingress, xem log đang chạy, sửa env/redeploy có audit |
| P2 tự động hóa | Push-to-deploy/preview khi desktop đóng | Chưa có control plane luôn chạy | Quyết định kiến trúc, xác minh webhook, queue/idempotency, trạng thái khi desktop tắt; không gắn nhãn auto deploy trước khi đạt |
| P2 vận hành | Backup/restore và pilot ML | Chưa có bằng chứng live đầy đủ | Backup có restore drill; pilot trên VPS đủ 40 GB với dữ liệu thật |

**Phân biệt nguồn và phương tiện chuyển file:** Với nguồn Git, VPS không bắt buộc tự `git clone`. Có thể checkout commit trên desktop, rồi gửi snapshot qua SSH bằng pipeline hiện tại. Người dùng vẫn nhập repo/ref và nhìn thấy SHA; snapshot Git được khóa theo SHA. Với nguồn trực tiếp, người dùng chọn thư mục trên máy và không hiển thị Git SHA giả. Hai nguồn cùng dùng pipeline build/health/record, nhưng giữ metadata nguồn riêng. Cách này tái dùng detector và không đưa credential Git lên VPS.

## 4. Hợp đồng Git-first đề xuất cho Worker

1. Nguồn là union tường minh `local`/`git`; người dùng chủ động chọn một trong hai và bản ghi local cũ vẫn đọc/deploy được. Với Git, lưu URL canonical không chứa credential, branch, root directory ở app; lưu **repo URL + full commit SHA** của snapshot ở từng deployment. Với local, lưu đường dẫn nguồn hiện có và hiển thị đúng nhãn “Thư mục trên máy”, không tạo Git metadata giả. Không lưu đường clone tạm vào `app.source_path` như định danh lâu dài. Sửa migration/restore để payload đã relay không cần đường clone cũ.
2. Bước chuẩn bị Git chạy trong Electron main hoặc CLI: URL HTTPS GitHub công khai hợp lệ; branch/ref được kiểm tra, fetch/checkout vào thư mục riêng dưới `userData`/temp, `GIT_TERMINAL_PROMPT=0`, lệnh qua `spawn` với mảng tham số, timeout, giới hạn dung lượng/file; không chạy hook/submodule/LFS trong lát cắt đầu. Sau checkout lấy `git rev-parse HEAD`, kiểm tra root nằm trong snapshot và detect tại đó. Chặn URL có userinfo, `file://`, local path, option injection, symlink thoát root và đường dẫn `..`.
3. `deploy:detect`/precheck/start phải dùng **cùng snapshot SHA**. Nếu branch thay đổi sau detect, buộc chuẩn bị lại hoặc dùng chính SHA đã pin và hiển thị rõ. Dọn snapshot có kiểm soát khi hủy/thất bại/hoàn tất; không dọn lúc pipeline còn dùng. Không ghi token, URL có credential, env secret hoặc stderr thô vào log/error/DB.
4. UI trình bày hai lựa chọn ngang hàng: “Thư mục trên máy” và “Git repository”; không ép người dùng đổi sang Git. Với Git, nhập URL, nhánh, root directory (mặc định `/`), hiện full/short SHA trước nút Deploy và trạng thái fetch/detect/fail. Với local, giữ thao tác chọn thư mục và các bước hiện có. App detail/lịch sử hiển thị đúng loại nguồn; chỉ bản Git có repo/ref/SHA và nút redeploy từ branch.
5. Khóa mô hình dữ liệu và IPC cho cả hai nguồn trước khi chọn số migration, rồi đồng bộ `docs/contracts/ipc-contract.ts`, `schema.sql`, `deploy-events.md`, migration tương ứng và `DECISIONS.md` trước khi nối runtime. Tránh dùng `source_path` vừa là URL vừa là path; giữ tương thích dữ liệu cũ.

**Giới hạn P0:** repo GitHub **công khai qua HTTPS**, deploy khi người dùng bấm; chưa nhận private credential, chưa tự deploy theo push, chưa preview PR, chưa HTTPS tự động. Nếu repo demo của người dùng là private, cần một repo công khai được người dùng chọn hoặc mở checkpoint credential riêng trước live gate. Không coi repo của chính OpsPilot là public khi chưa kiểm tra quyền truy cập ẩn danh.

**Nguồn demo đã kiểm tra ẩn danh ngày 08/10:** `https://github.com/everestt2806/opspilot.git`, nhánh `main`, root directory `demo-apps/express-api`. `git -c credential.helper= ls-remote` với `GIT_TERMINAL_PROMPT=0` trả `8af16e1f9165a31557288adbc23acc420244938f` cho `main`; commit này có `package.json`, `package-lock.json`, `Dockerfile`, `server.js` và `/health`. Đây là chính repo công khai của dự án, nhưng sẽ được clone như một nguồn Git bên ngoài vào snapshot riêng; không được dùng working tree local làm bằng chứng. Có thể chọn một SHA lịch sử của `demo-apps/express-api` để thử redeploy thủ công mà không push. Trước live gate phải xác minh lại branch/SHA vì remote có thể đổi.

## 5. Checkpoint và thứ tự nghiệm thu trước 14/10

| Mốc | Hạn | Worker thực hiện | Leader chỉ duyệt khi |
|---|---|---|---|
| G0 — contract hai nguồn + source acquisition | 09/10 | Chốt schema/IPC cho local và Git trước khi chọn số migration; module clone/fetch/checkout Git công khai, CLI thử độc lập | Test URL/ref/root/size/timeout/cancel; full SHA; bản ghi local cũ còn đọc/deploy được; không có runtime UI giả |
| G1 — nối pipeline + UI | 10/10 | Hai lựa chọn nguồn ngang hàng trong wizard; snapshot Git pin xuyên detect→precheck→start; app/history hiển thị đúng nguồn; migration/redeploy tương thích | Tests cho branch đổi, lỗi fetch, clone cleanup, Git redeploy, đường local cũ và migration; lint/typecheck/build/full Vitest |
| G2 — live Git smoke | 11/10 | Trên VPS phát triển, deploy repo công khai bằng UI; commit thứ hai và redeploy; thử rollback | Evidence URL, HTTP `/health`, repo/ref/full SHA cho mỗi deployment, image ID, thời gian; không lộ secret |
| G3 — rehearsal/print | 12–13/10 | Hai lần rehearsal 6–8 phút, video fallback từ lần live, cập nhật phiếu in PDF | SHA chạy demo và bằng chứng khớp, phân biệt rõ HTTP IP:port với HTTPS; gate cuối pass |

Nếu G0/G1 trễ, ưu tiên **một deploy Git thật** hơn ML/Doctor/rollback trên sân khấu vì deploy trực tiếp đã có trong sản phẩm. Cần kiểm tra hồi quy deploy trực tiếp; lần chạy này là bằng chứng của chế độ “Thư mục trên máy”, không được giới thiệu là Git deploy. Push-to-deploy cần control plane nhận webhook khi Electron tắt, nên là checkpoint riêng sau khi demo thủ công đã đạt; không gắn nhãn tự động cho nút Redeploy.

## 6. Vấn đề cần đối chiếu khi review Worker

- `DeployPipeline.run()` hiện cấp ID đồng bộ. Worker phải chứng minh acquisition bất đồng bộ không tạo race, không mất event và vẫn trả ID đúng contract; hoặc đưa ra thay đổi contract có migration/test đầy đủ.
- `app.source_path` cũ của local phải còn dùng được; repo/ref/SHA mới không được lưu bằng URL nhét vào path. Dữ liệu SQLite cũ sau migration phải đọc được.
- Migrate từ Git app không được phụ thuộc clone tạm đã xóa; relay payload phải là nguồn trong RESTORE, detector/plan lấy từ dữ liệu đã lưu hoặc snapshot được chuẩn bị có kiểm soát.
- Build một commit phải xác nhận nguồn đã checkout đúng SHA ngay trước upload; source không bị thay đổi bằng working tree của OpsPilot.
- UI không được báo `reachable` hay thành công nếu external probe chưa chạy hoặc bị cloud firewall chặn.
