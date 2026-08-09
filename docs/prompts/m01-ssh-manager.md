# M01 — SSH Manager · Người A · Tuần 1

`app/src/main/ssh/manager.ts`

## Mục tiêu
Một lớp bọc `ssh2` để mọi module khác nói chuyện với VPS mà không cần biết chi tiết SSH.
Đây là nền của M4, M6, M9 — sai ở đây thì mọi thứ phía trên đều lung lay.

## Đọc trước
- `docs/10-quy-uoc-code.md` mục 3 (lỗi) và **mục 5 (quy tắc SSH)**
- `docs/contracts/metric-format.md` mục 4 (cách `readFileTail` được dùng)
- `docs/contracts/ipc-contract.ts` (`IpcError.code`)

## API cần có

```ts
export class SshManager {
  /** Lấy connection từ pool (1 connection / VPS), tự mở nếu chưa có */
  async connect(vpsId: number): Promise<void>;

  /** Chạy lệnh. onStdout/onStderr để stream log real-time (FR-B6). */
  async exec(vpsId: number, cmd: string, opts?: {
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    timeoutMs?: number;      // mặc định 30_000
    signal?: AbortSignal;    // để pipeline huỷ giữa chừng
  }): Promise<{ code: number; stdout: string; stderr: string }>;

  /** Upload thư mục bằng tar qua stdin — KHÔNG dùng sftp từng file */
  async uploadDir(vpsId: number, localDir: string, remoteDir: string, opts?: {
    exclude?: string[];                       // mặc định: node_modules .git dist .next __pycache__ .venv
    onProgress?: (bytes: number) => void;
    signal?: AbortSignal;
  }): Promise<{ bytes: number }>;

  /** Đọc file từ byte thứ `fromByte` (1-based, dùng `tail -c +N`) — phục vụ metrics.jsonl */
  async readFileTail(vpsId: number, remotePath: string, fromByte: number)
    : Promise<{ content: string; nextByte: number }>;

  async readFile(vpsId: number, remotePath: string): Promise<string>;
  async writeFile(vpsId: number, remotePath: string, content: string, mode?: number): Promise<void>;
  async fileSize(vpsId: number, remotePath: string): Promise<number>;

  async disconnect(vpsId: number): Promise<void>;
  async disconnectAll(): Promise<void>;

  /** Sự kiện đổi trạng thái để topbar hiện dot SSH */
  on(event: 'status', cb: (e: { vpsId: number; status: 'online' | 'offline' }) => void): void;
}
```

## Ràng buộc

1. **Pool 1 connection/VPS.** Tự reconnect với backoff 1s/2s/4s, tối đa 3 lần.
   Chỉ retry `TIMEOUT` và `HOST_UNREACHABLE`. **Không retry** `AUTH_FAILED`.
   **Không retry lệnh có tác dụng phụ** — người gọi quyết định, `exec` chỉ retry khi kết nối
   hỏng *trước khi* lệnh chạy.
2. **Mọi lệnh có timeout.** Hết giờ → giết lệnh trên VPS, ném `AppError('SSH_TIMEOUT')`.
3. **`shellQuote(value)`** — hàm export riêng, bọc mọi giá trị do người dùng nhập trước khi
   nối vào chuỗi lệnh. Có unit test cho `'`, `$`, `;`, xuống dòng.
4. `uploadDir` dùng gói `tar` của npm tạo stream (không gọi `tar.exe` của Windows) rồi
   `exec('tar xzf - -C <remoteDir>')` với stream đó làm stdin. Tạo `remoteDir` trước
   (`mkdir -p`).
5. `readFileTail`: `tail -c +<fromByte> <path>`. `nextByte = fromByte + Buffer.byteLength(content)`.
   Trả `content` rỗng nếu chưa có dữ liệu mới. **Không** tự cắt dòng — việc đó của M6.
6. Cấu hình client: `keepaliveInterval: 30_000`, `readyTimeout: 15_000`.
7. Mọi lệnh ghi 1 dòng log (đã che secret) theo `docs/10` mục 4.
8. Không import bất cứ thứ gì từ `electron` trong file này — để test được bằng Node thuần.

## Ánh xạ lỗi

| Lỗi ssh2 | `IpcError.code` |
|---|---|
| `All configured authentication methods failed` | `SSH_AUTH_FAILED` |
| `ETIMEDOUT`, `Timed out while waiting for handshake` | `SSH_TIMEOUT` |
| `ECONNREFUSED`, `EHOSTUNREACH`, `ENOTFOUND` | `SSH_HOST_UNREACHABLE` |
| còn lại | `UNKNOWN` |

## Script thử độc lập — `app/scripts/try-ssh.ts` (`pnpm try:ssh`)

Đọc host/user/key từ biến môi trường (không hardcode), rồi chạy tuần tự và in kết quả:
1. `exec('docker --version')`
2. `exec('sleep 5')` với `timeoutMs: 2000` → phải ném `SSH_TIMEOUT`
3. `uploadDir` một thư mục nhỏ có `node_modules` giả → kiểm tra bên VPS **không** có `node_modules`
4. `writeFile` rồi `readFile` → khớp nội dung
5. `readFileTail` hai lần liên tiếp trên một file đang được append → lần 2 chỉ trả phần mới
6. Rút cáp mạng/ngắt wifi giữa chừng → quan sát reconnect

## Định nghĩa xong
- [ ] 6 bước của script trên đều đúng như mô tả
- [ ] Log của `docker build` (chạy tay trên VPS) stream ra console **theo thời gian thực**,
      không dồn cục cuối lệnh
- [ ] `shellQuote` có unit test
- [ ] Sai key → lỗi `SSH_AUTH_FAILED`, **không** retry (quan sát log)
