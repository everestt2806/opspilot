# TK-A13 — M4 lát cắt demo: deploy Express thật lên VM01 (PRECHECK→RECORD)

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 23/08/2026 | feat/m04-deploy-express | `docs/prompts/m04-deploy-pipeline.md`, `docs/contracts/deploy-events.md` | P0 |

## Mục tiêu

Kéo TK-A8 (M4) lên sớm cho demo 24/08: chạy trọn pipeline PRECHECK→UPLOAD→RENDER→BUILD→
DEPLOY→HEALTHCHECK→RECORD deploy `demo-apps/express-api` thật lên VM01 (221.121.1.79)
port 30xxx, thao tác từ UI, app chạy được qua mở URL, ghi nhận đầy đủ vào bảng `app`,
`deployment`, `action_log`. Kèm handler `vps:install-docker` (nút "Cài Docker ngay" còn
treo từ TK-B7) và detector tối thiểu (express) để pipeline có `BuildPlan`.

## Được sửa

- `app/src/main/deploy/**` (mới), `app/src/main/detectors/**` (thêm lõi tối thiểu),
  `app/src/main/vps/**`, `app/src/main/ssh/manager.ts` (thêm cờ ghi lặng cho `.env`),
  `app/src/main/db/**` (repository app/deployment/log), `app/src/main/ipc.ts`,
  `app/src/main/index.ts`, `app/scripts/**` (thêm `try-deploy.ts`), `templates/**` (mới),
  `app/src/renderer/**` (DeployPage + nút Cài Docker ngay), test các phần trên.

## Không được sửa

- `docs/contracts/**` — mọi struct theo đúng `deploy-events.md`, `ipc-contract.ts`,
  `schema.sql`, `detector-contract.ts`.
- `experiments/**`, `ml-service/**`, `collector/**`, `demo-apps/express-api/**`
  (sửa demo app phải qua TK-B2).

## Definition of Done

- [ ] `pnpm try:deploy` chạy trọn pipeline thật trên VM01: app express sống port 30xxx
- [ ] `curl http://221.121.1.79:<port>/health` trả 200 từ ngoài (mở URL bằng trình duyệt)
- [ ] Thao tác từ UI (DeployPage): chọn VPS → chọn folder → deploy → log live → mở URL
- [ ] DB ghi đủ: `app` + `deployment` (version, duration) + `action_log`
- [ ] Deploy lần 2 cùng app: version tăng, dùng lại host_port (evidence trong tk nhật ký)
- [ ] Huỷ giữa chừng / lỗi bước → `step-failed` đúng bước + đúng một `finished` + dọn đúng nhánh lỗi
- [ ] `vps:install-docker` hạ cánh đúng (nút "Cài Docker ngay" có confirm, cập nhật `docker_version`)
- [ ] Unit test các phần pure (detector, template, precheck parse) + lint/typecheck sạch
- [ ] Không rò secret: `.env` không vào log; `grep -r "DATABASE_URL"` trong log rỗng

## Nhật ký

- START 19/08 — Kéo sớm cho demo 24/08 (cùng đợt dồn lực tuần 1, docs/20 cập nhật 19/08).
  Kế hoạch phiên: đọc spec M4 + contract → dựng pipeline + templates → try-deploy CLI chạy
  thật VM01 → nối IPC + DeployPage → test/lint → PR.
- UPDATE 19/08 — `pnpm try:deploy` chạy thật VM01 (221.121.1.79): deploy v1 PASS — finished
  `running`, port 30000, tổng 54.7s (PRECHECK→BUILD→DEPLOY→HEALTHCHECK→RECORD đủ), healthcheck
  nội bộ `curl http://127.0.0.1:30000/health` trả 200, DB ghi `app` + `deployment`
  (current_deployment_id = v1). Bước 2 "healthcheck từ ngoài" FAIL → đã điều tra trên VPS:
  docker-proxy LISTEN 0.0.0.0:30000, curl local 200, không có ufw/firewalld, iptables INPUT
  policy ACCEPT ⇒ không phải bug code — **firewall nhà cung cấp (WiService) chặn inbound dải
  port app, chỉ mở 22**. Đây chính là case chẩn đoán sẽ demo 24/08. Việc cần làm (phía user):
  mở port 30000–30999 trong panel provider → chạy lại để hoàn thành deploy v2 + kiểm tra DB.
  Vì script dừng ở bước FAIL đầu tiên nên v2 thật chưa chạy; path redeploy đã có unit test.
- UPDATE 19/08 (2) — Hoàn tất UI: `DeployPage.tsx` wizard 4 bước đúng spec docs/02 mục 3.2
  (chọn VPS → chọn thư mục → nhận diện framework + signals khi không khớp → cấu hình env
  bắt buộc/tuỳ chọn + App mới/redeploy → bảng precheck + URL + nút Deploy) và log live cơ bản
  theo mục 3.3 (stepper 7 bước, terminal stdout/stderr đã lọc ANSI, timer, Huỷ có confirm
  `deploy:cancel`, banner thành công kèm nút Mở app, banner lỗi đúng bước + technical, quay
  lại wizard giữ nguyên source/env). Nút "Cài Docker ngay" hạ cánh trong ConnectionCheck
  (Modal.useModal, edit flow truyền `vpsId`, create flow hint lưu trước). Kiểm thử:
  22 files / 108 tests PASS (DeployPage 5 tests: happy path end-to-end cả filter event theo
  deploymentId, lỗi bước BUILD, huỷ giữa chừng, detect unmatched, precheck fail disabled
  nút Deploy; ConnectionCheck 2 tests mới: cài Docker có vpsId, chưa lưu chỉ hint), lint
  0 error 0 warning, typecheck sạch. Điểm dở dang: log live xterm đầu tư cao để TK-A14
  (đúng phân công trên board), và click-through UI thật chờ mở port firewall phía user.

## Lệnh tái hiện

```bash
cd app && pnpm test                         # unit test main + renderer
pnpm try:deploy --vps-id 1 --source ../demo-apps/express-api   # chạy thật VM01
pnpm dev                                    # DeployPage: chọn VPS -> chọn folder -> Deploy
```

## PR

- (chưa mở)