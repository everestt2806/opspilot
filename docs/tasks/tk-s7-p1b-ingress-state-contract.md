# TK-S7 P1b — Persisted ingress/TLS contract

> Trạng thái: CHỜ REVIEW. P1b chỉ cập nhật hợp đồng lưu trữ và invariant SQLite; không reconcile Caddy, đổi URL ứng dụng hay ghi VPS.

## Mục tiêu

Giữ nguyên `domain_binding` và dữ liệu legacy, đồng thời tách trạng thái DNS khỏi route ingress, certificate và external HTTPS probe. `route_status='active'` chỉ hợp lệ cho `shared_ingress` sau khi DNS, route, certificate và external probe có bằng chứng hiện hành cùng hostname/generation. `domain:upsert` chỉ chứng minh DNS.

## Thiết kế và thay đổi

- Migration 010 bổ sung các trạng thái DNS/route/certificate/probe, desired/observed generation, ownership, reason code và thời điểm kiểm tra; không lưu token, private key hoặc certificate secret.
- Migration 011 tiến hành từ v10, nên profile đã áp dụng migration 010 không phải hạ cấp. Trigger SQLite tự hạ route khỏi `active`, tăng generation và xóa route/certificate/probe evidence khi `app_id`, `hostname`, `mode`, `target`, loại/tên record hoặc ownership thay đổi. Route ở mode khác `shared_ingress` không thể active.
- `DomainRepository.upsertDns()` vẫn cập nhật DNS hợp lệ. Thay đổi identity được trigger invalidation cùng transaction; trạng thái HTTPS không được kế thừa proof cũ.
- `docs/contracts/schema.sql` đồng bộ trigger của migration mới nhất và thực thi được trên SQLite rỗng; index DNS khai báo duy nhất một lần.
- Roadmap ghi Git manual deploy/redeploy có live evidence G2/G2b; push-to-deploy và HTTPS vẫn chưa có. P1e dùng ACME staging trước khi cân nhắc certificate production.

## Cập nhật P1b — 14/10/2026

- Thêm migration 011 và kiểm thử nâng cấp v9→latest cùng v10→latest; dữ liệu domain binding giữ nguyên, migration lặp an toàn và `foreign_key_check` sạch.
- Bổ sung kiểm thử SQL cho từng trường identity/ownership, invalidation bằng chứng cũ, chặn mode không phải `shared_ingress`, cùng cập nhật DNS qua repository.
- Thêm gate Vitest thực thi toàn bộ schema contract trên SQLite rỗng và kiểm tra `foreign_key_check`.

## Gate

- Node 22.23.3, focused Vitest `src/main/db/index.test.ts` và `src/main/domain/repository.test.ts`: 18/18 PASS, trong đó schema contract SQLite rỗng và `foreign_key_check` đều PASS.
- Node 22.23.3: `pnpm --dir app typecheck` PASS; `pnpm --dir app build` PASS; `git diff --check` PASS.
- VPS, Caddy, certificate issuance và external HTTPS: NOT_RUN; ngoài phạm vi P1b.

## Giới hạn còn lại

P1b chỉ lưu hợp đồng/trạng thái và bảo vệ invariant SQLite. Chưa cài/reconcile Caddy, cấp certificate, chạy HTTPS probe, thêm IPC reconcile hoặc thay URL hiện hành. Các thao tác đó thuộc P1c–P1e.
