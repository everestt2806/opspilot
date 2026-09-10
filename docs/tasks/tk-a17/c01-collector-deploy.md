# C01 — Một lần deploy có app, PostgreSQL và collector

## Đầu vào

C00 APPROVED + manifest. Đọc prompt M04/M05, metric-format, deploy-events, schema, IPC;
source `deploy/templates.ts`, `pipeline.ts`, `service.ts`, collector và template compose.
Chưa làm scheduler/ML/UI. Đích nghiệm thu là container và JSONL trên VPS.

## Các bước Worker làm

1. Dùng DeployService/DeployPipeline tạo app demo thật và version đầu; không chèn DB giả.
   Express port trong container 3000, PostgreSQL 5432; host port do allocator chọn.
2. Đưa collector source/Dockerfile lên workspace demo và build image có định danh. Đóng gói
   nguồn collector trong luồng dev/build đang dùng, không phụ thuộc source path trên máy B.
3. Render compose app + DB + collector cùng network. Mount metrics đúng contract, socket
   Docker read-only, collector 128m/restart unless-stopped; không publish DB/collector.
4. App có DB thì DB_DSN nối postgres service đúng credential hiện có. Không làm lộ secret
   trong command log; `.env` giữ chmod 600 và PostgreSQL data persistent.
5. Giữ deployment healthcheck `/health`. Với Express demo, collector APP_URL trỏ
   `/items?limit=1` để thấy lỗi/chậm nghiệp vụ. Không sửa healthcheck thành business probe.
6. Kiểm tra cả hai đường `stepRender` và `restoreComposeTo`: collector/config/metrics vẫn
   tồn tại khi redeploy/rollback. Tái dùng renderer compose, tránh YAML riêng cho demo.
7. Deploy v1, tạo marker PostgreSQL qua app; redeploy v2, kiểm tra DB/credential/collector.
   Giữ hai image hợp lệ cho các chặng sau; chưa dọn/reset sau test.

## File được sửa

`collector/**`, `templates/**`, `app/src/main/deploy/{templates,pipeline,service}.ts`, test và
script deploy smoke/resource-path cần thiết. Không sửa Monitor UI/model/contract để vượt chặng.

## Case và DoD

- [ ] C01-T1: unit compose có app+DB+collector; no-DB vẫn chạy, DSN không bịa cho app không DB.
- [ ] C01-T2: deploy/redeploy/restore regression không mất collector/volume/secret.
- [ ] C01-T3: live ≥10 phút, JSONL parse đúng, seq liên tục, latest khớp, null có nghĩa đúng.
- [ ] C01-T4: live stats/HTTP/DB có số thực; không lấy metric máy laptop.
- [ ] C01-T5: marker DB tồn tại sau redeploy; port/image/current deployment có bằng chứng.
- [ ] C01-T6: collector lỗi không làm app chết; log không secret; chạy lại không tạo container trùng.
- [ ] C01-T7: focused deploy/template+collector tests, typecheck/lint/scoped format và build PASS.

## Evidence và review

`c01/live-deploy.md` ghi các ID thật, image/container/config đã bỏ secret, mẫu metric,
seq/time range, DB marker và logs; handoff-c01.md. Ảnh website đang hoạt động nếu truy cập được.
Leader review compose ở cả forward/restore, shell quoting/paths/secret, data persistence và
runtime collector. JSONL có trên VPS là đủ cho C01; không nhận là SQLite/ML đã nối xong.
C01 APPROVED mới mở C02.
