# Sprint demo OpsPilot trước 14/10/2026

> Lập ngày 08/10/2026. Chủ trì review: Leader. Thực hiện code: Worker.
> Mục tiêu là một buổi demo 6–8 phút có chứng cứ kiểm tra được, không tuyên bố tính năng chưa chạy thật.
> Kế hoạch năng lực sản phẩm dài hạn: [28-danh-gia-san-sang-vercel-tren-vps.md](28-danh-gia-san-sang-vercel-tren-vps.md).

## 1. Phạm vi chốt cho buổi demo

**Luồng trình diễn:** VPS/app overview → chọn source demo → detector và kế hoạch build →
pipeline deploy / lịch sử phiên bản → trạng thái truy cập → Doctor/giám sát → rollback hoặc migrate
(chỉ chọn phần có bằng chứng cùng bản build). Nói rõ OpsPilot là desktop operator chạy qua SSH;
Git push-to-deploy, ingress HTTPS và backup theo lịch là roadmap sau demo.

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
| D14-0 Kế hoạch | 08/10 | Nhận scope và khóa danh sách cảnh demo | Không mở tính năng sản phẩm lớn trước demo; baseline 68 file/626 test, lint/typecheck PASS trên Node 22 |
| D14-1 Live smoke trên VPS phát triển | 09/10 | Dùng profile app riêng, nhập VPS bằng fingerprint đã xác minh và SSH key; deploy một Express thật qua app, kiểm tra URL từ ngoài | Có deployment ID, URL, HTTP response, container/image, timestamp và SHA; không ghi secret vào bằng chứng; lỗi nào xảy ra thì ghi đúng bước |
| D14-2 Chứng cứ chức năng local | 10/10 | Chạy detector 3 demo app; chuẩn bị một kịch bản ML local bằng dữ liệu tổng hợp được gắn nhãn; xuất kết quả và lệnh tái chạy ngắn | Kết quả khớp code SHA; không nhầm tổng hợp với pilot VPS; không sửa thuật toán ML chỉ để làm đẹp demo |
| D14-3 Chốt máy demo và fallback | 11/10 | Nếu có VPS demo mới, lặp preflight và deploy smoke; nếu chưa có, tiếp tục dùng VPS phát triển đã đạt gate. Ghi bản chạy live để dự phòng mất mạng. | Chỉ trình bày live khi chính VPS dùng tại buổi demo đạt gate; bản ghi có ngày/SHA và được giới thiệu đúng là bản ghi |
| D14-4 Rehearsal 1 | 12/10 | Chạy đủ 6–8 phút, chụp cửa sổ Electron và website thật; ghi lỗi, thời gian, SHA | Sửa duy nhất blocker demo và lỗi trung thực dữ liệu; cập nhật phiếu in |
| D14-5 Rehearsal 2 & freeze | 13/10 | Lặp lại từ trạng thái đầu vào xác định; chạy lint, typecheck, full test, build; lưu ảnh/video fallback và phiếu in A4 | Leader chốt SHA và verdict `DEMO_READY_LIVE` hoặc `DEMO_READY_RECORDED`; không thêm tính năng sau freeze |
| Demo | 14/10 | Trình bày theo phiếu và mở bằng chứng dự phòng nếu mạng lỗi | Nói đúng trạng thái live/offline và giới hạn |

## 3. Task brief để giao Worker

### D14-1 — Live smoke trên VPS phát triển

- Tạo/cấu hình profile app riêng cho buổi thử; không xóa hoặc ghi đè userData đang có.
- Nhập VPS qua UI với fingerprint đã lấy từ console nhà cung cấp và SSH key hiện lưu ngoài repo.
  Không đưa private key, mật khẩu hoặc credential vào log, ảnh, báo cáo hay commit.
- Kiểm tra kết nối trong UI, Docker/Compose, quyền thư mục làm việc rồi deploy duy nhất
  `demo-apps/express-api` qua wizard. Kiểm tra `/health` qua URL public từ máy điều khiển.
- Ghi bằng chứng deployment ID, port, URL, HTTP status, container/image ID, thời gian, SHA và
  trạng thái exposure vào `docs/demo-14-10/evidence.md`; ghi lỗi thật nếu bước nào thất bại.
- Không chạy pilot ML, migrate hai VPS hoặc dọn dữ liệu không thuộc lần thử. Sửa blocker nhỏ
  bằng commit riêng, chạy gate liên quan và build; không push/PR/merge.

### D14-2 — Kịch bản local có thể lặp lại

- Dùng `demo-apps/{express-api,next-blog,vite-spa}` hiện có; ghi detector, plan và phiên bản thực tế.
- Dùng `ml-service/scripts/gen_fake_series.py` hoặc fixture có sẵn để chạy một phép phát hiện
  local; nguồn dữ liệu phải ghi “synthetic”. Nếu đường ML local không ổn định, dùng test/CSV kèm
  giải thích và không đưa cảnh ML live vào runbook.
- Ghi lệnh, SHA, kết quả, thời gian chạy vào `docs/demo-14-10/evidence.md`; không có secret.

### D14-3 — Chốt VPS demo và bản ghi dự phòng

- Nếu người dùng có VPS demo mới, xác minh fingerprint ngoài luồng, kiểm tra Docker/Compose,
  dung lượng, cổng, quyền `/opt/opspilot`, đồng hồ rồi chạy lại deploy smoke trên máy đó.
- Nếu chưa có VPS thứ hai, dùng VPS phát triển đã qua D14-1 cho live demo; không gọi đó là pilot.
- Ghi một video và ảnh của lần chạy live cùng SHA để dùng khi mạng lỗi; không tạo fixture deploy giả.

### D14-4/5 — Rehearsal và gói bàn giao

- Cập nhật [phiếu demo in A4](demo-14-10/phieu-demo.html) bằng SHA, chế độ và kết quả thực tế.
- Hai lần rehearsal có timestamp, duration, lỗi và ảnh màn hình mở được. Một video dự phòng cùng SHA.
- Phát hiện lỗi UI không làm lệch dữ liệu/nhãn; không mở task cải tiến giao diện khác.
- Gate cuối chạy tuần tự trên Node 22: lint, typecheck Node/Web/Scripts, full Vitest, build;
  ML pytest nếu dùng cảnh ML. Không dùng số gate cũ cho bản mới.

## 4. Đường găng và quy tắc cắt scope

1. Nếu D14-1 chưa đạt trước hết 10/10, tập trung sửa blocker deploy; bỏ cảnh rollback/ML live chưa có bằng chứng.
2. Nếu 11/10 máy dự kiến demo chưa qua gate, dùng VPS phát triển đã qua D14-1; nếu cả hai không dùng
   được, trình chiếu bản ghi live có ngày/SHA và nói rõ đây là bản ghi.
3. Nếu ML local không có lệnh chạy ổn định trong một lần rehearsal, chỉ nói kiến trúc và test;
   không phát biểu kết quả thực nghiệm hoặc accuracy.
4. DB-1, Git webhook, preview deployments, HTTPS ingress tự động, backup định kỳ và mở thêm framework
   nằm ngoài sprint demo. Roadmap sản phẩm vẫn giữ tại tài liệu 28.

## 5. Phiếu trình bày 6–8 phút

1. **0:00–0:40** — Bài toán: deploy và theo dõi app trên VPS của mình qua SSH; chỉ vào sơ đồ.
2. **0:40–1:30** — Danh sách app/VPS, trạng thái có thời điểm kiểm tra và nhãn live/offline.
3. **1:30–3:00** — Chọn Express demo, detector local thật, BuildPlan, wizard.
4. **3:00–4:45** — LIVE_VPS: một deploy thật, URL và logs; khi mạng lỗi: mở video/ảnh của lần
   chạy thật có ngày/SHA và nói rõ đây là bản ghi, không phải thao tác live.
5. **4:45–5:45** — Lịch sử phiên bản, rollback/Doctor/Exposure theo đúng bằng chứng chế độ đã chọn.
6. **5:45–6:45** — ML local synthetic hoặc sơ đồ thu mẫu → phát hiện → cảnh báo; ghi rõ pilot VPS chưa chạy.
7. **6:45–8:00** — Điểm mạnh, giới hạn hiện tại và ba bước tiếp theo: Git source, HTTPS ingress,
   runtime logs. Mời giảng viên hỏi.
