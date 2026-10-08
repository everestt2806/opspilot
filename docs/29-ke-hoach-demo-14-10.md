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
| LIVE_VPS | Trước 11/10 có VPS, host fingerprint xác minh độc lập, credential và Docker đạt preflight | Một deploy Express thật, URL kiểm tra từ ngoài, log/deployment/rollback thật | Không gọi HTTP IP:port là HTTPS; không gọi dữ liệu ML mock là pilot |
| OFFLINE_DISCLOSED | Thiếu bất kỳ điều kiện LIVE_VPS nào | App chạy thật trên máy, detector và thao tác local; dữ liệu fixture có nhãn mô phỏng; ảnh/log VPS lịch sử ghi ngày và SHA | Không gọi fixture hoặc ảnh lịch sử là deploy/monitor đang chạy live |

Hiện tại (08/10): đã có [VPS phát triển](tasks/dev-vps-preflight-2026-10-08.md) kiểm chứng SSH,
Docker và cổng 30000; máy này chưa phải VPS demo và chưa đạt mốc ổ 40 GB của pilot.
Docker Desktop daemon trên máy điều khiển không chạy. Mặc định vẫn chuẩn bị **OFFLINE_DISCLOSED**;
chỉ chuyển LIVE_VPS sau khi máy demo và luồng deploy thật đạt gate D14-3.

## 2. Checkpoint và lịch ngược

| Mốc | Hạn nội bộ | Worker làm | Leader review / DoD |
|---|---|---|---|
| D14-0 Kế hoạch | 08/10 | Nhận scope và khóa danh sách cảnh demo | Không mở tính năng sản phẩm lớn trước demo; baseline 68 file/626 test, lint/typecheck PASS trên Node 22 |
| D14-1 Demo offline an toàn | 09/10 | Tạo profile demo tách khỏi userData thật, banner `DEMO OFFLINE`, fixture có nhãn và chặn mọi lệnh SSH/ghi remote ở main; chỉ mở các tương tác local đã chạy thật | Test chứng minh không gọi SshManager/HTTP ngoài localhost trong chế độ demo; dữ liệu thật không bị đọc/ghi; không có deployment giả mang nhãn live |
| D14-2 Chứng cứ chức năng local | 10/10 | Chạy detector 3 demo app; chuẩn bị một kịch bản ML local bằng dữ liệu tổng hợp được gắn nhãn; xuất kết quả và lệnh tái chạy ngắn | Kết quả khớp code SHA; không nhầm tổng hợp với pilot VPS; không sửa thuật toán ML chỉ để làm đẹp demo |
| D14-3 Quyết định live | 11/10 | Nếu có VPS: chỉ đọc preflight SSH fingerprint, Docker, port, thời gian; nếu không: xác nhận fallback | Chỉ LIVE_VPS khi tất cả gate pass; nếu thiếu một gate chuyển OFFLINE_DISCLOSED, không dùng IP cũ của runbook tháng 9 |
| D14-4 Rehearsal 1 | 12/10 | Chạy đủ 6–8 phút, chụp cửa sổ Electron và website/fixture; ghi lỗi, thời gian, SHA | Sửa duy nhất blocker demo và lỗi trung thực dữ liệu; cập nhật phiếu in |
| D14-5 Rehearsal 2 & freeze | 13/10 | Lặp lại từ trạng thái đầu vào xác định; chạy lint, typecheck, full test, build; lưu ảnh/video fallback và phiếu in A4 | Leader chốt SHA và verdict `DEMO_READY_LIVE` hoặc `DEMO_READY_OFFLINE`; không thêm tính năng sau freeze |
| Demo | 14/10 | Trình bày theo phiếu và mở bằng chứng dự phòng nếu mạng lỗi | Nói đúng trạng thái live/offline và giới hạn |

## 3. Task brief để giao Worker

### D14-1 — Hồ sơ demo offline tách biệt

- Tạo cách chạy app với userData riêng, không đọc/sửa `%APPDATA%/OpsPilot` của người dùng.
- Trong chế độ demo offline, main chặn tập trung mọi kênh có thể gọi SSH, DNS, Cloudflare, deploy,
  rollback, migrate, Doctor fix hoặc ghi hạ tầng; dừng poller và helper tự động truy cập VPS.
- UI có nhãn nhìn thấy được ở mọi trang: “DEMO OFFLINE — dữ liệu mô phỏng, không kết nối VPS”.
- Dữ liệu fixture phục vụ danh sách VPS/app/deployment/history và chart nếu có phải nhận diện là
  mô phỏng; không tạo lịch sử giả trong profile thật. Phân biệt `running` ghi trong fixture với
  runtime đang chạy: không hiển thị như kết quả kiểm tra live.
- Vẫn cho phép chọn thư mục và chạy detector local thật. Các thao tác bị chặn trả `IpcError` rõ ràng.
- Test cấp main chứng minh SSH methods không được gọi; test renderer xác nhận banner và trạng thái
  bị chặn. Chạy typecheck/lint/test liên quan và build. Commit riêng, không push/PR/merge.

### D14-2 — Kịch bản local có thể lặp lại

- Dùng `demo-apps/{express-api,next-blog,vite-spa}` hiện có; ghi detector, plan và phiên bản thực tế.
- Dùng `ml-service/scripts/gen_fake_series.py` hoặc fixture có sẵn để chạy một phép phát hiện
  local; nguồn dữ liệu phải ghi “synthetic”. Nếu đường ML local không ổn định, dùng test/CSV kèm
  giải thích và không đưa cảnh ML live vào runbook.
- Ghi lệnh, SHA, kết quả, thời gian chạy vào `docs/demo-14-10/evidence.md`; không có secret.

### D14-3 — Preflight live có điều kiện

- Chỉ mở khi người dùng có VPS trước 11/10. Xác minh fingerprint qua console nhà cung cấp
  ngoài luồng trước SSH; không chấp nhận host key từ chính phiên kết nối đang kiểm tra.
- Kiểm tra read-only trước: kết nối, Docker/Compose, dung lượng, port, quyền `/opt/opspilot`, thời gian.
- Nếu tất cả pass, chạy một deploy Express trên profile thật riêng của demo và ghi URL external
  probe, container/image/deployment ID. Nếu không pass, ghi `BLOCKED/NOT_RUN`, dừng.
- Không chạy tải ML pilot, migrate hai VPS hoặc xóa dữ liệu hiện có để phục vụ demo ngắn.

### D14-4/5 — Rehearsal và gói bàn giao

- Cập nhật [phiếu demo in A4](demo-14-10/phieu-demo.html) bằng SHA, chế độ và kết quả thực tế.
- Hai lần rehearsal có timestamp, duration, lỗi và ảnh màn hình mở được. Một video dự phòng cùng SHA.
- Phát hiện lỗi UI không làm lệch dữ liệu/nhãn; không mở task cải tiến giao diện khác.
- Gate cuối chạy tuần tự trên Node 22: lint, typecheck Node/Web/Scripts, full Vitest, build;
  ML pytest nếu dùng cảnh ML. Không dùng số gate cũ cho bản mới.

## 4. Đường găng và quy tắc cắt scope

1. Nếu D14-1 chưa đạt trước hết 10/10, bỏ seed/chart mô phỏng và dùng app local sạch + CLI detector
   + ảnh lịch sử có nhãn, tránh cố làm demo mode thiếu an toàn.
2. Nếu 11/10 chưa có VPS đủ điều kiện, khóa OFFLINE_DISCLOSED. Không chờ đến 13/10 mới đổi kịch bản.
3. Nếu ML local không có lệnh chạy ổn định trong một lần rehearsal, chỉ nói kiến trúc và test;
   không phát biểu kết quả thực nghiệm hoặc accuracy.
4. DB-1, Git webhook, preview deployments, HTTPS ingress tự động, backup định kỳ và mở thêm framework
   nằm ngoài sprint demo. Roadmap sản phẩm vẫn giữ tại tài liệu 28.

## 5. Phiếu trình bày 6–8 phút

1. **0:00–0:40** — Bài toán: deploy và theo dõi app trên VPS của mình qua SSH; chỉ vào sơ đồ.
2. **0:40–1:30** — Danh sách app/VPS, trạng thái có thời điểm kiểm tra và nhãn live/offline.
3. **1:30–3:00** — Chọn Express demo, detector local thật, BuildPlan, wizard.
4. **3:00–4:45** — LIVE_VPS: một deploy thật, URL và logs; OFFLINE: mở hồ sơ triển khai lịch sử
   có ngày/SHA và nói đây là bằng chứng đã ghi, không phải thao tác live.
5. **4:45–5:45** — Lịch sử phiên bản, rollback/Doctor/Exposure theo đúng bằng chứng chế độ đã chọn.
6. **5:45–6:45** — ML local synthetic hoặc sơ đồ thu mẫu → phát hiện → cảnh báo; ghi rõ pilot VPS chưa chạy.
7. **6:45–8:00** — Điểm mạnh, giới hạn hiện tại và ba bước tiếp theo: Git source, HTTPS ingress,
   runtime logs. Mời giảng viên hỏi.
