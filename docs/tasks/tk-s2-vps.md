# TK-S2 — Dựng và nghiệm thu 2 VPS cùng provider/gói/region

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A (dựng), Both (dùng) | 12/08/2026 | không cần code | `docs/08-vps-setup.md`, `docs/21-ke-hoach-thue-vps.md` | P0 |

## Mục tiêu

2 máy VPS giống hệt nhau (cùng provider, cùng gói, cùng region — bắt buộc theo ADR/DECISIONS
và `docs/07` mục 9.3) để chạy thí nghiệm song song. Dựng theo runbook `docs/08` và nghiệm thu
bằng 6 lệnh. Đây là điều kiện gỡ choke cho TK-A4/A5, TK-B6 và gate G0.

## Được sửa

- Bảng mục 0 trong `docs/08-vps-setup.md` (điền IP, provider, snapshot, hạn thanh toán).
- Snapshot trên provider (`clean-docker-<ngày>`, 1 cái/máy).

## Không được sửa

- Code. Không chạy lệnh phá hủy trên VPS.

## Definition of Done

- [x] 2 máy **WiService preset Cheap 2** (2 vCPU · 4GB · 40GB · 1 IPv4), Ubuntu 24.04 LTS, cùng DC
- [x] Cả 2 máy chạy xong `docs/08` mục 1–4 (key riêng, user `deploy`, docker, `/opt/opspilot`)
- [x] 6/6 lệnh nghiệm thu `docs/08` mục 5 **xanh trên cả 2 máy**
- [ ] Snapshot `clean-docker-<ngày>` chụp xong cho cả 2 máy, ID ghi vào bảng mục 0
- [ ] Cả A và B đều `ssh deploy@<ip> 'echo OK'` bằng key riêng của mình (A xong; B chưa nạp key)
- [x] A chạy `pnpm try:ssh` thành công với VPS thật (giải choke TK-A4)

## Nhật ký

- START 12/08 — chờ mua máy, dự kiến xong trong ngày.
- BLOCKED 12/08 — chưa chốt provider / chưa mua máy. Điều kiện gỡ: mua đủ 2 máy cùng gói cùng DC.
- UPDATE 19/08 — đã chốt provider WiService (`DECISIONS.md` 19/08) và **đã mua xong 2 máy**.
  Việc còn lại: chọn đúng Ubuntu 24.04 + cùng DC khi tạo máy (kiểm tra), chạy runbook mục 1–6,
  6 lệnh nghiệm thu, snapshot `clean-docker-19-08`.
- UPDATE 19/08 — **dựng xong cả 2 máy, nghiệm thu 6/6 xanh trên cả 2**:
  Ubuntu 24.04.4 LTS · 2 vCPU · 3909MB RAM · 39G disk · Docker 29.7.2 (giống hệt nhau);
  user `deploy` + NOPASSWD sudoers; key A nạp xong rồi tắt `PasswordAuthentication no`
  (đã kiểm tra key vẫn vào sau khi tắt); UTC + systemd-timesyncd synchronized;
  `/opt/opspilot` chown deploy. `pnpm try:ssh` **6/6 trên cả 2 máy** (chi tiết xem TK-A4).
  Đồng hồ lệch **290ms / 236ms**.
  **Bẫy phát hiện:** firewall WiService mặc định chặn toàn bộ inbound → phải mở rule TCP 22
  trên dashboard (đã ghi runbook `docs/08` mục 0 + hồ sơ này).
  Còn lại để HOÀN THÀNH: (1) chụp snapshot `clean-docker-19-08` trên dashboard mỗi máy —
  việc tay của người dùng (hướng dẫn đã gửi); (2) nạp key của B — vì đã tắt password auth
  nên **B gửi pubkey cho A nạp bằng key A**, không bật lại password; (3) chép tên DC/hạn
  thanh toán từ dashboard vào bảng `docs/08` mục 0.

## Lệnh tái hiện

```bash
ssh deploy@<ip> 'docker run --rm hello-world | tail -1'
ssh deploy@<ip> 'timedatectl status | grep synchronized'
ssh deploy@<ip> 'free -m | head -2; df -h / | tail -1'
# đủ 6 lệnh: docs/08 mục 5
```

## PR

— (không cần code; cập nhật docs đi cùng commit bảng mục 0)