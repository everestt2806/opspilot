# TK-B6 — M5: chạy collector bằng Docker trên VPS

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 03/09/2026 | feat/m05-collector-docker | `docs/prompts/m05-collector.md`, `docs/08-vps-setup.md` | P0 |

## Mục tiêu

Đóng gói collector vào container Alpine (script ~150 dòng, theo quy tắc bất biến 8) và chạy
thật trên VPS, ghi vào `/opt/opspilot/<app>/metrics/`. Đây là một nửa cột "hai VPS dùng được"
của gate G0.

**Ghi chú 08/09:** board ghi VM01, nhưng VM01 đang bị chặn TCP/22 từ máy dev (đã ghi ở
TK-A15: "VM01 TCP/22 còn chặn"). Nhóm quyết định chạy B6 trên **VM02** trước để không chặn
TK-S4; khi VM01 mở lại port thì lặp lại tương tự cho nửa còn lại.

## Được sửa

- `collector/Dockerfile`, `collector/**` (của B).

## Không được sửa

- `docs/08-vps-setup.md` (của nhóm — sửa thì báo); không chạy lệnh phá hủy trên VPS.

## Definition of Done

- [x] Image build được trên VPS, kích thước hợp lý (Alpine)
- [x] Container chạy ≥10 phút trên VPS thật, sinh đúng JSONL trong `/opt/opspilot/<app>/metrics/`
- [x] Restart policy hợp lý; không mở thêm port trên VPS
- [ ] Báo A để A nghiệm thu readFileTail trên file thật (khép TK-A5)

## Nhật ký

- START 20/08 — VPS đã mua từ 19/08 (TK-S2), điều kiện cần đã có.
- UPDATE 19/08 — **Lùi W2** cùng chuỗi collector (quyết định dồn lực demo 24/08). Hạn dời
  28/08; VPS vẫn sẵn sàng (2 máy nghiệm thu 6/6) nên không mất điều kiện gì.
- ASSIGNED 30/08 — Rebaseline hạn 03/09; chỉ kéo sau TK-B5. Xong B6 báo A để chạy TK-S4
  trong ngày 04/09, rồi B chuyển sang TK-B8 Dashboard.
- START 08/09 — chạy trên **VM02** (`221.121.1.80`, key riêng `~/.ssh/vm02_key`) vì VM01
  còn chặn TCP/22. Triển khai bằng tay theo đúng bố cục contract `metric-format.md`:
  `/opt/opspilot/express-demo/` với `src/`, `collector/`, `metrics/` (chmod 755).
  Build 2 image trên VPS: `opspilot-demo-express:local` (246MB) từ `demo-apps/express-api`,
  `opspilot-collector:1.0.0` (157MB) từ `collector/` — Dockerfile hiện tại đã được duyệt ở
  B4/B5 nên giữ nguyên. `docker-compose.yml`: app (port host 30001, mem_limit 512m,
  healthcheck wget /health) + collector (mount docker.sock ro + `./metrics:/var/metrics`,
  `APP_URL=http://express-demo-app:3000/health` qua docker network, mem_limit 128m,
  `restart: unless-stopped`, không EXPOSE port). Sau 35 giây đã có 4 dòng JSONL đúng từng
  trường; collector không in lỗi nào.
- UPDATE 08/09 — smoke 11 phút 10 giây PASS, đủ DoD 10+ phút (bằng chứng dưới). Tick 3/4
  DoD; còn bước nghiệm thu readFileTail của A (chung TK-A5/TK-S4).

## Bằng chứng chạy thật (08/09, VM02)

- `docker compose ps`: `express-demo-app Up (healthy)`, `express-demo-collector Up`.
- Dòng đầu: `{"seq":1,"ts":"2026-09-08T07:41:11Z","cpu_pct":40.69,...,"latency_ms":19.7,
  "http_error_rate":0.0,"db_response_ms":null,"container_up":1,...}` — khớp từng trường
  với `metric-format.md` (null ≠ 0: app không có DB → `db_response_ms` null).
- Chạy 11 phút 10 giây (07:41:11Z→07:52:21Z): **68 dòng, `seq` 1..68 liên tục, 67 gap đều
  đúng 10,0s** (min=max=10.0), `latency_ms` thật cả 68 mẫu (3.5–19.7ms), `container_up=1`
  cả phiên, `db_response_ms` null đúng quy tắc (app không DB), `http_error_rate` 0.0,
  `latest.json` khớp byte dòng cuối, dòng to nhất 293 byte (<4KB).
- Tài nguyên: collector 18.24MiB/128MiB, app 31.5MiB/512MiB; `restart=unless-stopped`,
  `PortBindings` rỗng (không mở thêm port).

## Lệnh tái hiện

```bash
# trên máy dev (đã có key VM02 trong ~/.ssh/vm02_key):
K=~/.ssh/vm02_key; VM=deploy@221.121.1.80
ssh -i $K $VM 'mkdir -p /opt/opspilot/express-demo/{src,collector,metrics}'
scp -i $K demo-apps/express-api/{Dockerfile,package.json,package-lock.json,server.js} $VM:/opt/opspilot/express-demo/src/
scp -i $K -r demo-apps/express-api/public $VM:/opt/opspilot/express-demo/src/
scp -i $K collector/{collect.py,requirements.txt,Dockerfile} $VM:/opt/opspilot/express-demo/collector/
ssh -i $K $VM 'cd /opt/opspilot/express-demo/src && docker build -q -t opspilot-demo-express:local .'
ssh -i $K $VM 'cd /opt/opspilot/express-demo/collector && docker build -q -t opspilot-collector:1.0.0 .'
# ghi docker-compose.yml như mục Nhật ký, rồi:
ssh -i $K $VM 'cd /opt/opspilot/express-demo && docker compose up -d && sleep 5 && docker compose ps'
ssh -i $K $VM 'wc -l /opt/opspilot/express-demo/metrics/metrics.jsonl'
ssh -i $K $VM 'tail -1 /opt/opspilot/express-demo/metrics/metrics.jsonl; cat /opt/opspilot/express-demo/metrics/latest.json'
```

## PR

— (chưa có)
