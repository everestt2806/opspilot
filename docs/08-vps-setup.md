# RUNBOOK: DỰNG VPS TỪ ĐẦU (~30 phút)

Mục tiêu: provider có sự cố lúc 2 giờ sáng tuần chạy chính thức thì dựng lại VPS mới trong 30 phút và
chạy tiếp thí nghiệm. **Vừa làm vừa cập nhật file này** — mỗi lệnh gõ tay mà không ghi vào
đây là một lần phải mò lại.

---

## 0. Mua VPS

| Hạng mục | Chốt |
|---|---|
| Số lượng | **2** (nguồn + đích cho migrate; chạy song song thí nghiệm) |
| Cấu hình | 2 vCPU · 4 GB RAM · 40 GB SSD (build Next.js cần ≥2GB) |
| OS | **Ubuntu 24.04 LTS** |
| Provider | **Cùng provider, cùng gói, cùng region cho cả 2 máy** — bắt buộc, xem [`07`](07-giao-thuc-thi-nghiem.md#9-3) |
| Gợi ý | Hetzner CX22 (~€4/th) · Vultr · DigitalOcean (~6–12 USD/th) |
| Chi phí | ~40–70 USD cho 4 tháng cả 2 máy |
| Đặt tên | `deploytool-vps-1`, `deploytool-vps-2` |

Ghi lại ngay sau khi mua:

| | VPS 1 | VPS 2 |
|---|---|---|
| IP | | |
| Provider / region | | |
| Ngày tạo | | |
| Snapshot sạch (tên/ID) | | |
| Hết hạn thanh toán | | |

---

## 1. SSH key riêng cho đồ án

Trên **máy dev** (không dùng lại key cá nhân):

```bash
ssh-keygen -t ed25519 -C "deploytool-doan" -f ~/.ssh/deploytool_ed25519
```

- Cả 2 thành viên đều tạo key riêng, **cả 2 key đều nạp lên cả 2 VPS**.
- Không commit private key (đã chặn trong `.gitignore`). Không dán vào chat/Drive.
- Nạp key lúc tạo VPS (dán public key vào giao diện provider) hoặc:
  `ssh-copy-id -i ~/.ssh/deploytool_ed25519.pub root@<ip>`

---

## 2. Cứng hoá cơ bản + đồng hồ

```bash
ssh root@<ip>

# 2.1 Cập nhật
apt update && apt upgrade -y

# 2.2 Tài khoản làm việc (không dùng root cho tool)
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy   # tool cần chạy docker/systemctl không tương tác

# 2.3 Tắt đăng nhập bằng mật khẩu
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# 2.4 ĐỒNG HỒ — bắt buộc, nếu không detection delay sẽ sai (xem docs/07 mục 3)
timedatectl set-timezone UTC
apt install -y systemd-timesyncd
systemctl enable --now systemd-timesyncd
timedatectl status | grep -E 'synchronized|Time zone'   # phải thấy "System clock synchronized: yes"
```

> Nếu tổ chức yêu cầu, bật `ufw` cho phép 22 + dải 30000–30999. Mặc định đồ án **không bật
> firewall** để tránh mất thời gian debug — ghi rõ đây là hạn chế trong chương 6.

---

## 3. Docker

Tool có thể tự cài (FR-A2), nhưng khi dựng tay thì dùng đúng lệnh này để mọi VPS giống nhau:

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
systemctl enable --now docker
docker --version && docker compose version     # ghi lại phiên bản vào bảng ở mục 0
```

**Kiểm tra `deploy` chạy được docker không cần sudo:**
```bash
su - deploy -c 'docker ps'
```

---

## 4. Thư mục làm việc

```bash
mkdir -p /opt/deploytool
chown deploy:deploy /opt/deploytool
chmod 755 /opt/deploytool
```

Cấu trúc bên trong do tool tự tạo — xem [`contracts/metric-format.md`](contracts/metric-format.md).

---

## 5. Kiểm tra nghiệm thu (chạy đủ 6 lệnh, tất cả phải xanh)

```bash
ssh deploy@<ip> 'echo OK'                                  # 1. SSH bằng key, user deploy
ssh deploy@<ip> 'docker run --rm hello-world | tail -1'    # 2. Docker chạy không cần sudo
ssh deploy@<ip> 'touch /opt/deploytool/.probe && rm /opt/deploytool/.probe && echo WRITABLE'
ssh deploy@<ip> 'timedatectl status | grep synchronized'   # 4. Đồng hồ đồng bộ
ssh deploy@<ip> 'free -m | head -2; df -h / | tail -1'     # 5. Tài nguyên đúng như đã mua
ssh deploy@<ip> "date +%s%3N"                              # 6. So với đồng hồ máy dev, lệch < 2000ms
```

Lệnh 6 chính là phép đo `clock_offset_ms` mà `run_experiment.py` tự động hoá.

---

## 6. Snapshot — làm ngay, đừng để sau

Chụp snapshot **cả 2 VPS** ngay sau bước 5, đặt tên `clean-docker-<ngày>`.
Ghi ID snapshot vào bảng ở mục 0.

Snapshot này dùng để: reset nhanh giữa các lần tập demo · khôi phục khi thí nghiệm làm hỏng
máy · dựng lại nếu provider có sự cố.

**Lưu ý:** trong lúc chạy 50 run, `run_experiment.py` đã tự `docker compose down -v` trước
mỗi run nên **không cần** khôi phục snapshot giữa các run — làm vậy chỉ tốn thời gian.
Snapshot dành cho sự cố và cho buổi bảo vệ.

---

## 7. Trước mỗi buổi demo/bảo vệ

1. Khôi phục cả 2 VPS về snapshot `clean-docker-*`.
2. Chạy lại mục 5 (6 lệnh nghiệm thu).
3. Deploy trước app demo cho **Màn 2** (kịch bản memory leak) và để nó chạy ≥40 phút để model
   train xong — **không thể train ML tại chỗ trong lúc bảo vệ**, phải chuẩn bị trước.
4. Chạy [smoke test](15-checklists.md#smoke-test-10-phút).

Chi tiết: [`15-checklists.md`](15-checklists.md#ngày-bảo-vệ).

---

## 8. Sự cố thường gặp

| Triệu chứng | Nguyên nhân hay gặp | Xử lý |
|---|---|---|
| `docker: permission denied` | Quên `usermod -aG docker deploy`, hoặc chưa mở phiên SSH mới | Đăng xuất/đăng nhập lại, hoặc `newgrp docker` |
| Build Next.js bị OOM killed | 4GB RAM nhưng còn app khác đang chạy | `docker system prune -f`, dừng app khác, kiểm tra `free -m` |
| `no space left on device` | Image cũ tích tụ | M4 bước RECORD phải giữ đúng 3 image; chạy tay `docker image prune -a --filter "until=168h"` |
| Script `.sh` báo `bad interpreter: ^M` | File bị CRLF | `.gitattributes` đã ép LF — kiểm tra `git config core.autocrlf` trên máy đó |
| Lệch đồng hồ > 2s | `systemd-timesyncd` chưa bật | Mục 2.4, rồi `systemctl restart systemd-timesyncd` |
| SSH treo khi chạy lệnh dài | Idle timeout | Client dùng `ServerAliveInterval 30`; đã cấu hình sẵn trong M1 |
