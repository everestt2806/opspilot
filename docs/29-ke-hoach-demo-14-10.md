# Sprint demo OpsPilot trước 14/10/2026

> Lập ngày 08/10/2026. Chủ trì review: Leader. Thực hiện code: Worker.
> Mục tiêu là một buổi demo 6–8 phút có chứng cứ kiểm tra được, không tuyên bố tính năng chưa chạy thật.
> Kế hoạch năng lực sản phẩm dài hạn: [28-danh-gia-san-sang-vercel-tren-vps.md](28-danh-gia-san-sang-vercel-tren-vps.md).
> Chuẩn hoàn thiện UC-01…09 và các tính năng thiết yếu sau demo: [31-lo-trinh-hoan-thien-san-pham.md](31-lo-trinh-hoan-thien-san-pham.md). Demo 14/10 là cổng trung gian, không đóng các chức năng chưa qua live gate.
> Kiểm kê và đường găng Git-first: [30-audit-git-first-deploy.md](30-audit-git-first-deploy.md). Bản sửa 08/10 đặt Git source trước live demo.

## 1. Phạm vi chốt cho buổi demo

**Sản phẩm cho chọn hai cách deploy:** từ thư mục trên máy hoặc từ Git repository. Cả hai đi qua pipeline build/health/record; Git có thêm repo/ref/SHA, còn deploy trực tiếp không được gắn SHA giả. Buổi demo ưu tiên chứng minh đường Git đang thiếu.

**Luồng trình diễn:** VPS/app overview → chọn Git repository/branch → hiện commit SHA → detector và kế hoạch build →
pipeline deploy / lịch sử phiên bản → trạng thái truy cập → Doctor/giám sát → rollback hoặc migrate
(chỉ chọn phần có bằng chứng cùng bản build). Nói rõ OpsPilot là desktop operator chạy qua SSH;
Git **manual deploy từ repository** là năng lực chặn demo. Git **push-to-deploy** khi desktop đóng,
ingress HTTPS và backup theo lịch là roadmap sau demo.

### Hai chế độ bằng chứng

| Chế độ | Điều kiện | Được trình bày | Không được tuyên bố |
|---|---|---|---|
| LIVE_VPS | VPS đã pin host key và luồng deploy Express qua app đạt kiểm chứng thực tế | Một deploy Express thật, URL kiểm tra từ ngoài, log/deployment/rollback thật nếu từng thao tác đã chạy đạt | Không gọi HTTP IP:port là HTTPS; không gọi dữ liệu ML mock là pilot |
| RECORDED_FALLBACK | Mạng hoặc VPS demo không dùng được lúc trình bày | Video/ảnh/log của chính lần chạy live đã kiểm chứng, có ngày và SHA; detector local thật | Không gọi bản ghi là thao tác đang chạy live |

Hiện tại (08/10): [VPS phát triển](tasks/dev-vps-preflight-2026-10-08.md) đã kiểm chứng SSH,
Docker và cổng 30000; `SshManager` đã pin host key. Ưu tiên chạy **LIVE_VPS trên máy này**
để kiểm chứng sản phẩm; máy demo mua sau có thể thay thế khi qua cùng gate. Ổ 25 GB đủ cho
một app Express thử, nhưng chưa đạt mốc 40 GB của pilot ML. Chưa xác nhận luồng deploy qua app.

## 2. Checkpoint và lịch ngược

| Mốc | Hạn nội bộ | Worker làm | Leader review / DoD |
|---|---|---|---|
| D14-G0 Hợp đồng hai nguồn và lấy nguồn Git | 09/10 | Chốt mô hình local/Git và IPC trước khi chọn migration; clone/fetch/checkout repo công khai với SHA bất biến, test/CLI độc lập | Source từ Git thật; không lưu clone tạm làm nguồn lâu dài; dữ liệu local cũ còn đọc/deploy được |
| D14-G1 Hai nguồn deploy trong UI và pipeline | 10/10 | Hai lựa chọn ngang hàng trong wizard; Git detect/precheck/start cùng SHA; app/history hiển thị đúng loại nguồn, redeploy và migrate không phụ thuộc cache | Full gate pass; lỗi fetch/branch đổi/cleanup/migration và hồi quy deploy trực tiếp có test; chưa cần VPS |
| D14-G2 Live Git smoke trên VPS phát triển | 11/10 | Dùng profile riêng và VPS đã pin host key; deploy repo Express công khai qua app, redeploy commit mới và kiểm tra URL từ ngoài | Có repo/ref/full SHA cho từng deployment, ID, URL, HTTP response, container/image và thời gian; rollback nếu đã qua gate |
| D14-G3 Rehearsal 1 | 12/10 | Chạy đủ 6–8 phút, chụp Electron và website thật, ghi video dự phòng; ML synthetic chỉ khi không tranh thời gian Git | Bằng chứng live trùng SHA trong lịch sử; ghi lỗi và thời lượng thật |
| D14-G4 Rehearsal 2 & freeze | 13/10 | Lặp lại trên VPS sẽ dùng, chạy lint/typecheck/full test/build, in phiếu A4 | Leader chốt SHA và verdict `DEMO_READY_LIVE` hoặc `DEMO_READY_RECORDED` |
| Demo | 14/10 | Trình bày theo phiếu và mở bằng chứng dự phòng nếu mạng lỗi | Nói đúng trạng thái live/offline và giới hạn |

## 3. Task brief để giao Worker

### D14-G0/G1 — Bổ sung Git bên cạnh deploy trực tiếp

- Tuân thủ [contract và gate hai nguồn](30-audit-git-first-deploy.md), làm public Git + manual deploy
  trước webhook. Giữ deploy thư mục là lựa chọn ngang hàng, có thể dùng độc lập; không gọi folder upload là Git deploy.
- Ghi repo/ref/full SHA trong deployment và hiện trong UI; nguồn snapshot đã pin xuyên detect,
  precheck, build. Migration của app Git không phụ thuộc clone tạm sau khi dọn.

### D14-G2 — Live Git smoke trên VPS phát triển

- Tạo/cấu hình profile app riêng cho buổi thử; không xóa hoặc ghi đè userData đang có.
- Nhập VPS qua UI với fingerprint đã lấy từ console nhà cung cấp và SSH key hiện lưu ngoài repo.
  Không đưa private key, mật khẩu hoặc credential vào log, ảnh, báo cáo hay commit.
- Kiểm tra kết nối trong UI, Docker/Compose, quyền thư mục làm việc rồi deploy Express từ
  **`https://github.com/everestt2806/opspilot.git`**, branch `main`, root `demo-apps/express-api`
  qua wizard; xác nhận full commit SHA từ remote tại lúc chạy. Kiểm tra `/health` qua URL public
  từ máy điều khiển. Sau đó chọn một commit lịch sử hợp lệ của cùng subdir để thử redeploy bằng
  SHA cụ thể, không cần push; nếu kịch bản này không đạt gate thì chỉ trình bày một Git deploy thật.
- Ghi bằng chứng repository, branch, commit SHA, deployment ID, port, URL, HTTP status,
  container/image ID, thời gian và
  trạng thái exposure vào `docs/demo-14-10/evidence.md`; ghi lỗi thật nếu bước nào thất bại.
- Không chạy pilot ML, migrate hai VPS hoặc dọn dữ liệu không thuộc lần thử. Sửa blocker nhỏ
  bằng commit riêng, chạy gate liên quan và build; không push/PR/merge.

### Kịch bản ML/detector phụ khi luồng Git đã đạt

- Dùng `demo-apps/{express-api,next-blog,vite-spa}` hiện có; ghi detector, plan và phiên bản thực tế.
- Dùng `ml-service/scripts/gen_fake_series.py` hoặc fixture có sẵn để chạy một phép phát hiện
  local; nguồn dữ liệu phải ghi “synthetic”. Nếu đường ML local không ổn định, dùng test/CSV kèm
  giải thích và không đưa cảnh ML live vào runbook.
- Ghi lệnh, SHA, kết quả, thời gian chạy vào `docs/demo-14-10/evidence.md`; không có secret.

### Chốt VPS demo và bản ghi dự phòng

- Nếu người dùng có VPS demo mới, xác minh fingerprint ngoài luồng, kiểm tra Docker/Compose,
  dung lượng, cổng, quyền `/opt/opspilot`, đồng hồ rồi chạy lại deploy smoke trên máy đó.
- Nếu chưa có VPS thứ hai, dùng VPS phát triển đã qua D14-G2 cho live demo; không gọi đó là pilot.
- Ghi một video và ảnh của lần chạy live cùng SHA để dùng khi mạng lỗi; không tạo fixture deploy giả.

### D14-G3/G4 — Rehearsal và gói bàn giao

- Cập nhật [phiếu demo in A4](demo-14-10/phieu-demo.html) bằng SHA, chế độ và kết quả thực tế.
- Hai lần rehearsal có timestamp, duration, lỗi và ảnh màn hình mở được. Một video dự phòng cùng SHA.
- Phát hiện lỗi UI không làm lệch dữ liệu/nhãn; không mở task cải tiến giao diện khác.
- Gate cuối chạy tuần tự trên Node 22: lint, typecheck Node/Web/Scripts, full Vitest, build;
  ML pytest nếu dùng cảnh ML. Không dùng số gate cũ cho bản mới.

## 4. Đường găng và quy tắc cắt scope

1. Nếu D14-G1 chưa đạt trước hết 10/10, tập trung sửa blocker Git deploy; bỏ cảnh ML/Doctor live chưa có bằng chứng.
2. Nếu 11/10 máy dự kiến demo chưa qua gate, dùng VPS phát triển đã qua D14-G2; nếu cả hai không dùng
   được, trình chiếu bản ghi live có ngày/SHA và nói rõ đây là bản ghi.
3. Nếu ML local không có lệnh chạy ổn định trong một lần rehearsal, chỉ nói kiến trúc và test;
   không phát biểu kết quả thực nghiệm hoặc accuracy.
4. DB-1, Git webhook, preview deployments, HTTPS ingress tự động, backup định kỳ và mở thêm framework
   nằm ngoài sprint demo. Roadmap sản phẩm vẫn giữ tại tài liệu 28.

## 5. Phiếu trình bày 6–8 phút

1. **0:00–0:40** — Bài toán: deploy và theo dõi app trên VPS của mình qua SSH; chỉ vào sơ đồ.
2. **0:40–1:30** — Danh sách app/VPS, trạng thái có thời điểm kiểm tra và nhãn live/offline.
3. **1:30–3:00** — Nhập repo Git Express/branch, hiện full SHA, detector trên snapshot và BuildPlan.
4. **3:00–4:45** — LIVE_VPS: một deploy từ Git thật, URL và logs; khi mạng lỗi: mở video/ảnh của lần
   chạy thật có ngày/SHA và nói rõ đây là bản ghi, không phải thao tác live.
5. **4:45–5:45** — Lịch sử phiên bản, rollback/Doctor/Exposure theo đúng bằng chứng chế độ đã chọn.
6. **5:45–6:45** — ML local synthetic hoặc sơ đồ thu mẫu → phát hiện → cảnh báo; ghi rõ pilot VPS chưa chạy.
7. **6:45–8:00** — Điểm mạnh, giới hạn hiện tại và ba bước tiếp theo: push-to-deploy khi desktop tắt,
   HTTPS ingress, runtime logs. Mời giảng viên hỏi.
