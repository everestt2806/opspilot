# M02 — Mã hoá credential · Người A · Tuần 1

`app/src/main/crypto/credentials.ts` — FR-A1, NFR-2

## Mục tiêu
Lưu private key / password SSH xuống SQLite ở dạng đã mã hoá, giải mã được khi cần kết nối,
và **không bao giờ** để lộ ra log hay ra ngoài máy.

## Đọc trước
- `docs/contracts/schema.sql` bảng `vps` (các cột `crypto_scheme`, `encrypted_secret`, `iv`, `auth_tag`)
- `docs/14-quyet-dinh-kien-truc.md` **ADR-002**

## Thiết kế: hai scheme, cùng một interface

```ts
export interface CryptoScheme {
  readonly id: 'safe_storage' | 'aes_256_gcm';
  encrypt(plaintext: string): { ciphertext: Buffer; iv?: Buffer; authTag?: Buffer };
  decrypt(input: { ciphertext: Buffer; iv?: Buffer; authTag?: Buffer }): string;
  isAvailable(): boolean;
}

export function getScheme(id?: 'safe_storage' | 'aes_256_gcm'): CryptoScheme;
```

**Mặc định `safe_storage`** (ADR-002). `aes_256_gcm` viết sẵn nhưng chưa dùng — bật bằng
config khi GVHD yêu cầu đúng nguyên văn NFR-2. Vì đã có sẵn nên việc đổi tốn ~1 ngày và
**không lan sang module khác**.

### `safe_storage`
`safeStorage.encryptString()` / `decryptString()` của Electron. `iv` và `auth_tag` để `null`.
`safeStorage.isEncryptionAvailable() === false` (hiếm, Linux thiếu keyring) → báo lỗi rõ ràng,
**không** âm thầm lưu bản rõ.

### `aes_256_gcm`
- Khoá dẫn xuất: `scrypt(passphrase, salt, 32, { N: 2**15, r: 8, p: 1 })`
- `salt` 16 byte ngẫu nhiên lưu trong file `userData/crypto.salt` (tạo lần đầu)
- `iv` 12 byte ngẫu nhiên **mỗi lần mã hoá**, `authTag` 16 byte, lưu vào 2 cột riêng
- Passphrase do người dùng nhập lúc mở app, giữ trong RAM, không ghi ra đĩa

## Hàm mức cao (module khác chỉ dùng 2 hàm này)

```ts
export function saveSecret(vpsId: number, plaintext: string): void;   // ghi thẳng vào bảng vps
export function loadSecret(vpsId: number): string;                    // đọc + giải mã
```

## Ràng buộc — đọc kỹ, đây là phần bảo mật

1. **Bản rõ chỉ tồn tại trong RAM, trong thời gian ngắn nhất có thể.** Không ghi file tạm,
   không đưa vào biến toàn cục, không đưa vào state của renderer.
2. **Renderer không bao giờ nhận được bản rõ.** IPC `vps:create` nhận `secret` từ form, main
   mã hoá **ngay**, không trả lại.
3. **Không log.** Export hàm `maskSecrets(text: string): string` thay mọi chuỗi trông giống
   key/password bằng `***`, dùng trong logger (`docs/10` mục 4).
4. `decrypt` **phải throw** khi dữ liệu bị sửa (GCM tự phát hiện; `safeStorage` cũng vậy).
   Không được trả chuỗi rác.
5. Không tự cài đặt thuật toán mật mã — chỉ dùng `node:crypto` và `safeStorage`.

## Unit test bắt buộc (`vitest`)
- [ ] Mã hoá → giải mã ra đúng bản gốc, với: chuỗi ASCII · chuỗi tiếng Việt có dấu ·
      private key ed25519 nhiều dòng thật
- [ ] Sửa 1 byte `ciphertext` → `decrypt` **throw**
- [ ] Sửa 1 byte `authTag` (scheme AES) → **throw**
- [ ] Hai lần mã hoá cùng bản rõ → `ciphertext` **khác nhau** (do IV ngẫu nhiên)
- [ ] `maskSecrets` xoá sạch password và khối `-----BEGIN ... KEY-----`

Test `safe_storage` cần môi trường Electron → tách thành test riêng chạy trong Electron, hoặc
test qua interface với scheme AES (đủ để chứng minh logic đúng, ghi rõ trong báo cáo).

## Định nghĩa xong
- [ ] Toàn bộ unit test xanh
- [ ] Thêm VPS qua UI → cột `encrypted_secret` trong DB **không đọc được bằng mắt**
- [ ] Mở lại app → kết nối SSH vẫn thành công (giải mã đúng)
- [ ] `grep -ri "BEGIN OPENSSH" ~/.opspilot/logs/` → **không có kết quả**
