# OpsPilot — Desktop app deploy/migrate web app lên VPS + ML phát hiện degraded state

Dự án CNTT · 2 người · hạn nộp **20/11/2026**

Ứng dụng desktop kết nối VPS qua SSH để deploy/migrate web app đa framework, đồng thời
thu thập metric vận hành và chạy song song 4 phương pháp phát hiện bất thường
(rule-based, Z-score/EWMA, Isolation Forest, One-Class SVM + ensemble) để phát hiện suy
giảm vận hành và tự động rollback trước khi ứng dụng chết hẳn.

**Không cài agent thường trực trên VPS** — chỉ có Docker và các container của chính ứng dụng.

---

## Trạng thái

| Giai đoạn | Trạng thái |
|---|---|
| Tài liệu & hợp đồng kỹ thuật | ✅ Xong (tuần 0) |
| Duyệt đề tài với giảng viên | ⏳ Đang chờ |
| Code | 🏗️ Đang triển khai tuần 1 — xem [`docs/tasks/`](docs/tasks/) |

> **Rebaseline 09/08/2026:** nhóm bắt đầu triển khai vào **10/08/2026**. Bốn tuần đầu ưu tiên
> lát cắt chạy thật từ SSH → deploy → metric → ML/dashboard, mục tiêu nghiệm thu **16/24 yêu
> cầu chức năng (66,7%)** vào 11/09. Lịch mới: [`docs/04-timeline.md`](docs/04-timeline.md).

---

## Bắt đầu từ đâu

**Người mới vào dự án / AI mới vào phiên làm việc — đọc theo thứ tự:**

1. [`CLAUDE.md`](CLAUDE.md) — quy tắc bất biến + các con số đã chốt. **Bắt buộc.**
2. [`docs/README.md`](docs/README.md) — bản đồ toàn bộ tài liệu.
3. [`docs/01-ke-hoach.md`](docs/01-ke-hoach.md) — kiến trúc + spec 10 module.
4. [`docs/contracts/`](docs/contracts/) — hợp đồng kỹ thuật, không được sửa tuỳ tiện.
5. [`docs/tasks/`](docs/tasks/) — chọn một task trên board, đọc hồ sơ `tk-*`, tạo branch, bàn giao PR và cập nhật trạng thái.

**Sắp code một module cụ thể:** mở `docs/prompts/mXX-*.md` tương ứng, dán vào AI cùng với
`CLAUDE.md`. Đó là toàn bộ ngữ cảnh cần thiết.

---

## Yêu cầu môi trường

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 22 LTS | có `.nvmrc` |
| pnpm | 9+ | `corepack enable` |
| Python | 3.12 | cho `ml-service/`, `experiments/` |
| Docker Desktop | mới nhất | chỉ để test collector local, không bắt buộc |
| VPS | 2 × Ubuntu 24.04 LTS, 2vCPU/4GB/40GB | cùng provider, cùng region |

Hướng dẫn chi tiết + bẫy trên Windows: [`docs/09-moi-truong-dev.md`](docs/09-moi-truong-dev.md)
Dựng VPS: [`docs/08-vps-setup.md`](docs/08-vps-setup.md)

---

## Cấu trúc repo

```
app/            Electron (main: SSH, deploy, migrate, poller, SQLite | renderer: React + AntD)
ml-service/     FastAPI + scikit-learn, chạy localhost:8765, do Electron spawn
collector/      Script Python chạy trong container trên VPS, ghi metrics.jsonl
templates/      Dockerfile + docker-compose template cho từng framework
experiments/    Fault injection, load generator, chạy thí nghiệm, phân tích P/R/F1
demo-apps/      3 app mẫu Tier 1 để test và demo
docs/           Toàn bộ tài liệu, hợp đồng kỹ thuật, prompt cho AI
```

---

## Lệnh thường dùng (sẽ có từ tuần 1)

Trên máy có nhiều bản Node, chạy một lần ở đầu terminal PowerShell:

```powershell
. .\tools\enter-node22.ps1
```

```bash
pnpm dev          # chạy Electron ở chế độ dev (tự spawn ml-service)
pnpm typecheck    # kiểm tra TypeScript
pnpm lint         # ESLint + Ruff
pnpm test         # Vitest + Pytest
pnpm build        # build mã nguồn Electron
pnpm build:win    # tạo bộ cài Windows bằng electron-builder
```

---

## Tài liệu quan trọng nhất

- Kế hoạch & spec module → [`docs/01-ke-hoach.md`](docs/01-ke-hoach.md)
- Lịch 16 tuần theo ngày thật → [`docs/04-timeline.md`](docs/04-timeline.md)
- Bảng task & trạng thái trong repo → branch → PR → Done → [`docs/tasks/`](docs/tasks/)
- Hồ sơ một file gửi engineer/giảng viên review kiến trúc → [`docs/19-ho-so-review-va-chot-kien-truc.md`](docs/19-ho-so-review-va-chot-kien-truc.md)
- Giao thức thí nghiệm (phần ăn điểm) → [`docs/07-giao-thuc-thi-nghiem.md`](docs/07-giao-thuc-thi-nghiem.md)
- Nhật ký quyết định → [`DECISIONS.md`](DECISIONS.md)
