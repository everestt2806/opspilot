# TK-A5 — M1: uploadDir / readFileTail + resource check

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 19/08/2026 | feat/m01-ssh-connect-exec | `docs/prompts/m01-ssh-manager.md` | P1 |

## Mục tiêu (FR-A1, FR-A2)

Phần file/resource của M1: `uploadDir` (loại `node_modules`), `readFileTail` theo byte offset,
và kiểm tra tài nguyên VPS (RAM trống, disk trống, port đích) dùng cho precheck M4 và bảng VPS
của UI (B đang nối ở TK-B7).

## Được sửa

- `app/src/main/ssh/**`, `app/scripts/try-ssh.ts` (bước 3–4: upload/tail), test.

## Không được sửa

- `docs/contracts/**`, `app/src/renderer/**`, `collector/**` của B.

## Definition of Done

- [ ] Unit test upload loại đúng `node_modules`; readFileTail đúng offset/bytes
- [ ] Đường dẫn phía VPS luôn `path.posix.join` (bẫy Windows)
- [ ] Chạy thật trên VPS: upload 1 thư mục, đọc lại đuôi file
- [ ] Resource check: đọc được `metrics.jsonl` của B (TK-B5) nếu đã có
- [ ] Đủ input cho `vps:get-resources` (B dùng ở TK-B7)

## Nhật ký

- START 19/08 — phần upload/tail code cùng nhánh PR #9.
- UPDATE 19/08 — code + unit test xong, sáp nhập vào PR #9; mục thật-vẫn chờ VPS + file của B.
- BLOCKED 19/08 — chờ (1) TK-S2 VPS nghiệm thu xong, (2) TK-B5 có `metrics.jsonl` thật.
  Điều kiện gỡ: cả hai điều kiện trên; chạy try-ssh bước 3–4 + resource check rồi ghi DONE.

## Lệnh tái hiện

```bash
# local mock: pnpm try:ssh (bước 3 upload, bước 4 đọc đuôi file)
# thật trên VPS: như TK-A4, đổi SECRET_PATH như trên
```

## PR

- #9 — feat/m01-ssh-connect-exec (chung với TK-A4)