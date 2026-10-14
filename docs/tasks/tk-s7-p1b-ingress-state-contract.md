# TK-S7 P1b — Persisted ingress/TLS contract

> Trạng thái: CHỜ REVIEW. Phụ thuộc quyết định thiết kế P1a. Không có thao tác VPS/live trong checkpoint này.

## Mục tiêu

Migration 010 giữ nguyên `domain_binding` cũ và tạo state riêng cho DNS, route ingress, certificate và external HTTPS probe. `route_status='active'` chỉ hợp lệ khi DNS propagated, route/certificate/probe đều đã kiểm tra cho cùng hostname và `observed_generation` khớp `desired_generation`. `domain:upsert` chỉ ghi DNS state; không cấu hình Caddy, không đổi URL app.

## Thay đổi

- Migration `010_domain_ingress_state.sql`: backfill DNS status từ cột `status` legacy (`active` legacy thành DNS `propagated`), giữ nguyên giá trị cột cũ và mọi metadata cũ; state route/certificate/probe khởi đầu chưa cấu hình.
- `DomainRepository.upsertDns()` chỉ đổi DNS desired state. Thay đổi mode/record/target tăng desired generation và invalidates trạng thái probe. `recordIngressObservation()` kiểm ownership/generation, reason code và bằng chứng cùng-hostname; trigger SQLite chặn direct SQL đặt active thiếu các điều kiện.
- IPC contract trả trạng thái DNS riêng; type `DomainIngressState` tách route, certificate, probe, owner keys, generations và thời điểm kiểm tra. Schema/reason code không có credential, token, private key hay certificate secret.
- Roadmap ghi rõ Git manual deploy/redeploy đã có live evidence G2/G2b; push-to-deploy và HTTPS còn thiếu. P1e dùng ACME staging trước khi cân nhắc production ACME.

## Gate hiện tại

- Focused Vitest trên Node 22.23.3: `src/main/domain/repository.test.ts`, `src/main/db/index.test.ts`, `src/main/ipc.test.ts` — 28/28 PASS.
- Node 22.23.3: `pnpm --dir app typecheck` PASS; `pnpm --dir app build` PASS; `git diff --check` PASS.
- VPS/Caddy/external HTTPS: NOT_RUN, ngoài phạm vi P1b.

## Giới hạn còn lại

P1b chỉ lưu hợp đồng/trạng thái và bảo vệ invariant trong repository/SQLite. Chưa cài hoặc reconcile Caddy, chưa cấp certificate, chưa chạy HTTPS probe, chưa thêm IPC reconcile, chưa thay URL hiện tại. Các trạng thái ingress được ghi khi checkpoint reconcile tương ứng được triển khai ở P1c–P1e.
