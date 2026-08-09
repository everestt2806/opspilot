# LƯU Ý RÀ SOÁT KIẾN TRÚC & TÍNH KHẢ THI

> Ngày rà soát: **28/07/2026**
>
> Đây là tài liệu review và danh sách đề xuất, **không thay thế contract hiện tại**.
> Khi có mâu thuẫn, thứ tự ưu tiên vẫn là:
> `docs/contracts/` → `01-ke-hoach.md` → các tài liệu còn lại.
> Đề xuất nào được nhóm chấp nhận phải sửa contract liên quan và ghi vào `DECISIONS.md`
> trong cùng commit.

---

## 1. Kết luận

Kiến trúc tổng thể **khả thi, không cần thiết kế lại từ đầu**.

Đánh giá tại thời điểm rà soát: **7,5–8/10** cho phạm vi:

- Ứng dụng desktop cho một người dùng.
- 2 VPS cùng cấu hình.
- Nhóm 2 người.
- Bắt đầu triển khai 10/08/2026, hạn nộp 20/11/2026.
- Trọng tâm là so sánh phương pháp phát hiện bất thường, không phải xây nền tảng vận hành
  quy mô lớn.

Các lựa chọn Electron + React, SSH-only, SQLite WAL, FastAPI local và collector container đều
phù hợp với phạm vi đồ án. Không cần đổi stack, tách microservice hay bổ sung Kubernetes,
Prometheus, Grafana.

---

## 2. Đánh giá từng phần

| Thành phần | Đánh giá | Lưu ý |
|---|---|---|
| Electron + React | Tốt | Phù hợp desktop tool; renderer không được gọi SSH/SQLite trực tiếp |
| SSH-only, không agent | Tốt trong phạm vi | Đơn giản với 2 VPS; không đặt mục tiêu mở rộng hàng chục VPS |
| SQLite WAL | Tốt | Đủ cho poller ghi và UI đọc trên máy một người dùng |
| FastAPI ML chạy local | Khả thi | Dễ test; đóng gói/chọn đúng Python trên máy lạ là rủi ro vận hành |
| Collector + JSONL append-only | Khá tốt | Không mất mẫu khi SSH ngắt tạm thời; cần xử lý rotation chính xác |
| Deploy pipeline | Khả thi | Cần làm rõ vòng đời bản ghi `deployment` |
| Rollback | Chưa đủ chặt | Không nên chỉ giữ image; cần giữ manifest/config của từng release |
| Migrate | Khó nhất | Dễ vượt thời gian; phải có state machine và nhánh lỗi duy nhất |
| ML + thí nghiệm | Khả thi | Đủ cho nghiên cứu so sánh; không hứa trước ML luôn thắng rule |
| Auto-rollback | Hợp lý | Mặc định tắt + cooldown là lựa chọn an toàn |

---

## 3. Năm điểm cần chốt trước khi code sâu

### 3.1 Vòng đời bản ghi `deployment`

**Vấn đề:** `deploy:start` và các event cần `deployment_id` ngay từ đầu, nhưng kế hoạch hiện
mô tả bước `RECORD` mới ghi deployment.

**Đề xuất:**

1. Tạo row `deployment(status='building')` trước khi pipeline chạy.
2. Mỗi bước cập nhật trạng thái, `failed_step` và duration liên quan.
3. Pipeline thất bại vẫn giữ row để xem lịch sử và log.
4. Bước `RECORD` chỉ hoàn tất row, cập nhật `app.current_deployment_id` và dọn release cũ.

### 3.2 Rollback phải giữ release artifact, không chỉ Docker image

**Vấn đề:** image cũ có thể không chạy đúng với `docker-compose.yml`, `.env`, healthcheck hoặc
cấu hình của version mới.

**Đề xuất cấu trúc:**

```text
/opt/deploytool/<app>/
└── releases/
    ├── v1/
    │   ├── docker-compose.yml
    │   ├── .env
    │   └── metadata.json
    ├── v2/
    └── v3/
```

Rollback dùng đúng image và manifest của version đích. Giữ tối đa 3 release gần nhất.
Không xoá volume dữ liệu khi dọn release.

### 3.3 `http_error_rate` chưa nhận dữ liệu từ load generator

**Vấn đề:** collector hiện chỉ thấy status code của health probe 10 giây/lần. Các request
5 req/s do load generator tạo ra không đi vào `http_error_rate`, nên load generator chưa làm
error rate bớt nhiễu như giao thức thí nghiệm đang tuyên bố.

**Đề xuất ưu tiên:**

- Load generator công bố bộ đếm request/5xx theo cửa sổ 60 giây qua file JSON ghi nguyên tử
  hoặc endpoint nội bộ.
- Collector dùng nguồn này khi chạy thí nghiệm.
- Khi không có load generator, collector fallback về health probe.
- Ghi nguồn của error rate vào `raw_json` và `meta.json` để không trộn hai cách đo mà không biết.

### 3.4 Chốt hành vi khi migrate `VERIFY` thất bại

**Vấn đề:** kế hoạch nói mọi lỗi đều rollback và dọn đích; contract lại yêu cầu giữ dữ liệu
đích khi verify fail để người dùng quyết định.

**Đề xuất an toàn:**

1. Không xoá dữ liệu đích.
2. Dừng app đích.
3. Khởi động lại app nguồn ngay.
4. Giữ `verify_json`, hiện cảnh báo đỏ.
5. Cho phép retry verify hoặc abort để dọn đích.
6. Không cho xác nhận thành công khi checksum/count vẫn sai.

Cụm “VPS nguồn không bị đụng đến trước khi xác nhận” nên đổi thành:
**“Không xoá, không dừng vĩnh viễn và luôn có thể khởi động lại app nguồn trước khi người dùng
xác nhận.”**

### 3.5 Lưu riêng từng lần retry thí nghiệm

**Vấn đề:** protocol cho phép retry tối đa 2 lần, nhưng
`UNIQUE(scenario, repeat_index)` không lưu được cả attempt bị huỷ và attempt chạy lại.

**Đề xuất:**

```sql
attempt_index INTEGER NOT NULL DEFAULT 1,
UNIQUE (scenario, repeat_index, attempt_index)
```

Thư mục export cũng chứa attempt:

```text
run_<scenario>_<repeat>_attempt_<attempt>/
```

`analyze.py` chỉ đưa attempt `completed` vào bảng kết quả chính, nhưng vẫn thống kê số attempt
bị huỷ và nguyên nhân.

---

## 4. Lưu ý cho metric pipeline

### 4.1 File rotation có thể bỏ sót phần cuối file cũ

Khi `metrics.jsonl` được đổi thành `.1` giữa hai lần poll, cách chỉ kiểm tra
`current_size < offset` rồi reset offset có thể bỏ qua các dòng cuối chưa đọc của file `.1`.

Trước khi triển khai rotation cần chọn một trong các cách:

- Poller đọc nốt `.1` từ offset cũ rồi mới chuyển sang file mới.
- Rotation ghi marker/generation ID để poller biết chính xác file đang đọc.
- Tạm tắt rotation trong các run thí nghiệm và kiểm soát dung lượng bằng precheck.

Soak test phải chủ động dùng ngưỡng file nhỏ để ép nhánh rotation chạy; chờ file đạt 50 MB có
thể không kiểm thử được nhánh này.

### 4.2 Slope phải dùng timestamp thật

Feature `slope` có đơn vị “metric/phút”, vì vậy trục X phải lấy từ `ts_vps`, không mặc định
mọi mẫu cách nhau đúng 10 giây. Điều này đặc biệt quan trọng sau khi SSH mất kết nối rồi poller
nạp bù nhiều mẫu cùng lúc.

### 4.3 Vòng đời model sau redeploy

Model state hiện gắn với `deployment_id`. Mỗi lần redeploy tạo deployment mới có thể dẫn đến
30 phút chưa đủ baseline để model sẵn sàng.

Cần chốt rõ một trong hai cách:

- Train lại cho từng deployment/version — đơn giản, sạch về mặt thí nghiệm nhưng có blind
  period.
- Cho phép kế thừa model từ deployment trước của cùng app nếu feature version và cấu hình
  tương thích — tiện vận hành hơn nhưng cần điều kiện kiểm soát rõ.

Đối với run thí nghiệm chính thức vẫn phải reset và train sạch.

---

## 5. Lưu ý cho ML và thống kê

180 mẫu baseline và feature vector 20 chiều đủ để chạy Isolation Forest/One-Class SVM trong
phạm vi đồ án, nhưng không phải tập dữ liệu lớn. Kết quả cần được diễn giải thận trọng.

- Fit `StandardScaler` trước One-Class SVM.
- Quy định rõ cách chuẩn hoá và clip score về `[0,1]`, nhất là Isolation Forest.
- Không đổi ngưỡng/feature sau khi đã nhìn dữ liệu chính thức.
- Tính Precision/Recall/F1 theo **từng run**, sau đó lấy mean, std và CI với `n=10`.
- Không coi hàng trăm mẫu liên tiếp trong cùng run là các quan sát độc lập để làm CI.
- Phân bổ scenario/repeat cân bằng giữa hai VPS và tránh chạy toàn bộ một scenario trên cùng
  một VPS hoặc cùng một thời điểm.
- Báo cáo trung thực nếu ML không thắng rule; mục tiêu là so sánh có kiểm soát.

---

## 6. Lưu ý bảo mật

### 6.1 Docker socket

Mount `/var/run/docker.sock:ro` không biến Docker API thành read-only. Container truy cập được
Docker socket vẫn có quyền rất mạnh trên VPS.

Trong phạm vi đồ án có thể chấp nhận vì collector cần `docker stats`, nhưng phải:

- Không expose collector ra internet.
- Giữ image collector tối thiểu.
- Không nhận lệnh tuỳ ý từ người dùng/mạng.
- Ghi đây là giới hạn bảo mật trong chương 6.

### 6.2 SSH host fingerprint

M1 nên xác minh host key để tránh kết nối nhầm VPS hoặc MITM.

Phương án tối thiểu là TOFU:

1. Lần kết nối đầu hiển thị fingerprint cho người dùng xác nhận.
2. Lưu fingerprint cùng VPS profile.
3. Các lần sau fingerprint đổi thì chặn và yêu cầu xác nhận lại.

Nếu áp dụng, cần bổ sung trường lưu fingerprint vào schema/contract trước khi code M1.

### 6.3 Credential

`safeStorage` hợp lý trên Windows nhưng không đúng nguyên văn lời hứa “AES-256-GCM” trong đề
tài gốc. Nhóm cần chọn một cách giải trình nhất quán:

- Dùng `safeStorage` và nói rõ uỷ quyền cho DPAPI/keychain của hệ điều hành.
- Hoặc triển khai đường AES-256-GCM + scrypt đã dự phòng.

Không được vừa ghi AES-256-GCM trong báo cáo vừa chỉ dùng `safeStorage` trong code.

---

## 7. Lưu ý khi trình bày kiến trúc

Không nên nói hệ thống có đúng “2 OS process”. Electron vốn có main process và ít nhất một
renderer process.

Cách diễn đạt chính xác:

> Hệ thống có hai **thành phần ứng dụng chính**: Electron desktop app và Python ML service.
> Bên trong Electron, main process giữ đặc quyền SSH/SQLite; renderer process chỉ hiển thị UI
> và giao tiếp qua IPC.

---

## 8. Thứ tự ưu tiên nếu thiếu thời gian

Không cắt:

1. Deploy end-to-end.
2. Metric pipeline đúng và không mất dữ liệu.
3. Ba phương pháp ML + rule + ensemble.
4. Giao thức thí nghiệm và dữ liệu tái lập được.
5. Auto-rollback ở mức demo an toàn.

Cắt/giảm trước:

1. Tier 2 Flask.
2. Migrate PostgreSQL tổng quát — giữ migrate app không DB trước.
3. UI History/Settings nâng cao.
4. Đóng gói Python hoàn toàn — có thể yêu cầu Python 3.12 nếu cần.
5. Tối ưu thẩm mỹ ngoài hai màn hình demo chính.

---

## 9. Điều kiện “kiến trúc sẵn sàng để triển khai”

- [ ] Chốt vòng đời row `deployment`.
- [ ] Chốt cấu trúc release artifact phục vụ rollback.
- [ ] Chốt nguồn dữ liệu thật của `http_error_rate`.
- [ ] Chốt nhánh `VERIFY` fail của migrate.
- [ ] Chốt `attempt_index` cho retry thí nghiệm.
- [ ] Quyết định có pin SSH fingerprint hay ghi rõ là giới hạn.
- [ ] Mọi đề xuất được chấp nhận đã cập nhật contract + `DECISIONS.md`.

Khi bảy mục trên đã có câu trả lời, kiến trúc đủ ổn định để code theo module mà ít nguy cơ
phải sửa xuyên nhiều phần về sau.
