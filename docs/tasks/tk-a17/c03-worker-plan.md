# TK-A17/C03 — Worker plan: deploy ba loại source lên VPS

> **REVIEW_FIX_REQUIRED — review-01 ngày 12/09/2026.** Worker tiếp tục duy nhất C03 theo
> [review-c03.md](review-c03.md); không làm lại từ base cũ. Đây là task duy nhất Worker được thực hiện.
> C04 migrate và C05 rehearsal vẫn đóng cho tới khi Leader APPROVE C03.

## Mục tiêu bàn giao

Hoàn thiện detector/template và chạy thành công cùng pipeline OpsPilot cho ba source Tier 1 có sẵn:

1. `demo-apps/express-api` — Express có PostgreSQL;
2. `demo-apps/next-blog` — Next.js server;
3. `demo-apps/vite-spa` — Vite SPA tĩnh.

Mỗi source phải đi qua `detect → PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK →
RECORD`, có deployment/runtime/HTTP proof thật trên VPS. Không được dùng `docker compose` thủ công
thay pipeline để báo PASS.

## Base, quyền và ranh giới

- Kế thừa C02 APPROVED review-10: production `8fe4842`, tests `5febcbe`, submitted `313201d`,
  rồi bắt đầu từ HEAD chứa commit Leader sửa scope 14/09. Ghi exact base SHA trước sửa.
- Được sửa detector, deploy template/pipeline integration, focused test, demo README và một CLI live
  tối thiểu nếu cần để chạy service không qua UI.
- Không làm migrate, ML train/score, monitor UI, fault, rollback tự động theo cảnh báo hoặc thí nghiệm.
- Không sửa contract/type union, migration SQLite cũ hoặc thêm dependency. Flask Tier 2 không làm.
- Không reset/xóa SQLite, PostgreSQL, activation/cursor hay app đang có. Dùng tên app/port riêng;
  app B chỉ được inspect read-only.
- Không push/PR/merge/spawn subagent. Giữ nguyên `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png`.

Đọc trước: `CLAUDE.md`, `docs/contracts/detector-contract.ts`, mục deploy trong
`docs/contracts/deploy-events.md`, `docs/prompts/m03-detectors.md`, `docs/prompts/m04-deploy-pipeline.md`
và [tài liệu nguyên lý](../../25-nguyen-ly-deploy-migrate-demo-14-09.md).

## Khoảng cách code hiện tại phải đóng

- `DETECTORS` mới đăng ký Express; chưa có `nextjs.ts` và `static-spa.ts`.
- `templates/` mới có `express.Dockerfile`; thiếu hai template Tier 1.
- Next/Vite có Dockerfile riêng trong demo app nhưng sản phẩm phải sinh Dockerfile từ `BuildPlan`.
- Compose/collector/healthcheck hiện đã chạy với Express; phải chứng minh generic path vẫn đúng cho
  Next/Vite và không làm hồi quy C01/C02.

## Bước thực hiện

### C03-1 — preflight và ma trận input

1. Ghi branch/base/status/untracked; xác nhận không có experiment đang `running`.
2. Build `SourceTree` cho cả ba demo app; chụp `package.json`, `.env.example`, start/build script,
   Dockerfile tham khảo, port và route health thực tế.
3. SSH read-only VM02: Docker/resource/port/workspace hiện tại, app A và app B. Chọn ba app name mới
   không trùng, để allocator cấp port `30000–30999`.
4. Nếu VM02 drift hoặc thiếu quyền, tiếp tục test/code local; live outcome phải ghi BLOCKED cho tới
   khi chính VPS đạt. Không đổi sang mock.

### C03-2 — detector Next.js

1. Thêm detector thuần priority `30`: nhận `dependencies.next`, đọc version và `.env.example`.
2. Build plan dùng `npm ci`, `npm run build`, `npm start`, port `3000`, health `/`; phân biệt build-time
   `NEXT_PUBLIC_*` với env server runtime để không hứa sai.
3. Thêm `nextjs.Dockerfile` multi-stage Node 22; runtime chỉ chứa phần cần chạy, LF và template vars
   đúng contract.
4. Test matched/unmatched/malformed package, priority so với Vite/Express, env và render không còn
   placeholder.

### C03-3 — detector Vite SPA

1. Thêm detector thuần priority `20`: có `vite`, không có `next`; đọc version và `.env.example`.
2. Build plan build `dist`, image runtime Nginx, container port `80`, health `/`. `VITE_*` phải được
   truyền đúng thời điểm build; không đọc runtime env như thể bundle có thể đổi sau build.
3. Thêm `static-spa.Dockerfile` multi-stage Node 22 → Nginx Alpine và SPA fallback nếu app cần route.
4. Test matched/unmatched, `next+vite` chọn Next, Express+Vite chọn Vite, static asset/health và render
   không còn placeholder.

### C03-4 — tích hợp pipeline chung

1. Đăng ký detector theo priority; lỗi không nhận diện phải hiển thị signal cho đủ ba Tier 1.
2. Giữ một pipeline chung. Chỉ detector/template/BuildPlan khác nhau; không copy ba pipeline.
3. Xác nhận source upload bỏ dependency/build output, build command được quote an toàn, start command
   đúng và secret không vào event/log.
4. Collector dùng business route chỉ khi source có static `GET /items`; mọi source khác dùng health
   path. Compose không ép PostgreSQL cho Next/Vite; Express demo vẫn có health-gated PostgreSQL và
   giữ volume qua redeploy.
5. Thêm regression cancel/fail cleanup, image tag, current deployment, port allocation và C02
   activation lifecycle cho hai framework mới nếu code dùng chung bị chạm.

### C03-5 — live deploy bắt buộc

Chạy tuần tự để giảm tải VPS. Với từng source:

1. gọi detector/service thật, lưu DTO/build plan đã scrub;
2. gọi precheck và assert port chưa dùng;
3. start pipeline, thu đủ event đúng thứ tự và `finished:success`;
4. đối chiếu SQLite app/deployment/current pointer với `docker inspect` image/state/health;
5. gọi HTTP loopback trên VPS và đường trình chiếu thực tế; chụp nội dung nhận diện đúng app;
6. với Express tạo marker PostgreSQL qua API, reload và chứng minh marker còn sau một redeploy;
7. collector của từng app running, restart count không tăng bất thường và sinh metric mới;
8. ghi mọi lần fail ban đầu cùng fix/retry, không xóa evidence thất bại.

Không dừng/xóa ba app sau proof nếu chúng là input của C04; ghi manifest bàn giao chính xác.

## Case và điều kiện PASS

| Case   | Điều kiện bắt buộc                                                                         |
| ------ | ------------------------------------------------------------------------------------------ |
| C03-T1 | Detector/priority/signal của Express, Next, Vite đúng; Flask vẫn ngoài scope               |
| C03-T2 | Ba Dockerfile template render/build local hoặc fixture thật; không placeholder/CRLF/secret |
| C03-T3 | Express live deploy + PostgreSQL marker + redeploy giữ marker thành công                   |
| C03-T4 | Next.js live deploy thành công, đúng image/current deployment và HTTP nội dung app         |
| C03-T5 | Vite SPA live deploy thành công, Nginx health và HTTP/static asset đúng                    |
| C03-T6 | Cả ba đi qua pipeline/service thật, collector healthy; app B và dữ liệu C02 không bị đổi   |
| C03-T7 | Focused/static/build gates PASS; runtime đóng sạch, không open handle/process mồ côi       |

Nếu một trong ba source chưa live thành công thì C03 chưa PASS. Không hạ yêu cầu còn hai stack và không
dùng Dockerfile thủ công làm bằng chứng pipeline.

## Gate local

```text
app> pnpm exec vitest run --maxWorkers=1 src/main/detectors/detectors.test.ts \
     src/main/deploy/templates.test.ts src/main/deploy/pipeline.test.ts \
     src/main/deploy/service.test.ts
app> pnpm typecheck
app> pnpm exec tsc -p tsconfig.scripts.json --noEmit
app> pnpm exec eslint <changed-ts-tsx-files>
app> pnpm exec prettier --check <changed-code-doc-files>
app> pnpm build
collector> <venv-python> -m pytest -q
```

Chạy thêm test liên quan từ diff; không skip hay tăng timeout hàng loạt. Không chạy ML pytest vì ML
không đổi.

## Evidence và bàn giao

Tạo:

- `docs/evidence/tk-a17/c03/deploy-matrix.md` và raw log đã scrub;
- `docs/tasks/tk-a17/handoff-c03.md`;
- cập nhật task packet, board và sổ bàn giao trong cùng docs commit.

Handoff ghi exact base/code/docs SHA, commit list, command/cwd/runtime/exit/count, mapping C03-T1…T7,
bảng ba source với detector/build plan/app/deployment/image/port/health/URL/collector, PostgreSQL marker,
SQLite mutation ledger, failure attempts, final VPS state và mọi `NOT_RUN`. Kết quả cuối chỉ là
`READY_FOR_LOCAL_REVIEW` hoặc `BLOCKED`; Worker không tự APPROVE hay mở C04.
