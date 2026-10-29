# OpsPilot Docker Lab (Task L0)

Bộ công cụ kiểm chứng khả năng sẵn sàng (Readiness) của môi trường Docker Linux cục bộ phục vụ OpsPilot Product Mode.

> **Lưu ý quan trọng**: L0 chỉ chứng minh **Docker readiness** cục bộ (build, run, loopback HTTP health check, isolated cleanup). L0 **chưa chứng minh** Product deploy pipeline qua guarded SSH session (thuộc phạm vi H1/H2).

---

## 1. Mục tiêu và Tiêu chí Đạt

- **L0-O1 (Báo cáo môi trường)**: Xác nhận Node 22, pnpm, Docker Engine Linux và Docker Compose CLI. Ghi nhận tình trạng Linux OpenSSH/Git/Node cho H1.
- **L0-O2 (Fixture & Runner)**: Fixture Express tối thiểu độc lập, không phụ thuộc DB/secret; Dockerfile/Compose dùng dependency Express đã duyệt; mỗi lượt chạy có Run ID, port loopback và nhãn tài nguyên riêng.
- **L0-O3 (Bằng chứng chạy thật)**: Build image, chạy container, nhận HTTP 200 tại `/health`, kiểm tra `run_id` trong response body khớp chính xác lượt chạy hiện tại.
- **L0-O4 (Cleanup nghiêm ngặt)**: Tự động dọn dẹp chính xác các tài nguyên thuộc lượt chạy (cả khi thành công và khi gặp lỗi); kiểm tra sau dọn dẹp; bảo đảm 100% không ảnh hưởng tài nguyên có sẵn của người dùng.
- **L0-O5 (Hồ sơ bàn giao)**: Dossier ghi nhận đầy đủ lệnh, exit code, timestamp, image ID, container ID và bằng chứng kiểm thử.

---

## 2. Cấu trúc Thư mục

```text
app/scripts/product-docker-lab/
├── README.md               # Hướng dẫn này
├── runner.mjs              # Script runner thực thi và kiểm chứng tự động
└── fixture/                # Express fixture tối thiểu
    ├── package.json        # Express dependency cục bộ
    ├── server.js           # Server Express (/health endpoint)
    ├── Dockerfile          # Dockerfile tiêu chuẩn node:22-alpine
    ├── Dockerfile.fail     # Dockerfile cố ý lỗi phục vụ controlled test
    └── docker-compose.yml  # Compose template với nhãn cô lập
```

---

## 3. Cách chạy và Tái hiện

Từ thư mục root của worktree `opspilot-docker-lab`:

```powershell
# Chạy trọn vẹn toàn bộ 7 ca kiểm chứng (Full Suite)
node app/scripts/product-docker-lab/runner.mjs --suite

# Hoặc kiểm tra riêng báo cáo môi trường Docker
node app/scripts/product-docker-lab/runner.mjs --env

# Hoặc chạy thử nghiệm một lượt Happy Path đơn lẻ
node app/scripts/product-docker-lab/runner.mjs --happy
```

---

## 4. Ma trận 7 Ca Kiểm chứng Tự động

1. **Case 1 (Environment Report)**: Gọi `docker info` kiểm tra Engine là Linux và `docker compose version` khả dụng.
2. **Case 2 (Happy Path)**: Build image `opspilot-lab-express:<run_id>`, start container, poll `http://127.0.0.1:<port>/health` nhận HTTP 200 với `body.run_id === <run_id>`, dọn dẹp sạch sẽ.
3. **Case 3 (Controlled Build Failure)**: Dùng `Dockerfile.fail`, kiểm tra runner bắt lỗi exit code != 0, dừng đúng bước BUILD và không rò rỉ tài nguyên.
4. **Case 4 (Controlled Health Failure)**: Chạy với `SIMULATE_FAIL_HEALTH=1`, endpoint trả về 500, runner phát hiện lỗi, dừng đúng bước HEALTH_CHECK và dọn dẹp sạch sẽ.
5. **Case 5 (Two Consecutive Runs)**: Thực hiện 2 lượt chạy liên tiếp, kiểm tra độc lập tuyệt đối: Run ID khác nhau, port loopback khác nhau, không có va chạm hay nhầm lẫn bằng chứng.
6. **Case 6 (Existing Resources Protection)**: Đối chiếu danh sách container và image của người dùng trước và sau toàn bộ test suite, xác minh không có tài nguyên nào bị xóa hay biến đổi.
7. **Case 7 (Simulated Daemon Down)**: Giả lập môi trường Docker daemon không kết nối được (`DOCKER_HOST` không hợp lệ), xác minh runner báo lỗi rõ ràng và dừng ngay tại bước precheck.
