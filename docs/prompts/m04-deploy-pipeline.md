# M04 — Deploy pipeline · Người A · Tuần 2–4

`app/src/main/deploy/pipeline.ts` + `templates/` — FR-B4, B5, B6, B7, UC-02, UC-03, UC-04

## Mục tiêu
Từ một thư mục source trên máy người dùng → ứng dụng chạy trên VPS trong **dưới 3 phút**
(NFR-4), có log real-time, có rollback tự động khi healthcheck thất bại.

**Đây là cổng kiểm soát 1 của cả dự án** (hạn 30/08). Không xong thì phần ML không có dữ liệu.

## Đọc trước
- **`docs/contracts/deploy-events.md`** — thứ tự bước, bất biến, nhánh lỗi, timeout
- `docs/contracts/schema.sql` bảng `app`, `deployment`, `action_log`
- `docs/contracts/detector-contract.ts` (`BuildPlan`)
- `docs/contracts/ipc-contract.ts` (`DeployEvent`, `PrecheckResult`)
- `docs/14-quyet-dinh-kien-truc.md` ADR-004, ADR-006

## Cấu trúc

```ts
export class DeployPipeline {
  constructor(deps: { ssh: SshManager; db: Database; emit: (e: DeployEvent) => void });
  async run(input: DeployInput, signal: AbortSignal): Promise<{ deploymentId: number }>;
  async rollback(appId: number, targetDeploymentId: number): Promise<{ deploymentId: number }>;
}
```

Bảy bước tuần tự, mỗi bước một hàm private, mỗi bước phát `step-start` → `log*` →
`step-done`/`step-failed`. **Luôn** kết thúc bằng đúng một `finished` kể cả khi lỗi hay huỷ.

## Chi tiết từng bước

**1. `PRECHECK`** (chỉ đọc, không đổi gì trên VPS)
```bash
free -m | awk 'NR==2{print $7}'        # RAM khả dụng (cột available)
df -BG --output=avail / | tail -1      # disk trống
ss -tlnp | grep -q ":<port> " && echo USED || echo FREE
docker --version && docker compose version
```
Ngưỡng: RAM >512MB · disk >2GB · port chưa dùng · Docker tồn tại.
Trả `PrecheckResult` với **con số thực tế vs yêu cầu** cho từng dòng (UI hiện bảng 3 dòng).
App mới → cấp `host_port` là port trống nhỏ nhất trong **30000–30999**; app cũ → dùng lại port đã lưu.

**2. `UPLOAD`** — `ssh.uploadDir(local, /opt/opspilot/<app>/src)`.

**3. `RENDER`** — đọc template trong `templates/`, thay biến, `writeFile` lên VPS:
`Dockerfile` · `docker-compose.yml` · `.env` (**chmod 600**).
Compose gồm: service `app` (map `<host_port>:<container_port>`, `mem_limit: 512m`,
`restart: unless-stopped`) · `collector` · `postgres` nếu `needsDb` (volume `./data/pg`).
Biến thay thế: `{{APP_NAME}} {{IMAGE_TAG}} {{HOST_PORT}} {{CONTAINER_PORT}} {{HEALTHCHECK_PATH}}
{{BUILD_COMMAND}} {{START_COMMAND}} {{COLLECT_INTERVAL_S}}`.

**4. `BUILD`** — `cd /opt/opspilot/<app> && docker build -t <app>:v<N> .`
Stream stdout/stderr **nguyên văn, giữ ANSI**, không trim, không gộp dòng.

**5. `DEPLOY`** — `docker compose up -d`. Chờ container app ở trạng thái `running`.

**6. `HEALTHCHECK`** — `curl -fsS -m 5 http://127.0.0.1:<host_port><path>` ×10, cách 3 giây.
≥1 lần 2xx → qua. Thất bại hết → **tự rollback về v(N-1)** nếu có; không có → `status='failed'`,
**giữ nguyên container** để người dùng xem log.

**7. `RECORD`** — cập nhật `deployment` (`status`, `finished_at`, `total_duration_ms`,
`build_duration_ms`), ghi `action_log`, xoá image cũ chỉ giữ **3 bản gần nhất**.
Lỗi ở bước này chỉ log warning, **không** làm fail cả deploy.

## Rollback

`rollback(appId, targetDeploymentId)`: `docker compose up -d` với `IMAGE_TAG` của version đích
(image đã có sẵn trên VPS) → healthcheck → tạo bản ghi `deployment` mới với
`is_rollback_of = targetDeploymentId`, `status='running'`. **Không build lại** — đây là lý do
giữ 3 image (ADR-004), rollback mất ~10 giây.

## Bất biến (vi phạm là bug nghiêm trọng)

1. **Không bao giờ xoá `data/` hoặc volume** ở bất kỳ nhánh lỗi nào.
2. `PRECHECK` không thay đổi gì trên VPS.
3. `.env` **chỉ đi một chiều** lên VPS: không tải ngược về, không ghi vào SQLite, không xuất
   hiện trong log (che bằng `***`).
4. Cấp `version` trong transaction: `SELECT MAX(version)+1 FROM deployment WHERE app_id=?`.
5. Huỷ giữa chừng = `step-failed` ở bước đang chạy + chạy đúng nhánh dọn dẹp của bước đó.
6. Mỗi bước có timeout riêng (bảng ở `deploy-events.md` mục 3).

## Script thử — `pnpm try:deploy` (`app/scripts/try-deploy.ts`)
Chạy trọn pipeline từ CLI với đường dẫn source và `vps_id` truyền vào, in event ra console.
**Làm việc này TRƯỚC khi nối vào UI** — debug deploy qua giao diện chậm gấp nhiều lần.

## Định nghĩa xong (Cổng 1)
- [ ] Deploy thành công **cả 3** demo app Tier 1 từ CLI, mỗi app **< 3 phút**
- [ ] Mở được URL `http://<vps-ip>:<host_port>` từ trình duyệt ngoài
- [ ] Log `docker build` chảy real-time, có màu
- [ ] Deploy lần 2 cùng app → `version` tăng, dùng lại đúng `host_port`
- [ ] Cố tình làm healthcheck fail (sửa `healthcheckPath` sai) → **tự rollback về v(N-1)**,
      app cũ chạy lại được
- [ ] Ngắt mạng giữa `UPLOAD` → `step-failed` đúng bước, VPS không còn rác
- [ ] `docker image ls` chỉ còn tối đa 3 image của app đó
- [ ] `grep -r "PASSWORD" ~/.opspilot/logs/` → không có giá trị thật
