# QUY ƯỚC CODE

Đủ để 2 người + nhiều phiên AI viết ra code trông như của một người. Đặt tên: xem
[`06-glossary-quy-uoc.md`](06-glossary-quy-uoc.md).

---

## 1. Nguyên tắc chung

1. **Rõ ràng hơn ngắn gọn.** Code này sẽ bị hội đồng chỉ vào và hỏi "đoạn này làm gì".
2. **Không trừu tượng hoá sớm.** Chỉ tách hàm/lớp khi đã lặp lại **lần thứ ba**.
   Không factory, không strategy pattern, không dependency injection framework.
3. **Một file làm một việc.** File >300 dòng là tín hiệu cần tách (trừ `ipc.ts`).
4. **Không có code chết.** Xoá, đừng comment lại "để đó phòng khi cần" — git nhớ hộ rồi.
5. Comment giải thích **vì sao**, không giải thích **cái gì**. Cái gì thì đọc code là biết.
   Chỗ nào có quyết định đánh đổi → comment 1–2 dòng + link tới ADR.

---

## 2. TypeScript

```ts
// ✔ Kiểu tường minh cho mọi hàm public — đây là hợp đồng
export async function readFileTail(
  vpsId: number,
  remotePath: string,
  fromByte: number,
): Promise<{ content: string; nextByte: number }> { ... }
```

- `strict: true`. **Không `any`** — không biết kiểu thì dùng `unknown` rồi thu hẹp bằng `zod`.
- Mọi dữ liệu đi qua ranh giới (IPC, REST, JSON từ VPS) **phải validate bằng `zod`** trước
  khi dùng. Đây là ranh giới duy nhất mà runtime có thể khác kiểu khai báo.
- Union type + `switch` thay vì kế thừa. Không `class` trừ khi cần giữ trạng thái
  (`SshManager`, `DeployPipeline` là hai ngoại lệ hợp lệ).
- `async/await`, không `.then()` chuỗi. Mọi `await` có khả năng lỗi phải nằm trong `try`
  hoặc được gọi bởi hàm có `try` — không có promise rejection nào không ai bắt.
- Import theo thứ tự: thư viện ngoài → `@shared/*` → tương đối. Prettier tự sắp.

---

## 3. Xử lý lỗi

**Ba tầng, mỗi tầng một nhiệm vụ:**

| Tầng | Nhiệm vụ | Ví dụ |
|---|---|---|
| Thư viện (ssh2, sqlite) | ném lỗi thô | `Error: connect ETIMEDOUT` |
| Module (M1, M4…) | bọc thành lỗi có mã | `throw new AppError('SSH_TIMEOUT', {step:'UPLOAD', cause})` |
| IPC handler | đổi thành `IpcResult` + câu tiếng Việt | `{ok:false, error:{code, message, technical}}` |

```ts
export class AppError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    readonly context: { step?: string; cause?: unknown } = {},
  ) { super(code); }
}
```

Quy tắc:
- **Không nuốt lỗi.** `catch {}` rỗng bị cấm. Bắt được thì hoặc xử lý, hoặc ném tiếp kèm ngữ cảnh.
- **Không để lỗi thô ra UI.** Mọi mã lỗi map sang một câu trong `strings.ts` nói đủ 3 điều:
  chuyện gì · ở bước nào · làm gì tiếp.
- Lỗi trong pipeline **luôn** chạy nhánh dọn dẹp của đúng bước đó
  ([`contracts/deploy-events.md`](contracts/deploy-events.md)).
- `finally` để giải phóng tài nguyên (đóng stream, xoá file tạm), không để logic ở đó.

---

## 4. Logging

| Nơi | Ghi gì | Ghi đâu |
|---|---|---|
| Main process | mọi lệnh SSH (đã che secret), mọi chuyển bước pipeline | `~/.opspilot/logs/app-YYYY-MM-DD.log` + console dev |
| Log deploy | nguyên văn stdout/stderr | `~/.opspilot/logs/deploy-<id>.log` |
| Hành động người dùng | 1 dòng | bảng `action_log` (FR-E3) |
| ML service | request + thời gian inference | stdout (Electron bắt và hiện khi bấm dot ML) |

Định dạng một dòng: `<ISO ts> <LEVEL> [<module>] <thông điệp> <json ngữ cảnh>`

```
2026-10-06T14:32:10Z INFO [deploy] buoc BUILD bat dau {"deployment_id":42,"image":"express-api:v3"}
```

**Cấm ghi ra log:** nội dung `.env`, private key, password, toàn bộ `encrypted_secret`.
Khi cần in giá trị nhạy cảm → `***`. Có unit test kiểm tra hàm che này.

---

## 5. SSH (M1) — quy tắc riêng vì đây là nơi dễ sinh lỗi nhất

1. **Mọi lệnh có timeout.** Không có lệnh nào chạy vô hạn. Timeout mặc định từng bước:
   [`contracts/deploy-events.md`](contracts/deploy-events.md) mục 3.
2. **Mọi tham số người dùng nhập đi vào shell phải qua `shellQuote()`.** Tên app đã được ràng
   buộc bằng regex, nhưng đường dẫn và env thì không.
3. Lệnh dài (build, tar) **phải stream**, không `await` rồi mới đọc toàn bộ output — log
   real-time là FR-B6, và output của `docker build` có thể vài MB.
4. Một connection cho một VPS, dùng lại. Đóng khi xoá VPS hoặc thoát app.
5. Retry chỉ áp dụng cho lỗi mạng (`TIMEOUT`, `HOST_UNREACHABLE`), backoff 1s/2s/4s, tối đa 3
   lần. **Không retry** `AUTH_FAILED` (sai key thì thử lại vẫn sai) và **không retry lệnh có
   tác dụng phụ** (`docker compose up` đã chạy một nửa).

---

## 6. SQLite

- `better-sqlite3`, **đồng bộ** — đúng ý đồ, đừng bọc thành async.
- `PRAGMA journal_mode = WAL` bật lúc mở kết nối (poller ghi trong khi UI đọc).
- Mọi câu lệnh dùng **prepared statement + tham số**. Không nối chuỗi SQL. Không ngoại lệ.
- Nhiều lệnh ghi liên quan nhau → bọc `db.transaction()`. Ví dụ bắt buộc: cấp `version` mới,
  ghi một mẻ `metric_sample` + `score_sample`.
- Migration: file đánh số `001_init.sql`, `002_*.sql`… chạy theo thứ tự, cập nhật
  `schema_version`. **Không sửa file migration đã chạy trên máy người kia.**

---

## 7. Python (ml-service, collector, experiments)

- Ruff làm linter + formatter. Dòng ≤100 ký tự.
- Type hint cho mọi hàm public. Pydantic v2 cho mọi model của FastAPI.
- Không `print()` trong `ml-service` — dùng `logging`. `collector` được phép `print` (đơn giản
  hoá, log đi vào `docker logs`).
- `numpy` cho mọi tính toán trên chuỗi số. Không vòng lặp Python trên mảng lớn.
- **`random_state=42` ở mọi nơi có ngẫu nhiên.** Kết quả thí nghiệm phải tái lập được.
- `collector/collect.py`: chỉ dùng thư viện chuẩn + `requests` + `psycopg2`. Mọi lỗi trong
  vòng lặp phải bị bắt và ghi `null` cho trường tương ứng — **collector không bao giờ được
  chết**, vì chết là mất dữ liệu thí nghiệm.

---

## 8. React (renderer)

- Function component + hook. Không class component.
- State máy chủ (dữ liệu từ IPC) để trong Zustand store; state cục bộ của form dùng `useState`.
- Không gọi IPC trong render — chỉ trong `useEffect` hoặc event handler.
- Danh sách dài (log, lịch sử) phải ảo hoá hoặc giới hạn số dòng. Log dùng xterm.js nên
  không phải lo.
- **Mọi chuỗi hiển thị nằm trong `strings.ts`.** Không hardcode tiếng Việt trong component.
- Component >200 dòng → tách. Trang (`pages/`) chỉ ghép component + gọi store, không chứa
  logic nghiệp vụ.

---

## 9. Trước khi mở PR

- [ ] `pnpm test` và `pytest` xanh
- [ ] `pnpm lint` / `ruff check` không lỗi
- [ ] Không còn `console.log` debug, không còn `TODO` không có người nhận
- [ ] Không có secret trong diff (`git diff --staged | grep -iE 'password|secret|key'`)
- [ ] Đã cập nhật [`05-truy-vet-yeu-cau.md`](05-truy-vet-yeu-cau.md) nếu hoàn thành một FR
- [ ] Đã ghi [`../DECISIONS.md`](../DECISIONS.md) nếu lệch kế hoạch
- [ ] **Tự giải thích được từng hàm public trong diff** — nếu không thì đọc lại trước khi mở PR
