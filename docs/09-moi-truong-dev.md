# MÔI TRƯỜNG DEV & DEPENDENCY

Máy dev của nhóm: **Windows 11**. VPS: **Ubuntu 24.04**. Phần lớn bug tốn thời gian trong dự
án này đến từ khe hở giữa hai môi trường đó — mục 4 liệt kê sẵn.

---

## 1. Cài đặt một lần

| Công cụ | Phiên bản | Cách cài | Kiểm tra |
|---|---|---|---|
| Git | ≥2.40 | winget/installer | `git --version` |
| Node.js | **22 LTS** | `winget install OpenJS.NodeJS.LTS` | `node -v` → v22.x |
| pnpm | 9+ | `corepack enable && corepack prepare pnpm@latest --activate` | `pnpm -v` |
| Python | **3.12** | python.org (tick **Add to PATH**) | `python --version` |
| Docker Desktop | mới nhất | docker.com | `docker run --rm hello-world` |
| VS Code | mới nhất | | |
| OpenSSH client | có sẵn Win11 | `Get-WindowsCapability -Online -Name OpenSSH.Client*` | `ssh -V` |
| GitNexus (dev tool cho AI, không phải dep của app) | mới nhất | `npm i -g gitnexus` | `gitnexus --version` |

**GitNexus** — lập chỉ mục code thành knowledge-graph (symbol, call chain, dependency), phục vụ
Claude Code qua MCP. Chạy local, không cần server; cấu hình chung ở `.gitnexusrc` và `.mcp.json`
(đã commit). Cách dùng:

```bash
gitnexus analyze     # dựng/cập nhật index trong thư mục repo (mỗi máy tự chạy, sau thay đổi lớn)
gitnexus setup -c claude   # (tùy chọn) bật hooks PreToolUse/PostToolUse cho máy này
```

`.mcp.json` lọc sẵn server `gitnexus` bản read-only — Claude Code ở máy có cài GitNexus sẽ tự nạp.
Hooks và skills ghi vào `~/.claude/` nên mỗi người tự chạy `gitnexus setup` ở máy mình.

**Cấu hình Git bắt buộc (làm ngay, tránh hỏng line ending):**
```bash
git config --global core.autocrlf input
git config --global core.longpaths true
git config --global user.name "..."  &&  git config --global user.email "..."
```

**Extension VS Code khuyến nghị:** ESLint · Prettier · Python · Ruff · SQLite Viewer ·
Docker · EditorConfig.

---

## 2. Dependency đã duyệt

**Không thêm dependency ngoài danh sách này mà không ghi `DECISIONS.md`.** Mỗi dependency
mới là một câu hỏi tiềm năng của hội đồng ("cái này để làm gì?") và một rủi ro đóng gói.

### `app/` — Electron

| Gói | Vai trò |
|---|---|
| `electron` (33+) · `electron-vite` · `electron-builder` | khung + build + đóng gói |
| `react` · `react-dom` · `typescript` · `vite` | UI |
| `antd` (v5) · `@ant-design/icons` | component library (ADR-009) |
| `recharts` | chart dashboard |
| `@xterm/xterm` · `@xterm/addon-fit` · `@xterm/addon-search` | log viewer ANSI |
| `zustand` | state toàn cục |
| `ssh2` | kết nối VPS (M1) |
| `better-sqlite3` | SQLite đồng bộ, nhanh (M-db) |
| `zod` | validate dữ liệu qua ranh giới IPC |
| `dayjs` | format thời gian |
| `tar` | tạo tar stream khi UPLOAD (không phụ thuộc `tar.exe` của Windows) |
| dev: `vitest` · `eslint` · `prettier` · `@electron/rebuild` · `@testing-library/react` · `@testing-library/dom` · `jsdom` | 3 gói test sau chỉ cho component test renderer (quyết định 19/08), không vào bundle |

### `ml-service/` — Python

```
fastapi · uvicorn[standard] · pydantic (v2)
scikit-learn · numpy · scipy · joblib
pytest (dev) · ruff (dev)
```

### `experiments/` — Python

```
pandas · matplotlib · scipy · requests · paramiko (SSH cho script chạy độc lập)
```

### `collector/` — Python trong container Alpine

```
requests · psycopg2-binary        # cố ý giữ tối thiểu, image phải nhỏ và nhẹ
```
`docker stats` gọi qua `subprocess` — **không** dùng SDK `docker` (kéo theo cả đống phụ thuộc).

---

## 3. Khởi tạo dự án (tuần 1, làm một lần)

```bash
# 1. Electron
pnpm create @quick-start/electron app --template react-ts
cd app && pnpm install
pnpm add antd @ant-design/icons recharts @xterm/xterm @xterm/addon-fit \
         @xterm/addon-search zustand ssh2 better-sqlite3 zod dayjs tar
pnpm add -D @electron/rebuild vitest @types/ssh2 @types/better-sqlite3
pnpm exec electron-rebuild -f -w better-sqlite3      # BẮT BUỘC, xem mục 4.1

# 2. ML service
cd ../ml-service && python -m venv .venv
.venv\Scripts\activate && pip install -r requirements.txt

# 3. Copy contract sang code
#    docs/contracts/schema.sql            -> app/src/main/db/migrations/001_init.sql
#    docs/contracts/ipc-contract.ts       -> app/src/shared/ipc.ts
#    docs/contracts/detector-contract.ts  -> app/src/main/detectors/types.ts
```

Giữ nội dung copy **giống hệt** bản trong `docs/contracts/`. Lệch một chữ là mất tác dụng
của việc có contract.

---

## 4. Bẫy đã biết — đọc trước khi mất nửa ngày

### 4.1 `better-sqlite3` là native module
Electron dùng ABI khác Node → phải `pnpm exec electron-rebuild -f -w better-sqlite3` sau
**mỗi lần** đổi phiên bản Electron hoặc cài lại `node_modules`. Khi đóng gói, khai báo trong
`electron-builder.yml`:
```yaml
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
```
Triệu chứng khi quên: `NODE_MODULE_VERSION mismatch`, hoặc app build ra crash ngay khi mở.

### 4.2 CRLF giết script phía Linux
File `.sh`/`Dockerfile` bị CRLF → `bad interpreter: /bin/sh^M`. `.gitattributes` đã ép
`eol=lf`; **không ai được tắt**. Khi sinh file bằng code Node để upload lên VPS, luôn viết
`\n`, không dùng `os.EOL`.

### 4.3 Đường dẫn
Không ghép đường dẫn Windows vào lệnh SSH. Đường dẫn VPS luôn `path.posix.join`.
Mọi giá trị người dùng nhập đi vào lệnh shell phải qua `shellQuote()`.

### 4.4 Spawn Python từ Electron
Dùng đường dẫn tuyệt đối tới `.venv\Scripts\python.exe` — `python` trong PATH có thể là
Store stub hoặc phiên bản khác. Bắt buộc:
- kill tiến trình con trong `app.on('before-quit')` **và** `process.on('exit')`;
- trên Windows dùng `taskkill /pid <pid> /T /F` để diệt cả cây tiến trình (uvicorn có worker con);
- port 8765 bận → thử 8766, 8767 rồi báo lỗi rõ ràng (đừng im lặng).

Triệu chứng khi quên: mở app lần 2 báo "port đang dùng" vì lần 1 để lại process mồ côi.

### 4.5 Windows Defender làm chậm build
Thêm ngoại lệ cho thư mục repo và `node_modules`. Không làm thì `pnpm install` và
`vite build` chậm gấp 2–3 lần.

### 4.6 `safeStorage` gắn với từng máy
File `.db` copy sang máy người kia **không giải mã được credential**. Đây là hành vi đúng
(NFR-2), không phải bug. Mỗi người tự nhập VPS profile của mình.

### 4.7 Đường dẫn dài
Windows giới hạn 260 ký tự; `node_modules` của Electron rất sâu. Đã bật
`core.longpaths true` ở mục 1. Đặt repo gần gốc ổ đĩa (`D:\DuAnCNTT`) thay vì lồng sâu.

---

## 5. Script tiện ích (tạo dần trong `app/package.json`)

| Lệnh | Việc |
|---|---|
| `pnpm dev` | Chạy Electron dev, tự spawn ml-service |
| `pnpm test` | vitest — detectors, crypto |
| `pnpm build` | Đóng gói electron-builder |
| `pnpm try:ssh` | Thử M1 với VPS thật, không cần UI |
| `pnpm try:detect <path>` | Chạy detector engine lên một thư mục, in kết quả |
| `pnpm try:deploy` | Chạy trọn pipeline deploy từ CLI |
| `pnpm db:reset` | Xoá và tạo lại SQLite dev (**hỏi xác nhận**) |

Nguyên tắc: **mỗi module phải chạy được bằng CLI trước khi nối vào UI.** Debug SSH/deploy
qua giao diện chậm gấp nhiều lần.

---

## 6. Nếu phải setup lại máy từ đầu

1. Mục 1 (công cụ) → 2. `git clone` → 3. Mục 3 (khởi tạo) → 4. Tự nhập lại VPS profile
   (mục 4.6) → 5. Chạy smoke test.

Thời gian dự kiến: ~45 phút. Nếu lâu hơn, nghĩa là file này thiếu bước — bổ sung ngay.
