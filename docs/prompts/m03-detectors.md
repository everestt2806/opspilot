# M03 — Detector engine · Người A · Tuần 2

`app/src/main/detectors/` — FR-B1, FR-B2, FR-B8

## Mục tiêu
Nhìn vào một thư mục source, xác định framework, và sinh ra kế hoạch build (Dockerfile
template, build command, port, env bắt buộc). **Tính mở rộng của kiến trúc này là một trong 7
tiêu chí chấm điểm của đề tài** — thêm framework mới phải là thêm 1 file + 1 dòng, không sửa
lõi.

## Đọc trước
- **`docs/contracts/detector-contract.ts`** — interface, không được đổi
- `docs/01-ke-hoach.md` M3 (bảng quy tắc nhận diện)
- `docs/02-ui-ux-spec.md` mục 3.2 bước 2 (UI hiển thị kết quả và lý do trượt)

## Cần viết

```
detectors/
├─ types.ts        ← copy từ contracts/detector-contract.ts, KHÔNG sửa
├─ sourceTree.ts   ← dựng SourceTree từ một thư mục thật (phần duy nhất chạm fs)
├─ nextjs.ts  static-spa.ts  express.ts
├─ index.ts        ← export const DETECTORS + detectFramework()
└─ __fixtures__/   ← thư mục giả cho unit test
```

**`sourceTree.ts`** đọc tối đa 2 cấp thư mục, bỏ qua `node_modules/.git/dist/.next/__pycache__`,
đọc sẵn nội dung: `package.json`, `.env.example`, `requirements.txt`, `pyproject.toml`,
`next.config.*`, `vite.config.*`, `Dockerfile`. File >1MB thì bỏ qua nội dung, chỉ ghi tên.

**Ba detector là hàm thuần** — chỉ nhận `SourceTree`, không đụng fs, không gọi mạng, không throw.

## Quy tắc nhận diện (đã chốt)

| Detector | priority | `detect()` trả true khi |
|---|---|---|
| `nextjs` | 30 | `package.json` → `dependencies` có `next` |
| `static-spa` | 20 | `devDependencies` có `vite` **và không có** `next` |
| `express` | 10 | `dependencies` có `express`, không có `next`, không có `vite` |

Engine chạy priority giảm dần, lấy detector đầu tiên `true`. Các detector khác cũng `true`
đưa vào `alternatives`.

## `buildPlan()` cho từng framework

| | `nextjs` | `express` | `static-spa` |
|---|---|---|---|
| template | `nextjs.Dockerfile` | `express.Dockerfile` | `static-spa.Dockerfile` |
| build command | `npm ci && npm run build` | `npm ci` | `npm ci && npm run build` |
| start command | `npm start` | `node <entry>` (từ `main`/`scripts.start`) | `nginx -g 'daemon off;'` (image nhỏ phục vụ tĩnh) |
| `containerPort` | 3000 | 3000 (hoặc từ `PORT` trong `.env.example`) | 80 |
| `healthcheckPath` | `/` | `/health` nếu tìm thấy chuỗi `'/health'` trong source, không thì `/` | `/` |
| `requiredEnv` | `NODE_ENV` + từ `.env.example` | `NODE_ENV`, `PORT` + từ `.env.example` | từ `.env.example` (biến `VITE_*`) |

**`needsDb = true`** khi `dependencies` có một trong: `pg`, `prisma`, `typeorm`, `sequelize`.
Khi đó thêm `DATABASE_URL` vào `requiredEnv`.
Thấy `mongoose` → `manualSteps` cảnh báo "chưa hỗ trợ MongoDB, hãy tự cấu hình kết nối ngoài".

**`requiredEnv`** = hằng theo framework + mọi khoá parse từ `.env.example` (regex
`^([A-Z][A-Z0-9_]*)=` trên từng dòng, bỏ dòng comment) + `DATABASE_URL` nếu `needsDb`.
Loại trùng, giữ thứ tự xuất hiện.

**`detectedVersion`** đọc từ `dependencies` (vd `"next": "^14.2.3"` → `14.2.3`), chỉ để hiển thị.

## `explain()` — đừng bỏ qua

Trả về danh sách dấu hiệu **đã kiểm tra và kết quả**, kể cả khi trượt. Ví dụ với `nextjs`:

```
[ {description: "Có file package.json", passed: true},
  {description: "package.json có dependency 'next'", passed: false, found: "không tìm thấy"},
  {description: "Có file next.config.js hoặc next.config.mjs", passed: false} ]
```

Không detector nào khớp → UI hiện card đỏ liệt kê toàn bộ dấu hiệu của **mọi** detector.
Sự minh bạch này là điểm cộng khi demo: hệ thống nói được *vì sao* nó không nhận ra.

## Unit test bắt buộc (`vitest`) — ≥4 case mỗi detector

| Case | Kỳ vọng |
|---|---|
| Nhận đúng | `detect() === true`, `buildPlan()` đúng template và port |
| Từ chối đúng | dự án framework khác → `false` |
| Thư mục rác | rỗng / chỉ có `README.md` → `false`, **không throw** |
| Nhập nhằng | có cả `next` lẫn `express` → engine chọn `nextjs`, `alternatives` chứa `express` |

Thêm: `.env.example` 3 biến → `requiredEnv` chứa đủ 3 · có `prisma` → `needsDb === true` ·
`package.json` hỏng cú pháp → `false`, không throw.

Fixture là **object `SourceTree` dựng bằng tay**, không đọc file thật.

## Định nghĩa xong
- [ ] `pnpm try:detect ./demo-apps/next-blog` → `nextjs`, in ra `BuildPlan` đầy đủ
- [ ] Tương tự đúng với `express-api` và `vite-spa`
- [ ] Chạy trên một thư mục ngẫu nhiên (vd `C:\Windows`) → `matched: false`, không crash,
      không treo
- [ ] Toàn bộ unit test xanh
- [ ] **Kiểm chứng tính mở rộng:** viết nháp `flask.ts` trong 30 phút và xác nhận
      **không phải sửa dòng nào** trong `index.ts` ngoài việc thêm vào mảng
