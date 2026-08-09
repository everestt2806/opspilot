# CLAUDE.md — Ngữ cảnh bắt buộc cho mọi AI làm việc trên repo này

> File này được Claude Code nạp tự động. Với **model AI khác** (ChatGPT, Gemini, Copilot,
> Cursor...): dán nguyên file này + file spec module đang làm vào đầu phiên chat.
> Bản rút gọn để dán tay: `docs/prompts/00-context-chung.md`.

---

## 1. Dự án là gì

Đồ án tốt nghiệp: **ứng dụng desktop (Electron) deploy & migrate web app lên VPS qua SSH,
kèm module ML phát hiện suy giảm vận hành (degraded state) và tự động rollback.**

Điểm số của đồ án nằm ở **phần thí nghiệm ML và đánh giá thống kê**, không nằm ở app đẹp
hay kiến trúc phức tạp. App chỉ cần chạy đúng và ổn định để sinh dữ liệu cho thí nghiệm.

- Nhóm 2 người. Người A = App/Infra. Người B = ML/Monitoring.
- Deadline nộp: **20/11/2026**. Lịch chi tiết: `docs/04-timeline.md`.

---

## 2. 12 QUY TẮC BẤT BIẾN (vi phạm = reject PR, không tranh luận lại)

1. **Không overengineering.** Chỉ có đúng 2 tiến trình: Electron app và Python ML service.
   Không message queue, không Redis, không microservice, không Docker Compose cho chính tool.
2. **SQLite cho mọi thứ của tool** (cấu hình, lịch sử, metric, score, nhãn). PostgreSQL chỉ
   tồn tại bên trong app demo được deploy lên VPS.
3. **Mọi lệnh trên VPS đi qua `ssh exec`.** Không viết agent, không gRPC, không websocket
   tới VPS, không mở thêm port trên VPS ngoài port app.
4. **"Plugin detector" = một mảng object cùng interface trong một thư mục.** Không dynamic
   loading, không plugin runtime. Thêm framework = thêm 1 file + 1 dòng đăng ký vào mảng.
5. **Không authentication, không multi-user, không cloud sync, không auto-update.**
6. **UI dùng Ant Design v5 mặc định.** Không tự thiết kế component, không Tailwind,
   không custom theme ngoài design token đã chốt trong `docs/02-ui-ux-spec.md`.
7. **Migrate chỉ hỗ trợ app do chính tool này deploy.** Không migrate app lạ.
8. **Không cAdvisor / Prometheus / Grafana / Kubernetes.** Collector là 1 script Python
   ~150 dòng trong container Alpine.
9. **Không deep learning.** Đúng 3 mô hình + 1 ensemble: Z-score/EWMA, Isolation Forest,
   One-Class SVM, Ensemble voting.
10. **Không sửa file trong `docs/contracts/`** khi đang code một module. Contract là hợp
    đồng giữa 2 người và giữa các phiên AI. Muốn đổi → xem mục 5.
11. **Không tự "cải tiến" interface, tên bảng, tên trường, tên event, tên endpoint.**
    Sai một chữ là hai nửa hệ thống không nối được.
12. **Tier 2 (Flask) chỉ làm ở tuần 10 nếu dữ liệu chính thức W9 đã hoàn tất và mọi gate đều
    xanh.** Nếu pilot W8 chưa hoàn tất → cắt Tier 2 vĩnh viễn.

---

## 3. Nguồn sự thật (source of truth) — đọc đúng file, không đoán

| Cần biết gì | Đọc file |
|---|---|
| Schema DB, tên bảng/cột | `docs/contracts/schema.sql` |
| API của ML service | `docs/contracts/ml-api.openapi.yaml` |
| Kiểu dữ liệu IPC main↔renderer | `docs/contracts/ipc-contract.ts` |
| Interface Detector | `docs/contracts/detector-contract.ts` |
| Format file metric trên VPS | `docs/contracts/metric-format.md` |
| Event của deploy/migrate pipeline | `docs/contracts/deploy-events.md` |
| Spec module đang code | `docs/01-ke-hoach.md` PHẦN 4 + `docs/prompts/mXX-*.md` |
| Spec màn hình UI | `docs/02-ui-ux-spec.md` |
| Giao thức thí nghiệm | `docs/07-giao-thuc-thi-nghiem.md` |
| Quy ước đặt tên, đơn vị, timezone | `docs/06-glossary-quy-uoc.md` |
| Quy ước code, lỗi, log | `docs/10-quy-uoc-code.md` |
| Yêu cầu FR/NFR gốc và ai cover | `docs/05-truy-vet-yeu-cau.md` |

Nếu hai file mâu thuẫn nhau: **`docs/contracts/` thắng**, rồi đến `docs/01-ke-hoach.md`,
rồi mới đến các file còn lại. Phát hiện mâu thuẫn → dừng, báo người dùng, không tự chọn bừa.

---

## 4. Cấu trúc repo (đích đến, chưa tồn tại hết)

```
app/                    Electron + React + TS
  src/main/             ssh/ crypto/ db/ detectors/ deploy/ migrate/ monitor/ ipc.ts
  src/renderer/         React pages theo use case UC-01..UC-09
  src/shared/           type dùng chung main↔renderer (copy từ docs/contracts/)
ml-service/             FastAPI + scikit-learn (main.py, models/, features.py)
collector/              collect.py + Dockerfile (chạy trên VPS)
templates/              Dockerfile template từng framework + docker-compose.template.yml
experiments/            faults/ load_gen/ run_experiment.py analyze.py results/
demo-apps/              next-blog/ express-api/ vite-spa/
docs/                   toàn bộ tài liệu (file này trỏ tới)
```

---

## 5. Quy trình làm việc bắt buộc cho AI

**Trước khi viết dòng code đầu tiên của một module:**
1. Đọc `docs/prompts/mXX-*.md` của module đó.
2. Đọc các contract mà module đó chạm vào (bảng trong mục 3).
3. Nếu spec thiếu thông tin để quyết định → **hỏi, không tự chế**. Tự chế interface là lỗi
   nặng nhất trong repo này vì người kia đang code phía bên kia của interface.

**Khi viết code:**
- Bám đúng tên hàm/tham số/kiểu trả về ghi trong contract.
- Mỗi module phải chạy được **độc lập bằng script CLI trước khi nối vào UI**
  (`app/scripts/try-<module>.ts` hoặc `ml-service/scripts/`). Debug SSH/deploy qua UI rất chậm.
- Không thêm dependency mới nếu chưa có trong `docs/09-moi-truong-dev.md` mục "Dependency đã duyệt".

**Khi cần đổi contract (hiếm, phải có lý do kỹ thuật thật):**
1. Nói rõ đổi gì, vì sao, ảnh hưởng module nào.
2. Sửa file trong `docs/contracts/`.
3. Ghi 1 dòng vào `DECISIONS.md` theo đúng format có sẵn.
4. Nếu đổi schema: thêm file migration mới, **không sửa migration cũ** đã chạy trên máy người kia.

**Sau khi xong một module:** cập nhật ô trạng thái trong `docs/05-truy-vet-yeu-cau.md`.

---

## 6. Những con số đã chốt (không tự đổi)

| Thứ | Giá trị | Ghi ở |
|---|---|---|
| Chu kỳ collector ghi metric | **10 giây** | ADR-007 |
| Chu kỳ poller kéo metric qua SSH | **30 giây** (nạp toàn bộ dòng mới) | ADR-007 |
| Cửa sổ trượt tính feature | **20 mẫu** (≈200 giây) | M7 |
| Số metric đưa vào feature | **5** (cpu_pct, mem_mb, latency_ms, http_error_rate, db_response_ms) | M7 |
| Feature mỗi metric | **4** (giá trị, mean, std, slope) → vector 20 chiều | M7 |
| Mẫu tối thiểu để train | **≥150** (khuyến nghị 180 = 30 phút baseline) | ADR-007 |
| Ngưỡng score cảnh báo mặc định | **0.7**, cần **2 mẫu liên tiếp** | M7 |
| Ensemble triggered | khi **≥2/3** model vượt ngưỡng | ADR-008 |
| Auto-rollback | trusted_method triggered **3 lần liên tiếp**, cooldown **10 phút** | M8 |
| Ngưỡng rule mặc định | cpu>90%, mem>90%, latency>2000ms, error_rate>0.5, 3 mẫu liên tiếp | M6 |
| Precheck VPS | RAM trống >512MB, disk trống >2GB, port đích chưa dùng | M4 |
| Dải port cấp cho app | **30000–30999** | ADR-006 |
| Thư mục làm việc trên VPS | `/opt/deploytool/<app_name>/` | metric-format.md |
| Cổng ML service | **8765** (localhost, có fallback +1 nếu bận) | M7 |
| Số image cũ giữ lại để rollback | **3** | M4 |
| 1 run thí nghiệm | baseline train 30' + holdout 15' + fault 20' + hồi phục 10' | docs/07 |
| Ground truth grace | **60 giây** sau `fault_start` mới bắt đầu tính ANOMALY | docs/07 |
| Số run chính thức | 5 kịch bản × 10 lần = **50 run** | NFR-8 |

---

## 7. Nói và viết

- **Ngôn ngữ UI, tài liệu, commit message, comment: tiếng Việt.**
- **Tên biến/hàm/bảng/cột/file: tiếng Anh, không dấu.**
- Không dùng emoji trong code và log. UI dùng icon của AntD.
- Mọi thời điểm lưu vào DB: **ISO-8601 UTC** (`2026-07-27T10:00:00Z`). Chỉ đổi sang giờ
  địa phương ở tầng hiển thị. Chi tiết: `docs/06-glossary-quy-uoc.md`.

---

## 8. Bẫy đã biết trên môi trường của nhóm (Windows dev → Linux VPS)

1. `better-sqlite3` là native module → phải `electron-rebuild` sau mỗi lần đổi phiên bản
   Electron, và khai báo `asarUnpack` khi đóng gói. Không làm → app build ra chạy là crash.
2. File `.sh`/`Dockerfile` bị CRLF khi upload lên VPS sẽ chết với lỗi vô nghĩa.
   `.gitattributes` đã ép `eol=lf` — **không ai được tắt nó**.
3. Đường dẫn Windows (`D:\...`, dấu `\`) không được ghép thẳng vào lệnh SSH.
   Luôn dùng `path.posix.join` cho đường dẫn phía VPS.
4. Spawn Python trên Windows: dùng đường dẫn tuyệt đối tới `.venv/Scripts/python.exe`,
   không dựa vào `python` trong PATH. Phải kill tiến trình con khi Electron thoát,
   nếu không sẽ để lại process mồ côi giữ port 8765.
5. `safeStorage` mã hoá gắn với keychain của từng máy → file `.db` copy sang máy người kia
   **không giải mã được**. Mỗi người tự nhập VPS profile của mình. Đây là hành vi đúng.

---

## 9. Không bao giờ làm

- Commit file `*.db`, `.env`, private key (đã chặn bằng `.gitignore` — đừng dùng `git add -f`).
- Chạy lệnh phá huỷ trên VPS (`docker system prune -a`, `rm -rf /opt/...`) mà không hỏi.
- Sửa hoặc xoá dữ liệu trong `experiments/results/` — đó là 50+ giờ máy chạy, không tái tạo được.
- Tự chạy lại thí nghiệm hoặc redeploy khi đang có run thí nghiệm chạy (kiểm tra
  `experiment_run.status = 'running'` trước).
- Viết code cho Tier 2 / tính năng trong danh sách "KHÔNG LÀM" (`docs/01-ke-hoach.md` PHẦN 8).
