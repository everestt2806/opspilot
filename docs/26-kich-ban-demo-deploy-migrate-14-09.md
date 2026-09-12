# Kịch bản demo deploy và migrate — 14/09/2026

## Mục tiêu và câu nói mở đầu

Trong 6–8 phút, người xem thấy OpsPilot nhận diện ba loại source, deploy bằng một pipeline chung,
sau đó migrate Vite stateless và Express/PostgreSQL giữa VM02 và VM01. ML chưa được trình diễn:
“Phần ML vẫn đang phát triển và cần thêm dữ liệu vận hành đủ sạch để huấn luyện, kiểm chứng. Nhóm dời
phần train/score và đánh giá sang ít nhất hai tuần sau demo này, dự kiến xem lại từ 28/09/2026.”

## Chuẩn bị trước khi mở app

- Mở OpsPilot ở SHA được ghi trong handoff; kiểm tra VM02 profile 2 và VM01 profile 1 đều SSH online.
- Kiểm tra read-only app/runtime/collector của A17, không thao tác app B.
- Chuẩn bị các source `demo-apps/express-api`, `demo-apps/next-blog`, `demo-apps/vite-spa`.
- Nếu cần đường trình chiếu từ máy demo, tạo SSH local-forward theo credential resolver và gọi đúng đó là tunnel.

## Timeline và thao tác

| Thời gian | Thao tác trình chiếu                                                       | Điều cần nói/điều phải thấy                                                                             |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0:00–0:45 | Mở Deploy, chọn lần lượt Express, Next.js, Vite hoặc mở history của ba app | Detector hiển thị đúng framework; ưu tiên Next.js > Vite > Express; không nhầm Flask.                   |
| 0:45–2:15 | Cho xem source tree, BuildPlan và bắt đầu deploy app đại diện              | Luồng thật là `PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → RECORD`.                     |
| 2:15–2:45 | Mở Apps/Versions                                                           | Deployment ID, runtime image `vN`, Docker health, collector running, HTTP URL.                          |
| 2:45–3:20 | Mở Express, tạo marker nghiệp vụ và reload endpoint                        | Marker xuất hiện trong PostgreSQL nguồn trước migrate.                                                  |
| 3:20–4:50 | Mở Migrate, chọn source/target, chạy Vite rồi Express/PostgreSQL           | Stepper, byte/checksum, file/row counts, source/target runtime và downtime lấy từ event/SQLite thật.    |
| 4:50–5:30 | Ở `awaiting_confirm`, mở bảng VERIFY rồi chọn “giữ nguồn”                  | Chỉ confirm sau VERIFY PASS; source được giữ chạy làm fallback.                                         |
| 5:30–6:30 | Mở target URL, Apps và History                                             | Target HTTP 2xx, Docker/collector healthy, PostgreSQL marker/rows khớp, job/deployment/action thật.     |
| 6:30–8:00 | Nói fallback và ML deferral                                                | Nếu public port bị chặn, dùng tunnel; không gọi tunnel là public. Không train/score hoặc đưa số ML giả. |

## Fallback và quyết định an toàn

1. Nếu PRECHECK fail: dừng trước mutation, chụp lỗi/action và không retry mù.
2. Nếu BUILD/DEPLOY/HEALTHCHECK fail: giữ failed attempt, dùng source-kept healthy làm đường trình chiếu;
   không sửa SQLite thủ công.
3. Nếu migrate chưa tới `awaiting_confirm`: không confirm; giữ raw event và báo đúng step.
4. Nếu public URL không vào được: kiểm tra loopback HTTP trên VPS, sau đó tạo lại SSH tunnel; ghi rõ đây là
   đường trình chiếu qua tunnel.
5. Nếu collector/DB/marker không đạt: không tuyên bố thành công; dừng rehearsal và bàn giao `BLOCKED` với
   job, step, exit code và trạng thái cuối.

## Sau demo

- Xác nhận source và target A17 cùng healthy, collector không còn process/helper/tunnel treo, và mọi failed
  attempt vẫn còn trong history/evidence.
- Không reset/xóa/reassign PostgreSQL/SQLite, không chạm app B, không mở C06.
