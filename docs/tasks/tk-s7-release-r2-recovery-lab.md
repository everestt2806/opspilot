# R2 — Product crash and settlement recovery

START 06/11/2026 — User yêu cầu thực hiện toàn bộ release. Base R1 `bc4289a`, cùng branch `feat/release-audit-20261204`; R1 local gate PASS, executor vẫn tắt. Skill task-discipline.

## Requirement ledger

| Yêu cầu | Implementation / gate | State |
|---|---|---|
| Crash trước T1 không giả nhận success hoặc replay mutation | Before/after seal giữ unknown/barrier/leases, không terminal; recovery thiếu T1 bị từ chối | PASS |
| Mất kết nối sau T1 / ACK / idle / T2 phục hồi đúng exact record | Cold SQLite reader + pinned reconnect + signed attestation; sau T2 already_settled; final matrix `64a137977fe3` **9/9 PASS** | PASS |
| Lease expiry và fence/identity không bị bypass | Expiry forced past trong DB scratch vẫn chỉ settle exact committed record; đổi pin hoặc target fence thì reject, không release | PASS |
| Không tạo deployment/container mới khi recovery | CID/image/SHA/attempt/pointer; StartedAt/restart count app và collector CID/image/StartedAt giữ nguyên trên final matrix | PASS |
| Cleanup, regression và evidence không lẫn với R1 happy path | 9/9 cleanup=true/source_unchanged=true; scoped lint/Ruff/format PASS, hồ sơ local cùng commit | PASS |

## Phạm vi và cách kiểm

- Tái sử dụng real R1 SSH/Docker/SQLite setup/cleanup. R2 preload chỉ inject crash tại boundary và gọi production recovery; không giả lập reply, receipt, command hoặc metric.
- Target faults dùng helper wrapper trong private scratch, gọi implementation thật rồi kết thúc tiến trình sau durable receipt/ACK/idle. Không sửa target production để có failpoint.
- Recovery sau T1 phải đọc bằng connection SQLite mới và dùng exact persisted terminal. Trước T1 thiếu commit vẫn fail closed; không thêm API quản trị công khai hoặc tự học SSH key.
- Không VPS/DB production, không push/PR/merge. R2 local pass chưa đồng nghĩa service always-on/R3 hoặc nghiệm thu toàn sản phẩm.

## Nhật ký

- START 06/11: R1 có real pipeline và hai production fix; bắt đầu crash matrix trên target/helper hiện hành.
- UPDATE 06/11: focused after-T1 `421f604e2f14` PASS; full matrix `ebacaeaf5f3f` **9/9 PASS**. Mỗi case dùng OpenSSH/SQLite/Docker thật, source/receipt/HMAC không fake. Controller crash được inject bằng exception sau commit thật, target crash bằng process exit sau durable write; không nhận là OS restart của service đã cài.
- UPDATE 06/11: tăng cường no-replay proof bằng StartedAt/restart count của app và collector CID/image/StartedAt. Final matrix `64a137977fe3` **9/9 PASS**, mọi case cleanup/source_unchanged=true; giữ các artifact cũ làm lịch sử, không thay số liệu.

## Các điểm ngắt và kết quả bắt buộc

| Case | Injection và bằng chứng |
|---|---|
| before-seal | Ngắt SSH trước request seal; không receipt/T1, pointer giữ v1, prepared/leases giữ, recovery reject |
| after-seal | Target thoát sau fsync/atomic receipt, trước controller nhận; receipt durable nhưng không T1, không tự tuyên bố v2 active |
| after-t1 | Controller exception sau real finalize; connection SQLite mới đọc T1, reconnect/settle/T2, không deploy lại |
| after-ack | Target thoát sau durable ACK, marker còn unknown; recovery xác minh ACK rồi idle/T2 |
| after-idle | Target thoát sau marker idle trước response; recovery idempotent settle/T2 |
| after-t2 | Controller exception sau T2; recovery already_settled, không SSH mutation |
| expired-t1 | Đặt expiry về quá khứ trong đúng scratch lease; chỉ hoàn tất settlement đã committed, không cấp quyền mutation mới |
| changed-pin | Sau T1 đổi fingerprint/revision trong DB; không dùng context cũ để settle binding mới |
| stale-fence | Target marker có fence cao hơn; old attempt bị từ chối, không release lease |

## Lệnh và evidence

Node22/Linux, bundle R1 giữ nguyên tại `/var/tmp/opspilot-p3e3a-runtime/r1-lab.cjs`; cách build/setup ở [README](../../app/scripts/product-runtime-lab/README.md).

```sh
OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r1-lab.cjs node app/scripts/product-runtime-lab/recovery.mjs
```

Report chính: `app/.out-scripts/product-runtime-recovery/<nonce>/result.json`. Mỗi row dẫn nonce R1 child chứa SQLite backup/JSONL. Child cố ý kết thúc bằng `R2_CHECKPOINT_FINISHED` để chạy cleanup; chỉ R2 aggregate được nhận PASS, không nhận child đó là R1 baseline PASS.

- ESLint `scripts/product-runtime-lab` 0 errors/warnings; Ruff check + format check `recovery-target.py` PASS.
- Thông tin tích hợp: full app regression trên working tree có thêm R3a candidate → **1414 PASS, 2 SKIP, 0 FAIL**, Node/Web/scripts/lab types/build PASS. Đây không phải count của snapshot R2 độc lập; R2 gate chạy trên frozen R1 bundle và target hashes trong từng row. Warnings jsdom không phải native GUI proof.

Giới hạn: chưa có installed-service OS restart/soak, production enrollment, live VPS hay pre-T1 operator reconciliation UI. Pre-T1 unknown không được auto replay để che lỗi. Các phần đó nằm ở R3 và release gates còn lại; không có accepted exception.

HANDOFF-LOCAL 06/11 — R2 **CHỜ REVIEW**, đủ local crash/recovery gate; implementation là commit chứa `recovery.mjs` và hồ sơ này (`git log -1 -- app/scripts/product-runtime-lab/recovery.mjs`). Chỉ stage R2 harness/docs, không kéo R3a source đang triển khai vào commit. User đã yêu cầu tự làm tiếp; chuyển R3 adapter/bootstrap/security và service restart gate, không dừng chờ prompt. Không push/PR/merge/VPS mutation.
