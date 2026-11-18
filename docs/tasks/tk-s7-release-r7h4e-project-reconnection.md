# R7h-4e — nhận lại dự án/cấu hình Product

UPDATE 18/11/2026 — E4a frozen candidate/compiled12 giữ11pin cũ/native22/19/24/24,
full2733PASS+2existingLinuxSKIP/build/resource5checks PASS. [Task E4](tk-s7-release-r7h4e4-reconnection-rollout.md),
[candidate proof](../ui-redesign/r7h4e4-candidate-verification.json). Chưa serving
hoặc actual VPS GUI. User đã thay hạ tầng hết hạn bằng4máy mới; chỉ máy1+2 cho
assistant,3+4 Kim; public keyscan theo first-contact được user cho phép đã xong.
Fresh authenticated onboarding/serving/GUI là E4b OPEN, không dùng lại data claims
hoặc receipt của máy cũ. Chi tiết [allocation](tk-s7-vps-allocation-20261118.md).

UPDATE 17/11/2026 — E3 IPC/UI PASS trong phạm vi:5IPC IDs-only, explicit consent,
fresh restore và inspector provenance riêng; A→B→A dùng matching consent có kiểm
lại. Full2733PASS+2existingLinuxSKIP, standalone5 và Electron6checks/25captures
private/cleanup, types/lint/build PASS. [Task E3](tk-s7-release-r7h4e3-reconnection-ui.md),
[proof E3](../ui-redesign/r7h4e3-verification.json). E4 approved release/installed
composition/serving/actual VPS GUI vẫn OPEN; không dùng router lab thay live proof.

UPDATE 17/11/2026 — E2 backend/installed transport PASS trong phạm vi riêng:
Desktop039 consent journal, full2712PASS+2existingLinuxSKIP, native Root/Main23,
sameUID16 và Main standalone6checks/cleanup; types/lint/build PASS. Chi tiết và
source/raw hashes tại [task E2](tk-s7-release-r7h4e2-reconnection-main.md) và
[proof E2](../ui-redesign/r7h4e2-verification.json). Không thay kết quả E1 lịch sử;
E3 IPC/UI/inspector và E4 approve/serving/GUI còn OPEN. Không giả receipt cũ.

START17/11/2026 — Base1bb56ad. User tiếp tục core development, normal checkpoint
commit/push đã được cho phép. Kim giữ lane Windows delivery; không sửa file Kim.
Serving63d1/schema37/8apps/2PG giữ nguyên cho tới gate phát hành riêng.

Giả định phạm vi: một máy Desktop mới cần xem cấu hình hiện tại từ controller đã
xác minh, sau đó người dùng xác nhận nhận lại dự án bằng một journal có provenance
riêng. Không tạo giả lịch sử register/prepare/select, không xem metadata là đã
deploy/ready. Giữ kiểm tra receipt cũ cho các dự án tạo từ Desktop.

| Requirement | Evidence | State |
|---|---|---|
| E1 contract/design | Contract + DECISIONS: discover/recheck digest; review_required/not_granted, không giả historical receipts; standalone contract typecheck PASS. Main consent/journal/UI ở checkpoint sau | PASS |
| E1 readonly backend/CLI | Private bundle d4e1543f, native CLI309e20b86683 PASS15checks/cleanup: SSHD tắt, SQLite bytes không đổi, auto enabled giữ nguyên, stale/wrong authority refused. Chưa approved/serving | PASS |
| E1 verification | Full2694PASS+2existingLinuxSKIP/185files;16test mới, focused106 trong triển khai; native15 trên exact artifact/cleanup; node/web/scripts/contract types, scoped lint/format/build/diff PASS | PASS |
| E1 handoff | Board/task/proof và hashes đã đối chiếu; normal commit/push với Kim coauthor, SHA tra git log bên dưới. Không serving/Root-admin/Main/IPC/UI claim từ E1 | PASS |

Checkpoint tiếp theo:

1. E2: Main review/explicit consent, journal riêng và current-authority revalidation;
   không thay registration/selection receipt gốc. New Desktop/profile đổi VPS-ID
   phải có verified controller binding và fresh target identity.
   Resolver phải phân biệt provenance đăng ký và nhận lại; không ép snapshot hiện
   tại thành `ProductProjectRegistrationResult` (type cũ cố định source generation1).
   Rà foreign key của intent038 trước khi cho phép thao tác cấu hình từ journal mới;
   dùng migration mới khi cần, không ghi hàng giả vào `desktop_project_setup`.
2. E3: typed IPC/UI chọn app tìm thấy, xem khác biệt và xác nhận; stale/late results,
   failure/retry, bốn locale. Inspector nhận cả provenance registration hoặc explicit
   reconnection đã xác thực; không tự học thay đổi source.
3. E4: frozen candidate/native Root/Main/resource gates, protected rollout; actual
   Electron với hồ sơ hợp lệ, hai database cùng tên nhưng khác UUID, cleanup đúng
   quyền sở hữu. Giữ8app/2PG hiện có, không dựng tài nguyên production chỉ để lấp test.

Không claim E2–E4 từ E1. Product backup/restore/migrate và formal ML vẫn separate;
formal ML NOT_RUN theo hạ tầng user chưa cấp. Không PR/merge/reset/clean/stash/rebase.

UPDATE17/11 — E1 native309e20b86683 dùng exact private payload d4e1543f,15checks,
SSHD đã tắt, toàn bộ serialized SQLite không đổi, không production VPS/DB/Docker,
fixture cleanup PASS. DTO danh sách target không có auth_type; reader xác thực đầy
đủ credential binding và so public projection, rồi kiểm lại toàn bộ scope. Các lỗi
fixture pause-policy (pause_reason=NULL), literal type và unused variables đã sửa;
không bỏ qua test/gate lỗi. Full/build cuối cùng đã PASS.

## HANDOFF17/11 — E1 PASS, CHỜ REVIEW

- [Proof và source/raw hashes](../ui-redesign/r7h4e1-verification.json).
- Full Vitest:185files PASS+1file skip,2694tests PASS+2existingLinux-only SKIP,
  0FAIL;16test mới. Focused106tests đã pass trong triển khai, full cuối cùng bao
  phủ đúng source sau sửa lint. Node/Web/Scripts typecheck, contract standalone
  TypeScript, scoped ESLint0warnings/format/build/diff PASS.
- Native CLI15checks, record309e20b86683, private bundle
  `d4e1543f4f6d14f5af9325c41b951565d8f6c485f4fc48ee1e768e2d84a2f615`;
  binary hash khớp artifact thật đã chạy, chưa được approve làm serving release.
  Metadata Git/PG đã xác thực đọc được khi SSHD tắt; auto enabled không bị pause,
  không job/DB write. Các ca wrong app/controller/digest/target injection bị chặn;
  toàn bộ SQLite bytes trước/sau không đổi và fixture đã dọn.
- Unit bổ sung ENV→PG/PG→ENV, query_only connection, source/owner/policy/target
  drift, archived/revoked authority, sai key, ciphertext tamper, late metadata
  drift và forged digest/cross-app/repository URL. Không xuất credential/env values.
- Không đổi schema, approved catalog, file Kim hay VPS. Controller đang được ghim
  release63d1 từ checkpoint trước; E1 không kiểm nghiệm lại live và không tuyên bố
  UI đã nhận lại dự án. E2/E3/E4 và toàn tính năng reconnect còn OPEN.
- Commit lookup: `git log -1 -- docs/ui-redesign/r7h4e1-verification.json`.
  Normal push được phép, Kim coauthor; không PR/merge/force/reset/stash/clean/rebase.

### Lệnh kiểm chứng

`. ./tools/enter-node22.ps1`; `pnpm --prefix app exec vitest run --reporter=dot`;
`pnpm --prefix app build`; `pnpm --prefix app exec tsc -p tsconfig.scripts.json
--noEmit`; standalone contract với `tsc --noEmit --skipLibCheck --target ES2022
--module ESNext --moduleResolution bundler ../docs/contracts/product-project-reconnection.ts`.
Scoped ESLint/Prettier trên năm source TS, selection lab và reconnection lab mới.
Raw full/build logs: `app/.out-scripts/r7h4e1-{full,build}.log`.

Private Linux/root Node22: build controller ở thư mục nonce riêng, dùng
`OPSPILOT_CONTROL_PLANE_MODULES`, `OPSPILOT_CONTROL_PLANE_OUTPUT` và public source
fixture đã duyệt; đặt `OPSPILOT_PROJECT_RECONNECTION_GATE=1`, bỏ inspection gate
Docker, chạy selection lab như README. Raw native:
`app/.out-scripts/product-postgres-selection/309e20b86683/proof.json` và
`app/.out-scripts/r7h4e1-native-final.log`. Không dùng credential/VPS sản phẩm.
