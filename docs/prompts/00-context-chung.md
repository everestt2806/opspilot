# KHỐI NGỮ CẢNH CHUNG — dán vào đầu MỌI phiên làm việc với AI

---

Tôi đang làm đồ án tốt nghiệp: **ứng dụng desktop (Electron) deploy & migrate web app lên VPS
qua SSH, kèm module Machine Learning phát hiện suy giảm vận hành (degraded state) và tự động
rollback.** Nhóm 2 người, hạn nộp 20/11/2026.

**Điểm số của đồ án nằm ở phần thí nghiệm ML và đánh giá thống kê, không nằm ở app đẹp hay
kiến trúc phức tạp.** App chỉ cần chạy đúng và ổn định để sinh dữ liệu cho thí nghiệm.

## Kiến trúc

```
Máy người dùng (Windows)                                VPS (Ubuntu 24.04)
├─ Electron App                                         └─ Docker
│  ├─ Renderer: React + TS + Ant Design v5                 ├─ container app        :30xxx
│  └─ Main (Node.js):                          ── SSH ──▶  ├─ postgres (nếu app cần)
│     ssh2 · detectors · deploy pipeline                   └─ collector (python alpine)
│     migrate pipeline · poller · better-sqlite3              ghi /opt/opspilot/<app>/
│                                                             metrics/metrics.jsonl
└─ spawn ▶ ML service Python (FastAPI + scikit-learn)
           http://127.0.0.1:8765
```

Không agent trên VPS. Không mở thêm port. Chỉ Docker và các container của ứng dụng.

## Ngăn xếp công nghệ (đã chốt, không đề xuất thay)

- Electron 33 + React + TypeScript (strict) + Vite, đóng gói `electron-builder`
- `ssh2` · `better-sqlite3` (WAL) · `zod` · `antd` v5 · `recharts` · `@xterm/xterm` · `zustand`
- Python 3.12 + FastAPI + scikit-learn + numpy
- SQLite cho mọi dữ liệu của tool. PostgreSQL chỉ nằm trong app demo được deploy lên VPS.

## 12 quy tắc bất biến

1. Không overengineering. Đúng 2 tiến trình: Electron và ML service. Không queue, không Redis,
   không microservice.
2. SQLite cho mọi thứ của tool.
3. Mọi lệnh trên VPS qua `ssh exec`. Không agent, không gRPC, không websocket tới VPS.
4. "Plugin detector" = một mảng object cùng interface trong một thư mục. Không dynamic loading.
5. Không authentication, không multi-user, không cloud sync, không auto-update.
6. UI dùng Ant Design mặc định. Không tự thiết kế component, không Tailwind.
7. Migrate chỉ hỗ trợ app do chính tool này deploy.
8. Không cAdvisor/Prometheus/Grafana/Kubernetes. Collector là script Python ~150 dòng.
9. Không deep learning. Đúng 3 mô hình + 1 ensemble: Z-score/EWMA, Isolation Forest,
   One-Class SVM, Ensemble voting.
10. **Không sửa file trong `docs/contracts/`.** Thấy vấn đề thì báo, đừng tự sửa.
11. **Không tự "cải tiến" interface, tên bảng, tên trường, tên event, tên endpoint.**
    Hai người đang code hai phía của cùng interface đó.
12. Không thêm dependency ngoài danh sách đã duyệt.

## Các con số đã chốt

| Thứ | Giá trị |
|---|---|
| Collector ghi metric | 10 giây/dòng, **append** vào `metrics.jsonl` |
| Poller kéo qua SSH | 30 giây/lần, nạp **mọi dòng mới** bằng `tail -c +offset` |
| Cửa sổ trượt tính feature | 20 mẫu |
| Feature vector | 5 metric × 4 đặc trưng (giá trị, mean, std, slope) = **20 chiều** |
| 5 metric | `cpu_pct`, `mem_mb`, `latency_ms`, `http_error_rate`, `db_response_ms` |
| Mẫu tối thiểu để train | ≥150 (khuyến nghị 180) |
| Ngưỡng cảnh báo | score > 0.7, **2 mẫu liên tiếp** |
| Ensemble triggered | ≥2/3 model vượt ngưỡng |
| Ngưỡng rule | cpu>90%, mem>90%, latency>2000ms, error_rate>0.5, **3 mẫu liên tiếp** |
| Auto-rollback | trusted method triggered 3 lần liên tiếp, cooldown 10 phút |
| Precheck VPS | RAM trống >512MB, disk trống >2GB, port chưa dùng |
| Dải port cấp cho app | 30000–30999 |
| Thư mục trên VPS | `/opt/opspilot/<app_name>/` |
| Cổng ML service | 8765 (chỉ 127.0.0.1) |
| `random_state` | **42** ở mọi nơi có ngẫu nhiên |

## Quy ước bắt buộc

- Thời gian trong DB: **ISO-8601 UTC** (`2026-10-06T14:32:10Z`). `ts_vps` (đồng hồ VPS) là mốc
  chuẩn cho mọi phân tích; `ts_local` chỉ để debug.
- Đơn vị nằm trong tên trường: `_ms`, `_mb`, `_pct`, `_s`, `_gb`.
- `_pct` là 0–100; **tỷ lệ** (`http_error_rate`, `score`) là **0–1**.
- Không đo được → **`null`**, không bao giờ dùng `0` hay `-1`.
- Boolean trong SQLite: `INTEGER` 0/1.
- Tên bảng/cột: `snake_case`, số ít. Trường JSON qua IPC/REST cũng `snake_case` khi đến từ DB.
- Biến/hàm TypeScript: `camelCase`. Python: `snake_case`.
- Đường dẫn phía VPS ghép bằng `path.posix.join`, **không bao giờ** dùng `path.join` trên Windows.
- Comment và text UI: **tiếng Việt**. Tên định danh: **tiếng Anh không dấu**.
- Mọi dữ liệu qua ranh giới (IPC, REST, JSON từ VPS) phải validate bằng `zod`/`pydantic`.
- Không nuốt lỗi (`catch {}` rỗng bị cấm). Lỗi ra UI phải nói đủ 3 điều: chuyện gì · ở bước
  nào · làm gì tiếp.
- Không ghi secret (`.env`, private key, password) ra log — che bằng `***`.

## Cách tôi muốn bạn làm việc

- Bám **chính xác** contract tôi cung cấp. Không đổi tên, không thêm trường, không "cải tiến".
- Thiếu thông tin để quyết định → **hỏi tôi**, đừng tự giả định.
- Mỗi module kèm một script CLI chạy thử độc lập, không cần giao diện.
- Comment tiếng Việt ở chỗ có đánh đổi thiết kế.
- Không viết code cho tính năng nằm ngoài brief.
- Task và trạng thái nằm trong repo: `docs/tasks/board.md` + hồ sơ `docs/tasks/tk-*.md`.
  **Trước khi bàn giao kết quả cho tôi, bạn PHẢI cập nhật cả hai** (thêm dòng nhật ký
  `UPDATE`/`BLOCKED`, sửa trạng thái board, ghi lệnh tái hiện và link PR) — người sau chỉ đọc
  hai file này để tiếp việc, không hỏi lại người trước. Xem `docs/tasks/README.md` mục 3.

---

*(Dán tiếp file `docs/prompts/mXX-*.md` của module đang làm và các contract mà nó yêu cầu.)*
